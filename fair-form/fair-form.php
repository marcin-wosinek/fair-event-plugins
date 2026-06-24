<?php
/**
 * Plugin Name: Fair Form
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Form blocks and answer data layer for Fair Event Plugins.
 * Version: 0.2.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: Private
 * Text Domain: fair-form
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairForm
 */

namespace FairForm;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_FORM_VERSION', '0.2.0' );
define( 'FAIR_FORM_FILE', __FILE__ );
define( 'FAIR_FORM_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_FORM_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairForm\Core\Plugin;
Plugin::instance();

/**
 * Activation hook.
 */
function fair_form_activate() {
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( \FairForm\Database\Schema::get_questionnaire_submissions_table_sql() );
	dbDelta( \FairForm\Database\Schema::get_questionnaire_answers_table_sql() );
	Plugin::activate();

	// Record the DB version set during activation so maybe_upgrade_db knows
	// that existing steps are already applied on fresh installs.
	update_option( 'fair_form_db_version', FAIR_FORM_VERSION );
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_form_activate' );

/**
 * Deactivation hook.
 */
function fair_form_deactivate() {
	Plugin::deactivate();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_form_deactivate' );

/**
 * Apply incremental database migrations for existing installs.
 *
 * DbDelta cannot reliably flip NOT NULL to NULL on existing columns; those
 * changes are applied here with guarded ALTER TABLE statements instead.
 */
function fair_form_maybe_upgrade_db() {
	$db_version = get_option( 'fair_form_db_version', '0' );

	if ( version_compare( $db_version, '0.2.0', '<' ) ) {
		global $wpdb;

		$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';
		$answers_table     = $wpdb->prefix . 'fair_audience_questionnaire_answers';

		// Make participant_id nullable so submissions can exist without a Participant.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->query(
			$wpdb->prepare( 'ALTER TABLE %i MODIFY participant_id BIGINT UNSIGNED NULL', $submissions_table )
		);

		// Add 'email' to the question_type ENUM so email-field answers persist correctly.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->query(
			$wpdb->prepare( "ALTER TABLE %i MODIFY question_type ENUM('radio','checkbox','short_text','long_text','select','number','date','multiselect','file_upload','email') NOT NULL DEFAULT 'short_text'", $answers_table )
		);

		update_option( 'fair_form_db_version', '0.2.0' );
	}
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\fair_form_maybe_upgrade_db' );
