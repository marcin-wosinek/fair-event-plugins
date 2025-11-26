<?php
/**
 * Database installer for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Database;

defined( 'WPINC' ) || die;

/**
 * Handles database installation and migrations
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class Installer {

	/**
	 * Install database tables
	 *
	 * @return void
	 */
	public static function install() {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$current_version = Schema::get_db_version();

		// Create RSVP table.
		$sql = Schema::get_rsvp_table_sql();
		dbDelta( $sql );

		// Create invitations table.
		$sql = Schema::get_invitations_table_sql();
		dbDelta( $sql );

		// Run migrations if needed.
		if ( version_compare( $current_version, '1.2.0', '<' ) ) {
			self::migrate_to_1_2_0();
		}

		// Update database version.
		Schema::update_db_version( Schema::DB_VERSION );
	}

	/**
	 * Check if database needs upgrade
	 *
	 * @return bool True if upgrade is needed.
	 */
	public static function needs_upgrade() {
		$current_version = Schema::get_db_version();
		return version_compare( $current_version, Schema::DB_VERSION, '<' );
	}

	/**
	 * Migrate to version 1.2.0 - Add invitation tracking columns
	 *
	 * @return void
	 */
	public static function migrate_to_1_2_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_rsvp';

		// Check if columns already exist.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$columns = $wpdb->get_col(
			$wpdb->prepare(
				'SHOW COLUMNS FROM %i',
				$table_name
			)
		);

		// Add invited_by_user_id column if it doesn't exist.
		if ( ! in_array( 'invited_by_user_id', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN invited_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER attendance_status',
					$table_name
				)
			);

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD INDEX idx_invited_by (invited_by_user_id)',
					$table_name
				)
			);
		}

		// Add invitation_id column if it doesn't exist.
		if ( ! in_array( 'invitation_id', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN invitation_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER invited_by_user_id',
					$table_name
				)
			);
		}
	}

	/**
	 * Migrate existing posts to set _has_rsvp_block meta
	 *
	 * This should be run once to backfill the meta for all existing posts.
	 * Works on any post type (events, posts, pages, etc.).
	 *
	 * @return array Results with counts of processed and updated posts.
	 */
	public static function migrate_rsvp_block_meta() {
		$args = array(
			'post_type'      => 'any',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
		);

		$post_ids  = get_posts( $args );
		$processed = 0;
		$updated   = 0;

		foreach ( $post_ids as $post_id ) {
			$post           = get_post( $post_id );
			$has_rsvp_block = has_block( 'fair-rsvp/rsvp-button', $post );

			// Update meta.
			update_post_meta( $post_id, '_has_rsvp_block', $has_rsvp_block ? '1' : '0' );

			++$processed;
			if ( $has_rsvp_block ) {
				++$updated;
			}
		}

		return array(
			'processed' => $processed,
			'updated'   => $updated,
		);
	}
}
