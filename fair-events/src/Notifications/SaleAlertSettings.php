<?php
/**
 * Telegram ticket sale alert preferences.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Stores each organizer's Telegram ticket sale alert settings (#2448): its
 * switch, private chat or channel, and how often its alerts go out
 * (#2449): one message per sale, or a daily or weekly digest at a
 * site-local time. The organizer's switch is the only one: it controls
 * both its immediate alerts and its digests.
 *
 * Organizers are keyed like the sales summaries
 * ({@see SalesSummarySettings::DEFAULT_ORGANIZER} for the sitewide
 * organizer, a UUID for an additional one). Preferences live in their own
 * non-autoloaded option, never in an organizer's identity record, so
 * turning organizer management off or replacing an organizer keeps them.
 *
 * Everything starts off: nothing is sent until an administrator gives an
 * organizer a destination and turns its switch on. An organizer saved
 * before frequencies existed sends immediately.
 *
 * Sites saved before the organizer switch became the only one also stored
 * a sitewide switch. Read, a sitewide switch that was off turns every
 * organizer's switch off, keeping destinations and schedules, so upgrading
 * never starts sending; one that was on leaves each organizer's switch as
 * it was. {@see self::migrate()} then saves the settings without it.
 */
class SaleAlertSettings {
	public const OPTION = 'fair_events_sale_alerts';

	public const IMMEDIATE    = 'immediate';
	public const DAILY        = SalesSummarySettings::DAILY;
	public const WEEKLY       = SalesSummarySettings::WEEKLY;
	public const FREQUENCIES  = array( self::IMMEDIATE, self::DAILY, self::WEEKLY );
	public const DEFAULT_TIME = SalesSummarySettings::DEFAULT_TIME;
	public const DEFAULT_DAY  = SalesSummarySettings::DEFAULT_DAY;

	/**
	 * Settings that were never saved.
	 *
	 * @return array{organizers: array<string, array{enabled: bool, chat_id: string}>}
	 */
	public static function defaults() {
		return array(
			'organizers' => array(),
		);
	}

	/**
	 * One organizer's settings that were never saved.
	 *
	 * @return array{enabled: bool, chat_id: string, frequency: string, time_of_day: string, day_of_week: int}
	 */
	public static function organizer_defaults() {
		return array(
			'enabled'     => false,
			'chat_id'     => '',
			'frequency'   => self::IMMEDIATE,
			'time_of_day' => self::DEFAULT_TIME,
			'day_of_week' => self::DEFAULT_DAY,
		);
	}

	/**
	 * Whether an organizer's sales are collected into a digest.
	 *
	 * @param array $organizer Organizer settings.
	 * @return bool
	 */
	public static function is_digest( array $organizer ) {
		return in_array( $organizer['frequency'] ?? self::IMMEDIATE, array( self::DAILY, self::WEEKLY ), true );
	}

	/**
	 * Whether a key names an organizer: the sitewide one or a UUID.
	 *
	 * @param mixed $key Candidate key.
	 * @return bool
	 */
	public static function valid_key( $key ) {
		return SalesSummarySettings::valid_key( $key ) && SalesSummarySettings::CENTRAL !== $key;
	}

