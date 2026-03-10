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
	const DB_VERSION = '2.7.0';

	/**
	 * Get the SQL for creating the fair_event_dates table
	 *
	 * Note: Foreign key constraints are not supported by dbDelta().
	 * Referential integrity is enforced at the application level.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_dates_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_dates';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED DEFAULT NULL,
			start_datetime DATETIME NOT NULL,
			end_datetime DATETIME DEFAULT NULL,
			all_day BOOLEAN NOT NULL DEFAULT 0,
			occurrence_type VARCHAR(20) NOT NULL DEFAULT 'single',
			master_id BIGINT UNSIGNED DEFAULT NULL,
			rrule VARCHAR(255) DEFAULT NULL,
			exdates TEXT DEFAULT NULL,
			title VARCHAR(255) DEFAULT NULL,
			external_url TEXT DEFAULT NULL,
			link_type VARCHAR(20) NOT NULL DEFAULT 'post',
			theme_image_id BIGINT UNSIGNED DEFAULT NULL,
			capacity INT UNSIGNED DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_start_datetime (start_datetime),
			KEY idx_end_datetime (end_datetime),
			KEY idx_start_end (start_datetime, end_datetime),
			KEY idx_occurrence_type (occurrence_type),
			KEY idx_master_id (master_id),
			KEY idx_rrule (rrule(100)),
			KEY idx_link_type (link_type)
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
			page_id BIGINT UNSIGNED DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_slug (slug),
			KEY idx_enabled (enabled),
			KEY idx_created_at (created_at)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_event_photos table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_photos_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_event_photos';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id BIGINT UNSIGNED NOT NULL,
			attachment_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_attachment (attachment_id),
			KEY idx_event_id (event_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_photo_likes table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_photo_likes_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_photo_likes';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			attachment_id BIGINT UNSIGNED NOT NULL,
			user_id BIGINT UNSIGNED DEFAULT NULL,
			participant_id BIGINT UNSIGNED DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_attachment_user (attachment_id, user_id),
			KEY idx_attachment_id (attachment_id),
			KEY idx_user_id (user_id),
			KEY idx_participant_id (participant_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_event_venues table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_venues_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_venues';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL,
			address TEXT,
			google_maps_link TEXT,
			latitude VARCHAR(20) DEFAULT NULL,
			longitude VARCHAR(20) DEFAULT NULL,
			facebook_page_link TEXT,
			instagram_handle VARCHAR(255) DEFAULT NULL,
			website_url TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_name (name(100))
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_event_date_categories table
	 *
	 * Junction table for standalone event date categories.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_date_categories_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_date_categories';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			event_date_id BIGINT UNSIGNED NOT NULL,
			term_id BIGINT UNSIGNED NOT NULL,
			PRIMARY KEY (event_date_id, term_id),
			KEY idx_term_id (term_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_event_date_posts junction table
	 *
	 * Maps event_date_id to post_id for multi-post linking.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_date_posts_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_event_date_posts';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			event_date_id BIGINT UNSIGNED NOT NULL,
			post_id BIGINT UNSIGNED NOT NULL,
			PRIMARY KEY (event_date_id, post_id),
			KEY idx_post_id (post_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_group_pricing_rules table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_group_pricing_rules_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_group_pricing_rules';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL,
			discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
			discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_event_date_group (event_date_id, group_id),
			KEY idx_event_date_id (event_date_id),
			KEY idx_group_id (group_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_types table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_types_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_types';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			name VARCHAR(255) NOT NULL,
			capacity INT UNSIGNED DEFAULT NULL,
			sort_order INT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_date_id (event_date_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_sale_periods table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_sale_periods_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_sale_periods';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			name VARCHAR(255) DEFAULT NULL,
			sale_start DATETIME NOT NULL,
			sale_end DATETIME NOT NULL,
			sort_order INT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_date_id (event_date_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_prices table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_prices_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_prices';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			ticket_type_id BIGINT UNSIGNED NOT NULL,
			sale_period_id BIGINT UNSIGNED NOT NULL,
			price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			capacity INT UNSIGNED DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_type_period (ticket_type_id, sale_period_id),
			KEY idx_ticket_type_id (ticket_type_id),
			KEY idx_sale_period_id (sale_period_id)
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
