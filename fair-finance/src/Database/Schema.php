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
		self::create_reconciliation_tables();
		update_option( 'fair_finance_schema_version', '2' );
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
	/**
	 * Reconciliation table name.
	 *
	 * @param string $kind decisions, history, evidence or context.
	 * @return string
	 */
	public static function reconciliation_table( $kind ) {
		global $wpdb;
		return $wpdb->prefix . 'fair_finance_reconciliation_' . $kind;
	}

	/**
	 * Install Finance-owned decisions separately from provider records.
	 *
	 * @return void
	 */
	public static function create_reconciliation_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$collate   = $wpdb->get_charset_collate();
		$decisions = self::reconciliation_table( 'decisions' );
		$history   = self::reconciliation_table( 'history' );
		$evidence  = self::reconciliation_table( 'evidence' );
		$context   = self::reconciliation_table( 'context' );
		dbDelta(
			"CREATE TABLE $decisions (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			settlement_id bigint(20) UNSIGNED NOT NULL,
			entry_id bigint(20) UNSIGNED NOT NULL,
			state varchar(20) NOT NULL,
			material_hash char(64) NOT NULL,
			history_id bigint(20) UNSIGNED DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY settlement_id (settlement_id),
			UNIQUE KEY entry_id (entry_id)
		) $collate;"
		);
		dbDelta(
			"CREATE TABLE $history (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			decision_id bigint(20) UNSIGNED NOT NULL,
			settlement_id bigint(20) UNSIGNED NOT NULL,
			request_hash char(64) NOT NULL,
			state varchar(20) NOT NULL,
			actor_id bigint(20) UNSIGNED NOT NULL,
			confirmed_at datetime NOT NULL,
			reviewed longtext NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY request_hash (request_hash),
			KEY decision_id (decision_id),
			KEY settlement_id (settlement_id)
		) $collate;"
		);
		dbDelta(
			"CREATE TABLE $evidence (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			history_id bigint(20) UNSIGNED NOT NULL,
			revision_id bigint(20) UNSIGNED NOT NULL,
			movement_key varchar(191) NOT NULL,
			transaction_id bigint(20) UNSIGNED DEFAULT NULL,
			evidence longtext NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY movement (history_id,revision_id,movement_key),
			KEY transaction_id (transaction_id)
		) $collate;"
		);
		dbDelta(
			"CREATE TABLE $context (
			entry_id bigint(20) UNSIGNED NOT NULL,
			account_id bigint(20) UNSIGNED NOT NULL,
			currency char(3) NOT NULL,
			actor_id bigint(20) UNSIGNED NOT NULL,
			confirmed_at datetime NOT NULL,
			PRIMARY KEY  (entry_id)
		) $collate;"
		);
	}
}
