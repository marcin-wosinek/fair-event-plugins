<?php
/**
 * Plugin Name: Fair Payments Connector
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Simple payment block for WordPress
 * Version: 1.4.0
 * Requires at least: 6.2
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPL-2.0-or-later
 * Text Domain: fair-payments-connector
 *
 * @package FairPaymentsConnector
 */

defined( 'WPINC' ) || die;

// Define plugin constants.
define( 'FAIR_PAYMENTS_CONNECTOR_VERSION', '1.4.0' );
define( 'FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PAYMENTS_CONNECTOR_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Require Composer autoloader if it exists.
if ( file_exists( FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'vendor/autoload.php' ) ) {
	require_once FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'vendor/autoload.php';
}

// Initialize the plugin.
add_action( 'plugins_loaded', 'fair_payments_connector_init' );

// Activation and deactivation hooks.
register_activation_hook( __FILE__, 'fair_payment_activate' );
register_deactivation_hook( __FILE__, 'fair_payment_deactivate' );

/**
 * Initialize Fair Payments Connector plugin
 *
 * @return void
 */
function fair_payments_connector_init() {
	if ( class_exists( 'FairPaymentsConnector\Core\Plugin' ) ) {
		FairPaymentsConnector\Core\Plugin::instance()->init();
	}
}

/**
 * Plugin activation callback
 *
 * @return void
 */
function fair_payment_activate() {
	if ( class_exists( 'FairPaymentsConnector\Database\Schema' ) ) {
		FairPaymentsConnector\Database\Schema::create_tables();
	}

	// Flush rewrite rules to ensure REST API routes are available.
	flush_rewrite_rules();
}

/**
 * Plugin deactivation callback
 *
 * @return void
 */
function fair_payment_deactivate() {
	// Flush rewrite rules to clean up REST API routes.
	flush_rewrite_rules();
}

/**
 * Create a transaction with line items
 *
 * Example usage:
 * $transaction_id = fair_payment_create_transaction(
 *     [
 *         ['name' => 'Event Ticket', 'quantity' => 2, 'amount' => 15.00],
 *         ['name' => 'Processing Fee', 'quantity' => 1, 'amount' => 2.50],
 *     ],
 *     [
 *         'currency' => 'EUR',
 *         'description' => 'Event Registration',
 *         'post_id' => 123,
 *         'user_id' => get_current_user_id(),
 *     ]
 * );
 *
 * @param array $line_items Array of line items [['name' => '', 'quantity' => 1, 'amount' => 0.00], ...].
 * @param array $args {
 *     Optional transaction parameters.
 *
 *     @type string $currency Currency code (default: 'EUR').
 *     @type string $description Transaction description.
 *     @type int    $post_id Associated post ID.
 *     @type int    $user_id User ID (default: current user).
 *     @type array  $metadata Additional metadata.
 * }
 * @return int|WP_Error Transaction ID on success, WP_Error on failure.
 */
function fair_payment_create_transaction( $line_items, $args = array() ) {
	return \FairPaymentsConnector\API\TransactionAPI::create_transaction( $line_items, $args );
}

/**
 * Initiate payment for a transaction
 *
 * Example usage:
 * $result = fair_payment_initiate_payment(
 *     123,
 *     ['redirect_url' => get_permalink($post_id)]
 * );
 *
 * if ( ! is_wp_error( $result ) ) {
 *     wp_redirect( $result['checkout_url'] );
 *     exit;
 * }
 *
 * @param int   $transaction_id Transaction ID.
 * @param array $args {
 *     Payment parameters.
 *
 *     @type string $redirect_url URL to redirect after payment (required).
 *     @type string $webhook_url Webhook URL (optional, defaults to plugin webhook).
 * }
 * @return array|WP_Error {
 *     Payment data on success, WP_Error on failure.
 *
 *     @type string $checkout_url Mollie checkout URL.
 *     @type string $mollie_payment_id Mollie payment ID.
 *     @type string $status Payment status.
 * }
 */
function fair_payment_initiate_payment( $transaction_id, $args = array() ) {
	return \FairPaymentsConnector\API\TransactionAPI::initiate_payment( $transaction_id, $args );
}

/**
 * Get transaction with line items
 *
 * @param int $transaction_id Transaction ID.
 * @return object|null Transaction object with line_items property, or null if not found.
 */
function fair_payment_get_transaction( $transaction_id ) {
	return \FairPaymentsConnector\API\TransactionAPI::get_transaction( $transaction_id );
}

/**
 * Sync transaction status with Mollie
 *
 * Proactively checks Mollie API for the real status of a pending_payment transaction.
 * If the status has changed, updates the DB and fires action hooks (fair_payment_paid,
 * fair_payment_failed, etc.).
 *
 * Safe to call on any transaction — returns immediately for non-pending transactions.
 *
 * @param int $transaction_id Transaction ID.
 * @return object|null Updated transaction object, or null if not found.
 */
function fair_payment_sync_transaction_status( $transaction_id ) {
	return \FairPaymentsConnector\API\TransactionAPI::sync_transaction_status( $transaction_id );
}
