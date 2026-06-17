<?php
/**
 * Plugin Name: Fair Finance
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Budgeting, financial entries, and reconciliation for fair event management.
 * Version: 1.0.1
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: fair-finance
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairFinance
 */

namespace FairFinance;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_FINANCE_VERSION', '1.0.1' );
define( 'FAIR_FINANCE_FILE', __FILE__ );
define( 'FAIR_FINANCE_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_FINANCE_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairFinance\Core\Plugin;
Plugin::instance();

/**
 * Activation hook.
 */
function fair_finance_activate() {
	Plugin::activate();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_finance_activate' );

/**
 * Deactivation hook.
 */
function fair_finance_deactivate() {
	Plugin::deactivate();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_finance_deactivate' );
