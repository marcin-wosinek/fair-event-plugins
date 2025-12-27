<?php
/**
 * Mollie Payment Handler
 *
 * @package FairPayment
 */

namespace FairPayment\Payment;

use Mollie\Api\MollieApiClient;
use Mollie\Api\Exceptions\ApiException;

defined( 'WPINC' ) || die;

/**
 * Class for handling Mollie API interactions
 */
class MolliePaymentHandler {
	/**
	 * Mollie API client instance
	 *
	 * @var MollieApiClient
	 */
	private $mollie;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->mollie = new MollieApiClient();

		// Prefer OAuth if connected, otherwise fall back to API keys
		if ( get_option( 'fair_payment_mollie_connected', false ) ) {
			$this->set_access_token();
		} else {
			$this->set_api_key();
		}
	}

	/**
	 * Set API key based on mode
	 *
	 * @return void
	 */
	private function set_api_key() {
		$mode = get_option( 'fair_payment_mode', 'test' );

		if ( 'live' === $mode ) {
			$api_key = get_option( 'fair_payment_live_api_key', '' );
		} else {
			$api_key = get_option( 'fair_payment_test_api_key', '' );
		}

		if ( empty( $api_key ) ) {
			throw new \Exception( __( 'Mollie API key is not configured.', 'fair-payment' ) );
		}

		$this->mollie->setApiKey( $api_key );
	}

	/**
	 * Set OAuth access token
	 *
	 * Sets the Mollie API client to use OAuth access token authentication.
	 * Automatically refreshes expired tokens before use.
	 *
	 * @return void
	 * @throws \Exception If no valid access token is available.
	 */
	private function set_access_token() {
		$access_token = $this->get_valid_access_token();

		if ( empty( $access_token ) ) {
			throw new \Exception( __( 'Mollie is not connected. Please connect your Mollie account in settings.', 'fair-payment' ) );
		}

		$this->mollie->setAccessToken( $access_token );
	}

	/**
	 * Get valid access token
	 *
	 * Returns a valid access token, automatically refreshing if expired.
	 *
	 * @return string|false Valid access token or false if unavailable.
	 */
	private function get_valid_access_token() {
		$token   = get_option( 'fair_payment_mollie_access_token' );
		$expires = get_option( 'fair_payment_mollie_token_expires', 0 );

		// Token valid if not expired (5 min buffer)
		if ( $token && time() < ( $expires - 300 ) ) {
			return $token;
		}

		// Expired - refresh it
		return $this->refresh_access_token();
	}

	/**
	 * Refresh OAuth access token
	 *
	 * Contacts fair-platform to exchange refresh token for new access token.
	 *
	 * @return string|false New access token or false if refresh failed.
	 */
	private function refresh_access_token() {
		$refresh_token = get_option( 'fair_payment_mollie_refresh_token' );

		if ( empty( $refresh_token ) ) {
			update_option( 'fair_payment_mollie_connected', false );
			return false;
		}

		$response = wp_remote_post(
			'https://fair-event-plugins.com/oauth/refresh',
			array(
				'body'    => array( 'refresh_token' => $refresh_token ),
				'timeout' => 15,
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Mollie OAuth token refresh failed: ' . $response->get_error_message() );
			return false;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $body['success'] ) ) {
			update_option( 'fair_payment_mollie_connected', false );
			error_log( 'Mollie OAuth token refresh failed: Invalid response from fair-platform' );
			return false;
		}

		// Verify required keys exist in response
		if ( ! isset( $body['data']['access_token'] ) || ! isset( $body['data']['expires_in'] ) ) {
			update_option( 'fair_payment_mollie_connected', false );
			error_log( 'Mollie OAuth token refresh failed: Missing access_token or expires_in in response. Response: ' . wp_json_encode( $body ) );
			return false;
		}

		// Store new token
		$new_token  = $body['data']['access_token'];
		$expires_in = $body['data']['expires_in'];
		update_option( 'fair_payment_mollie_access_token', $new_token );
		update_option( 'fair_payment_mollie_token_expires', time() + $expires_in );

		return $new_token;
	}

	/**
	 * Get Mollie profile ID
	 *
	 * Required for OAuth payments. Fetches and caches the current profile ID.
	 *
	 * @return string|false Profile ID or false if unavailable.
	 */
	private function get_profile_id() {
		// Not needed for API key authentication
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return false;
		}

		// Check cached profile ID
		$profile_id = get_option( 'fair_payment_mollie_profile_id' );
		if ( ! empty( $profile_id ) ) {
			return $profile_id;
		}

		// Fetch current profile from Mollie
		try {
			$profile = $this->mollie->profiles->get( 'me' );
			if ( $profile && ! empty( $profile->id ) ) {
				update_option( 'fair_payment_mollie_profile_id', $profile->id );
				return $profile->id;
			}
		} catch ( \Exception $e ) {
			error_log( 'Failed to fetch Mollie profile: ' . $e->getMessage() );
		}

		return false;
	}

	/**
	 * Create a payment
	 *
	 * @param array $args Payment arguments.
	 * @return array Payment data including mollie_payment_id and checkout_url.
	 * @throws ApiException If payment creation fails.
	 */
	public function create_payment( $args ) {
		$defaults = array(
			'amount'       => '10.00',
			'currency'     => 'EUR',
			'description'  => __( 'Payment', 'fair-payment' ),
			'redirect_url' => home_url(),
			'webhook_url'  => '',
			'metadata'     => array(),
		);

		$args = wp_parse_args( $args, $defaults );

		try {
			$payment_data = array(
				'amount'      => array(
					'currency' => $args['currency'],
					'value'    => number_format( (float) $args['amount'], 2, '.', '' ),
				),
				'description' => $args['description'],
				'redirectUrl' => $args['redirect_url'],
				'webhookUrl'  => $args['webhook_url'],
				'metadata'    => $args['metadata'],
			);

			// Add profile ID for OAuth authentication
			$profile_id = $this->get_profile_id();
			if ( $profile_id ) {
				$payment_data['profileId'] = $profile_id;
			}

			// Set test mode based on settings (required for OAuth)
			$mode                     = get_option( 'fair_payment_mode', 'test' );
			$payment_data['testmode'] = ( 'live' === $mode ) ? false : true;

			$payment = $this->mollie->payments->create( $payment_data );

			return array(
				'mollie_payment_id' => $payment->id,
				'checkout_url'      => $payment->getCheckoutUrl(),
				'status'            => $payment->status,
			);
		} catch ( ApiException $e ) {
			throw new \Exception(
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to create payment: %s', 'fair-payment' ),
					$e->getMessage()
				)
			);
		}
	}

	/**
	 * Get payment status from Mollie
	 *
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @param array  $options Options for retrieving payment (e.g., testmode).
	 * @return object Payment object from Mollie.
	 * @throws ApiException If payment retrieval fails.
	 */
	public function get_payment( $mollie_payment_id, $options = array() ) {
		try {
			return $this->mollie->payments->get( $mollie_payment_id, $options );
		} catch ( ApiException $e ) {
			throw new \Exception(
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to retrieve payment: %s', 'fair-payment' ),
					$e->getMessage()
				)
			);
		}
	}

	/**
	 * Check if API is configured
	 *
	 * Checks if either OAuth connection or API keys are configured.
	 * OAuth is preferred, but API keys are still supported for backward compatibility.
	 *
	 * @return bool True if OAuth is connected or API key is set.
	 */
	public static function is_configured() {
		// Check OAuth connection first
		if ( get_option( 'fair_payment_mollie_connected', false ) ) {
			return true;
		}

		// Fall back to API key check
		$mode = get_option( 'fair_payment_mode', 'test' );

		if ( 'live' === $mode ) {
			$api_key = get_option( 'fair_payment_live_api_key', '' );
		} else {
			$api_key = get_option( 'fair_payment_test_api_key', '' );
		}

		return ! empty( $api_key );
	}
}
