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
	const DB_VERSION = '3.56.0';

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
			category_selection_saved BOOLEAN NOT NULL DEFAULT 0,
			all_day BOOLEAN NOT NULL DEFAULT 0,
			start_date DATE DEFAULT NULL,
			end_date DATE DEFAULT NULL,
			start_time TIME DEFAULT NULL,
			end_time TIME DEFAULT NULL,
			dates_override BOOLEAN NOT NULL DEFAULT 0,
			times_override BOOLEAN NOT NULL DEFAULT 0,
			occurrence_type VARCHAR(20) NOT NULL DEFAULT 'single',
			master_id BIGINT UNSIGNED DEFAULT NULL,
			rrule VARCHAR(255) DEFAULT NULL,
			venue_id BIGINT UNSIGNED DEFAULT NULL,
			title VARCHAR(255) DEFAULT NULL,
			external_url TEXT DEFAULT NULL,
			link_type VARCHAR(20) DEFAULT NULL,
			attendance_mode VARCHAR(20) DEFAULT NULL,
			joining_link VARCHAR(500) DEFAULT NULL,
			capacity INT UNSIGNED DEFAULT NULL,
			address TEXT DEFAULT NULL,
			recurrence_anchor DATE DEFAULT NULL,
			status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
			publication_status ENUM('publish','draft') NOT NULL DEFAULT 'publish',
			recurrence_mode ENUM('none','rule','manual') NOT NULL DEFAULT 'none',
			booking_message LONGTEXT DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_id (event_id),
			KEY idx_start_date (start_date),
			KEY idx_end_date (end_date),
			KEY idx_occurrence_type (occurrence_type),
			KEY idx_master_id (master_id),
			KEY idx_rrule (rrule(100)),
			KEY idx_link_type (link_type),
			KEY idx_recurrence_anchor (recurrence_anchor),
			KEY idx_venue_id (venue_id),
			KEY idx_status (status),
			KEY idx_publication_status (publication_status)
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
	 * Junction table for complete event date category selections.
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
			activities_enabled TINYINT(1) NOT NULL DEFAULT 1,
			minimum_activities INT UNSIGNED NOT NULL DEFAULT 0,
			maximum_activities INT UNSIGNED DEFAULT NULL,
			disable_at DATETIME DEFAULT NULL,
			recurrence_scope ENUM('single_instance','whole_series','multiple_instances') NOT NULL DEFAULT 'single_instance',
			minimum_instances INT UNSIGNED NOT NULL DEFAULT 0,
			disabled TINYINT(1) NOT NULL DEFAULT 0,
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
			sale_start DATETIME DEFAULT NULL,
			sale_end DATETIME DEFAULT NULL,
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
	 * Get the SQL for creating the fair_events_group_permission_rules table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_group_permission_rules_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_group_permission_rules';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL,
			permission_type VARCHAR(50) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_event_date_group_permission (event_date_id, group_id, permission_type),
			KEY idx_event_date_id (event_date_id),
			KEY idx_group_id (group_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_type_group_restrictions table
	 *
	 * Junction table linking ticket types to groups for availability restrictions.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_type_group_restrictions_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_type_group_restrictions';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			ticket_type_id BIGINT UNSIGNED NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL,
			PRIMARY KEY (ticket_type_id, group_id),
			KEY idx_group_id (group_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_event_date_settings table
	 *
	 * Stores per-event-date settings as key/value pairs.
	 * Only non-default values are stored.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_event_date_settings_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_event_date_settings';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			setting_key VARCHAR(100) NOT NULL,
			setting_value VARCHAR(255) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_event_date_key (event_date_id, setting_key),
			KEY idx_event_date_id (event_date_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_options table
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_options_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_options';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			name VARCHAR(255) NOT NULL,
			short_name VARCHAR(255) DEFAULT NULL,
			price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			discounted_price DECIMAL(10,2) DEFAULT NULL,
			capacity INT UNSIGNED DEFAULT NULL,
			derive_price_from_sale_period TINYINT(1) NOT NULL DEFAULT 0,
			sort_order INT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_date_id (event_date_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_option_prices table
	 *
	 * Per-(option, sale_period) price store for activity options whose
	 * `derive_price_from_sale_period` flag is on. Mirrors how `TicketPrice`
	 * keys ticket-type prices to sale periods.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_option_prices_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_option_prices';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			ticket_option_id BIGINT UNSIGNED NOT NULL,
			sale_period_id BIGINT UNSIGNED NOT NULL,
			price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (ticket_option_id, sale_period_id),
			KEY idx_sale_period_id (sale_period_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_signups table
	 *
	 * The transaction_id column is the latest payment attempt only, used by the retry,
	 * cancel and session flows; the payment history lives in
	 * fair_events_signup_payment_links. legacy_event_participant_id is the
	 * purchase's provenance: the Fair Audience relationship a historical
	 * backfill created it from (PAYMENT_HISTORY_MIGRATION.md §4.2). It is
	 * null for ordinary purchases, and unique, so one relationship never
	 * yields two purchases. It is a plain integer, not a foreign key, and
	 * outlives Fair Audience being deactivated. surname is optional and
	 * separate from name (#2215); signups made before it existed keep their
	 * whole name in name, with an empty surname.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_signups_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_signups';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			ticket_type_id BIGINT UNSIGNED DEFAULT NULL,
			name VARCHAR(255) NOT NULL,
			surname VARCHAR(255) NOT NULL DEFAULT '',
			email VARCHAR(255) NOT NULL,
			quantity INT UNSIGNED NOT NULL DEFAULT 1,
			mailing_opt_in TINYINT(1) NOT NULL DEFAULT 0,
			amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
			transaction_id BIGINT UNSIGNED DEFAULT NULL,
			payment_expires_at DATETIME DEFAULT NULL,
			participant_id BIGINT UNSIGNED DEFAULT NULL,
			over_capacity TINYINT(1) NOT NULL DEFAULT 0,
			legacy_event_participant_id BIGINT UNSIGNED DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_event_date_id (event_date_id),
			KEY idx_email (email(100)),
			KEY idx_transaction_id (transaction_id),
			KEY idx_payment_expires_at (payment_expires_at),
			KEY idx_participant_id (participant_id),
			UNIQUE KEY idx_legacy_event_participant_id (legacy_event_participant_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_signup_payment_links table
	 *
	 * One row per (purchase, Connector transaction, role): the Events-owned
	 * payment history of a purchase (PAYMENT_HISTORY_MIGRATION.md §5.1).
	 * The transaction_id is not a foreign key; Connector may be inactive and the
	 * transaction may have been deleted, and the link stays either way.
	 * allocated_amount is this purchase's part of the transaction total in
	 * currency, the transaction's currency when the link was written; the
	 * total and the transaction status are always read from Connector.
	 * attribution says who wrote the link (live, backfill or reconciled) and
	 * evidence (JSON) what established it. created_at is when the attempt
	 * was created, copied from the transaction; recorded_at is when the link
	 * was written. The unique key also serves purchase lookups.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_signup_payment_links_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_signup_payment_links';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			signup_id BIGINT UNSIGNED NOT NULL,
			transaction_id BIGINT UNSIGNED NOT NULL,
			role VARCHAR(30) NOT NULL,
			allocated_amount DECIMAL(10,2) NOT NULL,
			currency CHAR(3) NOT NULL,
			attribution VARCHAR(20) NOT NULL,
			evidence TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_signup_transaction_role (signup_id, transaction_id, role),
			KEY idx_transaction_id (transaction_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_payment_shadow_work table
	 *
	 * Shadow writes still owed by the payment history migration's live
	 * writers (PAYMENT_HISTORY_MIGRATION.md §8.8): a Connector transaction
	 * whose payment links aren't written yet, or a Fair Audience relationship
	 * whose shadow purchase isn't in step yet. One row per (kind, source_id);
	 * it is removed once the work succeeds. status is `pending` until the
	 * first attempt, `failed` when an attempt errored, and `unresolved` when
	 * the evidence named no purchase; reason holds the error code or the
	 * unresolved reason, detail its JSON context. Outstanding rows block the
	 * migration's verification.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_payment_shadow_work_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_payment_shadow_work';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			kind VARCHAR(20) NOT NULL,
			source_id BIGINT UNSIGNED NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			reason VARCHAR(64) DEFAULT NULL,
			detail TEXT DEFAULT NULL,
			attempts INT UNSIGNED NOT NULL DEFAULT 0,
			next_attempt_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_kind_source (kind, source_id),
			KEY idx_status_next_attempt (status, next_attempt_at)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_payment_history_findings table
	 *
	 * What the payment history backfill reported about a source record
	 * (PAYMENT_HISTORY_MIGRATION.md §6.2, §8.9): one row per (mode, reason,
	 * source_type, source_id), so a re-run updates the row instead of
	 * adding another. mode is `dry_run` or `backfill`; a new dry run
	 * replaces the previous dry run's rows. source_type names what
	 * source_id identifies: a Connector `transaction`, an Audience
	 * `relationship` or `ledger_row`, or an Events `signup`. event_date_id
	 * is the date the record concerns, when one is known, for filtering.
	 * status is `open`, `resolved` once a later pass attributed the record,
	 * or an administrator's decision: `reconciled` (linked by hand) or
	 * `reviewed` (kept without a link). A re-run never reopens a decided
	 * finding. detail holds the JSON context. Source rows are never changed.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_payment_history_findings_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_payment_history_findings';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			mode VARCHAR(20) NOT NULL,
			reason VARCHAR(64) NOT NULL,
			source_type VARCHAR(20) NOT NULL,
			source_id BIGINT UNSIGNED NOT NULL,
			event_date_id BIGINT UNSIGNED DEFAULT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'open',
			detail TEXT DEFAULT NULL,
			first_seen_at DATETIME NOT NULL,
			last_seen_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY idx_mode_reason_source (mode, reason, source_type, source_id),
			KEY idx_mode_status_reason (mode, status, reason),
			KEY idx_event_date_id (event_date_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_payment_history_comparisons table
	 *
	 * The payment history verification report (PAYMENT_HISTORY_MIGRATION.md
	 * §8.4, §8.9): one row per event date, comparing what the source
	 * history (relationships, Audience ledger) and the Events-owned history
	 * (units, payment links) say about it. admissions and activities hold
	 * the source and target counts and the explained difference, revenue the
	 * same per currency with each transaction's difference and cause, as
	 * JSON. revenue_state is `available` or `incomplete` (§7.1). blocking
	 * is 1 when a difference has no cause the contract allows.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_payment_history_comparisons_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_payment_history_comparisons';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			admissions TEXT NOT NULL,
			activities TEXT NOT NULL,
			revenue TEXT NOT NULL,
			revenue_state VARCHAR(20) NOT NULL,
			blocking TINYINT(1) NOT NULL DEFAULT 0,
			checked_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY idx_event_date_id (event_date_id),
			KEY idx_blocking (blocking)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_payment_history_audit table
	 *
	 * Append-only record of every payment history reconciliation
	 * (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.10): one row per administrator
	 * action (`link`, `unlink` or `review`), with the finding and reason it
	 * resolves, the transaction it touched, the acting user, the note they
	 * entered, and the finding and link state before and after as JSON.
	 * created_at is UTC. Rows are never updated or deleted.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_payment_history_audit_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_payment_history_audit';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			action VARCHAR(20) NOT NULL,
			finding_id BIGINT UNSIGNED DEFAULT NULL,
			reason VARCHAR(64) DEFAULT NULL,
			transaction_id BIGINT UNSIGNED DEFAULT NULL,
			user_id BIGINT UNSIGNED NOT NULL,
			note TEXT NOT NULL,
			before_state LONGTEXT NOT NULL,
			after_state LONGTEXT NOT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			KEY idx_finding_id (finding_id),
			KEY idx_transaction_id (transaction_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_tickets table
	 *
	 * One row per individual admission. A signup with quantity 3 owns three
	 * rows, positioned 1 through 3; the (signup_id, unit_position) key makes
	 * unit creation safe to retry. The signup remains the purchase and
	 * payment record; the purchaser stays tied to that purchase while the
	 * holder can later change on transfer. attended_at is the unit's own
	 * check-in time, independent of its siblings. event_date_id is the
	 * unit's own date: it follows the signup until the unit is moved on its
	 * own. deleted_at marks a cancelled unit an administrator removed from
	 * view; the row stays, so its position is never filled again and the
	 * purchase keeps its history.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_tickets_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_tickets';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			reference CHAR(32) NOT NULL,
			signup_id BIGINT UNSIGNED NOT NULL,
			unit_position INT UNSIGNED NOT NULL,
			event_date_id BIGINT UNSIGNED NOT NULL,
			ticket_type_id BIGINT UNSIGNED DEFAULT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
			purchaser_participant_id BIGINT UNSIGNED DEFAULT NULL,
			holder_participant_id BIGINT UNSIGNED DEFAULT NULL,
			attended_at DATETIME DEFAULT NULL,
			deleted_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_reference (reference),
			UNIQUE KEY idx_signup_unit (signup_id, unit_position),
			KEY idx_event_date_id (event_date_id),
			KEY idx_purchaser_participant_id (purchaser_participant_id),
			KEY idx_holder_participant_id (holder_participant_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_activities table
	 *
	 * One row per activity (ticket option) selected for an individual
	 * ticket. The option name is snapshotted so the selection stays readable
	 * after the option is renamed or deleted. A pending_payment row holds its
	 * place until expires_at while an add-on payment is in flight; the
	 * ticket's own status decides whether a selection made at purchase
	 * counts. over_capacity flags a selection that went past the activity's
	 * limit through an administrator's override or a late payment.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_activities_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_activities';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			ticket_id BIGINT UNSIGNED NOT NULL,
			ticket_option_id BIGINT UNSIGNED NOT NULL,
			ticket_option_name VARCHAR(255) NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
			expires_at DATETIME DEFAULT NULL,
			over_capacity TINYINT(1) NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_ticket_option (ticket_id, ticket_option_id),
			KEY idx_ticket_option_id (ticket_option_id),
			KEY idx_status_expires (status, expires_at)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_ticket_transfers table
	 *
	 * One row per administrator change of a ticket's holder (#2133): the
	 * ticket, the holder before and after, the acting WordPress user and the
	 * UTC time. Holders are participant IDs only, never name or email
	 * snapshots, so profile changes and anonymization apply to the history
	 * too; anonymizing a participant clears their IDs here. The purchaser,
	 * which a transfer never changes, stays on the ticket. Rows go with
	 * their ticket when it is physically deleted.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_ticket_transfers_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_ticket_transfers';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			ticket_id BIGINT UNSIGNED NOT NULL,
			from_participant_id BIGINT UNSIGNED DEFAULT NULL,
			to_participant_id BIGINT UNSIGNED DEFAULT NULL,
			user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			KEY idx_ticket_id (ticket_id),
			KEY idx_from_participant_id (from_participant_id),
			KEY idx_to_participant_id (to_participant_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_capacity_overrides table
	 *
	 * One row per administrator edit that took a signup past an event-date,
	 * ticket-type or activity limit, with the reason given. An activity
	 * override also names the ticket and the activity. Rows go when their
	 * signup is deleted.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_capacity_overrides_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_capacity_overrides';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			signup_id BIGINT UNSIGNED NOT NULL,
			action VARCHAR(20) NOT NULL,
			from_event_date_id BIGINT UNSIGNED DEFAULT NULL,
			to_event_date_id BIGINT UNSIGNED DEFAULT NULL,
			from_ticket_type_id BIGINT UNSIGNED DEFAULT NULL,
			to_ticket_type_id BIGINT UNSIGNED DEFAULT NULL,
			ticket_id BIGINT UNSIGNED DEFAULT NULL,
			ticket_option_id BIGINT UNSIGNED DEFAULT NULL,
			ticket_option_name VARCHAR(255) NOT NULL DEFAULT '',
			ticket_count INT UNSIGNED NOT NULL DEFAULT 0,
			taken INT UNSIGNED NOT NULL DEFAULT 0,
			capacity INT UNSIGNED NOT NULL DEFAULT 0,
			reason TEXT NOT NULL,
			user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_signup_id (signup_id)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_checkout_keys table
	 *
	 * One row per get-tickets checkout submitted with an idempotency key. The
	 * unique key hash makes a retried request resolve to the purchase it
	 * already created: signup_ids lists that purchase's signup rows
	 * (comma-separated), fingerprint identifies the purchase details the key
	 * was first used with, and context keeps what is needed to finish an
	 * interrupted checkout at the prices it was created with. An 'open' row
	 * is still being finished by the request holding its claim; a
	 * 'completed' row only reports its purchase's current state.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_checkout_keys_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_checkout_keys';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			key_hash CHAR(64) NOT NULL,
			fingerprint CHAR(64) NOT NULL,
			state VARCHAR(20) NOT NULL DEFAULT 'open',
			signup_ids TEXT NOT NULL,
			context LONGTEXT DEFAULT NULL,
			hooks_fired TINYINT(1) NOT NULL DEFAULT 0,
			claim_token CHAR(32) DEFAULT NULL,
			claim_expires_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_key_hash (key_hash),
			KEY idx_created_at (created_at)
		) ENGINE=InnoDB {$charset_collate};";
	}

	/**
	 * Get the SQL for creating the fair_events_schedule_items table
	 *
	 * One row per entry of an event's program. A row with a ticket_option_id
	 * is a workshop: its name, price and capacity stay on the ticket option,
	 * and bookable says whether that option can still be chosen with a
	 * ticket. A row without one is a program item of its own (a break, a
	 * talk) that is never a ticket choice. Datetimes are naive site-local
	 * strings, stored for the event date the row belongs to; a series keeps
	 * its rows on the master.
	 *
	 * @return string SQL statement for creating the table.
	 */
	public static function get_schedule_items_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_events_schedule_items';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_date_id BIGINT UNSIGNED NOT NULL,
			ticket_option_id BIGINT UNSIGNED DEFAULT NULL,
			bookable TINYINT(1) NOT NULL DEFAULT 0,
			title VARCHAR(255) NOT NULL DEFAULT '',
			start_datetime DATETIME NOT NULL,
			end_datetime DATETIME NOT NULL,
			description TEXT,
			location VARCHAR(255) NOT NULL DEFAULT '',
			sort_order INT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY idx_ticket_option_id (ticket_option_id),
			KEY idx_event_date_id (event_date_id)
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
	 * Whether a database version has ever been recorded
	 *
	 * @return bool True when the version option exists.
	 */
	public static function has_db_version() {
		return false !== get_option( 'fair_events_db_version', false );
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
