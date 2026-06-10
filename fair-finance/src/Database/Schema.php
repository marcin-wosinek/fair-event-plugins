<?php
/**
 * Database schema for Fair Finance
 *
 * @package FairFinance
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- schema creation legitimately uses dbDelta directly.
 */

namespace FairFinance\Database;

defined( 'WPINC' ) || die;

/**
 * Schema class for managing database tables
 */
class Schema {
	/**
	 * Get the table name for budgets
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_budgets_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_budgets';
	}

	/**
	 * Get the table name for financial entries
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_financial_entries_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_financial_entries';
	}

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	public static function create_tables() {
		self::create_budgets_table();
		self::create_financial_entries_table();
	}

	/**
	 * Create budgets table
	 *
	 * @return void
	 */
	public static function create_budgets_table() {
		global $wpdb;

		$table_name      = self::get_budgets_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			name varchar(255) NOT NULL,
			description text DEFAULT NULL,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Create financial entries table
	 *
	 * @return void
	 */
	public static function create_financial_entries_table() {
		global $wpdb;

		$table_name      = self::get_financial_entries_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			amount decimal(10,2) NOT NULL,
			entry_type varchar(20) NOT NULL,
			entry_date date NOT NULL,
			description text DEFAULT NULL,
			budget_id bigint(20) UNSIGNED DEFAULT NULL,
			transaction_id bigint(20) UNSIGNED DEFAULT NULL,
			external_reference varchar(255) DEFAULT NULL,
			import_source varchar(255) DEFAULT NULL,
			parent_entry_id bigint(20) UNSIGNED DEFAULT NULL,
			event_url varchar(500) DEFAULT NULL,
			event_date_id bigint(20) UNSIGNED DEFAULT NULL,
			participant_id bigint(20) UNSIGNED DEFAULT NULL,
			tag varchar(100) DEFAULT NULL,
			imported_at datetime DEFAULT NULL,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY external_reference (external_reference),
			KEY entry_type (entry_type),
			KEY entry_date (entry_date),
			KEY budget_id (budget_id),
			KEY transaction_id (transaction_id),
			KEY parent_entry_id (parent_entry_id),
			KEY event_date_id (event_date_id),
			KEY participant_id (participant_id),
			KEY tag (tag)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}
}
