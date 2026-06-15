<?php
/**
 * Mollie Payment Handler
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

use Mollie\Api\MollieApiClient;
use Mollie\Api\Exceptions\ApiException;
use FairPaymentsConnector\Database\PaymentLogRepository;

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

		// Prefer OAuth if connected, otherwise fall back to API keys.
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
	 * @throws \Exception If no API key is configured.
	 */
	private function set_api_key() {
		$mode = get_option( 'fair_payment_mode', 'test' );

		if ( 'live' === $mode ) {
			$api_key = get_option( 'fair_payment_live_api_key', '' );
		} else {
			$api_key = get_option( 'fair_payment_test_api_key', '' );
		}

		if ( empty( $api_key ) ) {
			throw new \Exception( esc_html__( 'Mollie API key is not configured.', 'fair-payments-connector' ) );
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
			throw new \Exception( esc_html__( 'Mollie is not connected. Please connect your Mollie account in settings.', 'fair-payments-connector' ) );
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

		// Token valid if not expired (5 min buffer).
		if ( $token && time() < ( $expires - 300 ) ) {
			return $token;
		}

		// Expired - refresh it.
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
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Token refresh failed: No refresh token found in database' );
			}
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
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Token refresh failed: HTTP error - ' . $response->get_error_message() . ' (code: ' . $response->get_error_code() . ')' );
			}
			return false;
		}

		$response_body = wp_remote_retrieve_body( $response );
		$body          = json_decode( $response_body, true );

		if ( json_last_error() !== JSON_ERROR_NONE ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Token refresh failed: Invalid JSON response - ' . json_last_error_msg() );
			}
			return false;
		}

		if ( empty( $body['success'] ) ) {
			update_option( 'fair_payment_mollie_connected', false );
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				$error_message = isset( $body['message'] ) ? $body['message'] : 'Unknown error';
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Token refresh failed: Server returned success=false - ' . $error_message );
			}
			return false;
		}

		// Verify required keys exist in response (nested under data.data).
		if ( ! isset( $body['data']['data']['access_token'] ) || ! isset( $body['data']['data']['expires_in'] ) ) {
			update_option( 'fair_payment_mollie_connected', false );
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Token refresh failed: Missing required fields in response' );
			}
			return false;
		}

		$new_token  = $body['data']['data']['access_token'];
		$expires_in = $body['data']['data']['expires_in'];
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
		// Not needed for API key authentication.
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return false;
		}

		// Check cached profile ID.
		$profile_id = get_option( 'fair_payment_mollie_profile_id' );
		if ( ! empty( $profile_id ) ) {
			return $profile_id;
		}

		// Fetch current profile from Mollie.
		try {
			$profile = $this->mollie->profiles->get( 'me' );
			if ( $profile && ! empty( $profile->id ) ) {
				update_option( 'fair_payment_mollie_profile_id', $profile->id );
				return $profile->id;
			}
		} catch ( \Exception $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Failed to fetch Mollie profile: ' . $e->getMessage() );
			}
		}

		return false;
	}

	/**
	 * Create a payment
	 *
	 * @param array $args Payment arguments.
	 * @return array Payment data including mollie_payment_id and checkout_url.
	 * @throws \Exception If the underlying Mollie call fails.
	 */
	public function create_payment( $args ) {
		$defaults = array(
			'amount'          => '10.00',
			'currency'        => 'EUR',
			'application_fee' => null,
			'description'     => __( 'Payment', 'fair-payments-connector' ),
			'redirect_url'    => home_url(),
			'webhook_url'     => '',
			'metadata'        => array(),
			'disable_methods' => array(),
		);

		$args = wp_parse_args( $args, $defaults );

		$logger         = new PaymentLogRepository();
		$transaction_id = isset( $args['metadata']['transaction_id'] )
			? (int) $args['metadata']['transaction_id']
			: null;

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

			// Add application fee if provided (for OAuth).
			if ( ! empty( $args['application_fee'] ) && $args['application_fee'] > 0 ) {
				$payment_data['applicationFee'] = array(
					'amount'      => array(
						'currency' => $args['currency'],
						'value'    => number_format( (float) $args['application_fee'], 2, '.', '' ),
					),
					'description' => __( 'Application fee', 'fair-payments-connector' ),
				);
			}

			// Add profile ID for OAuth authentication.
			$profile_id = $this->get_profile_id();
			if ( $profile_id ) {
				$payment_data['profileId'] = $profile_id;
			}

			// Set test mode based on settings (required for OAuth).
			$mode                     = get_option( 'fair_payment_mode', 'test' );
			$payment_data['testmode'] = ( 'live' === $mode ) ? false : true;

			// Build a method allowlist when callers want to suppress specific methods.
			// Mollie has no "exclude" parameter; the supported way is to pass `method`
			// as an allowlist. We fetch the currently active set so the allowlist.
			// stays in sync with the merchant's Mollie configuration.
			if ( ! empty( $args['disable_methods'] ) && is_array( $args['disable_methods'] ) ) {
				$allowed = $this->build_method_allowlist(
					$payment_data['amount'],
					$args['disable_methods'],
					$profile_id,
					$payment_data['testmode']
				);
				if ( ! empty( $allowed ) ) {
					$payment_data['method'] = array_values( $allowed );
				}
			}

			$logger->log(
				'mollie_call_started',
				array(
					'level'          => 'info',
					'transaction_id' => $transaction_id,
					'message'        => sprintf(
						'Calling Mollie API to create payment (%s %s, testmode=%s)',
						number_format( (float) $args['amount'], 2 ),
						$args['currency'],
						$payment_data['testmode'] ? 'true' : 'false'
					),
					'context'        => array(
						'amount'      => $payment_data['amount'],
						'description' => $args['description'],
						'testmode'    => $payment_data['testmode'],
						'has_profile' => (bool) $profile_id,
					),
				)
			);

			$payment = $this->mollie->payments->create( $payment_data );

			$logger->log(
				'mollie_call_succeeded',
				array(
					'level'          => 'info',
					'transaction_id' => $transaction_id,
					'message'        => sprintf( 'Mollie returned payment %s (status %s)', $payment->id, $payment->status ),
					'context'        => array(
						'mollie_payment_id' => $payment->id,
						'status'            => $payment->status,
					),
				)
			);

			return array(
				'mollie_payment_id' => $payment->id,
				'checkout_url'      => $payment->getCheckoutUrl(),
				'status'            => $payment->status,
			);
		} catch ( ApiException $e ) {
			// At this point Mollie may or may not have created the payment — we never.
			// got a confirmed response. Log the request payload so an admin can search.
			// the Mollie dashboard for an orphan payment.
			$logger->log(
				'mollie_call_failed',
				array(
					'level'          => 'error',
					'transaction_id' => $transaction_id,
					'message'        => sprintf( 'Mollie API call failed: %s', $e->getMessage() ),
					'context'        => array(
						'exception_class'   => get_class( $e ),
						'exception_message' => $e->getMessage(),
						'amount'            => $args['amount'],
						'currency'          => $args['currency'],
						'description'       => $args['description'],
					),
				)
			);
			throw new \Exception(
				esc_html(
					sprintf(
						/* translators: %s: error message */
						__( 'Failed to create payment: %s', 'fair-payments-connector' ),
						$e->getMessage()
					)
				)
			);
		}
	}

	/**
	 * Build a Mollie `method` allowlist that excludes the given method IDs.
	 *
	 * Queries Mollie for the currently active methods (scoped to the payment's
	 * amount/currency, profile, and test mode) and returns their IDs minus the
	 * disabled ones. Returns an empty array if the API call fails or filtering
	 * would yield no methods — callers should treat that as "let Mollie decide".
	 *
	 * @param array       $amount          Mollie amount array with 'currency' and 'value'.
	 * @param array       $disable_methods Method IDs to exclude (e.g. ['banktransfer']).
	 * @param string|null $profile_id      Mollie profile ID (required under OAuth).
	 * @param bool        $testmode        Whether the payment is created in test mode.
	 * @return string[] Allowed method IDs, or empty array if no allowlist should be applied.
	 */
	private function build_method_allowlist( $amount, $disable_methods, $profile_id, $testmode ) {
		try {
			$parameters = array( 'amount' => $amount );
			if ( $profile_id ) {
				$parameters['profileId'] = $profile_id;
				$parameters['testmode']  = $testmode ? 'true' : 'false';
			}

			$methods = $this->mollie->methods->allEnabled( $parameters );
		} catch ( ApiException $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Failed to list Mollie methods for filter: ' . $e->getMessage() );
			}
			return array();
		}

		$disable = array_map( 'strval', $disable_methods );
		$allowed = array();
		foreach ( $methods as $method ) {
			if ( empty( $method->id ) || in_array( $method->id, $disable, true ) ) {
				continue;
			}
			$allowed[] = $method->id;
		}

		// If filtering left us with nothing, fall back to letting Mollie show.
		// all enabled methods rather than passing an empty allowlist.
		if ( count( $allowed ) === count( $methods ) || empty( $allowed ) ) {
			return array();
		}

		return $allowed;
	}

	/**
	 * Get payment status from Mollie
	 *
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @param array  $options Options for retrieving payment (e.g., testmode).
	 * @return object Payment object from Mollie.
	 * @throws \Exception If the underlying Mollie call fails.
	 */
	public function get_payment( $mollie_payment_id, $options = array() ) {
		try {
			return $this->mollie->payments->get( $mollie_payment_id, $options );
		} catch ( ApiException $e ) {
			throw new \Exception(
				esc_html(
					sprintf(
						/* translators: %s: error message */
						__( 'Failed to retrieve payment: %s', 'fair-payments-connector' ),
						$e->getMessage()
					)
				)
			);
		}
	}

	/**
	 * Iterate balance transactions on the primary balance (newest first).
	 *
	 * Used to look up the real Mollie processing fee charged on a payment, which is
	 * exposed via BalanceTransaction.deductions rather than on the Payment object.
	 *
	 * @param bool $testmode Whether to query the test balance.
	 * @return \Mollie\Api\Resources\LazyCollection
	 * @throws \Exception If the balance transactions endpoint is unreachable.
	 */
	public function iterate_primary_balance_transactions( $testmode = false ) {
		$parameters = $testmode ? array( 'testmode' => 'true' ) : array();

		try {
			return $this->mollie->balanceTransactions->iteratorForPrimary( $parameters );
		} catch ( ApiException $e ) {
			throw new \Exception(
				esc_html(
					sprintf(
						/* translators: %s: error message */
						__( 'Failed to list balance transactions: %s', 'fair-payments-connector' ),
						$e->getMessage()
					)
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
		// Check OAuth connection first.
		if ( get_option( 'fair_payment_mollie_connected', false ) ) {
			return true;
		}

		// Fall back to API key check.
		$mode = get_option( 'fair_payment_mode', 'test' );

		if ( 'live' === $mode ) {
			$api_key = get_option( 'fair_payment_live_api_key', '' );
		} else {
			$api_key = get_option( 'fair_payment_test_api_key', '' );
		}

		return ! empty( $api_key );
	}
}
