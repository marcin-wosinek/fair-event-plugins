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
			label ENUM('interested', 'signed_up', 'collaborator') NOT NULL DEFAULT 'interested',
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

	/**
	 * Get SQL for creating the polls table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_polls_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_polls';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			event_id BIGINT UNSIGNED NOT NULL,
			title VARCHAR(255) NOT NULL COMMENT 'Internal title for admin reference',
			question TEXT NOT NULL COMMENT 'The actual question shown to participants',
			status ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			KEY idx_event_id (event_id),
			KEY idx_status (status),
			CONSTRAINT fk_poll_event FOREIGN KEY (event_id) REFERENCES {$wpdb->posts}(ID) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the poll options table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_poll_options_table_sql() {
		global $wpdb;

		$table_name       = $wpdb->prefix . 'fair_audience_poll_options';
		$polls_table_name = $wpdb->prefix . 'fair_audience_polls';
		$charset_collate  = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			poll_id BIGINT UNSIGNED NOT NULL,
			option_text VARCHAR(255) NOT NULL,
			display_order INT NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			KEY idx_poll_id (poll_id),
			KEY idx_display_order (display_order),
			CONSTRAINT fk_option_poll FOREIGN KEY (poll_id) REFERENCES {$polls_table_name}(id) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the poll access keys table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_poll_access_keys_table_sql() {
		global $wpdb;

		$table_name              = $wpdb->prefix . 'fair_audience_poll_access_keys';
		$polls_table_name        = $wpdb->prefix . 'fair_audience_polls';
		$participants_table_name = $wpdb->prefix . 'fair_audience_participants';
		$charset_collate         = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			poll_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			access_key CHAR(64) NOT NULL COMMENT 'SHA-256 hash for secure lookups',
			token CHAR(32) NOT NULL COMMENT 'Original random token for URL generation',
			status ENUM('pending', 'responded', 'expired') NOT NULL DEFAULT 'pending',
			sent_at DATETIME DEFAULT NULL,
			responded_at DATETIME DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY idx_access_key (access_key),
			UNIQUE KEY idx_poll_participant (poll_id, participant_id),
			KEY idx_token (token),
			KEY idx_status (status),
			KEY idx_participant_id (participant_id),
			CONSTRAINT fk_access_key_poll FOREIGN KEY (poll_id) REFERENCES {$polls_table_name}(id) ON DELETE CASCADE,
			CONSTRAINT fk_access_key_participant FOREIGN KEY (participant_id) REFERENCES {$participants_table_name}(id) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the poll responses table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_poll_responses_table_sql() {
		global $wpdb;

		$table_name              = $wpdb->prefix . 'fair_audience_poll_responses';
		$polls_table_name        = $wpdb->prefix . 'fair_audience_polls';
		$participants_table_name = $wpdb->prefix . 'fair_audience_participants';
		$poll_options_table_name = $wpdb->prefix . 'fair_audience_poll_options';
		$charset_collate         = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			poll_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			option_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY idx_poll_participant_option (poll_id, participant_id, option_id),
			KEY idx_poll_id (poll_id),
			KEY idx_participant_id (participant_id),
			KEY idx_option_id (option_id),
			CONSTRAINT fk_response_poll FOREIGN KEY (poll_id) REFERENCES {$polls_table_name}(id) ON DELETE CASCADE,
			CONSTRAINT fk_response_participant FOREIGN KEY (participant_id) REFERENCES {$participants_table_name}(id) ON DELETE CASCADE,
			CONSTRAINT fk_response_option FOREIGN KEY (option_id) REFERENCES {$poll_options_table_name}(id) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}
}
