<?php
/**
 * OAuth Callback Controller for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

/**
 * REST API controller handling OAuth state generation and credential callback.
 *
 * Two-step CSRF protection: the client fetches a short-lived state token before
 * redirecting to Mollie, then POSTs it back on return so we can verify it
 * server-side before writing any credentials.
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
	}

	/**
	 * Generate a one-time OAuth state token and store it in a user-scoped transient.
	 *
	 * @return \WP_REST_Response
	 */
	public function generate_state() {
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

		if ( false === $expected || ! hash_equals( $expected, $state ) ) {
			return new \WP_Error(
				'invalid_oauth_state',
				__( 'Invalid or expired OAuth state. Please try connecting again.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		update_option( 'fair_payment_mollie_access_token', $request->get_param( 'access_token' ) );
		update_option( 'fair_payment_mollie_refresh_token', $request->get_param( 'refresh_token' ) );
		update_option( 'fair_payment_mollie_token_expires', time() + $request->get_param( 'expires_in' ) );
		update_option( 'fair_payment_organization_id', $request->get_param( 'organization_id' ) );
		update_option( 'fair_payment_mollie_profile_id', $request->get_param( 'profile_id' ) );
		update_option( 'fair_payment_mollie_connected', true );
		update_option( 'fair_payment_mode', $request->get_param( 'test_mode' ) ? 'test' : 'live' );

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
