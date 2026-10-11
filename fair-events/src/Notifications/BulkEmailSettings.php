<?php
/**
 * Weekly bulk email notification settings.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Stores the weekly email's schedule, event selection and wording.
 *
 * The settings stay saved while Fair Audience, which sends the email, is
 * inactive.
 */
class BulkEmailSettings {
	public const OPTION       = 'fair_events_notification_bulk_email';
	public const WEEK_SCOPES  = array( 'current', 'next' );
	public const DEFAULT_DAY  = 1;
	public const DEFAULT_TIME = '08:00';

	/**
	 * Default settings. The subject is filled in by {@see self::get()}.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'enabled'     => false,
			'source_slug' => '',
			'day_of_week' => self::DEFAULT_DAY,
			'time_of_day' => self::DEFAULT_TIME,
			'week_scope'  => 'current',
			'skip_empty'  => true,
			'subject'     => '',
			'intro'       => '',
			'outro'       => '',
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

		$day   = isset( $value['day_of_week'] ) ? (int) $value['day_of_week'] : $defaults['day_of_week'];
		$time  = isset( $value['time_of_day'] ) ? (string) $value['time_of_day'] : '';
		$scope = isset( $value['week_scope'] ) ? (string) $value['week_scope'] : '';

		return array(
			'enabled'     => ! empty( $value['enabled'] ),
			'source_slug' => isset( $value['source_slug'] ) ? sanitize_title( (string) $value['source_slug'] ) : $defaults['source_slug'],
			'day_of_week' => $day >= 1 && $day <= 7 ? $day : $defaults['day_of_week'],
			'time_of_day' => TelegramSettings::valid_time( $time ) ? $time : $defaults['time_of_day'],
			'week_scope'  => in_array( $scope, self::WEEK_SCOPES, true ) ? $scope : $defaults['week_scope'],
			'skip_empty'  => isset( $value['skip_empty'] ) ? ! empty( $value['skip_empty'] ) : $defaults['skip_empty'],
			'subject'     => isset( $value['subject'] ) ? sanitize_text_field( (string) $value['subject'] ) : $defaults['subject'],
			'intro'       => isset( $value['intro'] ) ? wp_kses_post( (string) $value['intro'] ) : $defaults['intro'],
			'outro'       => isset( $value['outro'] ) ? wp_kses_post( (string) $value['outro'] ) : $defaults['outro'],
		);
	}
}
