<?php
/**
 * Database schema for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Database;

defined( 'WPINC' ) || die;

/**
 * Handles database schema definitions
 */
class Schema {

	/**
	 * Get the SQL for creating the fair_groups table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_groups_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_groups';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL,
			slug VARCHAR(255) NOT NULL,
			description TEXT DEFAULT NULL,
			access_control ENUM('open', 'managed') NOT NULL DEFAULT 'open',
			status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			created_by BIGINT UNSIGNED DEFAULT NULL,

			PRIMARY KEY (id),
			UNIQUE KEY unique_slug (slug),
			KEY idx_access_control (access_control),
			KEY idx_status (status),
			KEY idx_created_by (created_by),

			CONSTRAINT fk_groups_created_by
				FOREIGN KEY (created_by) REFERENCES {$wpdb->users}(ID)
				ON DELETE SET NULL
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_memberships table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_memberships_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_memberships';
		$groups_table    = $wpdb->prefix . 'fair_groups';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			user_id BIGINT UNSIGNED NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL,
			status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
			started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			ended_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

			PRIMARY KEY (id),
			KEY idx_user_id (user_id),
			KEY idx_group_id (group_id),
			KEY idx_user_group (user_id, group_id),
			KEY idx_status (status),
			KEY idx_started_at (started_at),
			KEY idx_ended_at (ended_at),

			CONSTRAINT fk_memberships_user_id
				FOREIGN KEY (user_id) REFERENCES {$wpdb->users}(ID)
				ON DELETE CASCADE,
			CONSTRAINT fk_memberships_group_id
				FOREIGN KEY (group_id) REFERENCES {$groups_table}(id)
				ON DELETE CASCADE
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get all table creation SQL statements
	 *
	 * @return array Array of SQL statements.
	 */
	public static function get_all_table_sql() {
		return array(
			'fair_groups'      => self::get_groups_table_sql(),
			'fair_memberships' => self::get_memberships_table_sql(),
		);
	}

	/**
	 * Get table names with WordPress prefix
	 *
	 * @return array Array of table names.
	 */
	public static function get_table_names() {
		global $wpdb;

		return array(
			'fair_groups'      => $wpdb->prefix . 'fair_groups',
			'fair_memberships' => $wpdb->prefix . 'fair_memberships',
		);
	}

	/**
	 * Check if a table exists
	 *
	 * @param string $table_name Table name to check.
	 * @return bool True if table exists, false otherwise.
	 */
	public static function table_exists( $table_name ) {
		global $wpdb;

		$query = $wpdb->prepare(
			'SHOW TABLES LIKE %s',
			$table_name
		);

		return $wpdb->get_var( $query ) === $table_name;
	}

	/**
	 * Get the current database version
	 *
	 * @return string Database version.
	 */
	public static function get_db_version() {
		return get_option( 'fair_membership_db_version', '0.0.0' );
	}

	/**
	 * Update the database version
	 *
	 * @param string $version New version number.
	 * @return bool True on success, false on failure.
	 */
	public static function update_db_version( $version ) {
		return update_option( 'fair_membership_db_version', $version );
	}
}
