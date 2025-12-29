<?php
/**
 * Plugin Name: Fair Team
 * Plugin URI: https://fair-event-plugins.com
 * Description: Link events and posts to team members who collaborate on them
 * Version: 0.1.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPL-3.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-team
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairTeam
 */

namespace FairTeam;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_TEAM_VERSION', '0.1.0' );
define( 'FAIR_TEAM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_TEAM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairTeam\Core\Plugin;
Plugin::instance()->init();

/**
 * Activation hook.
 */
function fair_team_activate() {
	// Database setup, rewrite rules, default options, etc.
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_team_activate' );

/**
 * Deactivation hook.
 */
function fair_team_deactivate() {
	// Cleanup (flush rewrite rules, clear scheduled events, etc.)
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_team_deactivate' );
