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

		if ( version_compare( $current_version, '1.3.0', '<' ) ) {
			self::migrate_to_1_3_0();
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
	 * Migrate to version 1.3.0 - Add guest RSVP support
	 *
	 * @return void
	 */
	public static function migrate_to_1_3_0() {
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

		// Add guest_name column if it doesn't exist.
		if ( ! in_array( 'guest_name', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN guest_name VARCHAR(255) NULL DEFAULT NULL AFTER user_id',
					$table_name
				)
			);
		}

		// Add guest_email column if it doesn't exist.
		if ( ! in_array( 'guest_email', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN guest_email VARCHAR(255) NULL DEFAULT NULL AFTER guest_name',
					$table_name
				)
			);

			// Add index for guest_email.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD INDEX idx_guest_email (guest_email)',
					$table_name
				)
			);
		}

		// Make user_id nullable by dropping and recreating the foreign key.
		// First, drop the foreign key constraint.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i DROP FOREIGN KEY fk_rsvp_user',
				$table_name
			)
		);

		// Modify user_id to be nullable.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i MODIFY COLUMN user_id BIGINT UNSIGNED NULL DEFAULT NULL',
				$table_name
			)
		);

		// Recreate the foreign key constraint.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i ADD CONSTRAINT fk_rsvp_user FOREIGN KEY (user_id) REFERENCES %i(ID) ON DELETE CASCADE',
				$table_name,
				$wpdb->users
			)
		);

		// Drop the old unique constraint on (event_id, user_id) since user_id can now be NULL.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i DROP INDEX idx_event_user',
				$table_name
			)
		);

		// Add new unique constraint that only applies when user_id is NOT NULL.
		// Note: In MySQL, NULL values are considered distinct, so this works as intended.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i ADD UNIQUE KEY idx_event_user (event_id, user_id)',
				$table_name
			)
		);
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
