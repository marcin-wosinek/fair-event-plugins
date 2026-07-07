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
		$logger = new PaymentLogRepository();

		// Get payment ID from webhook.
		$mollie_payment_id = $request->get_param( 'id' );

		$logger->log(
			'webhook_received',
			array(
				'level'   => 'info',
				'message' => sprintf( 'Webhook received for Mollie %s', $mollie_payment_id ? $mollie_payment_id : '(empty)' ),
				'context' => array( 'mollie_payment_id' => $mollie_payment_id ),
			)
		);

		if ( empty( $mollie_payment_id ) ) {
			$logger->log(
				'webhook_failed',
				array(
					'level'   => 'warning',
					'message' => 'Webhook missing payment ID',
				)
			);
			return new WP_Error(
				'missing_payment_id',
				__( 'Payment ID is missing from webhook.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		try {
			// Get transaction from database first to determine testmode.
			$transaction = Transaction::get_by_mollie_id( $mollie_payment_id );

			if ( ! $transaction ) {
				$logger->log(
					'webhook_failed',
					array(
						'level'   => 'error',
						'message' => sprintf( 'Webhook for unknown Mollie payment %s (orphan)', $mollie_payment_id ),
						'context' => array( 'mollie_payment_id' => $mollie_payment_id ),
					)
				);
				return new WP_Error(
					'transaction_not_found',
					__( 'Transaction not found in database.', 'fair-payments-connector' ),
					array( 'status' => 404 )
				);
			}

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
