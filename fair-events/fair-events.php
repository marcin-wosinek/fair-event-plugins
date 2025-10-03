<?php
/**
 * Plugin Name: Fair Events
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Event management plugin.
 * Version: 0.1.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-events
 *
 * Fair Events is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Events is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Events. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairEvents
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairEvents;

defined( 'WPINC' ) || die;

require_once __DIR__ . '/vendor/autoload.php';

use FairEvents\Core\Plugin;

// Initialize plugin
Plugin::instance()->init();

/**
 * Plugin activation hook
 *
 * @return void
 */
function fair_events_activate() {
	// Trigger post type registration.
	\FairEvents\PostTypes\Event::register();
	// Clear the permalinks after the post type has been registered.
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\fair_events_activate' );

/**
 * Plugin deactivation hook
 *
 * @return void
 */
function fair_events_deactivate() {
	// Clear the permalinks to remove our post type's rules from the database.
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\fair_events_deactivate' );
