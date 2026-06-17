<?php
/**
 * Settings management for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settings;

defined( 'WPINC' ) || die;

/**
 * Settings class for registering plugin settings
 */
class Settings {
	/**
	 * Initialize settings
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register plugin settings
	 *
	 * @return void
	 */
	public function register_settings() {
		// Test API Key.
		register_setting(
			'fair_payment_settings',
			'fair_payment_test_api_key',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Test API Key', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// Live API Key.
		register_setting(
			'fair_payment_settings',
			'fair_payment_live_api_key',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Live API Key', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// Mode (test or live).
		register_setting(
			'fair_payment_settings',
			'fair_payment_mode',
			array(
				'type'              => 'string',
				'description'       => __( 'Payment mode (test or live)', 'fair-payments-connector' ),
				'sanitize_callback' => array( $this, 'sanitize_mode' ),
				'show_in_rest'      => true,
				'default'           => 'test',
			)
		);

		// Organization ID.
		register_setting(
			'fair_payment_settings',
			'fair_payment_organization_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Organization ID', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// OAuth Access Token.
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_access_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie OAuth Access Token', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// OAuth Refresh Token.
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_refresh_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie OAuth Refresh Token', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// OAuth Token Expiration.
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_token_expires',
			array(
				'type'              => 'integer',
				'description'       => __( 'Mollie OAuth Token Expiration (Unix timestamp)', 'fair-payments-connector' ),
				'sanitize_callback' => 'absint',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'integer',
						'context' => array( 'edit' ),
					),
				),
				'default'           => 0,
			)
		);

		// OAuth Site ID.
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_site_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Unique Site Identifier for OAuth', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// OAuth Connection Status.
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_connected',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Mollie OAuth Connection Status', 'fair-payments-connector' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'boolean',
						'context' => array( 'edit' ),
					),
				),
				'default'           => false,
			)
		);

		// Mollie Profile ID (cached for OAuth).
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_profile_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Profile ID (cached)', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Disable bank transfer when close to event date.
		register_setting(
			'fair_payment_settings',
			'fair_payment_disable_banktransfer_near_date',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Disable bank transfer when close to the key date of the sale', 'fair-payments-connector' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		// Bank transfer cutoff in working days.
		register_setting(
			'fair_payment_settings',
			'fair_payment_banktransfer_threshold_days',
			array(
				'type'              => 'integer',
				'description'       => __( 'Working-day threshold for disabling bank transfer', 'fair-payments-connector' ),
				'sanitize_callback' => array( $this, 'sanitize_threshold_days' ),
				'show_in_rest'      => true,
				'default'           => 3,
			)
		);

		// Default currency for all transactions.
		register_setting(
			'fair_payment_settings',
			'fair_payment_currency',
			array(
				'type'              => 'string',
				'description'       => __( 'Default currency for all transactions', 'fair-payments-connector' ),
				'sanitize_callback' => array( $this, 'sanitize_currency' ),
				'show_in_rest'      => true,
				'default'           => 'EUR',
			)
		);

		// Feature flag bundle toggles — UI state only, never overrides a
		// wp-config constant (see Features::sanitize_option()).
		register_setting(
			'fair_payment_settings',
			\FairPaymentsConnector\Core\Features::OPTION,
			array(
				'type'              => 'object',
				'description'       => __( 'Per-bundle feature toggles', 'fair-payments-connector' ),
				'sanitize_callback' => array( \FairPaymentsConnector\Core\Features::class, 'sanitize_option' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'                 => 'object',
						'additionalProperties' => array( 'type' => 'boolean' ),
					),
				),
				'default'           => array(),
			)
		);
	}

	/**
	 * Sanitize working-day threshold setting
	 *
	 * @param mixed $value Threshold value.
	 * @return int Sanitized non-negative integer.
	 */
	public function sanitize_threshold_days( $value ) {
		return max( 0, (int) $value );
	}

	/**
	 * Sanitize mode setting
	 *
	 * @param string $value Mode value.
	 * @return string Sanitized mode (test or live).
	 */
	public function sanitize_mode( $value ) {
		return in_array( $value, array( 'test', 'live' ), true ) ? $value : 'test';
	}

	/**
	 * Sanitize currency setting
	 *
	 * Allowlist of ISO 4217 codes supported by Mollie.
	 *
	 * @param string $value Currency code.
	 * @return string Validated currency code, or 'EUR' as fallback.
	 */
	public function sanitize_currency( $value ) {
		$allowed = array( 'EUR', 'USD', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'PLN', 'CZK', 'HUF' );
		return in_array( strtoupper( (string) $value ), $allowed, true ) ? strtoupper( (string) $value ) : 'EUR';
	}
}
