<?php
/**
 * Removal of the retired photo authorship and tagging data
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Removes the data left by photo authors, photo tags and the participant
 * photo upload page (#1689).
 *
 * Drops the photo author/tag table, deletes every user's bulk upload author
 * and tag preferences, and removes the stored fair-audience-experimental
 * `photos` choice. Media attachments and their files are kept. Every step is
 * a no-op when already done and is checked afterwards, so the cleanup can be
 * repeated after a partial failure and works whether or not the companion
 * plugin is active.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PhotoCleanup {

	/**
	 * User meta keys of the retired bulk upload selectors.
	 */
	const USER_META_KEYS = array(
		'fair_audience_bulk_upload_author',
		'fair_audience_bulk_upload_tags',
	);

	/**
	 * Run the cleanup.
	 *
	 * @return bool True when every step succeeded.
	 */
	public static function run() {
		global $wpdb;

		$table_dropped = false !== $wpdb->query(
			$wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . 'fair_audience_photo_participants' )
		);

		$meta_removed    = self::delete_user_meta();
		$feature_removed = RetiredFeatureChoice::remove( 'photos' );

		return $table_dropped && $meta_removed && $feature_removed;
	}

	/**
	 * Delete the bulk upload preferences of every user.
	 *
	 * @return bool True when no such user meta remains.
	 */
	private static function delete_user_meta() {
		global $wpdb;

		foreach ( self::USER_META_KEYS as $meta_key ) {
			// Returns false when nothing was stored; the count below decides.
			delete_metadata( 'user', 0, $meta_key, '', true );
		}

		$remaining = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE meta_key IN (%s, %s)',
				$wpdb->usermeta,
				self::USER_META_KEYS[0],
				self::USER_META_KEYS[1]
			)
		);

		return null !== $remaining && 0 === (int) $remaining;
	}
}
