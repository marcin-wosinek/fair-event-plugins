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
		$this->set_api_key();
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
			$payment = $this->mollie->payments->create(
				array(
					'amount'      => array(
						'currency' => $args['currency'],
						'value'    => number_format( (float) $args['amount'], 2, '.', '' ),
					),
					'description' => $args['description'],
					'redirectUrl' => $args['redirect_url'],
					'webhookUrl'  => $args['webhook_url'],
					'metadata'    => $args['metadata'],
				)
			);

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
	 * @return object Payment object from Mollie.
	 * @throws ApiException If payment retrieval fails.
	 */
	public function get_payment( $mollie_payment_id ) {
		try {
			return $this->mollie->payments->get( $mollie_payment_id );
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
	 * @return bool True if API key is set.
	 */
	public static function is_configured() {
		$mode = get_option( 'fair_payment_mode', 'test' );

		if ( 'live' === $mode ) {
			$api_key = get_option( 'fair_payment_live_api_key', '' );
		} else {
			$api_key = get_option( 'fair_payment_test_api_key', '' );
		}

		return ! empty( $api_key );
	}
}
