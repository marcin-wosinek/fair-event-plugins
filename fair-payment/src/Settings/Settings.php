<?php
/**
 * Settings management for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Settings;

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
		// Test API Key
		register_setting(
			'fair_payment_settings',
			'fair_payment_test_api_key',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Test API Key', 'fair-payment' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Live API Key
		register_setting(
			'fair_payment_settings',
			'fair_payment_live_api_key',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Live API Key', 'fair-payment' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Mode (test or live)
		register_setting(
			'fair_payment_settings',
			'fair_payment_mode',
			array(
				'type'              => 'string',
				'description'       => __( 'Payment mode (test or live)', 'fair-payment' ),
				'sanitize_callback' => array( $this, 'sanitize_mode' ),
				'show_in_rest'      => true,
				'default'           => 'test',
			)
		);

		// Organization ID
		register_setting(
			'fair_payment_settings',
			'fair_payment_organization_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Organization ID', 'fair-payment' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);
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
}
