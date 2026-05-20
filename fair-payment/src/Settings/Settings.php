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

		// OAuth Access Token
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_access_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie OAuth Access Token', 'fair-payment' ),
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

		// OAuth Refresh Token
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_refresh_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie OAuth Refresh Token', 'fair-payment' ),
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

		// OAuth Token Expiration
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_token_expires',
			array(
				'type'              => 'integer',
				'description'       => __( 'Mollie OAuth Token Expiration (Unix timestamp)', 'fair-payment' ),
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

		// OAuth Site ID
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_site_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Unique Site Identifier for OAuth', 'fair-payment' ),
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

		// OAuth Connection Status
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_connected',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Mollie OAuth Connection Status', 'fair-payment' ),
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

		// Enable Budgets Feature
		register_setting(
			'fair_payment_settings',
			'fair_payment_enable_budgets',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Enable budgeting features', 'fair-payment' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		// Mollie Profile ID (cached for OAuth)
		register_setting(
			'fair_payment_settings',
			'fair_payment_mollie_profile_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Mollie Profile ID (cached)', 'fair-payment' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Disable bank transfer when close to event date
		register_setting(
			'fair_payment_settings',
			'fair_payment_disable_banktransfer_near_date',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Disable bank transfer when close to the key date of the sale', 'fair-payment' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		// Bank transfer cutoff in working days
		register_setting(
			'fair_payment_settings',
			'fair_payment_banktransfer_threshold_days',
			array(
				'type'              => 'integer',
				'description'       => __( 'Working-day threshold for disabling bank transfer', 'fair-payment' ),
				'sanitize_callback' => array( $this, 'sanitize_threshold_days' ),
				'show_in_rest'      => true,
				'default'           => 3,
			)
		);

		// Telegram: enabled
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_enabled',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Enable Telegram notifications on successful transactions', 'fair-payment' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		// Telegram: bot token (sensitive — edit context only)
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_bot_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram bot token (from @BotFather)', 'fair-payment' ),
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

		// Telegram: chat IDs (comma-separated)
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_chat_ids',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram chat IDs (comma-separated)', 'fair-payment' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Telegram: message template
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_template',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram message template (HTML, supports placeholders)', 'fair-payment' ),
				'sanitize_callback' => array( $this, 'sanitize_template' ),
				'show_in_rest'      => true,
				'default'           => self::default_template(),
			)
		);

		// Telegram: include PII placeholders
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_include_pii',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Allow participant name/email in Telegram messages', 'fair-payment' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => true,
			)
		);
	}

	/**
	 * Default Telegram message template.
	 *
	 * @return string
	 */
	public static function default_template() {
		return '<b>{test_label}{site_domain}</b>' . "\n"
			. '<a href="{event_url}">{event_title}</a>' . "\n"
			. '<a href="{participant_url}">{participant_name}</a>' . "\n"
			. 'Ticket: {ticket_label}' . "\n"
			. 'Activities: {activities}' . "\n"
			. 'Discounts: {discounts}' . "\n"
			. 'Total: {amount} {currency}';
	}

	/**
	 * Sanitize template — preserve newlines, strip dangerous tags.
	 *
	 * @param string $value Template value.
	 * @return string
	 */
	public function sanitize_template( $value ) {
		return wp_kses(
			(string) $value,
			array(
				'b'      => array(),
				'strong' => array(),
				'i'      => array(),
				'em'     => array(),
				'u'      => array(),
				'a'      => array( 'href' => array() ),
				'br'     => array(),
				'code'   => array(),
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
}
