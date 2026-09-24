<?php
/**
 * Removal of the retired event gallery's data
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

defined( 'WPINC' ) || die;

/**
 * Removes gallery-only data left by the event gallery.
 *
 * Drops the photo relationship and likes tables, the bulk upload event
 * preference, and the `galleries` entry of the stored fair-events-experimental
 * feature option. Attachment posts and files are kept. Every step is a no-op
 * when already done, so the cleanup can be repeated after a partial failure
 * and works whether or not the companion plugin is active.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GalleryCleanup {

	/**
	 * Option holding the fair-events-experimental feature choices.
	 */
	const FEATURES_OPTION = 'fair_events_experimental_features';

	/**
	 * Gallery-only tables, without the table prefix.
	 */
	const TABLES = array( 'fair_events_photo_likes', 'fair_events_event_photos' );

	/**
	 * Run the cleanup.
	 *
	 * @return bool True when every step succeeded.
	 */
	public static function run() {
		global $wpdb;

		$success = true;

		foreach ( self::TABLES as $suffix ) {
			if ( false === $wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . $suffix ) ) ) {
				$success = false;
			}
		}

		delete_metadata( 'user', 0, 'fair_events_bulk_upload_event', '', true );

		$features = get_option( self::FEATURES_OPTION );
		if ( is_array( $features ) && array_key_exists( 'galleries', $features ) ) {
			unset( $features['galleries'] );
			if ( ! update_option( self::FEATURES_OPTION, $features ) ) {
				$success = false;
			}
		}

		// The /event-gallery/{id} rewrite rule is gone; WordPress rebuilds
		// the stored rules on the next request.
		delete_option( 'rewrite_rules' );

		return $success;
	}
}
