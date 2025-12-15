<?php
/**
 * Database installer for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Database;

use FairMembership\Utils\DebugLogger;

defined( 'WPINC' ) || die;

/**
 * Handles database installation and upgrades
 */
class Installer {

	/**
	 * Plugin version for database schema
	 */
	const DB_VERSION = '1.2.0';

	/**
	 * Install database tables
	 *
	 * @return void
	 */
	public static function install() {
		self::create_tables();
		self::update_db_version();
	}

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	private static function create_tables() {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$sql_statements = Schema::get_all_table_sql();

		foreach ( $sql_statements as $table_name => $sql ) {
			dbDelta( $sql );
		}

		// Log installation
		DebugLogger::info( 'Database tables created/updated' );
	}

	/**
	 * Update database version option
	 *
	 * @return void
	 */
	private static function update_db_version() {
		Schema::update_db_version( self::DB_VERSION );
	}

	/**
	 * Check if database needs upgrade
	 *
	 * @return bool True if upgrade needed, false otherwise.
	 */
	public static function needs_upgrade() {
		$current_version = Schema::get_db_version();
		return version_compare( $current_version, self::DB_VERSION, '<' );
	}

	/**
	 * Upgrade database if needed
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		if ( self::needs_upgrade() ) {
			$current_version = Schema::get_db_version();

			// Run specific migrations based on version
			if ( version_compare( $current_version, '1.2.0', '<' ) ) {
				self::migrate_to_1_2_0();
			}

			self::install();
		}
	}

	/**
	 * Migration to version 1.2.0 - Remove unique constraint on memberships
	 *
	 * @return void
	 */
	private static function migrate_to_1_2_0() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		// Drop the unique constraint
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i DROP INDEX unique_user_group',
				$table_name
			)
		);

		// Add regular index instead
		$wpdb->query(
			$wpdb->prepare(
				'ALTER TABLE %i ADD INDEX idx_user_group (user_id, group_id)',
				$table_name
			)
		);

		DebugLogger::info( 'Migrated to version 1.2.0 - Removed unique constraint on memberships' );
	}

	/**
	 * Uninstall - remove database tables and options
	 *
	 * @return void
	 */
	public static function uninstall() {
		global $wpdb;

		// Get table names
		$tables = Schema::get_table_names();

		// Drop tables (be careful with this!)
		foreach ( $tables as $table_name ) {
			$wpdb->query(
				$wpdb->prepare(
					'DROP TABLE IF EXISTS %i',
					$table_name
				)
			);
		}

		// Remove options
		delete_option( 'fair_membership_db_version' );

		// Log uninstallation
		DebugLogger::info( 'Database tables removed' );
	}

	/**
	 * Get installation status
	 *
	 * @return array Status information.
	 */
	public static function get_status() {
		$tables = Schema::get_table_names();
		$status = array(
			'db_version'     => Schema::get_db_version(),
			'target_version' => self::DB_VERSION,
			'needs_upgrade'  => self::needs_upgrade(),
			'tables'         => array(),
		);

		foreach ( $tables as $key => $table_name ) {
			$status['tables'][ $key ] = array(
				'name'   => $table_name,
				'exists' => Schema::table_exists( $table_name ),
			);
		}

		return $status;
	}

	/**
	 * Create sample data for testing (development only)
	 *
	 * @return void
	 */
	public static function create_sample_data() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';

		// Only create if table is empty
		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i',
				$table_name
			)
		);
		if ( $count > 0 ) {
			return;
		}

		$sample_groups = array(
			array(
				'name'           => 'Premium Members',
				'slug'           => 'premium-members',
				'description'    => 'Members with premium access to all features',
				'access_control' => 'managed',
				'status'         => 'active',
				'created_by'     => get_current_user_id(),
			),
			array(
				'name'           => 'Event Organizers',
				'slug'           => 'event-organizers',
				'description'    => 'Users who can create and manage events',
				'access_control' => 'managed',
				'status'         => 'active',
				'created_by'     => get_current_user_id(),
			),
			array(
				'name'           => 'VIP Access',
				'slug'           => 'vip-access',
				'description'    => 'Special access group for VIP members',
				'access_control' => 'managed',
				'status'         => 'active',
				'created_by'     => get_current_user_id(),
			),
			array(
				'name'           => 'Basic Users',
				'slug'           => 'basic-users',
				'description'    => 'Standard user access level',
				'access_control' => 'open',
				'status'         => 'active',
				'created_by'     => get_current_user_id(),
			),
			array(
				'name'           => 'Beta Testers',
				'slug'           => 'beta-testers',
				'description'    => 'Users testing new features',
				'access_control' => 'open',
				'status'         => 'active',
				'created_by'     => get_current_user_id(),
			),
		);

		foreach ( $sample_groups as $group ) {
			$wpdb->insert(
				$table_name,
				$group,
				array( '%s', '%s', '%s', '%s', '%s', '%d' )
			);
		}

		DebugLogger::info( 'Sample data created' );
	}
}
