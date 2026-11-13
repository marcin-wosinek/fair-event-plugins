<?php
/**
 * Plugin Name: Fair Platform - Mollie OAuth Integration
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Minimal OAuth proxy for Mollie Connect integration. Enables WordPress sites to connect Mollie accounts with platform fees.
 * Version: 1.5.2
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: Private
 * Text Domain: fair-platform
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.2
 *
 * @package FairPlatform
 */

namespace FairPlatform;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_PLATFORM_VERSION', '1.5.2' );
define( 'FAIR_PLATFORM_FILE', __FILE__ );
define( 'FAIR_PLATFORM_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PLATFORM_URL', plugin_dir_url( __FILE__ ) );

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
		'messages'    => array( \FairPlatform\Core\SharedLibraryMessages::class, 'message' ),
	)
);

// Initialize plugin once the shared library is selected.
use FairPlatform\Core\Plugin;
\Fair_Events_Shared_Loader::when_ready(
	__FILE__,
	static function () {
		Plugin::instance();
	}
);

/**
 * Activation hook.
 */
function fair_platform_activate() {
	Plugin::activate();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_platform_activate' );

/**
 * Deactivation hook.
 */
function fair_platform_deactivate() {
	Plugin::deactivate();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_platform_deactivate' );
