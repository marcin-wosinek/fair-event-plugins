<?php
/**
 * Database Schema
 *
 * @package FairTeam
 */

namespace FairTeam\Database;

defined( 'WPINC' ) || die;

/**
 * Schema class for database table definitions.
 */
class Schema {

	/**
	 * Get SQL for creating the post members junction table.
	 *
	 * This table stores many-to-many relationships between posts (events, posts, pages, etc.)
	 * and team members.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_post_members_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_team_post_members';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			post_id BIGINT UNSIGNED NOT NULL,
			team_member_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY idx_post_team_member (post_id, team_member_id),
			KEY idx_post_id (post_id),
			KEY idx_team_member_id (team_member_id),
			FOREIGN KEY (post_id) REFERENCES {$wpdb->posts}(ID) ON DELETE CASCADE,
			FOREIGN KEY (team_member_id) REFERENCES {$wpdb->posts}(ID) ON DELETE CASCADE
		) ENGINE=InnoDB $charset_collate;";
	}
}
