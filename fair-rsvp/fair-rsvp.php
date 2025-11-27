<?php
/**
 * Plugin Name: Fair RSVP
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: RSVP management for events - let users sign up for events.
 * Version: 0.5.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-rsvp
 * Domain Path: /languages
 *
 * Fair RSVP is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair RSVP is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair RSVP. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairRsvp
 * @author Marcin Wosinek
 * @since 0.1.0
 */

namespace FairRsvp;

defined( 'WPINC' ) || die;

// Define plugin constants.
define( 'FAIR_RSVP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_RSVP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'FAIR_RSVP_VERSION', '0.1.0' );

require_once __DIR__ . '/vendor/autoload.php';

use FairRsvp\Core\Plugin;

// Initialize plugin.
Plugin::instance()->init();

/**
 * Load plugin text domain for translations
 */
function fair_rsvp_load_textdomain() {
	load_plugin_textdomain( 'fair-rsvp', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\fair_rsvp_load_textdomain' );

/**
 * Plugin activation hook
 */
function fair_rsvp_activate() {
	// Database installation will be handled here.
	\FairRsvp\Database\Installer::install();

	// Migrate existing events to set _has_rsvp_block meta.
	\FairRsvp\Database\Installer::migrate_rsvp_block_meta();

	flush_rewrite_rules();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_rsvp_activate' );

/**
 * Plugin deactivation hook
 */
function fair_rsvp_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_rsvp_deactivate' );
