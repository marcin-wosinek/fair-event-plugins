<?php
/**
 * Plugin Name: Fair Events
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Event management plugin.
 * Version: 0.7.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-events
 * Domain Path: /languages
 * Tested up to: 6.9
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

	// Initialize plugin.
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

// Define date resolver in global namespace for cross-plugin use.
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
			// Only handle fair-event: format.
			if ( ! is_string( $date_string ) || strpos( $date_string, 'fair-event:' ) !== 0 ) {
				return $date_string;
			}

			// Get event dates.
			$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
			if ( ! $event_dates ) {
				return $date_string;
			}

			// Resolve based on format.
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

	/**
	 * Resolve user group identifier to array of user IDs
	 *
	 * This function allows plugins to reference dynamic user groups using special strings.
	 * Plugins can register their own resolvers using the 'fair_events_user_group_resolve' filter.
	 *
	 * Example usage:
	 * - 'fair-membership:premium-members' - resolves to premium member user IDs
	 * - 'fair-events:event-123-yes' - resolves to attendees who RSVP'd yes to event 123
	 *
	 * @param string $group_string Group identifier to resolve.
	 * @param array  $context      Optional context for resolution (e.g., event_id).
	 * @return array Array of user IDs, empty array if not resolved.
	 */
	function fair_events_user_group_resolve( $group_string, $context = array() ) {
		/**
		 * Filter to resolve dynamic user group strings to user ID arrays.
		 *
		 * Plugins should check if the group_string matches their format,
		 * resolve it to user IDs, and return the array. If not their format,
		 * return an empty array.
		 *
		 * @param array  $user_ids     Array of user IDs (initially empty).
		 * @param string $group_string Group identifier to resolve.
		 * @param array  $context      Context for resolution.
		 * @return array Array of user IDs.
		 */
		$user_ids = apply_filters( 'fair_events_user_group_resolve', array(), $group_string, $context );

		return is_array( $user_ids ) ? $user_ids : array();
	}

	/**
	 * Get available user grouping options for UI
	 *
	 * This function collects user group options from all plugins that register them.
	 * Used by admin interfaces to show available user groups in dropdowns.
	 *
	 * @return array Array of grouping options with 'value', 'label', and optional 'description' keys.
	 */
	function fair_events_user_group_options() {
		/**
		 * Filter to collect user grouping options for UI dropdowns.
		 *
		 * Plugins should add their grouping options as arrays with:
		 * - 'value': The special format string (e.g., 'fair-membership:premium-members')
		 * - 'label': Translated display label (e.g., __('Premium Members', 'textdomain'))
		 * - 'description': Optional description for UI tooltips
		 *
		 * @param array $options Array of grouping options.
		 * @return array Updated array of grouping options.
		 */
		return apply_filters( 'fair_events_user_group_options', array() );
	}

	/**
	 * Register fair-events event attendee group resolvers
	 */
	add_filter(
		'fair_events_user_group_resolve',
		function ( $user_ids, $group_string, $context ) {
			// Only handle fair-events: format.
			if ( ! is_string( $group_string ) || strpos( $group_string, 'fair-events:event-' ) !== 0 ) {
				return $user_ids;
			}

			// Parse format: fair-events:event-{id}-{status}
			// Example: fair-events:event-123-yes (attendees who RSVP'd yes).
			if ( preg_match( '/^fair-events:event-(\d+)-([a-z]+)$/', $group_string, $matches ) ) {
				$event_id    = (int) $matches[1];
				$rsvp_status = $matches[2]; // yes, maybe, no.

				// Query RSVP database if fair-rsvp is active.
				global $wpdb;
				$table_name = $wpdb->prefix . 'fair_rsvp';

				// Check if table exists.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name ) ) ) {
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
					$user_ids = $wpdb->get_col(
						$wpdb->prepare(
							'SELECT DISTINCT user_id FROM %i WHERE event_id = %d AND rsvp_status = %s',
							$table_name,
							$event_id,
							$rsvp_status
						)
					);

					return array_map( 'intval', $user_ids );
				}
			}

			return array();
		},
		10,
		3
	);

}
