<?php
/**
 * OAuth Callback Controller for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\AuditLog\AuditLogger;

defined( 'WPINC' ) || die;

/**
 * REST API controller handling OAuth state generation and credential callback.
 *
 * Two-step CSRF protection: the client fetches a short-lived state token before
 * redirecting to Mollie, then POSTs it back on return so we can verify it
 * server-side before writing any credentials. The audit description is
 * generated server-side once the callback succeeds (#1575) — administrators
 * no longer supply a reason for connecting, reconnecting, or disconnecting.
 */
class OAuthCallbackController extends \WP_REST_Controller {

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-payments-connector/v1',
			'/oauth/state',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'generate_state' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/oauth/callback',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_callback' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'state'           => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'access_token'    => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'refresh_token'   => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'expires_in'      => array(
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
					'organization_id' => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
						'default'           => '',
					),
					'profile_id'      => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
						'default'           => '',
					),
					'test_mode'       => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/oauth/disconnect',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_disconnect' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	/**
	 * Generate a one-time OAuth state token and store it in a user-scoped
	 * transient.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response
	 */
	public function generate_state( \WP_REST_Request $request ) {
		$state = wp_generate_password( 32, false );
		set_transient( $this->state_transient_key(), $state, 5 * MINUTE_IN_SECONDS );
		return new \WP_REST_Response( array( 'state' => $state ), 200 );
	}

	/**
	 * Validate state and persist OAuth credentials.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function handle_callback( \WP_REST_Request $request ) {
		$state    = $request->get_param( 'state' );
		$expected = get_transient( $this->state_transient_key() );

		// Single-use: delete before any branching to prevent replay.
		delete_transient( $this->state_transient_key() );

		if ( ! is_string( $expected ) || '' === $expected || ! hash_equals( $expected, $state ) ) {
			return new \WP_Error(
				'invalid_oauth_state',
				__( 'Invalid or expired OAuth state. Please try connecting again.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		// An organization ID from a prior connection is our signal that this
		// is a reconnect rather than a first-ever connection, independent of
		// the current fair_payment_mollie_connected flag (which is also
		// false right after a disconnect-then-reconnect).
		$is_reconnect = (bool) get_option( 'fair_payment_organization_id', '' );
		$mode         = $request->get_param( 'test_mode' ) ? 'test' : 'live';

		update_option( 'fair_payment_mollie_access_token', $request->get_param( 'access_token' ) );
		update_option( 'fair_payment_mollie_refresh_token', $request->get_param( 'refresh_token' ) );
		update_option( 'fair_payment_mollie_token_expires', time() + $request->get_param( 'expires_in' ) );
		update_option( 'fair_payment_organization_id', $request->get_param( 'organization_id' ) );
		update_option( 'fair_payment_mollie_profile_id', $request->get_param( 'profile_id' ) );
		update_option( 'fair_payment_mollie_connected', true );
		update_option( 'fair_payment_mode', $mode );

		$mode_label  = 'live' === $mode
			? __( 'live', 'fair-payments-connector' )
			: __( 'test', 'fair-payments-connector' );
		$description = $is_reconnect
			? sprintf(
				/* translators: %s: connection mode (live or test) */
				__( 'Reconnected to Mollie in %s mode.', 'fair-payments-connector' ),
				$mode_label
			)
			: sprintf(
				/* translators: %s: connection mode (live or test) */
				__( 'Connected to Mollie in %s mode.', 'fair-payments-connector' ),
				$mode_label
			);

		// Persisting the connection and its audit entry is treated as one
		// unit — but unlike a simple option write, the Mollie tokens are
		// already live at this point, and reverting them the way
		// SettingsWriteController reverts a plain option is riskier than
		// useful here, so this only fails the request without undoing them.
		$result = AuditLogger::record_action(
			$is_reconnect ? 'mollie_reconnected' : 'mollie_connected',
			$description,
			get_current_user_id(),
			array( 'mode' => $mode )
		);

		if ( false === $result ) {
			return new \WP_Error(
				'audit_log_failed',
				__( 'Connected, but the audit entry could not be recorded.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		return new \WP_REST_Response( array( 'success' => true ), 200 );
	}

	/**
	 * Remove the stored Mollie OAuth credentials and connection state.
	 *
	 * The tokens have no show_in_rest entry (see Settings::register_settings()),
	 * so /wp/v2/settings can no longer clear them — this is the only write
	 * path for disconnecting.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function handle_disconnect( \WP_REST_Request $request ) {
		delete_option( 'fair_payment_mollie_access_token' );
		delete_option( 'fair_payment_mollie_refresh_token' );
		update_option( 'fair_payment_mollie_token_expires', 0 );
		update_option( 'fair_payment_mollie_connected', false );
		delete_transient( 'fair_payment_connection_overview_test' );
		delete_transient( 'fair_payment_connection_overview_live' );

		$description = __( 'Disconnected from Mollie.', 'fair-payments-connector' );
		$result      = AuditLogger::record_action( 'mollie_disconnected', $description, get_current_user_id() );

		if ( false === $result ) {
			return new \WP_Error(
				'audit_log_failed',
				__( 'Disconnected, but the audit entry could not be recorded.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		return new \WP_REST_Response( array( 'success' => true ), 200 );
	}

	/**
	 * Transient key scoped to the current user.
	 *
	 * @return string
	 */
	private function state_transient_key() {
		return 'fpc_oauth_state_' . get_current_user_id();
	}
}
