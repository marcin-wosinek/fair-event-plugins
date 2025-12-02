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
	const DB_VERSION = '1.3.0';

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
			user_id BIGINT UNSIGNED NULL DEFAULT NULL,
			guest_name VARCHAR(255) NULL DEFAULT NULL,
			guest_email VARCHAR(255) NULL DEFAULT NULL,
			rsvp_status VARCHAR(20) NOT NULL DEFAULT 'pending',
			attendance_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable',
			invited_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
			invitation_id BIGINT UNSIGNED NULL DEFAULT NULL,
			rsvp_at DATETIME NULL DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_user_id (user_id),
			KEY idx_guest_email (guest_email),
			KEY idx_rsvp_status (rsvp_status),
			KEY idx_attendance_status (attendance_status),
			KEY idx_invited_by (invited_by_user_id),
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
	 * Get the SQL for creating the fair_rsvp_invitations table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_invitations_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_rsvp_invitations';
		$rsvp_table      = $wpdb->prefix . 'fair_rsvp';
		$charset_collate = $wpdb->get_charset_collate();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			inviter_user_id BIGINT UNSIGNED NOT NULL,
			invited_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
			invited_email VARCHAR(255) NULL DEFAULT NULL,
			invitation_token VARCHAR(64) NOT NULL,
			invitation_status VARCHAR(20) NOT NULL DEFAULT 'pending',
			expires_at DATETIME NULL DEFAULT NULL,
			used_at DATETIME NULL DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_inviter (inviter_user_id),
			KEY idx_invited_user (invited_user_id),
			KEY idx_email (invited_email),
			KEY idx_status (invitation_status),
			UNIQUE KEY idx_token (invitation_token),

			CONSTRAINT fk_invitation_event
				FOREIGN KEY (event_id) REFERENCES {$wpdb->posts}(ID)
				ON DELETE CASCADE,
			CONSTRAINT fk_invitation_inviter
				FOREIGN KEY (inviter_user_id) REFERENCES {$wpdb->users}(ID)
				ON DELETE CASCADE,
			CONSTRAINT fk_invitation_invited_user
				FOREIGN KEY (invited_user_id) REFERENCES {$wpdb->users}(ID)
				ON DELETE SET NULL
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
