<?php
/**
 * Bridge to Fair Events Experimental's Instagram posting.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Finds the Instagram posting Fair Events Experimental provides.
 *
 * Settings, schedules, duplicate prevention and history stay in this plugin.
 * Drawing the image, writing the caption, storing the image and calling
 * Instagram belong to Fair Events Experimental, with its Instagram
 * connection. Without it (inactive, outdated, or its Instagram feature off)
 * Instagram notifications keep their settings and are paused.
 */
class InstagramAdapter {
	public const API         = '\FairEventsExperimental\Instagram\EventListPosts';
	public const API_VERSION = 1;

	public const ACTIVE      = 'active';
	public const INACTIVE    = 'experimental_inactive';
	public const OUTDATED    = 'experimental_outdated';
	public const UNAVAILABLE = 'instagram_unavailable';

	/**
	 * Whether Instagram posting can be used on this request, and if not, why.
	 *
	 * @return string One of the constants.
	 */
	public function availability() {
		$api = self::API;
		if ( ! defined( 'FAIR_EVENTS_EXPERIMENTAL_VERSION' ) ) {
			return self::INACTIVE;
		}
		if ( ! class_exists( $api ) || ! defined( $api . '::VERSION' ) || (int) $api::VERSION < self::API_VERSION ) {
			return self::OUTDATED;
		}
		return $api::available() ? self::ACTIVE : self::UNAVAILABLE;
	}

	/**
	 * Administrator-facing explanation of an availability.
	 *
	 * @param string $availability From {@see self::availability()}.
	 * @return string '' when active.
	 */
	public function message( $availability ) {
		switch ( $availability ) {
			case self::INACTIVE:
				return __( 'Instagram posts are paused because Fair Events Experimental is not active. It provides the Instagram connection and draws the posts. The settings are kept, and posting resumes with the next scheduled week once it is active again.', 'fair-events' );
			case self::OUTDATED:
				return __( 'Instagram posts need a newer Fair Events Experimental. Update it to manage and send them. The settings are kept.', 'fair-events' );
			case self::UNAVAILABLE:
				$api = self::API;
				return (string) $api::unavailable_message();
			default:
				return '';
		}
	}

	/**
	 * The posting API, or null when it cannot be used now.
	 *
	 * @return object|null
	 */
	public function posts() {
		if ( self::ACTIVE !== $this->availability() ) {
			return null;
		}
		$api = self::API;
		return new $api();
	}
}
