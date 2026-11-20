<?php
/**
 * Instagram event-list notification settings.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Reads and saves one Instagram configuration's event feed, heading page and
 * schedule, kept by {@see Configurations}.
 *
 * The Instagram connection is not a setting: it lives in Fair Events
 * Experimental (Fair Events → Instagram), and the account it posts to is read
 * when a post is prepared and again just before it is published.
 */
class InstagramSettings {

	/**
	 * Default settings: off, so nothing is posted until an administrator
	 * turns it on.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'enabled'     => false,
			'source_slug' => '',
			'page_id'     => 0,
			'day_of_week' => TelegramSettings::DEFAULT_DAY,
			'time_of_day' => TelegramSettings::DEFAULT_TIME,
			'week_scope'  => TelegramSettings::DEFAULT_SCOPE,
		);
	}

	/**
	 * A configuration's saved settings, normalized onto the defaults.
	 *
	 * @param string $id Configuration ID.
	 * @return array Defaults when the configuration does not exist.
	 */
	public static function get( $id ) {
		return self::normalize( Configurations::settings( $id ) );
	}

	/**
	 * Save a configuration's settings.
	 *
	 * @param string $id       Configuration ID.
	 * @param array  $settings Settings, validated by the caller.
	 * @return bool Whether it was saved; false when the configuration no longer exists.
	 */
	public static function save( $id, array $settings ) {
		return Configurations::update( $id, array( 'settings' => self::normalize( $settings ) ) );
	}

	/**
	 * Merge stored values onto the defaults, coercing each field's type.
	 *
	 * @param array $settings Raw settings.
	 * @return array
	 */
	public static function normalize( array $settings ) {
		$defaults = self::defaults();
		$day      = isset( $settings['day_of_week'] ) ? (int) $settings['day_of_week'] : $defaults['day_of_week'];
		$time     = isset( $settings['time_of_day'] ) ? (string) $settings['time_of_day'] : '';
		$scope    = isset( $settings['week_scope'] ) ? (string) $settings['week_scope'] : '';

		return array(
			'enabled'     => ! empty( $settings['enabled'] ),
			'source_slug' => isset( $settings['source_slug'] ) ? sanitize_key( (string) $settings['source_slug'] ) : '',
			'page_id'     => isset( $settings['page_id'] ) ? max( 0, (int) $settings['page_id'] ) : 0,
			'day_of_week' => $day >= 1 && $day <= 7 ? $day : $defaults['day_of_week'],
			'time_of_day' => TelegramSettings::valid_time( $time ) ? $time : $defaults['time_of_day'],
			'week_scope'  => in_array( $scope, TelegramSettings::WEEK_SCOPES, true ) ? $scope : $defaults['week_scope'],
		);
	}
}
