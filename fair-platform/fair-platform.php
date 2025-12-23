<?php
/**
 * Plugin Name: Fair Platform - Mollie OAuth Integration
 * Plugin URI: https://fair-event-plugins.com
 * Description: Minimal OAuth proxy for Mollie Connect integration. Enables WordPress sites to connect Mollie accounts with platform fees.
 * Version: 1.0.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: Private
 * Text Domain: fair-platform
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairPlatform
 */

namespace FairPlatform;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_PLATFORM_VERSION', '1.0.0' );
define( 'FAIR_PLATFORM_FILE', __FILE__ );
define( 'FAIR_PLATFORM_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PLATFORM_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairPlatform\Core\Plugin;
Plugin::instance();

/**
 * Activation hook.
 */
function fair_platform_activate() {
	Plugin::instance()->register_rewrite_rules();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_platform_activate' );

/**
 * Deactivation hook.
 */
function fair_platform_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_platform_deactivate' );
