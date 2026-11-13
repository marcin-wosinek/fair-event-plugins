<?php
/**
 * Plugin Name: Fair Finance
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Budgeting, financial entries, and reconciliation for fair event management.
 * Version: 1.5.0
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
define( 'FAIR_FINANCE_VERSION', '1.5.0' );
define( 'FAIR_FINANCE_FILE', __FILE__ );
define( 'FAIR_FINANCE_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_FINANCE_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Every Fair plugin bundles the shared library. Each copy registers here,
// the newest is selected on plugins_loaded, and this plugin uses shared
// classes only after that (see PHP_PATTERNS.md § Shared Package).
require_once __DIR__ . '/vendor/fair-events/shared/bootstrap.php';
\Fair_Events_Shared_Loader::register(
	array(
		'plugin_file' => __FILE__,
		'package_dir' => __DIR__ . '/vendor/fair-events/shared',
		'messages'    => array( \FairFinance\Core\SharedLibraryMessages::class, 'message' ),
	)
);

// Initialize plugin once the shared library is selected.
use FairFinance\Core\Plugin;
\Fair_Events_Shared_Loader::when_ready(
	__FILE__,
	static function () {
		Plugin::instance();
	}
);

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
