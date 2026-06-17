<?php
/**
 * Settings management for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Settings;

defined( 'WPINC' ) || die;

/**
 * Registers the Telegram notification settings with the REST API.
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
		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_enabled',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Enable Telegram notifications on successful transactions', 'fair-payments-connector-experimental' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_bot_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram bot token (from @BotFather)', 'fair-payments-connector-experimental' ),
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

		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_chat_ids',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram chat IDs (comma-separated)', 'fair-payments-connector-experimental' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_template',
			array(
				'type'              => 'string',
				'description'       => __( 'Telegram message template (HTML, supports placeholders)', 'fair-payments-connector-experimental' ),
				'sanitize_callback' => array( $this, 'sanitize_template' ),
				'show_in_rest'      => true,
				'default'           => self::default_template(),
			)
		);

		register_setting(
			'fair_payment_settings',
			'fair_payment_telegram_include_pii',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Allow participant name/email in Telegram messages', 'fair-payments-connector-experimental' ),
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
}
