<?php
/**
 * Webhook REST API Endpoint
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\Services\PublicEndpointRateLimiter;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Class for handling webhook notifications from Mollie
 */
class WebhookEndpoint extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'webhook';

	/**
	 * Shape of an acceptable Mollie payment ID.
	 */
	const PAYMENT_ID_PATTERN = '/^[A-Za-z0-9_]{1,64}$/';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'handle_webhook' ),
					// Public — Mollie calls it without credentials. Requests with
					// a missing, malformed or unknown payment ID are throttled
					// per IP in handle_webhook().
					'permission_callback' => '__return_true',
				),
			)
		);
	}

	/**
	 * Handle webhook notification from Mollie
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function handle_webhook( WP_REST_Request $request ) {
		$logger  = new PaymentLogRepository();
		$limiter = new PublicEndpointRateLimiter();

		// Get payment ID from webhook.
		$raw_id = $request->get_param( 'id' );

		if ( empty( $raw_id ) ) {
			return $this->reject_invalid_webhook(
				$limiter,
				$logger,
				null,
				array(
					'level'   => 'warning',
					'message' => 'Webhook missing payment ID',
				),
				new WP_Error(
					'missing_payment_id',
					__( 'Payment ID is missing from webhook.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				)
			);
		}

		// Mollie payment IDs are short alphanumeric strings such as
		// "tr_WDqYK6vllg". Anything else is refused before it reaches the
		// database or the log.
		if ( ! is_scalar( $raw_id ) || ! preg_match( self::PAYMENT_ID_PATTERN, (string) $raw_id ) ) {
			return $this->reject_invalid_webhook(
				$limiter,
				$logger,
				null,
				array(
					'level'   => 'warning',
					'message' => 'Webhook payment ID is malformed',
				),
				new WP_Error(
					'invalid_payment_id',
					__( 'Payment ID in webhook is invalid.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				)
			);
		}

		$mollie_payment_id = (string) $raw_id;

		try {
			// Get transaction from database first to determine testmode.
			$transaction = Transaction::get_by_mollie_id( $mollie_payment_id );

			// Unknown IDs never reach Mollie, and count against the caller's
			// invalid-webhook budget so they can't flood the log either.
			if ( ! $transaction ) {
				return $this->reject_invalid_webhook(
					$limiter,
					$logger,
					$mollie_payment_id,
					array(
						'level'   => 'error',
						'message' => sprintf( 'Webhook for unknown Mollie payment %s (orphan)', $mollie_payment_id ),
						'context' => array( 'mollie_payment_id' => $mollie_payment_id ),
					),
					new WP_Error(
						'transaction_not_found',
						__( 'Transaction not found in database.', 'fair-payments-connector' ),
						array( 'status' => 404 )
					)
				);
			}

			$this->log_received( $logger, $mollie_payment_id );

			// Skip terminal-state transactions — re-processing would re-fire hooks and
			// re-run the balance fee scan. `authorized` is excluded: it can still move
			// to `paid` so a follow-up webhook must be handled normally.
			$terminal_states = array( 'paid', 'failed', 'canceled', 'expired' );
			if ( in_array( $transaction->status, $terminal_states, true ) ) {
				$logger->log(
					'webhook_skipped',
					array(
						'level'          => 'info',
						'transaction_id' => (int) $transaction->id,
						'message'        => sprintf(
							'Webhook skipped — transaction already in terminal state "%s"',
							$transaction->status
						),
						'context'        => array(
							'mollie_payment_id' => $mollie_payment_id,
							'status'            => $transaction->status,
						),
					)
				);
				return new WP_REST_Response(
					array(
						'success' => true,
						'status'  => $transaction->status,
					),
					200
				);
			}

			// Retrieve payment status from Mollie using correct testmode.
			$handler = new MolliePaymentHandler();
			$options = array(
				'testmode' => ! empty( $transaction->testmode ),
			);
			$payment = $handler->get_payment( $mollie_payment_id, $options );

			// Update transaction status. Compare-and-swap against the status we just
			// read, so a concurrent sync (e.g. triggered by the customer's browser
			// reloading the payment page) can't both win and re-fire status hooks.
			$updated = Transaction::update_status( $mollie_payment_id, $payment->status, $transaction->status );

			if ( ! $updated ) {
				$current = Transaction::get_by_mollie_id( $mollie_payment_id );

				if ( $current && $current->status === $payment->status ) {
					// Another process already made this exact transition — nothing left to do.
					$logger->log(
						'webhook_skipped',
						array(
							'level'          => 'info',
							'transaction_id' => (int) $transaction->id,
							'message'        => 'Webhook skipped — status already updated by a concurrent request',
							'context'        => array(
								'mollie_payment_id' => $mollie_payment_id,
								'status'            => $payment->status,
							),
						)
					);
					return new WP_REST_Response(
						array(
							'success' => true,
							'status'  => $payment->status,
						),
						200
					);
				}

				$logger->log(
					'webhook_failed',
					array(
						'level'          => 'error',
						'transaction_id' => (int) $transaction->id,
						'message'        => 'Failed to update transaction status from webhook',
						'context'        => array(
							'mollie_payment_id' => $mollie_payment_id,
							'mollie_status'     => $payment->status,
						),
					)
				);
				return new WP_Error(
					'status_update_failed',
					__( 'Failed to update transaction status.', 'fair-payments-connector' ),
					array( 'status' => 500 )
				);
			}

			$logger->log(
				'webhook_status_updated',
				array(
					'level'          => 'info',
					'transaction_id' => (int) $transaction->id,
					'message'        => sprintf(
						'Status updated from %s to %s via webhook',
						$transaction->status,
						$payment->status
					),
					'context'        => array(
						'mollie_payment_id' => $mollie_payment_id,
						'old_status'        => $transaction->status,
						'new_status'        => $payment->status,
					),
				)
			);

			// Handle payment status actions.
			$this->handle_payment_status( $payment, $transaction );

			// Return 200 OK to Mollie.
			return new WP_REST_Response(
				array(
					'success' => true,
					'status'  => $payment->status,
				),
				200
			);

		} catch ( \Exception $e ) {
			$logger->log(
				'webhook_failed',
				array(
					'level'   => 'error',
					'message' => sprintf( 'Webhook handler exception: %s', $e->getMessage() ),
					'context' => array(
						'exception_class'   => get_class( $e ),
						'mollie_payment_id' => $mollie_payment_id,
					),
				)
			);

			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => $e->getMessage(),
				),
				200
			);
		}
	}

	/**
	 * Answer a webhook with a missing, malformed or unknown payment ID.
	 *
	 * Below the caller's invalid-webhook limit the request is counted, logged
	 * and answered with its own error. Past the limit it gets a 429 and is not
	 * logged, so repeated bogus calls can't flood the payment log. Valid
	 * webhooks never consult this budget, so a noisy source cannot hold up
	 * Mollie's notifications for real payments.
	 *
	 * @param PublicEndpointRateLimiter $limiter     Rate limiter.
	 * @param PaymentLogRepository      $logger      Payment logger.
	 * @param string|null               $logged_id   Payment ID to log; null when it is missing or malformed.
	 * @param array                     $failure_log Arguments of the webhook_failed log entry.
	 * @param WP_Error                  $error       Error returned below the limit.
	 * @return WP_Error
	 */
	private function reject_invalid_webhook( PublicEndpointRateLimiter $limiter, PaymentLogRepository $logger, $logged_id, array $failure_log, WP_Error $error ) {
		$limited = $limiter->check( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK );
		if ( $limited ) {
			return $limited;
		}

		$limiter->record( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK );

		$this->log_received( $logger, $logged_id );
		$logger->log( 'webhook_failed', $failure_log );

		return $error;
	}

	/**
	 * Log that a webhook arrived.
	 *
	 * @param PaymentLogRepository $logger            Payment logger.
	 * @param string|null          $mollie_payment_id Payment ID; null when it is missing or malformed.
	 * @return void
	 */
	private function log_received( PaymentLogRepository $logger, $mollie_payment_id ) {
		$logger->log(
			'webhook_received',
			array(
				'level'   => 'info',
				'message' => sprintf( 'Webhook received for Mollie %s', null !== $mollie_payment_id ? $mollie_payment_id : '(empty)' ),
				'context' => array( 'mollie_payment_id' => $mollie_payment_id ),
			)
		);
	}

	/**
	 * Handle different payment statuses
	 *
	 * Delegates to TransactionAPI::handle_payment_status_change() for shared logic.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 * @return void
	 */
	private function handle_payment_status( $payment, $transaction ) {
		TransactionAPI::handle_payment_status_change( $payment, $transaction );
	}
}
