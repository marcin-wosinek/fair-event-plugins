<?php
/**
 * Plugin Name: Fair Audience Experimental
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Activates advanced feature bundles for Fair Audience (fees, polls, galleries, Instagram, groups, collaborators, messaging, image templates, timeline, import, weekly schedule, invitations, manage-event-ext). Requires fair-audience.
 * Version: 1.1.0
 * Requires at least: 6.7
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

// Defer bootstrap to plugins_loaded so fair-audience (loaded alphabetically before
// fair-audience-experimental) has already been included and FAIR_AUDIENCE_VERSION is defined.
add_action(
	'plugins_loaded',
	function () {
		// Runtime guard: deactivate gracefully when fair-audience is not active.
		if ( ! defined( 'FAIR_AUDIENCE_VERSION' ) ) {
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

		define( 'FAIR_AUDIENCE_EXPERIMENTAL_VERSION', '1.1.0' );
		define( 'FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
		define( 'FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

		\FairAudienceExperimental\Core\Plugin::instance()->init();
	},
	5
);

/**
 * Activation hook.
 *
 * @return void
 */
function fair_audience_experimental_activate() {
	if ( \FairAudienceExperimental\Core\Features::is_enabled( 'instagram' ) && ! wp_next_scheduled( 'fair_audience_refresh_instagram_token' ) ) {
		wp_schedule_event( time(), 'daily', 'fair_audience_refresh_instagram_token' );
	}
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_experimental_activate' );

/**
 * Deactivation hook.
 *
 * @return void
 */
function fair_audience_experimental_deactivate() {
	wp_clear_scheduled_hook( 'fair_audience_refresh_instagram_token' );
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_audience_experimental_deactivate' );
