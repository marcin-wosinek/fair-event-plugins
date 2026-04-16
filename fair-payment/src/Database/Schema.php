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
	 * Get the table name for entry-transaction junction table
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_entry_transactions_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_entry_transactions';
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
			event_date_id bigint(20) UNSIGNED DEFAULT NULL,
			user_id bigint(20) UNSIGNED DEFAULT NULL,
			participant_id bigint(20) UNSIGNED DEFAULT NULL,
			amount decimal(10,2) NOT NULL,
			currency varchar(3) NOT NULL DEFAULT 'EUR',
			application_fee decimal(10,2) DEFAULT NULL,
			mollie_fee decimal(10,2) DEFAULT NULL,
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
			KEY participant_id (participant_id),
			KEY post_id (post_id),
			KEY event_date_id (event_date_id)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Create line items table.
		self::create_line_items_table();

		// Create budgets table.
		self::create_budgets_table();

		// Create financial entries table.
		self::create_financial_entries_table();

		// Create entry-transaction junction table.
		self::create_entry_transactions_table();

		// Run migrations if needed.
		self::migrate_to_v2();
		self::migrate_to_v3();
		self::migrate_to_v4();
		self::migrate_to_v5();
		self::migrate_to_v6();
		self::migrate_to_v7();
		self::migrate_to_v8();
		self::migrate_to_v9();
		self::migrate_to_v10();
		self::migrate_to_v11();
		self::migrate_to_v12();
		self::migrate_to_v13();
		self::migrate_to_v14();
		self::migrate_to_v15();
		self::migrate_to_v16();

		// Store database version for future migrations.
		update_option( 'fair_payment_db_version', '16.0' );
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
			KEY event_date_id (event_date_id)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Create entry-transaction junction table for 1:many matching
	 *
	 * @return void
	 */
	public static function create_entry_transactions_table() {
		global $wpdb;

		$table_name      = self::get_entry_transactions_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			entry_id bigint(20) UNSIGNED NOT NULL,
			transaction_id bigint(20) UNSIGNED NOT NULL,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY entry_transaction (entry_id, transaction_id),
			KEY entry_id (entry_id),
			KEY transaction_id (transaction_id)
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
	 * Migrate database from v3.0 to v4.0
	 *
	 * Adds application_fee column to track application fees (2%) for each transaction.
	 *
	 * @return void
	 */
	public static function migrate_to_v4() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '4.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if application_fee column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'application_fee'
				)
			);

			// Add application_fee column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN application_fee decimal(10,2) DEFAULT NULL AFTER currency',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v4.0 to v5.0
	 *
	 * Renames platform_fee_amount column to application_fee for consistency with Mollie API.
	 *
	 * @return void
	 */
	public static function migrate_to_v5() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '5.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if old platform_fee_amount column exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$old_column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'platform_fee_amount'
				)
			);

			// Check if new application_fee column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$new_column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'application_fee'
				)
			);

			// Rename column if old exists and new doesn't.
			if ( ! empty( $old_column_exists ) && empty( $new_column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i CHANGE COLUMN platform_fee_amount application_fee decimal(10,2) DEFAULT NULL',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v5.0 to v6.0
	 *
	 * Adds budgets and financial_entries tables for cost & income tracking.
	 *
	 * @return void
	 */
	public static function migrate_to_v6() {
		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '6.0', '<' ) ) {
			// Tables are created via dbDelta in create_tables() method.
			// This migration just ensures they exist for existing installations.
			self::create_budgets_table();
			self::create_financial_entries_table();
		}
	}

	/**
	 * Migrate database from v6.0 to v7.0
	 *
	 * Adds external_reference column to financial_entries for import deduplication.
	 *
	 * @return void
	 */
	public static function migrate_to_v7() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '7.0', '<' ) ) {
			$table_name = self::get_financial_entries_table_name();

			// Check if external_reference column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'external_reference'
				)
			);

			// Add external_reference column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN external_reference varchar(255) DEFAULT NULL AFTER transaction_id',
						$table_name
					)
				);

				// Add unique index on external_reference.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD UNIQUE KEY external_reference (external_reference)',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v7.0 to v8.0
	 *
	 * Adds import_source and imported_at columns to financial_entries to track import origin.
	 *
	 * @return void
	 */
	public static function migrate_to_v8() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '8.0', '<' ) ) {
			$table_name = self::get_financial_entries_table_name();

			// Check if import_source column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'import_source'
				)
			);

			// Add import_source column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN import_source varchar(255) DEFAULT NULL AFTER external_reference',
						$table_name
					)
				);
			}

			// Check if imported_at column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$imported_at_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'imported_at'
				)
			);

			// Add imported_at column if it doesn't exist.
			if ( empty( $imported_at_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN imported_at datetime DEFAULT NULL AFTER import_source',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v8.0 to v9.0
	 *
	 * Adds parent_entry_id column to financial_entries for split entry support.
	 *
	 * @return void
	 */
	public static function migrate_to_v9() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '9.0', '<' ) ) {
			$table_name = self::get_financial_entries_table_name();

			// Check if parent_entry_id column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'parent_entry_id'
				)
			);

			// Add parent_entry_id column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN parent_entry_id bigint(20) UNSIGNED DEFAULT NULL AFTER import_source',
						$table_name
					)
				);

				// Add index on parent_entry_id.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD KEY parent_entry_id (parent_entry_id)',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v9.0 to v10.0
	 *
	 * Adds event_url column to financial_entries for linking entries to events.
	 *
	 * @return void
	 */
	public static function migrate_to_v10() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '10.0', '<' ) ) {
			$table_name = self::get_financial_entries_table_name();

			// Check if event_url column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'event_url'
				)
			);

			// Add event_url column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN event_url varchar(500) DEFAULT NULL AFTER parent_entry_id',
						$table_name
					)
				);

				// Add index on event_url.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD KEY event_url (event_url)',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v10.0 to v11.0
	 *
	 * Adds event_date_id column to financial_entries for linking entries to event dates by ID.
	 *
	 * @return void
	 */
	public static function migrate_to_v11() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '11.0', '<' ) ) {
			$table_name = self::get_financial_entries_table_name();

			// Check if event_date_id column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'event_date_id'
				)
			);

			// Add event_date_id column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN event_date_id bigint(20) UNSIGNED DEFAULT NULL AFTER event_url',
						$table_name
					)
				);

				// Add index on event_date_id.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD KEY event_date_id (event_date_id)',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v11.0 to v12.0
	 *
	 * Adds mollie_fee column to transactions to track Mollie processing fees.
	 *
	 * @return void
	 */
	public static function migrate_to_v12() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '12.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if mollie_fee column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'mollie_fee'
				)
			);

			// Add mollie_fee column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN mollie_fee decimal(10,2) DEFAULT NULL AFTER application_fee',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v12.0 to v13.0
	 *
	 * Adds event_date_id column to transactions for linking to event dates.
	 *
	 * @return void
	 */
	public static function migrate_to_v13() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '13.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if event_date_id column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'event_date_id'
				)
			);

			// Add event_date_id column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN event_date_id bigint(20) UNSIGNED DEFAULT NULL AFTER post_id',
						$table_name
					)
				);

				// Add index on event_date_id.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD KEY event_date_id (event_date_id)',
						$table_name
					)
				);
			}
		}
	}

	/**
	 * Migrate database from v13.0 to v14.0
	 *
	 * Creates entry-transaction junction table and migrates existing 1:1 matches.
	 *
	 * @return void
	 */
	public static function migrate_to_v14() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '14.0', '<' ) ) {
			// Ensure junction table exists.
			self::create_entry_transactions_table();

			$junction_table = self::get_entry_transactions_table_name();
			$entries_table  = self::get_financial_entries_table_name();

			// Migrate existing 1:1 matches into the junction table.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				$wpdb->prepare(
					'INSERT IGNORE INTO %i (entry_id, transaction_id) SELECT id, transaction_id FROM %i WHERE transaction_id IS NOT NULL',
					$junction_table,
					$entries_table
				)
			);
		}
	}

	/**
	 * Migrate database from v14.0 to v15.0
	 *
	 * Adds participant_id column to transactions to link transactions to fair-audience participants.
	 * The user_id column is kept as a fallback alternative.
	 *
	 * @return void
	 */
	public static function migrate_to_v15() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '15.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// Check if participant_id column already exists.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$column_exists = $wpdb->get_results(
				$wpdb->prepare(
					'SHOW COLUMNS FROM %i LIKE %s',
					$table_name,
					'participant_id'
				)
			);

			// Add participant_id column if it doesn't exist.
			if ( empty( $column_exists ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD COLUMN participant_id bigint(20) UNSIGNED DEFAULT NULL AFTER user_id',
						$table_name
					)
				);

				// Add index on participant_id.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
				$wpdb->query(
					$wpdb->prepare(
						'ALTER TABLE %i ADD KEY participant_id (participant_id)',
						$table_name
					)
				);
			}

			// Trigger backfill hook so fair-audience (or any listener) can populate participant_id
			// from existing user_id values. Listeners should be idempotent (only update rows where
			// participant_id IS NULL).
			do_action( 'fair_payment_backfill_participant_ids' );
		}
	}

	/**
	 * Migrate database from v15.0 to v16.0
	 *
	 * Backfills event_date_id column on transactions from metadata.event_date_id
	 * for rows created before event_date_id was persisted as a top-level column.
	 *
	 * @return void
	 */
	public static function migrate_to_v16() {
		global $wpdb;

		$current_version = get_option( 'fair_payment_db_version', '1.0' );

		if ( version_compare( $current_version, '16.0', '<' ) ) {
			$table_name = self::get_payments_table_name();

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT id, metadata FROM %i WHERE event_date_id IS NULL AND metadata IS NOT NULL AND metadata != ''",
					$table_name
				)
			);

			if ( ! empty( $rows ) ) {
				foreach ( $rows as $row ) {
					$metadata = json_decode( $row->metadata, true );
					if ( ! is_array( $metadata ) || empty( $metadata['event_date_id'] ) ) {
						continue;
					}

					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
					$wpdb->update(
						$table_name,
						array( 'event_date_id' => (int) $metadata['event_date_id'] ),
						array( 'id' => (int) $row->id ),
						array( '%d' ),
						array( '%d' )
					);
				}
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

		$line_items_table         = self::get_line_items_table_name();
		$transactions_table       = self::get_payments_table_name();
		$financial_entries_table  = self::get_financial_entries_table_name();
		$budgets_table            = self::get_budgets_table_name();
		$entry_transactions_table = self::get_entry_transactions_table_name();

		// Drop entry-transaction junction table first (references both entries and transactions).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $entry_transactions_table ) );

		// Drop financial entries (references transactions and budgets).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $financial_entries_table ) );

		// Drop budgets table.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $budgets_table ) );

		// Drop line items (foreign key reference to transactions).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $line_items_table ) );

		// Drop transactions table.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $transactions_table ) );

		delete_option( 'fair_payment_db_version' );
	}
}
