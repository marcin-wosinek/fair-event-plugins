<?php
/**
 * Plugin Name: Fair Audience Experimental
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Activates advanced feature bundles for Fair Audience (fees, polls, Instagram, groups, messaging, timeline, import, invitations, manage-event-ext). Requires fair-audience.
 * Version: 1.6.1
 * Requires at least: 7.0
 * Requires PHP: 8.0
 * Requires Plugins: fair-audience
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-audience-experimental
 * Domain Path: /languages
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental;

defined( 'ABSPATH' ) || die;

require_once __DIR__ . '/vendor/autoload.php';

// Every Fair plugin bundles the shared library. Each copy registers here,
// the newest is selected on plugins_loaded, and this plugin uses shared
// classes only after that (see PHP_PATTERNS.md § Shared Package).
require_once __DIR__ . '/vendor/fair-events/shared/bootstrap.php';
\Fair_Events_Shared_Loader::register(
	array(
		'plugin_file' => __FILE__,
		'package_dir' => __DIR__ . '/vendor/fair-events/shared',
		'messages'    => array( \FairAudienceExperimental\Core\SharedLibraryMessages::class, 'message' ),
	)
);

// Defer bootstrap to plugins_loaded so fair-audience (loaded alphabetically before
// fair-audience-experimental) has already been included and FAIR_AUDIENCE_VERSION is defined.
add_action(
	'plugins_loaded',
	function () {
		// Runtime guard: deactivate gracefully when fair-audience is not active.
		if ( ! defined( 'FAIR_AUDIENCE_VERSION' ) ) {
			// Nothing of this plugin runs without Fair Audience, so nothing
			// stays scheduled; the next request with it back restores it.
			\FairAudienceExperimental\Core\Cron::deactivate();
			add_action(
				'admin_notices',
				function () {
					echo '<div class="notice notice-error"><p>'
						. esc_html__( 'Fair Audience Experimental requires the Fair Audience plugin to be active.', 'fair-audience-experimental' )
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

		define( 'FAIR_AUDIENCE_EXPERIMENTAL_VERSION', '1.6.1' );
		define( 'FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
		define( 'FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

		// Shared classes are safe only once the newest copy is selected.
		if ( ! \Fair_Events_Shared_Loader::is_ready( __FILE__ ) ) {
			return;
		}

		\FairAudienceExperimental\Core\Plugin::instance()->init();
	},
	5
);

/**
 * Deactivation hook.
 *
 * Removes every event this plugin owns; pending scheduled messages and
 * Instagram credentials stay. The first request after reactivation restores
 * the enabled bundles' events.
 *
 * @return void
 */
function fair_audience_experimental_deactivate() {
	\FairAudienceExperimental\Core\Cron::deactivate();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_experimental_deactivate' );
