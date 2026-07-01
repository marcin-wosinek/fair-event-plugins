<?php
/**
 * Payment REST API Endpoint
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Payment\PaymentStatus;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Database\PaymentLogRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Class for handling payment REST API endpoints
 */
class PaymentEndpoint extends WP_REST_Controller {

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
	protected $rest_base = 'payments';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/nonce',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_nonce' ),
					// Public — generates a nonce for anonymous payment forms; reads no data.
					'permission_callback' => '__return_true',
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_payment' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'amount'      => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'currency'    => array(
							'required'          => false,
							'type'              => 'string',
							'default'           => get_option( 'fair_payment_currency', 'EUR' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'description' => array(
							'required'          => false,
							'type'              => 'string',
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'post_id'     => array(
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'block_id'    => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'nonce'       => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<transaction_id>\d+)/status',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_transaction_status' ),
					// Anonymous read is intentional (post-Mollie redirect flow); ownership is enforced
					// by a per-transaction access token. Permission failures return WP_Error 404 to
					// avoid confirming which transaction IDs exist.
					'permission_callback' => array( $this, 'get_transaction_status_permissions_check' ),
					'args'                => array(
						'transaction_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'token'          => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Return a fresh nonce for the payment form.
	 *
	 * @return WP_REST_Response
	 */
	public function get_nonce() {
		return new WP_REST_Response( array( 'nonce' => wp_create_nonce( 'fpc_payment_form' ) ) );
	}

	/**
	 * Find a block in a parsed block tree by its blockId attribute.
	 *
	 * @param array  $blocks   Parsed blocks array.
	 * @param string $block_id UUID to search for.
	 * @return array|null Matching block or null.
	 */
	private function find_block_by_id( array $blocks, string $block_id ): ?array {
		foreach ( $blocks as $block ) {
			if ( isset( $block['attrs']['blockId'] ) && $block['attrs']['blockId'] === $block_id ) {
				return $block;
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = $this->find_block_by_id( $block['innerBlocks'], $block_id );
				if ( null !== $found ) {
					return $found;
				}
			}
		}
		return null;
	}

	/**
	 * Create a new payment
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_payment( WP_REST_Request $request ) {
		// TODO: Implement different behavior for logged-in vs anonymous users.
		// - Logged-in users: Track in user profile.
		// - Anonymous users: Require email.
		// See: REST_API_BACKEND.md for implementation guidance.

		// Manual nonce check — apiFetch nonce auto-verification only applies to authenticated
		// requests; public endpoints must verify manually. See REST_API_BACKEND.md.
		if ( ! wp_verify_nonce( $request->get_param( 'nonce' ), 'fpc_payment_form' ) ) {
			return new WP_Error(
				'invalid_nonce',
				__( 'Invalid request.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		$logger = new PaymentLogRepository();

		$currency    = $request->get_param( 'currency' );
		$description = $request->get_param( 'description' );
		$post_id     = $request->get_param( 'post_id' );
		$block_id    = $request->get_param( 'block_id' );

		// Derive authoritative amount from saved block content.
		$post = $post_id ? get_post( $post_id ) : null;
		if ( ! $post ) {
			return new WP_Error(
				'invalid_block',
				__( 'Block not found.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		$blocks        = parse_blocks( $post->post_content );
		$matched_block = $this->find_block_by_id( $blocks, $block_id );

		if ( ! $matched_block ) {
			return new WP_Error(
				'invalid_block',
				__( 'Block not found.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		$expected_amount  = floatval( $matched_block['attrs']['amount'] ?? 0 );
		$submitted_amount = floatval( $request->get_param( 'amount' ) );

		if ( $submitted_amount < $expected_amount ) {
			return new WP_Error(
				'amount_too_low',
				__( 'Amount does not match block configuration.', 'fair-payments-connector' ),
				array( 'status' => 422 )
			);
		}

		// Use the server-derived amount, not the client value.
		$amount = (string) $expected_amount;

		$logger->log(
			'payment_creation_started',
			array(
				'level'   => 'info',
				'message' => sprintf( 'Payment request received for post %d', (int) $post_id ),
				'context' => array(
					'amount'      => $amount,
					'currency'    => $currency,
					'description' => $description,
					'post_id'     => $post_id,
				),
			)
		);

		// Check if Mollie is configured.
		if ( ! MolliePaymentHandler::is_configured() ) {
			$logger->log(
				'payment_validation_failed',
				array(
					'level'   => 'warning',
					'message' => 'Mollie not configured',
					'context' => array( 'reason' => 'mollie_not_configured' ),
				)
			);
			return new WP_Error(
				'mollie_not_configured',
				__( 'Mollie payment gateway is not configured. Please configure your API keys in settings.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		// Validate amount.
		if ( ! is_numeric( $amount ) || $amount <= 0 ) {
			$logger->log(
				'payment_validation_failed',
				array(
					'level'   => 'warning',
					'message' => 'Invalid payment amount',
					'context' => array(
						'reason' => 'invalid_amount',
						'amount' => $amount,
					),
				)
			);
			return new WP_Error(
				'invalid_amount',
				__( 'Invalid payment amount.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		// Prepare description.
		$final_description = ! empty( $description ) ? $description : sprintf(
			/* translators: %s: amount and currency */
			__( 'Payment of %1$s %2$s', 'fair-payments-connector' ),
			$amount,
			$currency
		);

		// Create transaction with single line item using new API.
		$line_items = array(
			array(
				'name'     => $final_description,
				'quantity' => 1,
				'amount'   => (float) $amount,
			),
		);

		$transaction_id = TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'    => $currency,
				'description' => $final_description,
				'post_id'     => $post_id,
				'user_id'     => get_current_user_id(),
				'metadata'    => array(
					'post_id'         => $post_id,
					'user_id'         => get_current_user_id(),
					'legacy_rest_api' => true,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			$logger->log(
				'transaction_creation_failed',
				array(
					'level'   => 'error',
					'message' => $transaction_id->get_error_message(),
					'context' => array(
						'error_code' => $transaction_id->get_error_code(),
					),
				)
			);
			return new WP_Error(
				'transaction_creation_failed',
				$transaction_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// Load freshly created transaction so we can attach its access token to the
		// post-Mollie redirect URL. The token gates the /status endpoint.
		$transaction = Transaction::get_by_id( $transaction_id );

		// Prepare redirect URL.
		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'post_id'               => $post_id,
				'token'                 => $transaction ? $transaction->access_token : '',
			),
			$post_id ? get_permalink( $post_id ) : home_url()
		);

		// Initiate payment immediately.
		$payment = TransactionAPI::initiate_payment(
			$transaction_id,
			array(
				'redirect_url' => $redirect_url,
				'webhook_url'  => rest_url( 'fair-payments-connector/v1/webhook' ),
			)
		);

		if ( is_wp_error( $payment ) ) {
			$logger->log(
				'payment_initiation_failed',
				array(
					'level'          => 'error',
					'transaction_id' => (int) $transaction_id,
					'message'        => $payment->get_error_message(),
					'context'        => array(
						'error_code' => $payment->get_error_code(),
					),
				)
			);
			return new WP_Error(
				'payment_initiation_failed',
				$payment->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$logger->log(
			'payment_creation_succeeded',
			array(
				'level'          => 'info',
				'transaction_id' => (int) $transaction_id,
				'message'        => sprintf(
					'Payment created successfully (Mollie %s)',
					$payment['mollie_payment_id']
				),
				'context'        => array(
					'mollie_payment_id' => $payment['mollie_payment_id'],
					'status'            => $payment['status'],
				),
			)
		);

		// Return same response structure for backward compatibility.
		return new WP_REST_Response(
			array(
				'success'           => true,
				'transaction_id'    => $transaction_id,
				'mollie_payment_id' => $payment['mollie_payment_id'],
				'checkout_url'      => $payment['checkout_url'],
				'status'            => $payment['status'],
			),
			201
		);
	}

	/**
	 * Get transaction status
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_transaction_status( WP_REST_Request $request ) {
		$transaction_id = $request->get_param( 'transaction_id' );

		// Get transaction from database.
		$transaction = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		// Prepare response data. `status` is kept as the raw transaction status for
		// backward compatibility; `lifecycle_status` is the canonical
		// confirmed|processing|failed state the shared frontend poller reads.
		$response_data = array(
			'transaction_id'    => $transaction->id,
			'status'            => $transaction->status,
			'lifecycle_status'  => PaymentStatus::from_raw_status( (string) $transaction->status ),
			'amount'            => $transaction->amount,
			'currency'          => $transaction->currency,
			'description'       => $transaction->description,
			'mollie_payment_id' => $transaction->mollie_payment_id,
			'testmode'          => (bool) $transaction->testmode,
		);

		return new WP_REST_Response( $response_data, 200 );
	}

	/**
	 * Permission check for the transaction status endpoint.
	 *
	 * Returns a 404 WP_Error on any failure so anonymous callers cannot enumerate
	 * transaction IDs by distinguishing missing rows from token mismatches.
	 *
	 * Allowed without a token:
	 * - Site admins (manage_options) — support / debugging.
	 * - The transaction's owner when logged in (user_id matches).
	 *
	 * Otherwise the request must carry a `token` query arg that constant-time
	 * matches the row's access_token.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error True if allowed, WP_Error (404) otherwise.
	 */
	public function get_transaction_status_permissions_check( WP_REST_Request $request ) {
		$not_found = new WP_Error(
			'transaction_not_found',
			__( 'Transaction not found.', 'fair-payments-connector' ),
			array( 'status' => 404 )
		);

		$transaction = Transaction::get_by_id( $request->get_param( 'transaction_id' ) );

		if ( ! $transaction ) {
			return $not_found;
		}

		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		if (
			is_user_logged_in()
			&& ! empty( $transaction->user_id )
			&& (int) $transaction->user_id === get_current_user_id()
		) {
			return true;
		}

		$provided = (string) $request->get_param( 'token' );
		$expected = (string) ( $transaction->access_token ?? '' );

		if ( '' === $expected || '' === $provided ) {
			return $not_found;
		}

		if ( hash_equals( $expected, $provided ) ) {
			return true;
		}

		return $not_found;
	}
}
