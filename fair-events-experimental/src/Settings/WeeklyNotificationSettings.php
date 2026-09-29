<?php
/**
 * Weekly event notification settings.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Settings;

defined( 'WPINC' ) || die;

/**
 * Stores the weekly notification schedule and provider configuration.
 *
 * The Telegram bot token lives in its own non-autoloaded option and is never
 * returned by {@see self::get()}, so settings responses cannot disclose it.
 * Provider configuration is kept when a provider or the whole feature is
 * disabled.
 */
class WeeklyNotificationSettings {
	public const OPTION         = 'fair_events_experimental_weekly_notifications';
	public const TOKEN_OPTION   = 'fair_events_experimental_weekly_telegram_token';
	public const MAX_CHAT_IDS   = 20;
	public const WEEK_SCOPES    = array( 'current', 'next' );
	public const DEFAULT_DAY    = 1;
	public const DEFAULT_TIME   = '09:00';
	public const DEFAULT_SCOPE  = 'current';
	private const TIME_PATTERN  = '/^([01]\d|2[0-3]):[0-5]\d$/';
	private const TOKEN_PATTERN = '/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/';

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'enabled'     => false,
			'source_slug' => '',
			'page_id'     => 0,
			'day_of_week' => self::DEFAULT_DAY,
			'time_of_day' => self::DEFAULT_TIME,
			'week_scope'  => self::DEFAULT_SCOPE,
			'providers'   => array(
				'telegram' => array(
					'enabled'  => false,
					'chat_ids' => array(),
				),
			),
		);
	}

	/**
	 * Saved settings, normalized onto the defaults.
	 *
	 * @return array
	 */
	public static function get() {
		$stored = get_option( self::OPTION, array() );
		return self::normalize( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Save settings.
	 *
	 * @param array $settings Settings, validated by the caller.
	 * @return void
	 */
	public static function save( array $settings ) {
		update_option( self::OPTION, self::normalize( $settings ), false );
	}

	/**
	 * Merge stored values onto the defaults, coercing each field's type.
	 *
	 * @param array $settings Raw settings.
	 * @return array
	 */
	public static function normalize( array $settings ) {
		$defaults = self::defaults();
		$telegram = isset( $settings['providers']['telegram'] ) && is_array( $settings['providers']['telegram'] )
			? $settings['providers']['telegram']
			: array();

		$day   = isset( $settings['day_of_week'] ) ? (int) $settings['day_of_week'] : $defaults['day_of_week'];
		$time  = isset( $settings['time_of_day'] ) ? (string) $settings['time_of_day'] : '';
		$scope = isset( $settings['week_scope'] ) ? (string) $settings['week_scope'] : '';

		return array(
			'enabled'     => ! empty( $settings['enabled'] ),
			'source_slug' => isset( $settings['source_slug'] ) ? sanitize_key( (string) $settings['source_slug'] ) : '',
			'page_id'     => isset( $settings['page_id'] ) ? max( 0, (int) $settings['page_id'] ) : 0,
			'day_of_week' => $day >= 1 && $day <= 7 ? $day : $defaults['day_of_week'],
			'time_of_day' => self::valid_time( $time ) ? $time : $defaults['time_of_day'],
			'week_scope'  => in_array( $scope, self::WEEK_SCOPES, true ) ? $scope : $defaults['week_scope'],
			'providers'   => array(
				'telegram' => array(
					'enabled'  => ! empty( $telegram['enabled'] ),
					'chat_ids' => isset( $telegram['chat_ids'] ) && is_array( $telegram['chat_ids'] )
						? array_values( array_filter( array_map( 'strval', $telegram['chat_ids'] ), array( self::class, 'valid_chat_id' ) ) )
						: array(),
				),
			),
		);
	}

	/**
	 * Whether a value is a 24-hour 'HH:MM' time.
	 *
	 * @param string $time Time.
	 * @return bool
	 */
	public static function valid_time( $time ) {
		return is_string( $time ) && (bool) preg_match( self::TIME_PATTERN, $time );
	}

	/**
	 * Whether a value is a Telegram chat ID (numeric) or public @username.
	 *
	 * @param string $chat_id Chat or channel identifier.
	 * @return bool
	 */
	public static function valid_chat_id( $chat_id ) {
		return is_string( $chat_id ) && (bool) preg_match( '/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/', $chat_id );
	}

	/**
	 * Whether a value has the shape of a Telegram bot token.
	 *
	 * @param string $token Bot token.
	 * @return bool
	 */
	public static function valid_token( $token ) {
		return is_string( $token ) && (bool) preg_match( self::TOKEN_PATTERN, $token );
	}

	/**
	 * Split a list of chat IDs typed as text or sent as an array.
	 *
	 * @param mixed $raw Comma, space or newline separated text, or an array.
	 * @return string[] Trimmed, de-duplicated identifiers in input order.
	 */
	public static function parse_chat_ids( $raw ) {
		$parts = is_array( $raw ) ? $raw : preg_split( '/[\s,]+/', (string) $raw );
		$parts = array_map( 'trim', array_map( 'strval', (array) $parts ) );
		return array_values( array_unique( array_filter( $parts, 'strlen' ) ) );
	}

	/**
	 * The saved Telegram bot token, or an empty string.
	 *
	 * @return string
	 */
	public static function telegram_token() {
		return (string) get_option( self::TOKEN_OPTION, '' );
	}

	/**
	 * Save the Telegram bot token.
	 *
	 * @param string $token Validated bot token.
	 * @return void
	 */
	public static function set_telegram_token( $token ) {
		update_option( self::TOKEN_OPTION, (string) $token, false );
	}

	/**
	 * Remove the saved Telegram bot token.
	 *
	 * @return void
	 */
	public static function clear_telegram_token() {
		delete_option( self::TOKEN_OPTION );
	}
}
