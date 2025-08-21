<?php
/**
 * Currency service for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Services;

defined( 'WPINC' ) || die;

/**
 * Handles currency-related functionality
 */
class CurrencyService {

	/**
	 * Get available currencies with their labels
	 *
	 * @return array Available currencies with their labels.
	 */
	public function get_available_currencies() {
		return array(
			'USD' => __( 'US Dollar ($)', 'fair-payment' ),
			'EUR' => __( 'Euro (€)', 'fair-payment' ),
			'GBP' => __( 'British Pound (£)', 'fair-payment' ),
			'CAD' => __( 'Canadian Dollar (C$)', 'fair-payment' ),
			'AUD' => __( 'Australian Dollar (A$)', 'fair-payment' ),
			'JPY' => __( 'Japanese Yen (¥)', 'fair-payment' ),
			'CHF' => __( 'Swiss Franc (CHF)', 'fair-payment' ),
			'SEK' => __( 'Swedish Krona (kr)', 'fair-payment' ),
			'NOK' => __( 'Norwegian Krone (kr)', 'fair-payment' ),
			'DKK' => __( 'Danish Krone (kr)', 'fair-payment' ),
			'PLN' => __( 'Polish Złoty (zł)', 'fair-payment' ),
		);
	}

	/**
	 * Get currency symbols mapping
	 *
	 * @return array Currency symbols mapping.
	 */
	public function get_currency_symbols() {
		return array(
			'USD' => '$',
			'EUR' => '€',
			'GBP' => '£',
			'CAD' => 'C$',
			'AUD' => 'A$',
			'JPY' => '¥',
			'CHF' => 'CHF',
			'SEK' => 'kr',
			'NOK' => 'kr',
			'DKK' => 'kr',
			'PLN' => 'zł',
		);
	}

	/**
	 * Get allowed currencies from plugin options
	 *
	 * @return array Allowed currency codes.
	 */
	public function get_allowed_currencies() {
		$options = get_option( 'fair_payment_options', array() );
		return $options['allowed_currencies'] ?? array( 'EUR', 'USD', 'GBP' );
	}

	/**
	 * Get allowed currencies formatted for JavaScript/UI consumption
	 *
	 * @return array Array of currency objects with 'label' and 'value' keys.
	 */
	public function get_allowed_currencies_for_ui() {
		$allowed_currencies = $this->get_allowed_currencies();
		$available_currencies = $this->get_available_currencies();
		
		$ui_currencies = array();
		foreach ( $allowed_currencies as $currency_code ) {
			if ( isset( $available_currencies[ $currency_code ] ) ) {
				$ui_currencies[] = array(
					'label' => $available_currencies[ $currency_code ],
					'value' => $currency_code,
				);
			}
		}
		
		return $ui_currencies;
	}

	/**
	 * Get currency symbol for a given currency code
	 *
	 * @param string $currency_code Currency code.
	 * @return string Currency symbol or currency code if symbol not found.
	 */
	public function get_currency_symbol( $currency_code ) {
		$symbols = $this->get_currency_symbols();
		return $symbols[ $currency_code ] ?? $currency_code;
	}

	/**
	 * Validate if a currency is allowed
	 *
	 * @param string $currency_code Currency code to validate.
	 * @return bool True if currency is allowed, false otherwise.
	 */
	public function is_currency_allowed( $currency_code ) {
		$allowed_currencies = $this->get_allowed_currencies();
		return in_array( strtoupper( $currency_code ), $allowed_currencies, true );
	}

	/**
	 * Sanitize and validate a list of currency codes
	 *
	 * @param array $currency_codes Array of currency codes to sanitize.
	 * @return array Sanitized and validated currency codes.
	 */
	public function sanitize_currency_codes( $currency_codes ) {
		$available_currencies = $this->get_available_currencies();
		$sanitized = array();
		
		if ( is_array( $currency_codes ) ) {
			foreach ( $currency_codes as $currency ) {
				$currency = strtoupper( sanitize_text_field( $currency ) );
				if ( isset( $available_currencies[ $currency ] ) ) {
					$sanitized[] = $currency;
				}
			}
		}
		
		// Ensure at least one currency is present
		if ( empty( $sanitized ) ) {
			$sanitized = array( 'EUR' );
		}
		
		return array_unique( $sanitized );
	}
}