<?php
/**
 * Event Repository
 *
 * Centralized access to events across all enabled post types.
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Repository for fetching events from all enabled post types.
 */
class EventRepository {

	/**
	 * Get all events from enabled post types.
	 *
	 * @param array $args Optional. Query arguments.
	 *                    - post_status: 'publish', 'any', or array of statuses. Default 'publish'.
	 *                    - orderby: Order by field. Default 'title'.
	 *                    - order: ASC or DESC. Default 'ASC'.
	 *                    - posts_per_page: Number of posts. Default -1 (all).
	 * @return \WP_Post[] Array of post objects.
	 */
	public static function get_all( $args = array() ) {
		$defaults = array(
			'post_status'    => 'publish',
			'orderby'        => 'title',
			'order'          => 'ASC',
			'posts_per_page' => -1,
		);

		$args = wp_parse_args( $args, $defaults );

		// Always use enabled post types from settings.
		$args['post_type'] = Settings::get_enabled_post_types();

		return get_posts( $args );
	}

	/**
	 * Get all events for dropdown/select fields.
	 *
	 * Returns events formatted for use in dropdowns with id and title.
	 *
	 * @param array $args Optional. Query arguments (same as get_all).
	 * @return array Array of arrays with 'id' and 'title' keys.
	 */
	public static function get_for_dropdown( $args = array() ) {
		$events = self::get_all( $args );

		return array_map(
			function ( $event ) {
				return array(
					'id'    => $event->ID,
					'title' => $event->post_title,
				);
			},
			$events
		);
	}

	/**
	 * Check if a post is an event (belongs to enabled post types).
	 *
	 * @param int|\WP_Post $post Post ID or object.
	 * @return bool True if post is an event type.
	 */
	public static function is_event( $post ) {
		$post = get_post( $post );

		if ( ! $post ) {
			return false;
		}

		$enabled_types = Settings::get_enabled_post_types();

		return in_array( $post->post_type, $enabled_types, true );
	}

	/**
	 * Get a single event by ID.
	 *
	 * Only returns the post if it belongs to an enabled post type.
	 *
	 * @param int $event_id Event post ID.
	 * @return \WP_Post|null Post object or null if not found/not an event.
	 */
	public static function get_by_id( $event_id ) {
		$post = get_post( $event_id );

		if ( ! $post || ! self::is_event( $post ) ) {
			return null;
		}

		return $post;
	}
}
