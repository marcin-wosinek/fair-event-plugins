<?php
/**
 * Connection API Controller for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\Payment\MollieCredentials;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\OAuth\GrantedScopes;
use FairPaymentsConnector\Models\Transaction;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * REST API controller for testing Mollie connection
 */
class ConnectionController extends \WP_REST_Controller {

	/**
	 * Amount of a test payment, in the site currency.
	 */
	const TEST_PAYMENT_AMOUNT = 1.0;

	/**
	 * Context fields a confirmation covers. A change to any of them between
	 * the confirmation and the creation needs a fresh confirmation.
	 */
	const CONFIRMED_CONTEXT_FIELDS = array( 'mode', 'currency', 'profile_id', 'organization_id' );

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-payments-connector/v1',
			'/test-connection',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'test_connection' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/connection/overview',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_connection_overview' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/oauth/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_oauth_status' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/test-payment',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_test_payment_context' ),
					// Read-only, but it reveals the connected account identifiers.
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create_test_payment' ),
					// Admin-only: this creates a real transaction (real money in live mode)
					// with no backing block, so it must not reuse the public payment path.
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'confirmed' => array(
							'description' => __( 'The test payment context the administrator confirmed, as returned by GET /test-payment.', 'fair-payments-connector' ),
							'type'        => 'object',
							'properties'  => array(
								'mode'            => array( 'type' => 'string' ),
								'currency'        => array( 'type' => 'string' ),
								'profile_id'      => array( 'type' => 'string' ),
								'organization_id' => array( 'type' => 'string' ),
							),
						),
					),
				),
			)
		);
	}

	/**
	 * Error for a connection whose stored tokens cannot be used, before any
	 * Mollie request or transaction is attempted.
	 *
	 * @return \WP_Error|null Null when the tokens are usable.
	 */
	private function credentials_unavailable() {
		$status = MollieCredentials::status();

		if ( MollieCredentials::AVAILABLE === $status ) {
			return null;
		}

		return new \WP_Error(
			'mollie_credentials_unavailable',
			MollieCredentials::admin_message( $status ),
			array(
				'status'            => 409,
				'credential_status' => $status,
			)
		);
	}

	/**
	 * Build the context a test payment would be created with right now.
	 *
	 * Reads stored settings only — it neither calls Mollie nor creates a
	 * transaction.
	 *
	 * @return array{amount: string, amount_display: string, currency: string, mode: string, profile_id: string, organization_id: string}
	 */
	private function test_payment_context() {
		$currency = Money::site_currency();

		return array(
			'amount'          => Money::format_value( self::TEST_PAYMENT_AMOUNT ),
			'amount_display'  => Money::format_display( self::TEST_PAYMENT_AMOUNT, $currency ),
			'currency'        => $currency,
			'mode'            => get_option( 'fair_payment_mode', 'test' ),
			'profile_id'      => (string) get_option( 'fair_payment_mollie_profile_id', '' ),
			'organization_id' => (string) get_option( 'fair_payment_organization_id', '' ),
		);
	}

	/**
	 * Get the amount, currency, mode, and connected account a test payment
	 * would use, so the administrator can confirm them before a live payment.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_test_payment_context() {
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return new \WP_Error(
				'not_connected',
				__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$unavailable = $this->credentials_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		return new \WP_REST_Response( $this->test_payment_context(), 200 );
	}

	/**
	 * Get the connection status and the permissions Mollie granted.
	 *
	 * `settlement_access` is true only for an active connection whose
	 * recorded scopes include settlement access. A connection made before
	 * scopes were recorded reports `scopes_known: false` and has to be
	 * reconnected before settlements can be read.
	 *
	 * `credential_status` says whether the stored tokens can be used (see
	 * MollieCredentials): a connection whose tokens are temporarily or
	 * permanently unreadable stays `connected`, with `payments_available`
	 * false. The tokens themselves are never part of the response.
	 *
	 * @return \WP_REST_Response
	 */
	public function get_oauth_status() {
		$scopes            = GrantedScopes::get();
		$credential_status = MollieCredentials::status();

		return new \WP_REST_Response(
			array(
				'connected'                   => (bool) get_option( 'fair_payment_mollie_connected', false ),
				'credential_status'           => $credential_status,
				'credentials_encrypted'       => MollieCredentials::is_encrypted(),
				'payments_available'          => MolliePaymentHandler::is_configured(),
				'scopes_known'                => null !== $scopes,
				'granted_scopes'              => null === $scopes ? array() : $scopes,
				'settlement_access'           => GrantedScopes::has_settlement_access(),
				'settlement_access_requested' => GrantedScopes::is_settlement_access_requested(),
			),
			200
		);
	}

	/**
	 * Get the connected Mollie profile name and enabled payment methods.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_connection_overview() {
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return new \WP_Error(
				'not_connected',
				__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$unavailable = $this->credentials_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		try {
			$handler  = new MolliePaymentHandler();
			$overview = $handler->get_connection_overview();
		} catch ( \Exception $e ) {
			return new \WP_Error(
				'mollie_unreachable',
				$e->getMessage(),
				array( 'status' => 502 )
			);
		}

		$organization_id = get_option( 'fair_payment_organization_id', '' );

		$overview['manage_url'] = $organization_id
			? "https://my.mollie.com/dashboard/{$organization_id}/settings/payment-methods"
			: 'https://my.mollie.com/dashboard/';

		return new \WP_REST_Response( $overview, 200 );
	}

	/**
	 * Create a one-unit test payment and return its Mollie checkout URL.
	 *
	 * Exercises the full payment flow (transaction creation, checkout, webhook
	 * status update) from the settings page, without a backing payment block.
	 * Admin-only — see the permission callback on the route.
	 *
	 * A live payment needs the context the administrator confirmed; when the
	 * mode, currency, or connected account changed since, nothing is created
	 * and a fresh confirmation is required.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function create_test_payment( \WP_REST_Request $request ) {
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return new \WP_Error(
				'not_connected',
				__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$unavailable = $this->credentials_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		$context   = $this->test_payment_context();
		$confirmed = $request->get_param( 'confirmed' );

		if ( 'live' === $context['mode'] && ! is_array( $confirmed ) ) {
			return new \WP_Error(
				'test_payment_confirmation_required',
				__( 'Confirm the live test payment before creating it.', 'fair-payments-connector' ),
				array(
					'status'  => 409,
					'context' => $context,
				)
			);
		}

		if ( is_array( $confirmed ) ) {
			foreach ( self::CONFIRMED_CONTEXT_FIELDS as $field ) {
				if ( ! isset( $confirmed[ $field ] ) || (string) $confirmed[ $field ] !== $context[ $field ] ) {
					return new \WP_Error(
						'test_payment_context_changed',
						__( 'The payment mode, currency, or connected Mollie account changed since you confirmed. No payment was created. Review the updated details and confirm again.', 'fair-payments-connector' ),
						array(
							'status'  => 409,
							'context' => $context,
						)
					);
				}
			}
		}

		$currency    = $context['currency'];
		$mode        = $context['mode'];
		$description = __( 'Test payment (Fair Payments Connector settings)', 'fair-payments-connector' );

		$transaction_id = TransactionAPI::create_transaction(
			array(
				array(
					'name'     => $description,
					'quantity' => 1,
					'amount'   => self::TEST_PAYMENT_AMOUNT,
				),
			),
			array(
				'currency'    => $currency,
				'description' => $description,
				'user_id'     => get_current_user_id(),
				'metadata'    => array(
					'test_payment' => true,
					'user_id'      => get_current_user_id(),
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return new \WP_Error(
				'test_payment_failed',
				$transaction_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$transaction  = Transaction::get_by_id( $transaction_id );
		$settings_url = add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) );

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'token'                 => $transaction ? $transaction->access_token : '',
			),
			$settings_url
		);

		$payment = TransactionAPI::initiate_payment(
			$transaction_id,
			array(
				'redirect_url' => $redirect_url,
				'webhook_url'  => rest_url( 'fair-payments-connector/v1/webhook' ),
			)
		);

		if ( is_wp_error( $payment ) ) {
			return new \WP_Error(
				'test_payment_failed',
				$payment->get_error_message(),
				array( 'status' => 500 )
			);
		}

		return new \WP_REST_Response(
			array(
				'success'        => true,
				'transaction_id' => $transaction_id,
				'checkout_url'   => $payment['checkout_url'],
				'status'         => $payment['status'],
				'currency'       => $currency,
				'mode'           => $mode,
			),
			201
		);
	}

	/**
	 * Test Mollie connection and trigger token refresh
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function test_connection() {
		try {
			// Check if OAuth is configured.
			if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
				return new \WP_Error(
					'not_connected',
					__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				);
			}

			$unavailable = $this->credentials_unavailable();
			if ( $unavailable ) {
				return $unavailable;
			}

			// Get current token expiration.
			$token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );

			// Try to create payment handler (will trigger token refresh if needed).
			$handler = new MolliePaymentHandler();

			// If we get here, connection is working.
			$new_token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );
			$new_expires_at    = $new_token_expires > 0 ? gmdate( 'Y-m-d H:i:s', $new_token_expires ) : 'unknown';

			// Check if token was refreshed.
			$was_refreshed = $new_token_expires !== $token_expires;

			return new \WP_REST_Response(
				array(
					'success'         => true,
					'message'         => $was_refreshed
						? __( 'Connection test successful. Token was refreshed.', 'fair-payments-connector' )
						: __( 'Connection test successful. Token is still valid.', 'fair-payments-connector' ),
					'token_refreshed' => $was_refreshed,
					'token_expires'   => $new_token_expires,
					'expires_at'      => $new_expires_at,
				),
				200
			);

		} catch ( \Exception $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Test connection failed: ' . $e->getMessage() . "\n" . $e->getTraceAsString() );
			}

			// The exception message and location can name server paths and
			// library internals, so they reach the response only in debug mode.
			$data = array( 'status' => 500 );
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				$data['details'] = array(
					'message' => $e->getMessage(),
					'code'    => $e->getCode(),
					'file'    => basename( $e->getFile() ),
					'line'    => $e->getLine(),
				);
			}

			return new \WP_Error(
				'connection_failed',
				__( 'Connection test failed.', 'fair-payments-connector' ),
				$data
			);
		}
	}
}
