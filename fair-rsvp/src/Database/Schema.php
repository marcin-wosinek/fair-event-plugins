<?php
/**
 * Database schema for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Database;

defined( 'WPINC' ) || die;

/**
 * Handles database schema definitions
 */
class Schema {

	/**
	 * Database version
	 */
	const DB_VERSION = '1.0.0';

	/**
	 * Get the SQL for creating the fair_rsvp table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_rsvp_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_rsvp';
		$charset_collate = $wpdb->get_charset_collate();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			user_id BIGINT UNSIGNED NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_user_id (user_id),
			KEY idx_status (status),
			UNIQUE KEY idx_event_user (event_id, user_id),

			CONSTRAINT fk_rsvp_event
				FOREIGN KEY (event_id) REFERENCES {$wpdb->posts}(ID)
				ON DELETE CASCADE,
			CONSTRAINT fk_rsvp_user
				FOREIGN KEY (user_id) REFERENCES {$wpdb->users}(ID)
				ON DELETE CASCADE
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get current database version
	 *
	 * @return string Current database version.
	 */
	public static function get_db_version() {
		return get_option( 'fair_rsvp_db_version', '0.0.0' );
	}

	/**
	 * Update database version
	 *
	 * @param string $version New version number.
	 * @return void
	 */
	public static function update_db_version( $version ) {
		update_option( 'fair_rsvp_db_version', $version );
	}
}
