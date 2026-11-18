<?php
/**
 * Sales summary preferences.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Stores each sales summary report's schedule and fallback address (#2306).
 *
 * A report is either one organizer's own summary, keyed by the organizer's
 * ID ({@see self::DEFAULT_ORGANIZER} for the sitewide organizer, a UUID for
 * an additional one), or the consolidated summary of every organizer, keyed
 * by {@see self::CENTRAL}.
 *
 * Preferences live in their own non-autoloaded option, never in an
 * organizer's identity record, so editing or replacing an organizer's
 * identity can't erase them, and turning organizer management off keeps
 * them. Every report starts Off; one can be turned on only with a fallback
 * address saved, which receives the report when its organizer has no valid
 * notification address.
 */
class SalesSummarySettings {
	public const OPTION            = 'fair_events_sales_summary';
	public const CENTRAL           = 'central';
	public const DEFAULT_ORGANIZER = 'default';
	public const OFF               = 'off';
	public const DAILY             = 'daily';
	public const WEEKLY            = 'weekly';
	public const FREQUENCIES       = array( self::OFF, self::DAILY, self::WEEKLY );
	public const DEFAULT_TIME      = '08:00';
	public const DEFAULT_DAY       = 1;

	/**
	 * Settings of a report that was never saved.
	 *
	 * @return array{frequency: string, time_of_day: string, day_of_week: int, fallback_email: string}
	 */
	public static function defaults() {
		return array(
			'frequency'      => self::OFF,
			'time_of_day'    => self::DEFAULT_TIME,
			'day_of_week'    => self::DEFAULT_DAY,
			'fallback_email' => '',
		);
	}

	/**
	 * Whether a key names a report: the central summary, the sitewide
	 * organizer or an additional organizer's UUID.
	 *
	 * @param mixed $key Candidate key.
	 * @return bool
	 */
	public static function valid_key( $key ) {
		return is_string( $key )
			&& ( self::CENTRAL === $key
				|| self::DEFAULT_ORGANIZER === $key
				|| 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $key ) );
	}

	/**
	 * Every saved report's settings, keyed by report.
	 *
	 * @return array<string, array>
	 */
	public static function all() {
		$stored = get_option( self::OPTION, array() );
		$saved  = is_array( $stored ) && isset( $stored['reports'] ) && is_array( $stored['reports'] ) ? $stored['reports'] : array();

		$reports = array();
		foreach ( $saved as $key => $settings ) {
			if ( self::valid_key( (string) $key ) ) {
				$reports[ (string) $key ] = self::sanitize( $settings );
			}
		}
		return $reports;
	}

	/**
	 * One report's settings; the defaults when it was never saved.
	 *
	 * @param string $key Report key.
	 * @return array
	 */
	public static function get( $key ) {
		$all = self::all();
		return $all[ (string) $key ] ?? self::defaults();
	}

	/**
	 * Save one report's settings, leaving every other report as it is.
	 *
	 * @param string $key      Report key.
	 * @param array  $settings Validated settings.
	 * @return array The saved settings.
	 */
	public static function save( $key, array $settings ) {
		$stored = get_option( self::OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();
		if ( ! isset( $stored['reports'] ) || ! is_array( $stored['reports'] ) ) {
			$stored['reports'] = array();
		}

		$sanitized                          = self::sanitize( $settings );
		$stored['reports'][ (string) $key ] = $sanitized;

		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, $stored, '', false );
		} else {
			update_option( self::OPTION, $stored, false );
		}

		return $sanitized;
	}

	/**
	 * Whether a report is scheduled to send.
	 *
	 * @param array $settings Report settings.
	 * @return bool
	 */
	public static function is_enabled( array $settings ) {
		return self::OFF !== $settings['frequency'] && '' !== $settings['fallback_email'];
	}

	/**
	 * Validate settings from input. Unlike {@see self::sanitize()}, nothing
	 * is repaired: a value that isn't valid is reported by field.
	 *
	 * @param array $value Raw settings: frequency, time_of_day, day_of_week, fallback_email.
	 * @return array{settings: array, errors: array<string, string>}
	 */
	public static function validate( array $value ) {
		$errors   = array();
		$defaults = self::defaults();

		$frequency = $value['frequency'] ?? $defaults['frequency'];
		if ( ! is_string( $frequency ) || ! in_array( $frequency, self::FREQUENCIES, true ) ) {
			$errors['frequency'] = __( 'Choose Off, Daily or Weekly.', 'fair-events' );
			$frequency           = $defaults['frequency'];
		}

		$time = $value['time_of_day'] ?? $defaults['time_of_day'];
		if ( ! is_string( $time ) || ! TelegramSettings::valid_time( $time ) ) {
			$errors['time_of_day'] = __( 'Enter the delivery time as hours and minutes, for example 08:00.', 'fair-events' );
			$time                  = $defaults['time_of_day'];
		}

		$day = $value['day_of_week'] ?? $defaults['day_of_week'];
		if ( ! is_numeric( $day ) || (int) $day < 1 || (int) $day > 7 || (int) $day != $day ) { // phpcs:ignore Universal.Operators.StrictComparisons.LooseNotEqual -- rejects fractions given as numbers or strings.
			$errors['day_of_week'] = __( 'Choose the weekday for the weekly summary.', 'fair-events' );
			$day                   = $defaults['day_of_week'];
		}

		$fallback = IndividualEmailSettings::parse_recipient( $value['fallback_email'] ?? '' );
		if ( null === $fallback ) {
			$errors['fallback_email'] = __( 'Enter one valid fallback email address.', 'fair-events' );
			$fallback                 = '';
		} elseif ( '' === $fallback && self::OFF !== $frequency ) {
			$errors['fallback_email'] = __( 'Save a fallback email address before turning the sales summary on.', 'fair-events' );
		}

		return array(
			'settings' => array(
				'frequency'      => $frequency,
				'time_of_day'    => $time,
				'day_of_week'    => (int) $day,
				'fallback_email' => $fallback,
			),
			'errors'   => $errors,
		);
	}

	/**
	 * Normalize stored settings onto the defaults.
	 *
	 * A report whose fallback address can't be read is stored as Off, so
	 * nothing is enabled without somewhere to send it.
	 *
	 * @param mixed $value Raw settings.
	 * @return array
	 */
	public static function sanitize( $value ) {
		$defaults = self::defaults();
		if ( ! is_array( $value ) ) {
			return $defaults;
		}

		$frequency = isset( $value['frequency'] ) && in_array( $value['frequency'], self::FREQUENCIES, true ) ? $value['frequency'] : $defaults['frequency'];
		$time      = isset( $value['time_of_day'] ) && is_string( $value['time_of_day'] ) && TelegramSettings::valid_time( $value['time_of_day'] ) ? $value['time_of_day'] : $defaults['time_of_day'];
		$day       = isset( $value['day_of_week'] ) ? (int) $value['day_of_week'] : $defaults['day_of_week'];
		$fallback  = IndividualEmailSettings::parse_recipient( $value['fallback_email'] ?? '' );
		$fallback  = null === $fallback ? '' : $fallback;

		return array(
			'frequency'      => '' === $fallback ? self::OFF : $frequency,
			'time_of_day'    => $time,
			'day_of_week'    => $day >= 1 && $day <= 7 ? $day : $defaults['day_of_week'],
			'fallback_email' => $fallback,
		);
	}
}
