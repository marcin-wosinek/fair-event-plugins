<?php
/**
 * Database installer for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

defined( 'WPINC' ) || die;

/**
 * Handles database installation and migrations
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

		$sql = Schema::get_event_dates_table_sql();
		dbDelta( $sql );

		// Run migration if upgrading from pre-1.0.0
		if ( version_compare( $current_version, '1.0.0', '<' ) ) {
			self::migrate_to_1_0_0();
		}

		// Update database version
		Schema::update_db_version( Schema::DB_VERSION );

		error_log( 'Fair Events: Database tables installed successfully' );
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
	 * Run database upgrades if needed
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		if ( self::needs_upgrade() ) {
			$current_version = Schema::get_db_version();

			// Run migrations
			if ( version_compare( $current_version, '1.0.0', '<' ) ) {
				self::migrate_to_1_0_0();
			}

			// Install/update tables
			self::install();
		}
	}

	/**
	 * Migrate to version 1.0.0 - Create event dates table and migrate data
	 *
	 * @return void
	 */
	private static function migrate_to_1_0_0() {
		error_log( 'Fair Events: Starting migration to 1.0.0...' );

		self::migrate_from_postmeta();

		error_log( 'Fair Events: Migration to 1.0.0 completed' );
	}

	/**
	 * Migrate event dates from postmeta to custom table
	 *
	 * @return void
	 */
	private static function migrate_from_postmeta() {
		// Get all fair_event posts
		$events = get_posts(
			array(
				'post_type'      => 'fair_event',
				'posts_per_page' => -1,
				'post_status'    => 'any',
			)
		);

		$migrated = 0;
		$skipped  = 0;

		foreach ( $events as $event ) {
			// Check if already migrated
			$existing = self::check_event_dates_exists( $event->ID );
			if ( $existing ) {
				++$skipped;
				continue;
			}

			// Read from postmeta
			$start   = get_post_meta( $event->ID, 'event_start', true );
			$end     = get_post_meta( $event->ID, 'event_end', true );
			$all_day = get_post_meta( $event->ID, 'event_all_day', true );

			if ( $start ) {
				// Insert directly into table (don't use EventDates model to avoid circular dependency during migration)
				self::insert_event_date( $event->ID, $start, $end, $all_day );
				++$migrated;
			}
		}

		error_log( "Fair Events: Migrated {$migrated} events to custom table, skipped {$skipped} already migrated" );
	}

	/**
	 * Check if event dates record exists
	 *
	 * @param int $event_id Event post ID.
	 * @return bool True if exists.
	 */
	private static function check_event_dates_exists( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table_name} WHERE event_id = %d",
				$event_id
			)
		);

		return $count > 0;
	}

	/**
	 * Insert event date record
	 *
	 * @param int    $event_id Event post ID.
	 * @param string $start    Start datetime.
	 * @param string $end      End datetime.
	 * @param bool   $all_day  All day flag.
	 * @return void
	 */
	private static function insert_event_date( $event_id, $start, $end, $all_day ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$wpdb->insert(
			$table_name,
			array(
				'event_id'       => $event_id,
				'start_datetime' => $start,
				'end_datetime'   => $end,
				'all_day'        => $all_day ? 1 : 0,
			),
			array( '%d', '%s', '%s', '%d' )
		);
	}
}
