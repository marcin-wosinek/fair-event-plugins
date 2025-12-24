<?php
/**
 * Database Schema for Fair Platform
 *
 * @package FairPlatform
 */

namespace FairPlatform\Database;

defined( 'ABSPATH' ) || die;

/**
 * Database schema management
 */
class Schema {
	/**
	 * Database version
	 *
	 * @var string
	 */
	const DB_VERSION = '1.0.0';

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	public static function create_tables() {
		global $wpdb;

		$charset_collate = $wpdb->get_charset_collate();
		$table_name      = $wpdb->prefix . 'fair_platform_connections';

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			site_id VARCHAR(255) NOT NULL,
			site_name VARCHAR(255),
			site_url VARCHAR(255),
			mollie_organization_id VARCHAR(100),
			mollie_profile_id VARCHAR(100),
			status VARCHAR(20) NOT NULL,
			error_code VARCHAR(50),
			error_message TEXT,
			scope_granted TEXT,
			profile_created BOOLEAN DEFAULT 0,
			connected_at DATETIME NOT NULL,
			last_token_refresh DATETIME,
			ip_address VARCHAR(45),
			user_agent TEXT,
			INDEX idx_site_id (site_id),
			INDEX idx_organization (mollie_organization_id),
			INDEX idx_status (status),
			INDEX idx_connected_at (connected_at)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Store database version.
		update_option( 'fair_platform_db_version', self::DB_VERSION );
	}

	/**
	 * Drop database tables
	 *
	 * @return void
	 */
	public static function drop_tables() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_platform_connections';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "DROP TABLE IF EXISTS {$table_name}" );

		delete_option( 'fair_platform_db_version' );
	}

	/**
	 * Check if tables need updating
	 *
	 * @return bool
	 */
	public static function needs_update() {
		$current_version = get_option( 'fair_platform_db_version', '0' );
		return version_compare( $current_version, self::DB_VERSION, '<' );
	}
}
