<?php
/**
 * Database schema for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

defined( 'WPINC' ) || die;

/**
 * Handles database schema definitions
 */
class Schema {

	/**
	 * Database version
	 */
	const DB_VERSION = '1.1.0';

	/**
	 * Get the SQL for creating the fair_event_dates table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_dates_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_dates';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			start_datetime DATETIME NOT NULL,
			end_datetime DATETIME DEFAULT NULL,
			all_day BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_start_datetime (start_datetime),
			KEY idx_end_datetime (end_datetime),
			KEY idx_start_end (start_datetime, end_datetime),

			CONSTRAINT fk_event_dates_event
				FOREIGN KEY (event_id) REFERENCES {$wpdb->posts}(ID)
				ON DELETE CASCADE
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_event_sources table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_sources_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_sources';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL,
			slug VARCHAR(255) NOT NULL,
			data_sources LONGTEXT NOT NULL,
			enabled TINYINT(1) NOT NULL DEFAULT 1,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			UNIQUE KEY idx_slug (slug),
			KEY idx_enabled (enabled),
			KEY idx_created_at (created_at)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get current database version
	 *
	 * @return string Current database version.
	 */
	public static function get_db_version() {
		return get_option( 'fair_events_db_version', '0.0.0' );
	}

	/**
	 * Update database version
	 *
	 * @param string $version Version to set.
	 * @return void
	 */
	public static function update_db_version( $version ) {
		update_option( 'fair_events_db_version', $version );
	}
}