	/**
	 * The saved settings.
	 *
	 * @return array
	 */
	public static function get() {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Whether any organizer sends its ticket sales.
	 *
	 * @return bool
	 */
	public static function any_enabled() {
		foreach ( self::get()['organizers'] as $organizer ) {
			if ( $organizer['enabled'] ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Save settings stored with the former sitewide switch without it,
	 * once, with the organizer switches it implies
	 * ({@see self::sanitize()}).
	 *
	 * @return bool Whether settings were migrated.
	 */
	public static function migrate() {
		$raw = get_option( self::OPTION, false );
		if ( ! is_array( $raw ) || ! array_key_exists( 'enabled', $raw ) ) {
			return false;
		}
		update_option( self::OPTION, self::sanitize( $raw ), false );
		return true;
	}

	/**
	 * One organizer's settings; the defaults when never saved.
	 *
	 * @param string $key Organizer key.
	 * @return array{enabled: bool, chat_id: string, frequency: string, time_of_day: string, day_of_week: int}
	 */
	public static function organizer( $key ) {
		return self::get()['organizers'][ (string) $key ] ?? self::organizer_defaults();
	}

	/**
	 * Save validated settings. Organizers not named keep their saved
	 * settings, so an organizer hidden while organizer management is off
	 * keeps its destination.
	 *
	 * @param array $settings Validated settings.
	 * @return array The saved settings.
	 */
	public static function save( array $settings ) {
		$current   = self::get();
		$merged    = array(
			'organizers' => array_merge( $current['organizers'], $settings['organizers'] ?? array() ),
		);
		$sanitized = self::sanitize( $merged );

		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, $sanitized, '', false );
		} else {
			update_option( self::OPTION, $sanitized, false );
		}

		return $sanitized;
	}

	/**
	 * Validate settings from input. Nothing is repaired: a value that isn't
	 * valid is reported by field. An organizer field left out takes its
	 * default; callers merge saved values in first to keep them.
	 *
	 * @param array $value Raw settings: organizers keyed by organizer.
	 * @return array{settings: array, errors: array<string, string>}
	 */
	public static function validate( array $value ) {
		$errors = array();

		$organizers = array();
		$raw        = $value['organizers'] ?? array();
		if ( ! is_array( $raw ) ) {
			$errors['organizers'] = __( 'The organizer settings could not be read.', 'fair-events' );
			$raw                  = array();
		}

		foreach ( $raw as $key => $organizer ) {
			$key = (string) $key;
			if ( ! self::valid_key( $key ) || ! is_array( $organizer ) ) {
				$errors['organizers'] = __( 'The organizer settings could not be read.', 'fair-events' );
				continue;
			}

			$organizer_enabled = $organizer['enabled'] ?? false;
			if ( ! is_bool( $organizer_enabled ) ) {
				$errors[ "organizers.{$key}.enabled" ] = __( 'Turn the organizer’s alerts on or off.', 'fair-events' );
				$organizer_enabled                     = false;
			}

			$chat_id = $organizer['chat_id'] ?? '';
			$chat_id = is_string( $chat_id ) ? trim( $chat_id ) : null;
			if ( null === $chat_id || ( '' !== $chat_id && ! TelegramSettings::valid_chat_id( $chat_id ) ) ) {
				$errors[ "organizers.{$key}.chat_id" ] = __( 'Enter one chat ID (a number such as -1001234567890) or a public @channelname.', 'fair-events' );
				$chat_id                               = '';
			} elseif ( '' === $chat_id && $organizer_enabled ) {
				$errors[ "organizers.{$key}.chat_id" ] = __( 'Enter a chat or channel before turning the organizer’s alerts on.', 'fair-events' );
			}

			$schedule = self::validate_schedule( $key, $organizer, $errors );

			$organizers[ $key ] = array_merge(
				array(
					'enabled' => $organizer_enabled,
					'chat_id' => $chat_id,
				),
				$schedule
			);
		}

		return array(
			'settings' => array(
				'organizers' => $organizers,
			),
			'errors'   => $errors,
		);
	}

	/**
	 * Validate one organizer's frequency, delivery time and weekday.
	 *
	 * @param string $key       Organizer key.
	 * @param array  $organizer Raw organizer settings.
	 * @param array  $errors    Errors by field, added to.
	 * @return array{frequency: string, time_of_day: string, day_of_week: int}
	 */
	private static function validate_schedule( $key, array $organizer, array &$errors ) {
		$defaults = self::organizer_defaults();

		$frequency = $organizer['frequency'] ?? $defaults['frequency'];
		if ( ! in_array( $frequency, self::FREQUENCIES, true ) ) {
			$errors[ "organizers.{$key}.frequency" ] = __( 'Choose how often the organizer’s sales are sent: immediately, daily or weekly.', 'fair-events' );
			$frequency                               = $defaults['frequency'];
		}

		$time = $organizer['time_of_day'] ?? $defaults['time_of_day'];
		if ( ! TelegramSettings::valid_time( $time ) ) {
			$errors[ "organizers.{$key}.time_of_day" ] = __( 'Enter the delivery time as hours and minutes, for example 08:00.', 'fair-events' );
			$time                                      = $defaults['time_of_day'];
		}

		$day = $organizer['day_of_week'] ?? $defaults['day_of_week'];
		if ( ! is_int( $day ) || $day < 1 || $day > 7 ) {
			$errors[ "organizers.{$key}.day_of_week" ] = __( 'Choose the weekday for the weekly digest.', 'fair-events' );
			$day                                       = $defaults['day_of_week'];
		}

		return array(
			'frequency'   => $frequency,
			'time_of_day' => $time,
			'day_of_week' => $day,
		);
	}

	/**
	 * Normalize stored settings onto the defaults. An organizer whose
	 * destination can't be read is stored off; one without a readable
	 * frequency sends immediately. A former sitewide switch that is not on
	 * turns every organizer off.
	 *
	 * @param mixed $value Raw settings.
	 * @return array
	 */
	public static function sanitize( $value ) {
		$defaults = self::defaults();
		if ( ! is_array( $value ) ) {
			return $defaults;
		}

		// Settings saved with the former sitewide switch.
		$legacy_off = array_key_exists( 'enabled', $value ) && true !== $value['enabled'];
		$organizers = array();
		$fallback   = self::organizer_defaults();
		foreach ( (array) ( $value['organizers'] ?? array() ) as $key => $organizer ) {
			$key = (string) $key;
			if ( ! self::valid_key( $key ) || ! is_array( $organizer ) ) {
				continue;
			}
			$chat_id            = isset( $organizer['chat_id'] ) && is_string( $organizer['chat_id'] ) && TelegramSettings::valid_chat_id( $organizer['chat_id'] ) ? $organizer['chat_id'] : '';
			$frequency          = $organizer['frequency'] ?? null;
			$time               = $organizer['time_of_day'] ?? null;
			$day                = isset( $organizer['day_of_week'] ) ? (int) $organizer['day_of_week'] : 0;
			$organizers[ $key ] = array(
				'enabled'     => ! $legacy_off && '' !== $chat_id && true === ( $organizer['enabled'] ?? false ),
				'chat_id'     => $chat_id,
				'frequency'   => in_array( $frequency, self::FREQUENCIES, true ) ? $frequency : $fallback['frequency'],
				'time_of_day' => TelegramSettings::valid_time( $time ) ? $time : $fallback['time_of_day'],
				'day_of_week' => $day >= 1 && $day <= 7 ? $day : $fallback['day_of_week'],
			);
		}

		return array(
			'organizers' => $organizers,
		);
	}
}
