<?php
/**
 * Plugin Name: Fair Form
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Form blocks and answer data layer for Fair Event Plugins.
 * Version: 0.1.0
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
define( 'FAIR_FORM_VERSION', '0.1.0' );
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
	Plugin::activate();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_form_activate' );

/**
 * Deactivation hook.
 */
function fair_form_deactivate() {
	Plugin::deactivate();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_form_deactivate' );
