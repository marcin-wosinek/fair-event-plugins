<?php
/**
 * Plugin Name: Fair Audience
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Manage event participants with custom profiles and many-to-many event relationships
 * Version: 0.3.0
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
define( 'FAIR_AUDIENCE_VERSION', '0.1.0' );
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
	dbDelta( \FairAudience\Database\Schema::get_event_signup_access_keys_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_instagram_posts_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_extra_messages_table_sql() );
	dbDelta( \FairAudience\Database\Schema::get_custom_mail_messages_table_sql() );

	// Flush rewrite rules for poll_key, gallery_key, and confirm_email_key query vars.
	flush_rewrite_rules();

	// Schedule daily Instagram token refresh.
	if ( ! wp_next_scheduled( 'fair_audience_refresh_instagram_token' ) ) {
		wp_schedule_event( time(), 'daily', 'fair_audience_refresh_instagram_token' );
	}

	// Update database version.
	update_option( 'fair_audience_db_version', '1.16.0' );
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
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		dbDelta( \FairAudience\Database\Schema::get_event_signup_access_keys_table_sql() );

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
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\fair_audience_maybe_upgrade_db' );

/**
 * Deactivation hook.
 */
function fair_audience_deactivate() {
	// Clear scheduled Instagram token refresh.
	wp_clear_scheduled_hook( 'fair_audience_refresh_instagram_token' );
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_deactivate' );
