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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL,
			surname VARCHAR(255) DEFAULT '',
			email VARCHAR(255) DEFAULT NULL,
			instagram VARCHAR(255) DEFAULT '' COMMENT 'Instagram handle without @',
			email_profile ENUM('minimal', 'marketing') NOT NULL DEFAULT 'minimal',
			status ENUM('pending', 'confirmed') NOT NULL DEFAULT 'confirmed',
			wp_user_id BIGINT UNSIGNED DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_email (email),
			UNIQUE KEY idx_wp_user_id (wp_user_id),
			KEY idx_name (name, surname),
			KEY idx_instagram (instagram),
			KEY idx_status (status)
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			label ENUM('interested', 'signed_up', 'collaborator') NOT NULL DEFAULT 'interested',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_event_participant (event_id, participant_id),
			KEY idx_event_id (event_id),
			KEY idx_participant_id (participant_id),
			KEY idx_label (label)
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			title VARCHAR(255) NOT NULL COMMENT 'Internal title for admin reference',
			question TEXT NOT NULL COMMENT 'The actual question shown to participants',
			status ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY idx_event_id (event_id),
			KEY idx_status (status)
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			poll_id BIGINT UNSIGNED NOT NULL,
			option_text VARCHAR(255) NOT NULL,
			display_order INT NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY idx_poll_id (poll_id),
			KEY idx_display_order (display_order)
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			poll_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			access_key CHAR(64) NOT NULL COMMENT 'SHA-256 hash for secure lookups',
			token CHAR(32) NOT NULL COMMENT 'Original random token for URL generation',
			status ENUM('pending', 'responded', 'expired') NOT NULL DEFAULT 'pending',
			sent_at DATETIME DEFAULT NULL,
			responded_at DATETIME DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_access_key (access_key),
			UNIQUE KEY idx_poll_participant (poll_id, participant_id),
			KEY idx_token (token),
			KEY idx_status (status),
			KEY idx_participant_id (participant_id)
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			poll_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			option_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_poll_participant_option (poll_id, participant_id, option_id),
			KEY idx_poll_id (poll_id),
			KEY idx_participant_id (participant_id),
			KEY idx_option_id (option_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the import resolutions table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_import_resolutions_table_sql() {
		global $wpdb;

		$table_name              = $wpdb->prefix . 'fair_audience_import_resolutions';
		$participants_table_name = $wpdb->prefix . 'fair_audience_participants';
		$charset_collate         = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			filename VARCHAR(255) NOT NULL,
			original_email VARCHAR(255) NOT NULL,
			import_row_number INT NOT NULL,
			resolved_name VARCHAR(255) NOT NULL,
			resolved_surname VARCHAR(255) NOT NULL,
			resolved_email VARCHAR(255) NOT NULL,
			resolution_action ENUM('edit', 'skip', 'alias') NOT NULL DEFAULT 'edit',
			participant_id BIGINT UNSIGNED DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_original_name_surname (original_email, resolved_name, resolved_surname),
			KEY idx_filename (filename),
			KEY idx_original_email (original_email),
			KEY idx_participant_id (participant_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the photo participants table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_photo_participants_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_photo_participants';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			attachment_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			role ENUM('author', 'tagged') NOT NULL DEFAULT 'author',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_attachment_author (attachment_id, role),
			KEY idx_participant_id (participant_id),
			KEY idx_attachment_id (attachment_id),
			KEY idx_role (role)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the gallery access keys table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_gallery_access_keys_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_gallery_access_keys';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			access_key CHAR(64) NOT NULL COMMENT 'SHA-256 hash for secure lookups',
			token CHAR(32) NOT NULL COMMENT 'Original random token for URL generation',
			sent_at DATETIME DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_event_participant (event_id, participant_id),
			UNIQUE KEY idx_access_key (access_key),
			UNIQUE KEY idx_token (token),
			KEY idx_event_id (event_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the email confirmation tokens table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_email_confirmation_tokens_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_email_confirmation_tokens';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			participant_id BIGINT UNSIGNED NOT NULL,
			token CHAR(32) NOT NULL COMMENT 'Random token for email confirmation URL',
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_token (token),
			UNIQUE KEY idx_participant (participant_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the groups table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_groups_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_groups';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY idx_name (name)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the group participants junction table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_group_participants_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_group_participants';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			group_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_group_participant (group_id, participant_id),
			KEY idx_group_id (group_id),
			KEY idx_participant_id (participant_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the event signup access keys table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_event_signup_access_keys_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_event_signup_access_keys';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			participant_id BIGINT UNSIGNED NOT NULL,
			access_key CHAR(64) NOT NULL COMMENT 'SHA-256 hash for secure lookups',
			token CHAR(32) NOT NULL COMMENT 'Original random token for URL generation',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY idx_event_participant (event_id, participant_id),
			UNIQUE KEY idx_access_key (access_key),
			UNIQUE KEY idx_token (token),
			KEY idx_event_id (event_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the Instagram posts table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_instagram_posts_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_instagram_posts';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			ig_media_id VARCHAR(255) DEFAULT NULL COMMENT 'Instagram media ID after publishing',
			ig_container_id VARCHAR(255) DEFAULT NULL COMMENT 'Instagram container ID during creation',
			caption TEXT NOT NULL,
			image_url VARCHAR(2083) NOT NULL COMMENT 'Must be publicly accessible URL',
			status ENUM('pending', 'publishing', 'published', 'failed') NOT NULL DEFAULT 'pending',
			error_message TEXT DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			published_at DATETIME DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY idx_status (status),
			KEY idx_created_at (created_at)
		) ENGINE=InnoDB $charset_collate;";
	}
}
