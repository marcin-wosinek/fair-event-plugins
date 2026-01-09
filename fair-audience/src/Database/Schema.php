<?php
/**
 * Database Schema
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Database schema definitions.
 */
class Schema {

	/**
	 * Get SQL for creating the participants table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_participants_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_participants';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			surname VARCHAR(255) NOT NULL,
			email VARCHAR(255) NOT NULL,
			instagram VARCHAR(255) DEFAULT '' COMMENT 'Instagram handle without @',
			email_profile ENUM('minimal', 'in_the_loop') NOT NULL DEFAULT 'minimal',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY idx_email (email),
			KEY idx_name (name, surname),
			KEY idx_instagram (instagram)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the event-participants junction table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_event_participants_table_sql() {
		global $wpdb;

		$table_name              = $wpdb->prefix . 'fair_audience_event_participants';
		$participants_table_name = $wpdb->prefix . 'fair_audience_participants';
		$charset_collate         = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			event_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			label ENUM('interested', 'signed_up') NOT NULL DEFAULT 'interested',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY idx_event_participant (event_id, participant_id),
			KEY idx_event_id (event_id),
			KEY idx_participant_id (participant_id),
			KEY idx_label (label),
			CONSTRAINT fk_audience_event FOREIGN KEY (event_id) REFERENCES {$wpdb->posts}(ID) ON DELETE CASCADE,
			CONSTRAINT fk_audience_participant FOREIGN KEY (participant_id) REFERENCES {$participants_table_name}(id) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}
}
