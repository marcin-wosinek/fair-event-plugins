<?php
/**
 * Plugin Name: Fair Payment
 * Plugin URI: https://fair-event-plugins.com
 * Description: Simple payment block for WordPress
 * Version: 0.1.0
 * Author: Fair Event Plugins
 * Author URI: https://fair-event-plugins.com
 * License: GPL-2.0-or-later
 * Text Domain: fair-payment
 *
 * @package FairPayment
 */

defined( 'WPINC' ) || die;

// Define plugin constants.
define( 'FAIR_PAYMENT_VERSION', '0.1.0' );
define( 'FAIR_PAYMENT_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PAYMENT_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Require Composer autoloader if it exists.
if ( file_exists( FAIR_PAYMENT_PLUGIN_DIR . 'vendor/autoload.php' ) ) {
	require_once FAIR_PAYMENT_PLUGIN_DIR . 'vendor/autoload.php';
}

// Initialize the plugin.
add_action( 'plugins_loaded', 'fair_payment_init' );

/**
 * Initialize Fair Payment plugin
 *
 * @return void
 */
function fair_payment_init() {
	if ( class_exists( 'FairPayment\Core\Plugin' ) ) {
		FairPayment\Core\Plugin::instance()->init();
	}
}
