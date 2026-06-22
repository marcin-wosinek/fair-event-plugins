<?php
/**
 * Settings management for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Settings;

use FairPaymentsConnectorExperimental\Hooks\NotificationHooks;

defined( 'WPINC' ) || die;

/**
 * Registers the notification settings with the REST API.
 */
class Settings {

	const ROUTES_OPTION    = 'fair_payment_notification_routes';
	const BOT_TOKEN_OPTION = 'fair_payment_telegram_bot_token';

	/**
	 * Initialize settings.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_settings' ) );
		add_action( 'plugins_loaded', array( $this, 'maybe_migrate_legacy_settings' ), 10 );
	}

	/**
	 * Register plugin settings.
	 *
	 * @return void
	 */
	public function register_settings() {
		register_setting(
			'fair_payment_settings',
			self::BOT_TOKEN_OPTION,
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
			self::ROUTES_OPTION,
			array(
				'type'              => 'array',
				'description'       => __( 'Notification routes configuration', 'fair-payments-connector-experimental' ),
				'sanitize_callback' => array( $this, 'sanitize_routes' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'  => 'array',
						'items' => array(
							'type'       => 'object',
							'properties' => array(
								'id'          => array( 'type' => 'string' ),
								'enabled'     => array( 'type' => 'boolean' ),
								'channel'     => array(
									'type' => 'string',
									'enum' => array( 'email', 'telegram' ),
								),
								'destination' => array( 'type' => 'string' ),
								'frequency'   => array(
									'type' => 'string',
									'enum' => array( 'immediate', 'hourly', 'daily', 'weekly' ),
								),
								'include_pii' => array( 'type' => 'boolean' ),
							),
						),
					),
				),
				'default'           => array(),
			)
		);
	}

	/**
	 * Sanitize the routes array.
	 *
	 * Drops entries with invalid channel/frequency, sanitizes destinations,
	 * coerces booleans, and assigns a stable ID when missing.
	 *
	 * @param mixed $value Raw value from the REST request.
	 * @return array
	 */
	public function sanitize_routes( $value ) {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$valid_channels    = array( 'email', 'telegram' );
		$valid_frequencies = array( 'immediate', 'hourly', 'daily', 'weekly' );
		$sanitized         = array();

		foreach ( $value as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			$channel   = isset( $entry['channel'] ) ? (string) $entry['channel'] : '';
			$frequency = isset( $entry['frequency'] ) ? (string) $entry['frequency'] : 'immediate';

			if ( ! in_array( $channel, $valid_channels, true ) ) {
				continue;
			}
			if ( ! in_array( $frequency, $valid_frequencies, true ) ) {
				continue;
			}

			$raw_destination = isset( $entry['destination'] ) ? (string) $entry['destination'] : '';
			if ( 'email' === $channel ) {
				$destination = sanitize_email( $raw_destination );
				if ( '' === $destination ) {
					continue;
				}
			} else {
				$ids = NotificationHooks::parse_chat_ids( $raw_destination );
				if ( empty( $ids ) ) {
					continue;
				}
				$destination = implode( ', ', $ids );
			}

			$id = isset( $entry['id'] ) ? sanitize_text_field( (string) $entry['id'] ) : '';
			if ( '' === $id ) {
				$id = wp_generate_uuid4();
			}

			$sanitized[] = array(
				'id'          => $id,
				'enabled'     => ! empty( $entry['enabled'] ),
				'channel'     => $channel,
				'destination' => $destination,
				'frequency'   => $frequency,
				'include_pii' => isset( $entry['include_pii'] ) ? (bool) $entry['include_pii'] : true,
			);
		}

		return $sanitized;
	}

	/**
	 * One-time migration: if routes are empty and legacy flat settings exist,
	 * synthesize an immediate Telegram route so existing behavior is preserved.
	 *
	 * @return void
	 */
	public function maybe_migrate_legacy_settings() {
		$routes = get_option( self::ROUTES_OPTION, null );
		if ( null !== $routes ) {
			return;
		}

		$legacy_enabled  = get_option( 'fair_payment_telegram_enabled', false );
		$legacy_chat_ids = (string) get_option( 'fair_payment_telegram_chat_ids', '' );
		$legacy_pii      = (bool) get_option( 'fair_payment_telegram_include_pii', true );

		if ( ! $legacy_enabled || '' === trim( $legacy_chat_ids ) ) {
			update_option( self::ROUTES_OPTION, array() );
			return;
		}

		$ids = NotificationHooks::parse_chat_ids( $legacy_chat_ids );
		if ( empty( $ids ) ) {
			update_option( self::ROUTES_OPTION, array() );
			return;
		}

		$migrated_routes = array();
		foreach ( $ids as $chat_id ) {
			$migrated_routes[] = array(
				'id'          => wp_generate_uuid4(),
				'enabled'     => true,
				'channel'     => 'telegram',
				'destination' => $chat_id,
				'frequency'   => 'immediate',
				'include_pii' => $legacy_pii,
			);
		}

		update_option( self::ROUTES_OPTION, $migrated_routes );
	}

	/**
	 * Default notification message template.
	 *
	 * This is the single built-in format — it is not user-editable.
	 * Both Telegram and email channels use this via TelegramService::render_template().
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
}
