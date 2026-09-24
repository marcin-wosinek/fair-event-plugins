<?php
/**
 * Removal of the retired event gallery's data
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Removes gallery-only data left by the event gallery.
 *
 * Drops the gallery access keys table and moves the stored
 * fair-audience-experimental `galleries` choice onto the `photos` bundle,
 * which carries the retained photo upload and attribution features. Photo
 * author/tag records and media attachments are kept. Every step is a no-op
 * when already done, so the cleanup can be repeated after a partial failure
 * and works whether or not the companion plugin is active.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GalleryCleanup {

	/**
	 * Option holding the fair-audience-experimental feature choices.
	 */
	const FEATURES_OPTION = 'fair_audience_experimental_features';

	/**
	 * Run the cleanup.
	 *
	 * @return bool True when every step succeeded.
	 */
	public static function run() {
		global $wpdb;

		$success = false !== $wpdb->query(
			$wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . 'fair_audience_gallery_access_keys' )
		);

		return self::migrate_feature_option() && $success;
	}

	/**
	 * Move a stored `galleries` choice onto `photos` and drop the old key.
	 *
	 * An explicit `photos` choice wins over the legacy value.
	 *
	 * @return bool True when the option no longer holds `galleries`.
	 */
	private static function migrate_feature_option() {
		$features = get_option( self::FEATURES_OPTION );
		if ( ! is_array( $features ) || ! array_key_exists( 'galleries', $features ) ) {
			return true;
		}

		if ( ! array_key_exists( 'photos', $features ) ) {
			$features['photos'] = (bool) $features['galleries'];
		}
		unset( $features['galleries'] );

		return update_option( self::FEATURES_OPTION, $features );
	}
}
