<?php
/**
 * Plugin Name: Fair Payments Connector Experimental
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Experimental features for Fair Payments Connector: API tokens, connected sites, and Telegram notifications.
 * Version: 0.1.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: Private
 * Text Domain: fair-payments-connector-experimental
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION', '0.1.0' );
define( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_FILE', __FILE__ );
define( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairPaymentsConnectorExperimental\Core\Plugin;
add_action( 'plugins_loaded', array( Plugin::class, 'instance' ) );
