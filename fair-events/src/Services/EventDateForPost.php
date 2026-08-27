<?php
/**
 * Ensure event-date data exists for an enabled post.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;

/**
 * Creates the single/master event date associated with a post when needed.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventDateForPost {

	/**
	 * Ensure a post has one event-date record and junction-table relationship.
	 *
	 * @param int $post_id Post ID.
	 * @return EventDates|null Event date, or null when creation failed.
	 */
	public static function ensure( $post_id ) {
		global $wpdb;

		$post_id   = absint( $post_id );
		$lock_name = 'fair_events_post_' . $post_id;
		$locked    = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 5 )
		);

		if ( 1 !== $locked ) {
			return null;
		}

		try {
			$event_date = EventDates::get_by_event_id( $post_id );
			if ( ! $event_date ) {
				EventDates::save( $post_id, null, null, false );
				$event_date = EventDates::get_by_event_id( $post_id );
			}

			if ( $event_date ) {
				EventDates::add_linked_post( $event_date->id, $post_id );
			}
		} finally {
			$wpdb->get_var(
				$wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name )
			);
		}

		return $event_date ? $event_date : null;
	}
}
