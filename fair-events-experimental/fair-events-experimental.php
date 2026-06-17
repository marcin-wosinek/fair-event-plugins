<?php
/**
 * Plugin Name: Fair Events Experimental
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Activates advanced feature bundles for Fair Events (galleries, sources, ticketing, event-tools, migration, venues). Requires fair-events.
 * Version: 1.1.0
 * Requires at least: 6.7
 * Requires PHP: 8.0
 * Requires Plugins: fair-events
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-events-experimental
 * Domain Path: /languages
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental;

defined( 'ABSPATH' ) || die;

require_once __DIR__ . '/vendor/autoload.php';

// Defer bootstrap to plugins_loaded so fair-events (loaded alphabetically after
// fair-events-experimental) has already been included and FAIR_EVENTS_VERSION is defined.
add_action(
	'plugins_loaded',
	function () {
		// Runtime guard: deactivate gracefully when fair-events is not active.
		if ( ! defined( 'FAIR_EVENTS_VERSION' ) ) {
			add_action(
				'admin_notices',
				function () {
					echo '<div class="notice notice-error"><p>'
						. esc_html__( 'Fair Events Experimental requires the Fair Events plugin to be active.', 'fair-events-experimental' )
						. '</p></div>';
				}
			);
			// Deactivate self if called during activation.
			if ( isset( $_GET['activate'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				add_action(
					'admin_init',
					function () {
						deactivate_plugins( plugin_basename( __FILE__ ) );
					}
				);
			}
			return;
		}

		define( 'FAIR_EVENTS_EXPERIMENTAL_VERSION', '1.1.0' );
		define( 'FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
		define( 'FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

		\FairEventsExperimental\Core\Plugin::instance()->init();
	},
	5
);
