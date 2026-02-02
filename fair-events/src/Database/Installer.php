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

		$sql = Schema::get_event_dates_table_sql();
		dbDelta( $sql );

		$sql = Schema::get_event_sources_table_sql();
		dbDelta( $sql );

		$sql = Schema::get_event_photos_table_sql();
		dbDelta( $sql );

		$sql = Schema::get_photo_likes_table_sql();
		dbDelta( $sql );

		$sql = Schema::get_event_venues_table_sql();
		dbDelta( $sql );

		// Run migration if upgrading from pre-1.0.0
		if ( version_compare( $current_version, '1.0.0', '<' ) ) {
			self::migrate_to_1_0_0();
		}

		// Run migration if upgrading from pre-1.2.0 (taxonomy to table).
		if ( version_compare( $current_version, '1.2.0', '<' ) ) {
			self::migrate_to_1_2_0();
		}

		// Version 1.3.0 - Photo likes table (no data migration needed, table created by dbDelta).

		// Run migration if upgrading from pre-1.4.0 (add participant_id to photo_likes).
		if ( version_compare( $current_version, '1.4.0', '<' ) ) {
			self::migrate_to_1_4_0();
		}

		// Run migration if upgrading from pre-1.5.0 (add recurrence columns to event_dates).
		if ( version_compare( $current_version, '1.5.0', '<' ) ) {
			self::migrate_to_1_5_0();
		}

		// Run migration if upgrading from pre-1.6.0 (add rrule column to event_dates).
		if ( version_compare( $current_version, '1.6.0', '<' ) ) {
			self::migrate_to_1_6_0();
		}

		// Run migration if upgrading from pre-1.7.0 (add venue_id column to event_dates).
		if ( version_compare( $current_version, '1.7.0', '<' ) ) {
			self::migrate_to_1_7_0();
		}

		// Update database version
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

			if ( version_compare( $current_version, '1.2.0', '<' ) ) {
				self::migrate_to_1_2_0();
			}

			if ( version_compare( $current_version, '1.4.0', '<' ) ) {
				self::migrate_to_1_4_0();
			}

			if ( version_compare( $current_version, '1.5.0', '<' ) ) {
				self::migrate_to_1_5_0();
			}

			if ( version_compare( $current_version, '1.6.0', '<' ) ) {
				self::migrate_to_1_6_0();
			}

			if ( version_compare( $current_version, '1.7.0', '<' ) ) {
				self::migrate_to_1_7_0();
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
		self::migrate_from_postmeta();
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
				'SELECT COUNT(*) FROM %i WHERE event_id = %d',
				$table_name,
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

	/**
	 * Migrate to version 1.2.0 - Move event gallery from taxonomy to table.
	 *
	 * @return void
	 */
	private static function migrate_to_1_2_0() {
		self::migrate_from_taxonomy();
	}

	/**
	 * Migrate event photos from taxonomy to custom table.
	 *
	 * @return void
	 */
	private static function migrate_from_taxonomy() {
		global $wpdb;

		$taxonomy   = 'fair_event_gallery';
		$table_name = $wpdb->prefix . 'fair_events_event_photos';

		// Get all terms in the event gallery taxonomy.
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
			)
		);

		if ( is_wp_error( $terms ) || empty( $terms ) ) {
			return;
		}

		foreach ( $terms as $term ) {
			// Get event ID from term meta.
			$event_id = get_term_meta( $term->term_id, 'event_id', true );

			if ( ! $event_id ) {
				// Try to extract from slug (event-123).
				if ( preg_match( '/^event-(\d+)$/', $term->slug, $matches ) ) {
					$event_id = (int) $matches[1];
				}
			}

			if ( ! $event_id ) {
				continue;
			}

			// Get all attachments in this term.
			$attachment_ids = get_objects_in_term( $term->term_id, $taxonomy );

			if ( is_wp_error( $attachment_ids ) || empty( $attachment_ids ) ) {
				continue;
			}

			foreach ( $attachment_ids as $attachment_id ) {
				// Check if already migrated.
				$existing = $wpdb->get_var(
					$wpdb->prepare(
						'SELECT COUNT(*) FROM %i WHERE attachment_id = %d',
						$table_name,
						$attachment_id
					)
				);

				if ( $existing > 0 ) {
					continue;
				}

				// Insert into new table.
				$wpdb->insert(
					$table_name,
					array(
						'event_id'      => $event_id,
						'attachment_id' => $attachment_id,
					),
					array( '%d', '%d' )
				);
			}
		}
	}

	/**
	 * Migrate to version 1.4.0 - Add participant_id column to photo_likes table.
	 *
	 * @return void
	 */
	private static function migrate_to_1_4_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_events_photo_likes';

		// Check if column already exists.
		$column_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'participant_id'",
				$table_name
			)
		);

		if ( empty( $column_exists ) ) {
			// Add participant_id column.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN participant_id BIGINT UNSIGNED DEFAULT NULL AFTER user_id',
					$table_name
				)
			);

			// Add index for participant_id.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD KEY idx_participant_id (participant_id)',
					$table_name
				)
			);
		}

		// Make user_id nullable for existing installations.
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i MODIFY COLUMN user_id BIGINT UNSIGNED DEFAULT NULL',
				$table_name
			)
		);
	}

	/**
	 * Migrate to version 1.5.0 - Add recurrence columns to event_dates table.
	 *
	 * @return void
	 */
	private static function migrate_to_1_5_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if occurrence_type column already exists.
		$occurrence_type_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'occurrence_type'",
				$table_name
			)
		);

		if ( empty( $occurrence_type_exists ) ) {
			// Add occurrence_type column.
			$wpdb->query(
				$wpdb->prepare(
					"ALTER TABLE %i ADD COLUMN occurrence_type VARCHAR(20) NOT NULL DEFAULT 'single' AFTER all_day",
					$table_name
				)
			);

			// Add index for occurrence_type.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD KEY idx_occurrence_type (occurrence_type)',
					$table_name
				)
			);
		}

		// Check if master_id column already exists.
		$master_id_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'master_id'",
				$table_name
			)
		);

		if ( empty( $master_id_exists ) ) {
			// Add master_id column.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN master_id BIGINT UNSIGNED DEFAULT NULL AFTER occurrence_type',
					$table_name
				)
			);

			// Add index for master_id.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD KEY idx_master_id (master_id)',
					$table_name
				)
			);
		}
	}

	/**
	 * Migrate to version 1.6.0 - Add rrule column to event_dates table.
	 *
	 * @return void
	 */
	private static function migrate_to_1_6_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if rrule column already exists.
		$rrule_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'rrule'",
				$table_name
			)
		);

		if ( empty( $rrule_exists ) ) {
			// Add rrule column.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN rrule VARCHAR(255) DEFAULT NULL AFTER master_id',
					$table_name
				)
			);

			// Add index for rrule.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD KEY idx_rrule (rrule(100))',
					$table_name
				)
			);
		}

		// Migrate existing data from post meta to table.
		self::migrate_rrule_from_postmeta();
	}

	/**
	 * Migrate RRULE data from postmeta to event_dates table.
	 *
	 * @return void
	 */
	private static function migrate_rrule_from_postmeta() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Get all events with event_recurrence meta.
		$events_with_recurrence = $wpdb->get_results(
			"SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = 'event_recurrence' AND meta_value != ''"
		);

		if ( empty( $events_with_recurrence ) ) {
			return;
		}

		foreach ( $events_with_recurrence as $row ) {
			$event_id = (int) $row->post_id;
			$rrule    = $row->meta_value;

			// Update the master/single row with the rrule.
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE %i SET rrule = %s WHERE event_id = %d AND occurrence_type IN ('single', 'master')",
					$table_name,
					$rrule,
					$event_id
				)
			);
		}
	}

	/**
	 * Migrate to version 1.7.0 - Add venue_id column to event_dates table.
	 *
	 * @return void
	 */
	private static function migrate_to_1_7_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if venue_id column already exists.
		$venue_id_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'venue_id'",
				$table_name
			)
		);

		if ( empty( $venue_id_exists ) ) {
			// Add venue_id column.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN venue_id BIGINT UNSIGNED DEFAULT NULL AFTER rrule',
					$table_name
				)
			);

			// Add index for venue_id.
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD KEY idx_venue_id (venue_id)',
					$table_name
				)
			);
		}
	}
}
