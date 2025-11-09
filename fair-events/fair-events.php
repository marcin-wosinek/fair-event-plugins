<?php
/**
 * Plugin Name: Fair Events
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Event management plugin.
 * Version: 0.4.3
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-events
 * Domain Path: /languages
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

namespace FairEvents {

	defined( 'WPINC' ) || die;

	// Define plugin constants.
	define( 'FAIR_EVENTS_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
	define( 'FAIR_EVENTS_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

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
		// Install database tables.
		\FairEvents\Database\Installer::install();
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
}

// Define date resolver in global namespace for cross-plugin use
namespace {
	/**
	 * Resolve special date strings to actual datetime values
	 *
	 * This function allows plugins to reference dynamic dates using special strings.
	 * Plugins can register their own resolvers using the 'fair_events_date_resolve' filter.
	 *
	 * Example usage:
	 * - 'fair-event:start' - resolves to event start datetime
	 * - 'fair-event:end' - resolves to event end datetime
	 *
	 * @param string $date_string Date string to resolve (ISO datetime or special format).
	 * @param int    $post_id     Post ID context for resolution.
	 * @return string Resolved datetime string or original value if not resolved.
	 */
	function fair_events_resolve_date( $date_string, $post_id ) {
		/**
		 * Filter to resolve dynamic date strings to actual datetime values.
		 *
		 * Plugins should check if the date_string matches their format,
		 * resolve it, and return the resolved value. If not their format,
		 * return the original $date_string unchanged.
		 *
		 * @param string $date_string Date string to resolve.
		 * @param int    $post_id     Post ID context for resolution.
		 * @return string Resolved datetime or original string.
		 */
		return apply_filters( 'fair_events_date_resolve', $date_string, $post_id );
	}

	/**
	 * Register fair-events own date resolvers
	 */
	add_filter(
		'fair_events_date_resolve',
		function ( $date_string, $post_id ) {
			// Only handle fair-event: format
			if ( ! is_string( $date_string ) || strpos( $date_string, 'fair-event:' ) !== 0 ) {
				return $date_string;
			}

			// Get event dates
			$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
			if ( ! $event_dates ) {
				return $date_string;
			}

			// Resolve based on format
			switch ( $date_string ) {
				case 'fair-event:start':
					return $event_dates->start_datetime ?? $date_string;
				case 'fair-event:end':
					return $event_dates->end_datetime ?? $date_string;
				default:
					return $date_string;
			}
		},
		10,
		2
	);

	/**
	 * Register fair-events date options for UI
	 */
	add_filter(
		'fair_events_date_options',
		function ( $options ) {
			$options[] = array(
				'value' => 'fair-event:start',
				'label' => __( 'Fair Event: Start Date', 'fair-events' ),
			);
			$options[] = array(
				'value' => 'fair-event:end',
				'label' => __( 'Fair Event: End Date', 'fair-events' ),
			);
			return $options;
		}
	);
}
