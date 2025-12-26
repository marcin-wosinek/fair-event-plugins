<?php
/**
 * Database schema for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Database;

defined( 'WPINC' ) || die;

/**
 * Schema class for managing database tables
 */
class Schema {
	/**
	 * Get the table name for payment transactions
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_payments_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_transactions';
	}

	/**
	 * Get the table name for line items
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_line_items_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_line_items';
	}

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	public static function create_tables() {
		global $wpdb;

		$table_name      = self::get_payments_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			mollie_payment_id varchar(50) NOT NULL,
			post_id bigint(20) UNSIGNED DEFAULT NULL,
			user_id bigint(20) UNSIGNED DEFAULT NULL,
			amount decimal(10,2) NOT NULL,
			currency varchar(3) NOT NULL DEFAULT 'EUR',
			status varchar(20) NOT NULL DEFAULT 'draft',
			payment_initiated_at datetime DEFAULT NULL,
			testmode tinyint(1) NOT NULL DEFAULT 1,
			description text DEFAULT NULL,
			redirect_url text DEFAULT NULL,
			webhook_url text DEFAULT NULL,
			checkout_url text DEFAULT NULL,
			metadata longtext DEFAULT NULL,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY mollie_payment_id (mollie_payment_id),
			KEY status (status),
			KEY user_id (user_id),
			KEY post_id (post_id)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Create line items table.
		self::create_line_items_table();

		// Run migrations if needed.
		self::migrate_to_v2();
		self::migrate_to_v3();

		// Store database version for future migrations.
		update_option( 'fair_payment_db_version', '3.0' );
	}

	/**
	 * Create line items table
	 *
	 * @return void
	 */
	public static function create_line_items_table() {
		global $wpdb;

		$table_name      = self::get_line_items_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			transaction_id bigint(20) UNSIGNED NOT NULL,
			name varchar(255) NOT NULL,
			description text DEFAULT NULL,
			quantity int(11) NOT NULL DEFAULT 1,
			unit_amount decimal(10,2) NOT NULL,
			total_amount decimal(10,2) NOT NULL,
			sort_order int(11) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY transaction_id (transaction_id),
			KEY sort_order (sort_order)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Migrate database from v1.0 to v2.0
	 *
	 * @return void
	 */
	public static function migrate_to_v2() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '2.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if payment_initiated_at column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'payment_initiated_at'
				)
			);

			// Add payment_initiated_at column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN payment_initiated_at datetime DEFAULT NULL AFTER status',
						$table_name
					)
				);
			}

			// Update existing transactions: if they have mollie_payment_id, set status to 'pending_payment'.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE %i
					SET status = 'pending_payment', payment_initiated_at = created_at
					WHERE mollie_payment_id != '' AND status = 'open'",
					$table_name
				)
			);
		}
	}

	/**
	 * Migrate database from v2.0 to v3.0
	 *
	 * Adds testmode column to store which mode (test/live) was used when creating the payment.
	 *
	 * @return void
	 */
	public static function migrate_to_v3() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '3.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if testmode column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'testmode'
				)
			);

			// Add testmode column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN testmode tinyint(1) NOT NULL DEFAULT 1 AFTER payment_initiated_at',
						$table_name
					)
				);

				// Set testmode based on current mode setting for existing transactions.
				$current_mode = get_option( 'fair_payment_mode', 'test' );
				$testmode     = ( 'live' === $current_mode ) ? 0 : 1;

				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->query(
					$wpdb->prepare(
						'UPDATE %i SET testmode = %d WHERE mollie_payment_id != %s',
						$table_name,
						$testmode,
						''
					)
				);
			}
		}
	}

	/**
	 * Drop database tables (used for uninstall)
	 *
	 * @return void
	 */
	public static function drop_tables() {
		global $wpdb;

		$line_items_table   = self::get_line_items_table_name();
		$transactions_table = self::get_payments_table_name();

		// Drop line items first (foreign key reference).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $line_items_table ) );

		// Drop transactions table.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $transactions_table ) );

		delete_option( 'fair_payment_db_version' );
	}
}
