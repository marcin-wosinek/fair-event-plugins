<?php
/**
 * Plugin Name: Fair Audience
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Manage event participants with custom profiles and many-to-many event relationships
 * Version: 0.1.0
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

	// Flush rewrite rules for poll_key query var.
	flush_rewrite_rules();

	// Update database version.
	update_option( 'fair_audience_db_version', '1.1.0' );
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
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\fair_audience_maybe_upgrade_db' );

/**
 * Deactivation hook.
 */
function fair_audience_deactivate() {
	// Cleanup if needed.
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_deactivate' );
