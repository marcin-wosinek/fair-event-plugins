<?php
/**
 * Payment REST API Endpoint
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\Payment\MollieCredentials;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Payment\PaymentStatus;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\Services\PublicEndpointRateLimiter;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * Class for handling payment REST API endpoints
 */
class PaymentEndpoint extends WP_REST_Controller {

	/**
	 * Request header carrying the per-transaction access token for status reads.
	 *
	 * @var string
	 */
	const TOKEN_HEADER = 'X-Fair-Payment-Token';

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
					// Throttled per IP in get_nonce().
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
					// Public — anonymous visitors pay through the Simple Payment block.
					// Throttled per IP in create_payment().
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
							'default'           => Money::site_currency(),
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
					// by a per-transaction access token sent in the X-Fair-Payment-Token header.
					// Permission failures return WP_Error 404 to avoid confirming which transaction
					// IDs exist.
					'permission_callback' => array( $this, 'get_transaction_status_permissions_check' ),
					'args'                => array(
						'transaction_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						// Deprecated fallback for the access token; prefer the header. Still
						// accepted because other payment flows keep the token in their return
						// URL and the site-wide callback notice reads it from there.
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
	 * @return WP_REST_Response|WP_Error Response object, or a 429 error once the caller's limit is reached.
	 */
	public function get_nonce() {
		$limited = ( new PublicEndpointRateLimiter() )->attempt( PublicEndpointRateLimiter::BUCKET_NONCE );
		if ( $limited ) {
			return $limited;
		}

		return new WP_REST_Response( array( 'nonce' => wp_create_nonce( 'fpc_payment_form' ) ) );
	}

	/**
	 * Find all blocks in a parsed block tree matching a blockId attribute.
	 *
	 * A page can legitimately contain unrelated blocks that happen to carry a
	 * `blockId` attribute of their own; this only matches Simple Payment
	 * blocks so it can't be confused by those.
	 *
	 * @param array  $blocks   Parsed blocks array.
	 * @param string $block_id UUID to search for.
	 * @return array List of matching blocks (possibly empty).
	 */
	private function find_blocks_by_id( array $blocks, string $block_id ): array {
		$matches = array();
		foreach ( $blocks as $block ) {
			if (
				'fair-payment/simple-payment' === ( $block['blockName'] ?? '' )
				&& isset( $block['attrs']['blockId'] )
				&& $block['attrs']['blockId'] === $block_id
			) {
				$matches[] = $block;
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$matches = array_merge( $matches, $this->find_blocks_by_id( $block['innerBlocks'], $block_id ) );
			}
		}
		return $matches;
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

		// Throttle before any work: every attempt past this point may write
		// transaction and log rows and call Mollie. Applies to signed-in
		// callers too, since the route is public either way.
		$limited = ( new PublicEndpointRateLimiter() )->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT );
		if ( $limited ) {
			return $limited;
		}

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

		// WordPress' `required` check on args passes on ''. An empty block_id would
		// otherwise match any legacy block whose saved blockId is also '', so reject
		// it outright rather than resolving an ambiguous match.
		if ( '' === $block_id ) {
			return new WP_Error(
				'invalid_block',
				__( 'Block not found.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		// Derive authoritative amount from saved block content.
		$post = $post_id ? get_post( $post_id ) : null;
		if ( ! $post ) {
			return new WP_Error(
				'invalid_block',
				__( 'Block not found.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		$blocks         = parse_blocks( $post->post_content );
		$matched_blocks = $this->find_blocks_by_id( $blocks, $block_id );

		if ( ! $matched_blocks ) {
			return new WP_Error(
				'invalid_block',
				__( 'Block not found.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		// More than one block shares this id (e.g. a pre-fix duplicated block
		// nobody has reopened in the editor since). Trusting the first match
		// would mischarge the buyer if the copies have different prices, so
		// fail closed instead.
		if ( count( $matched_blocks ) > 1 ) {
			return new WP_Error(
				'ambiguous_block',
				__( 'This payment option is misconfigured. Please contact the site owner.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		$matched_block    = $matched_blocks[0];
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

		// Connected, but the stored credentials cannot be read right now.
		if ( ! MolliePaymentHandler::is_configured() && get_option( 'fair_payment_mollie_connected', false ) ) {
			$logger->log(
				'payment_validation_failed',
				array(
					'level'   => 'error',
					'message' => 'Mollie credentials unavailable',
					'context' => array(
						'reason'            => 'mollie_credentials_unavailable',
						'credential_status' => MollieCredentials::status(),
					),
				)
			);
			return new WP_Error(
				'payments_unavailable',
				__( 'Online payment is temporarily unavailable. Please try again later or contact the organizer.', 'fair-payments-connector' ),
				array( 'status' => 503 )
			);
		}

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

		// Load the freshly created transaction so its access token can be returned
		// to the browser. The token gates the /status endpoint; it is deliberately
		// kept out of the redirect URL, where Referer headers, browser history and
		// access logs would expose it.
		$transaction = Transaction::get_by_id( $transaction_id );

		// Prepare redirect URL.
		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'post_id'               => $post_id,
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
			// Return as-is: initiate_payment() already sanitizes the message and
			// sets status/admin data, so re-wrapping here would strip data.admin
			// and re-flatten the status to a hardcoded 500.
			return $payment;
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

		// Same response structure as before, plus the access token the browser
		// keeps for the status read after returning from checkout.
		$response = new WP_REST_Response(
			array(
				'success'           => true,
				'transaction_id'    => $transaction_id,
				'mollie_payment_id' => $payment['mollie_payment_id'],
				'checkout_url'      => $payment['checkout_url'],
				'status'            => $payment['status'],
				'access_token'      => $transaction ? (string) $transaction->access_token : '',
			),
			201
		);
		$response->header( 'Cache-Control', 'no-store, private' );

		return $response;
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

		$response = new WP_REST_Response( $response_data, 200 );
		// The read is authorized per request (token, owner or admin), so no shared
		// cache may store it.
		$response->header( 'Cache-Control', 'no-store, private' );

		return $response;
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
	 * Otherwise the request must carry the row's access_token, compared in
	 * constant time. It is read from the X-Fair-Payment-Token header, which keeps
	 * it out of URLs (Referer headers, browser history, access logs). The `token`
	 * query arg is still accepted as a deprecated fallback for flows whose return
	 * URL carries the token; the header wins when both are present.
	 *
	 * Residual risk: the Simple Payment block holds the token in the buyer's
	 * session storage between checkout and return, so any script running on the
	 * site's pages can read it. It only grants this status read.
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

		$provided = (string) $request->get_header( self::TOKEN_HEADER );
		if ( '' === $provided ) {
			$provided = (string) $request->get_param( 'token' );
		}
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
