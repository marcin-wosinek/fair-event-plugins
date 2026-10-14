<?php
/**
 * Individual email notification settings.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\WeeklyEventsProvider;

defined( 'WPINC' ) || die;

/**
 * Stores the recipient, schedule, event selection and wording of the weekly
 * email sent to one explicitly configured address.
 *
 * The address is typed in by an administrator. It is not tied to a WordPress
 * user or a Fair Audience participant.
 */
class IndividualEmailSettings {
	public const OPTION = 'fair_events_notification_individual_email';

	/**
	 * Event selection meaning every published event of this site.
	 *
	 * Any other selection is an event source slug. Slugs never contain '@',
	 * so the two cannot be confused.
	 */
	public const LOCAL_EVENTS = WeeklyEventsProvider::LOCAL_EVENTS;

	private const MAX_RECIPIENT_LENGTH = 254;

	/**
	 * Default settings. The subject is filled in by {@see self::get()}.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'enabled'         => false,
			'recipient'       => '',
			'event_selection' => self::LOCAL_EVENTS,
			'day_of_week'     => BulkEmailSettings::DEFAULT_DAY,
			'time_of_day'     => BulkEmailSettings::DEFAULT_TIME,
			'week_scope'      => 'current',
			'skip_empty'      => true,
			'subject'         => '',
			'intro'           => '',
			'outro'           => '',
		);
	}

	/**
	 * Saved settings as stored, normalized onto the defaults.
	 *
	 * Translates nothing, so it is safe before `init`.
	 *
	 * @return array
	 */
	public static function stored() {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Saved settings, with the default subject where none was saved.
	 *
	 * Call on or after `init`: the default subject is translated.
	 *
	 * @return array
	 */
	public static function get() {
		$settings = self::stored();
		if ( '' === $settings['subject'] ) {
			$settings['subject'] = __( 'This week’s events: {week_start} – {week_end}', 'fair-events' );
		}

		return $settings;
	}

	/**
	 * Save settings.
	 *
	 * @param array $settings Settings.
	 * @return void
	 */
	public static function save( array $settings ) {
		update_option( self::OPTION, self::sanitize( $settings ), false );
	}

	/**
	 * Read one email address from input.
	 *
	 * Anything that is not exactly one address is refused, never repaired:
	 * lists, display names, and line breaks or other control characters that
	 * could add mail headers.
	 *
	 * @param mixed $value Raw recipient.
	 * @return string|null The address, '' when none was given, or null when invalid.
	 */
	public static function parse_recipient( $value ) {
		if ( ! is_string( $value ) || preg_match( '/[\x00-\x1F\x7F]/', $value ) ) {
			return null;
		}

		$value = trim( $value, ' ' );
		if ( '' === $value ) {
			return '';
		}

		if ( strlen( $value ) > self::MAX_RECIPIENT_LENGTH
			|| preg_match( '/[\s,;<>()"\'\\\\]/u', $value )
			|| 1 !== substr_count( $value, '@' )
			|| ! is_email( $value )
			|| sanitize_email( $value ) !== $value
		) {
			return null;
		}

		return $value;
	}

	/**
	 * Whether a value names an event selection: every local event, or the slug
	 * of an event source.
	 *
	 * @param mixed $value Raw selection.
	 * @return bool
	 */
	public static function valid_selection( $value ) {
		return is_string( $value )
			&& ( self::LOCAL_EVENTS === $value || ( '' !== $value && sanitize_title( $value ) === $value ) );
	}

	/**
	 * Merge values onto the defaults, coercing each field's type.
	 *
	 * @param mixed $value Raw settings.
	 * @return array
	 */
	public static function sanitize( $value ) {
		$defaults = self::defaults();
		if ( ! is_array( $value ) ) {
			return $defaults;
		}

		$day       = isset( $value['day_of_week'] ) ? (int) $value['day_of_week'] : $defaults['day_of_week'];
		$time      = isset( $value['time_of_day'] ) ? (string) $value['time_of_day'] : '';
		$scope     = isset( $value['week_scope'] ) ? (string) $value['week_scope'] : '';
		$recipient = self::parse_recipient( $value['recipient'] ?? '' );
		$selection = $value['event_selection'] ?? null;

		return array(
			'enabled'         => ! empty( $value['enabled'] ),
			'recipient'       => null === $recipient ? $defaults['recipient'] : $recipient,
			'event_selection' => self::valid_selection( $selection ) ? $selection : $defaults['event_selection'],
			'day_of_week'     => $day >= 1 && $day <= 7 ? $day : $defaults['day_of_week'],
			'time_of_day'     => TelegramSettings::valid_time( $time ) ? $time : $defaults['time_of_day'],
			'week_scope'      => in_array( $scope, BulkEmailSettings::WEEK_SCOPES, true ) ? $scope : $defaults['week_scope'],
			'skip_empty'      => isset( $value['skip_empty'] ) ? ! empty( $value['skip_empty'] ) : $defaults['skip_empty'],
			'subject'         => isset( $value['subject'] ) ? sanitize_text_field( (string) $value['subject'] ) : $defaults['subject'],
			'intro'           => isset( $value['intro'] ) ? wp_kses_post( (string) $value['intro'] ) : $defaults['intro'],
			'outro'           => isset( $value['outro'] ) ? wp_kses_post( (string) $value['outro'] ) : $defaults['outro'],
		);
	}
}
