<?php
/**
 * Plugin Name: Fair Audience
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Manage event participants with custom profiles and many-to-many event relationships
 * Version: 1.9.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPL-3.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-audience
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairAudience
 */

namespace FairAudience;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_AUDIENCE_VERSION', '1.9.0' );
define( 'FAIR_AUDIENCE_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_AUDIENCE_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairAudience\Core\Plugin;
Plugin::instance()->init();

/**
 * Activation hook.
 */
function fair_audience_activate() {
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( \FairAudience\Database\Schema::get_participants_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_event_participants_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_polls_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_poll_options_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_poll_access_keys_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_poll_responses_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_import_resolutions_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_photo_participants_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_gallery_access_keys_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_email_confirmation_tokens_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_groups_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_group_participants_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_instagram_posts_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_extra_messages_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_custom_mail_messages_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_fees_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_fee_payments_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_fee_audit_log_table_sql() );

	// Flush rewrite rules for poll_key, gallery_key, and confirm_email_key query vars.
	flush_rewrite_rules();

	dbDelta( \FairAudience\Database\Schema::get_fee_payment_transactions_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_participant_categories_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_event_participant_options_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_email_consent_log_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_event_scheduled_messages_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_event_participant_transactions_table_sql() );

	// Update database version.
	update_option( 'fair_audience_db_version', '1.40.0' );

	// Link any existing fair_events_signups rows to participants by email —
	// the fair-events migration that adds participant_id may already have
	// run while fair-audience was inactive.
	\FairAudience\Hooks\SignupHookBridge::backfill_signup_participant_ids();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_activate' );

/**
 * Check and upgrade database if needed.
 */
function fair_audience_maybe_upgrade_db() {
	$db_version = get_option( 'fair_audience_db_version', '0' );

	if ( version_compare( $db_version, '1.0.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_participants_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_event_participants_table_sql() );
		update_option( 'fair_audience_db_version', '1.0.0' );
	}

	if ( version_compare( $db_version, '1.1.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_polls_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_poll_options_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_poll_access_keys_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_poll_responses_table_sql() );
		flush_rewrite_rules();
		update_option( 'fair_audience_db_version', '1.1.0' );
	}

	if ( version_compare( $db_version, '1.2.0', '<' ) ) {
		global $wpdb;
		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		// Add 'collaborator' to label ENUM.
		$wpdb->query(
			"ALTER TABLE {$table_name}
			 MODIFY label ENUM('interested', 'signed_up', 'collaborator')
			 NOT NULL DEFAULT 'interested'"
		);

		update_option( 'fair_audience_db_version', '1.2.0' );
	}

	if ( version_compare( $db_version, '1.3.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_import_resolutions_table_sql() );

		update_option( 'fair_audience_db_version', '1.3.0' );
	}

	if ( version_compare( $db_version, '1.4.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_photo_participants_table_sql() );

		update_option( 'fair_audience_db_version', '1.4.0' );
	}

	if ( version_compare( $db_version, '1.5.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_gallery_access_keys_table_sql() );

		// Flush rewrite rules for gallery_key query var.
		flush_rewrite_rules();

		update_option( 'fair_audience_db_version', '1.5.0' );
	}

	if ( version_compare( $db_version, '1.6.0', '<' ) ) {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		// Add status column to participants table.
		$participants_table = $wpdb->prefix . 'fair_audience_participants';
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 ADD COLUMN IF NOT EXISTS status ENUM('pending', 'confirmed')
			 NOT NULL DEFAULT 'confirmed' AFTER email_profile"
		);

		// Create email confirmation tokens table.
		dbDelta( \FairAudience\Database\Schema::get_email_confirmation_tokens_table_sql() );

		// Flush rewrite rules for confirm_email_key query var.
		flush_rewrite_rules();

		update_option( 'fair_audience_db_version', '1.6.0' );
	}

	if ( version_compare( $db_version, '1.7.0', '<' ) ) {
		global $wpdb;

		// Add wp_user_id column to participants table.
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 ADD COLUMN IF NOT EXISTS wp_user_id BIGINT UNSIGNED DEFAULT NULL AFTER status"
		);

		// Add unique index on wp_user_id.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 ADD UNIQUE INDEX IF NOT EXISTS idx_wp_user_id (wp_user_id)"
		);

		update_option( 'fair_audience_db_version', '1.7.0' );
	}

	if ( version_compare( $db_version, '1.8.0', '<' ) ) {
		global $wpdb;

		// Make surname column optional (allow empty string as default).
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 MODIFY COLUMN surname VARCHAR(255) DEFAULT ''"
		);

		update_option( 'fair_audience_db_version', '1.8.0' );
	}

	if ( version_compare( $db_version, '1.9.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_groups_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_group_participants_table_sql() );

		update_option( 'fair_audience_db_version', '1.9.0' );
	}

	if ( version_compare( $db_version, '1.10.0', '<' ) ) {
		update_option( 'fair_audience_db_version', '1.10.0' );
	}

	if ( version_compare( $db_version, '1.11.0', '<' ) ) {
		global $wpdb;
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// Step 1: Modify ENUM to include new value.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 MODIFY COLUMN email_profile ENUM('minimal', 'in_the_loop', 'marketing') NOT NULL DEFAULT 'minimal'"
		);

		// Step 2: Update existing rows.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			"UPDATE {$participants_table}
			 SET email_profile = 'marketing'
			 WHERE email_profile = 'in_the_loop'"
		);

		// Step 3: Remove old ENUM value.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 MODIFY COLUMN email_profile ENUM('minimal', 'marketing') NOT NULL DEFAULT 'minimal'"
		);

		update_option( 'fair_audience_db_version', '1.11.0' );
	}

	if ( version_compare( $db_version, '1.12.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_instagram_posts_table_sql() );

		update_option( 'fair_audience_db_version', '1.12.0' );
	}

	if ( version_compare( $db_version, '1.13.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_extra_messages_table_sql() );

		update_option( 'fair_audience_db_version', '1.13.0' );
	}

	if ( version_compare( $db_version, '1.14.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_instagram_posts_table_sql() );

		update_option( 'fair_audience_db_version', '1.14.0' );
	}

	if ( version_compare( $db_version, '1.15.0', '<' ) ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_extra_messages';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$table_name}
			 ADD COLUMN IF NOT EXISTS category_id BIGINT UNSIGNED DEFAULT NULL AFTER is_active"
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$table_name}
			 ADD INDEX IF NOT EXISTS idx_category_id (category_id)"
		);

		update_option( 'fair_audience_db_version', '1.15.0' );
	}

	if ( version_compare( $db_version, '1.16.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_custom_mail_messages_table_sql() );

		update_option( 'fair_audience_db_version', '1.16.0' );
	}

	if ( version_compare( $db_version, '1.17.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_fees_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_fee_payments_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_fee_audit_log_table_sql() );

		update_option( 'fair_audience_db_version', '1.17.0' );
	}

	if ( version_compare( $db_version, '1.18.0', '<' ) ) {
		global $wpdb;

		$fees_table = $wpdb->prefix . 'fair_audience_fees';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$fees_table}
			 ADD COLUMN IF NOT EXISTS budget_id BIGINT UNSIGNED DEFAULT NULL AFTER currency"
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$fees_table}
			 ADD INDEX IF NOT EXISTS idx_budget_id (budget_id)"
		);

		update_option( 'fair_audience_db_version', '1.18.0' );
	}

	if ( version_compare( $db_version, '1.19.0', '<' ) ) {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		// Create fee payment transactions junction table.
		dbDelta( \FairAudience\Database\Schema::get_fee_payment_transactions_table_sql() );

		// Add 'payment_failed' to audit log action ENUM.
		$audit_log_table = $wpdb->prefix . 'fair_audience_fee_audit_log';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$audit_log_table}
			 MODIFY action ENUM('amount_adjusted', 'marked_paid', 'marked_canceled', 'reminder_sent', 'payment_failed') NOT NULL"
		);

		update_option( 'fair_audience_db_version', '1.19.0' );
	}

	if ( version_compare( $db_version, '1.20.0', '<' ) ) {
		global $wpdb;

		$tables = array(
			$wpdb->prefix . 'fair_audience_event_participants',
			$wpdb->prefix . 'fair_audience_polls',
			$wpdb->prefix . 'fair_audience_gallery_access_keys',
		);

		foreach ( $tables as $table_name ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table_name}
				 ADD COLUMN IF NOT EXISTS event_date_id BIGINT UNSIGNED DEFAULT NULL AFTER event_id"
			);

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table_name}
				 ADD INDEX IF NOT EXISTS idx_event_date_id (event_date_id)"
			);
		}

		// Backfill event_date_id from fair_event_dates where event_id matches.
		$event_dates_table = $wpdb->prefix . 'fair_event_dates';
		foreach ( $tables as $table_name ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				"UPDATE {$table_name} t
				 JOIN {$event_dates_table} ed ON ed.event_id = t.event_id
				 SET t.event_date_id = ed.id
				 WHERE t.event_date_id IS NULL"
			);
		}

		update_option( 'fair_audience_db_version', '1.20.0' );
	}

	if ( version_compare( $db_version, '1.21.0', '<' ) ) {
		// Questionnaire tables now created by fair-form plugin activation.
		// dbDelta is idempotent so existing installs are unaffected if fair-form
		// has already created the tables.
		update_option( 'fair_audience_db_version', '1.21.0' );
	}

	if ( version_compare( $db_version, '1.22.0', '<' ) ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_photo_participants';

		// Drop old unique key that only allows one tagged person per photo.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$table_name} DROP INDEX IF EXISTS idx_attachment_author" );

		// Add new unique key that prevents duplicate tags but allows multiple tagged people.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$table_name} ADD UNIQUE INDEX idx_attachment_participant (attachment_id, participant_id)" );

		update_option( 'fair_audience_db_version', '1.22.0' );
	}

	if ( version_compare( $db_version, '1.23.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_participant_categories_table_sql() );

		update_option( 'fair_audience_db_version', '1.23.0' );
	}

	if ( version_compare( $db_version, '1.24.0', '<' ) ) {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		// Backfill event_date_id for event_participants where it is NULL.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			"UPDATE {$wpdb->prefix}fair_audience_event_participants ep
			SET ep.event_date_id = (
				SELECT ed.id FROM {$wpdb->prefix}fair_event_dates ed
				WHERE ed.event_id = ep.event_id LIMIT 1
			)
			WHERE ep.event_date_id IS NULL OR ep.event_date_id = 0"
		);

		// Backfill event_date_id for gallery_access_keys where it is NULL.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			"UPDATE {$wpdb->prefix}fair_audience_gallery_access_keys gak
			SET gak.event_date_id = (
				SELECT ed.id FROM {$wpdb->prefix}fair_event_dates ed
				WHERE ed.event_id = gak.event_id LIMIT 1
			)
			WHERE gak.event_date_id IS NULL OR gak.event_date_id = 0"
		);

		// Backfill event_date_id for polls where it is NULL.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			"UPDATE {$wpdb->prefix}fair_audience_polls p
			SET p.event_date_id = (
				SELECT ed.id FROM {$wpdb->prefix}fair_event_dates ed
				WHERE ed.event_id = p.event_id LIMIT 1
			)
			WHERE p.event_date_id IS NULL OR p.event_date_id = 0"
		);

		// Drop old unique keys and add new ones for event_participants.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$wpdb->prefix}fair_audience_event_participants DROP INDEX IF EXISTS idx_event_participant" );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$wpdb->prefix}fair_audience_event_participants ADD UNIQUE INDEX idx_event_date_participant (event_date_id, participant_id)" );

		// Drop old unique key and add new one for gallery_access_keys.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$wpdb->prefix}fair_audience_gallery_access_keys DROP INDEX IF EXISTS idx_event_participant" );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query( "ALTER TABLE {$wpdb->prefix}fair_audience_gallery_access_keys ADD UNIQUE INDEX idx_event_date_participant (event_date_id, participant_id)" );

		// Re-run dbDelta to update column definitions (NOT NULL).
		dbDelta( \FairAudience\Database\Schema::get_event_participants_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_gallery_access_keys_table_sql() );
		dbDelta( \FairAudience\Database\Schema::get_polls_table_sql() );

		update_option( 'fair_audience_db_version', '1.24.0' );
	}

	if ( version_compare( $db_version, '1.25.0', '<' ) ) {
		global $wpdb;

		// Add 'multiselect' to the question_type ENUM.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$wpdb->prefix}fair_audience_questionnaire_answers
			MODIFY question_type ENUM('radio','checkbox','short_text','long_text','select','number','date','multiselect') NOT NULL DEFAULT 'short_text'"
		);

		update_option( 'fair_audience_db_version', '1.25.0' );
	}

	if ( version_compare( $db_version, '1.26.0', '<' ) ) {
		global $wpdb;

		// Add 'file_upload' to the question_type ENUM.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$wpdb->prefix}fair_audience_questionnaire_answers
			MODIFY question_type ENUM('radio','checkbox','short_text','long_text','select','number','date','multiselect','file_upload') NOT NULL DEFAULT 'short_text'"
		);

		update_option( 'fair_audience_db_version', '1.26.0' );
	}

	if ( version_compare( $db_version, '1.27.0', '<' ) ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_event_participants';

		// Add 'pending_payment' to label ENUM.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$table}
			MODIFY label ENUM('interested', 'signed_up', 'collaborator', 'pending_payment') NOT NULL DEFAULT 'interested'"
		);

		// Add payment_expires_at column if missing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$has_expires = $wpdb->get_results(
			$wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'payment_expires_at' )
		);
		if ( empty( $has_expires ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table} ADD COLUMN payment_expires_at DATETIME DEFAULT NULL AFTER label,
				ADD KEY idx_payment_expires_at (payment_expires_at)"
			);
		}

		// Add transaction_id column if missing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$has_tx = $wpdb->get_results(
			$wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'transaction_id' )
		);
		if ( empty( $has_tx ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table} ADD COLUMN transaction_id BIGINT UNSIGNED DEFAULT NULL AFTER payment_expires_at,
				ADD KEY idx_transaction_id (transaction_id)"
			);
		}

		update_option( 'fair_audience_db_version', '1.27.0' );
	}

	if ( version_compare( $db_version, '1.28.0', '<' ) ) {
		global $wpdb;
		$table = $wpdb->prefix . 'fair_audience_event_participants';

		// Add ticket_type_id column if missing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$has_ticket_type = $wpdb->get_results(
			$wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'ticket_type_id' )
		);
		if ( empty( $has_ticket_type ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table} ADD COLUMN ticket_type_id BIGINT UNSIGNED DEFAULT NULL AFTER transaction_id,
				ADD KEY idx_ticket_type_id (ticket_type_id)"
			);
		}

		// Add seats column if missing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$has_seats = $wpdb->get_results(
			$wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'seats' )
		);
		if ( empty( $has_seats ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table} ADD COLUMN seats INT UNSIGNED NOT NULL DEFAULT 1 AFTER ticket_type_id"
			);
		}

		update_option( 'fair_audience_db_version', '1.28.0' );
	}

	if ( version_compare( $db_version, '1.29.0', '<' ) ) {
		global $wpdb;
		$table = $wpdb->prefix . 'fair_audience_event_participants';

		// Add attended_at column if missing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$has_attended_at = $wpdb->get_results(
			$wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'attended_at' )
		);
		if ( empty( $has_attended_at ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				"ALTER TABLE {$table} ADD COLUMN attended_at DATETIME DEFAULT NULL AFTER seats"
			);
		}

		update_option( 'fair_audience_db_version', '1.29.0' );
	}

	if ( version_compare( $db_version, '1.30.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_event_participant_options_table_sql() );
		update_option( 'fair_audience_db_version', '1.30.0' );
	}

	if ( version_compare( $db_version, '1.31.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_participants_table_sql() );
		update_option( 'fair_audience_db_version', '1.31.0' );
	}

	if ( version_compare( $db_version, '1.32.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_event_participant_options_table_sql() );

		// Backfill ticket_option_name from the ticket_options table where the FK still exists.
		$wpdb->query(
			"UPDATE {$wpdb->prefix}fair_audience_event_participant_options epo
			INNER JOIN {$wpdb->prefix}fair_events_ticket_options topt ON epo.ticket_option_id = topt.id
			SET epo.ticket_option_name = topt.name
			WHERE epo.ticket_option_name = ''"
		);

		update_option( 'fair_audience_db_version', '1.32.0' );
	}

	if ( version_compare( $db_version, '1.33.0', '<' ) ) {
		global $wpdb;

		$ep_table = $wpdb->prefix . 'fair_audience_event_participants';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$column_exists = $wpdb->get_results(
			$wpdb->prepare(
				"SHOW COLUMNS FROM %i LIKE 'admin_comment'",
				$ep_table
			)
		);

		if ( empty( $column_exists ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query(
				$wpdb->prepare(
					'ALTER TABLE %i ADD COLUMN admin_comment TEXT DEFAULT NULL AFTER attended_at',
					$ep_table
				)
			);
		}

		update_option( 'fair_audience_db_version', '1.33.0' );
	}

	if ( version_compare( $db_version, '1.34.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_email_consent_log_table_sql() );
		update_option( 'fair_audience_db_version', '1.34.0' );
	}

	if ( version_compare( $db_version, '1.35.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( \FairAudience\Database\Schema::get_event_scheduled_messages_table_sql() );
		update_option( 'fair_audience_db_version', '1.35.0' );
	}

	if ( version_compare( $db_version, '1.36.0', '<' ) ) {
		global $wpdb;
		$table_name = $wpdb->prefix . 'fair_audience_event_scheduled_messages';

		// Re-scope scheduled mailings from the event (post) to the event date.
		// MySQL 8 (unlike MariaDB) has no IF [NOT] EXISTS for columns/indexes,
		// so each schema change is guarded with an information_schema check.

		// Backfill event_date_id from the anchor where missing; anchor_ref_id has
		// always held the event-date id, so it is a safe source for legacy rows.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			"UPDATE {$table_name}
			 SET event_date_id = anchor_ref_id
			 WHERE event_date_id IS NULL AND anchor_ref_id IS NOT NULL"
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$table_name}
			 MODIFY COLUMN event_date_id BIGINT UNSIGNED NOT NULL COMMENT 'Event date the mailing is scoped to'"
		);

		$has_event_id_index = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM information_schema.STATISTICS
				 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s',
				$table_name,
				'idx_event_id'
			)
		);
		if ( $has_event_id_index ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query( "ALTER TABLE {$table_name} DROP INDEX idx_event_id" );
		}

		$has_event_id_column = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM information_schema.COLUMNS
				 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s',
				$table_name,
				'event_id'
			)
		);
		if ( $has_event_id_column ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query( "ALTER TABLE {$table_name} DROP COLUMN event_id" );
		}

		$has_event_date_index = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM information_schema.STATISTICS
				 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s',
				$table_name,
				'idx_event_date_id'
			)
		);
		if ( ! $has_event_date_index ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query( "ALTER TABLE {$table_name} ADD INDEX idx_event_date_id (event_date_id)" );
		}

		update_option( 'fair_audience_db_version', '1.36.0' );
	}

	if ( version_compare( $db_version, '1.37.0', '<' ) ) {
		global $wpdb;
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// Add 'declined' to the email_profile ENUM so organizers can record
		// that a participant was asked and explicitly refused.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"ALTER TABLE {$participants_table}
			 MODIFY COLUMN email_profile ENUM('minimal', 'marketing', 'declined') NOT NULL DEFAULT 'minimal'"
		);

		update_option( 'fair_audience_db_version', '1.37.0' );
	}

	if ( version_compare( $db_version, '1.38.0', '<' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		// Ledger linking event_participant rows to every payment (and, later,
		// refund) transaction they accumulate — a single registration can hold
		// more than one transaction once single-instance signups can be upgraded
		// to whole-series passes.
		dbDelta( \FairAudience\Database\Schema::get_event_participant_transactions_table_sql() );

		update_option( 'fair_audience_db_version', '1.38.0' );
	}

	if ( version_compare( $db_version, '1.39.0', '<' ) ) {
		global $wpdb;
		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		// The seats-per-ticket feature has been removed; every signup now counts
		// as one seat, so the per-row weight column is no longer needed.
		$has_seats_column = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM information_schema.COLUMNS
				 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s',
				$table_name,
				'seats'
			)
		);
		if ( $has_seats_column ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
			$wpdb->query( "ALTER TABLE {$table_name} DROP COLUMN seats" );
		}

		update_option( 'fair_audience_db_version', '1.39.0' );
	}

	if ( version_compare( $db_version, '1.40.0', '<' ) ) {
		// Link any existing fair_events_signups rows to participants by
		// email, in case the fair-events migration that adds
		// participant_id ran while fair-audience was inactive.
		\FairAudience\Hooks\SignupHookBridge::backfill_signup_participant_ids();

		update_option( 'fair_audience_db_version', '1.40.0' );
	}
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\fair_audience_maybe_upgrade_db' );

/**
 * Deactivation hook.
 */
function fair_audience_deactivate() {
	wp_clear_scheduled_hook( 'fair_audience_cleanup_expired_signups' );
	wp_clear_scheduled_hook( 'fair_audience_send_scheduled_messages' );
	wp_clear_scheduled_hook( 'fair_audience_weekly_digest_tick' );
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_deactivate' );
