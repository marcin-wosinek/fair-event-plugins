<?php
/**
 * Weekly bulk email notification settings.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Reads and saves one bulk email configuration's schedule, event selection
 * and wording, kept by {@see Configurations}.
 *
 * The settings stay saved while Fair Audience, which sends the email, is
 * inactive.
 */
class BulkEmailSettings {
	/**
	 * Where the single bulk email configuration was saved before
	 * configurations had IDs. Once it is migrated, the option holds a
	 * read-only summary of every bulk email configuration instead
	 * ({@see self::refresh_summary()}): Fair Audience reads its `enabled` flag
	 * to decide whether to offer the weekly-summary preference, also while
	 * this plugin is inactive.
	 */
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
	 * A configuration's saved settings, normalized onto the defaults.
	 *
	 * Translates nothing, so it is safe before `init`.
	 *
	 * @param string $id Configuration ID.
	 * @return array Defaults when the configuration does not exist.
	 */
	public static function stored( $id ) {
		return self::sanitize( Configurations::settings( $id ) );
	}

	/**
	 * A configuration's saved settings, with the default subject where none
	 * was saved.
	 *
	 * Call on or after `init`: the default subject is translated.
	 *
	 * @param string $id Configuration ID.
	 * @return array
	 */
	public static function get( $id ) {
		$settings = self::stored( $id );
		if ( '' === $settings['subject'] ) {
			$settings['subject'] = __( 'This week’s events: {week_start} – {week_end}', 'fair-events' );
		}

		return $settings;
	}

	/**
	 * Save a configuration's settings.
	 *
	 * @param string $id       Configuration ID.
	 * @param array  $settings Settings.
	 * @return void
	 */
	public static function save( $id, array $settings ) {
		Configurations::update( $id, array( 'settings' => self::sanitize( $settings ) ) );
		self::refresh_summary();
	}

	/**
	 * Write the summary Fair Audience reads: whether any bulk email
	 * configuration is on, and whether any was set up (an event feed chosen).
	 *
	 * The weekly-summary preference covers every bulk email configuration,
	 * so a participant who opts out receives none of them. Which feeds a
	 * subscriber receives is chosen in Fair Audience ({@see WeeklyFeedCatalog}).
	 *
	 * @return void
	 */
	public static function refresh_summary() {
		$configurations = Configurations::all( Configurations::BULK_EMAIL );
		$enabled        = false;
		$configured     = false;
		foreach ( $configurations as $configuration ) {
			$settings   = self::sanitize( $configuration['settings'] );
			$enabled    = $enabled || $settings['enabled'];
			$configured = $configured || $settings['enabled'] || '' !== $settings['source_slug'];
		}

		update_option(
			self::OPTION,
			array(
				'summary'        => true,
				'enabled'        => $enabled,
				'configured'     => $configured,
				'configurations' => count( $configurations ),
			),
			false
		);
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
