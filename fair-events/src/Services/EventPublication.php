<?php
/**
 * Draft or publish an event together with its linked posts.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use WP_Error;

/**
 * Keeps an event's publication status and the status of every post linked to
 * it aligned.
 *
 * A series has one status, held by its master, so an action opened from any
 * of its dates applies to the whole series. Every linked post is checked
 * before anything is written, and a failed write restores the posts already
 * changed, so the event and its posts never end up in conflicting states
 * unnoticed. External URLs are never touched.
 */
class EventPublication {

	/**
	 * Publication statuses an event can have.
	 */
	const STATUSES = array( 'publish', 'draft' );

	/**
	 * Post statuses that are left alone: a trashed post or an editor
	 * placeholder is not a page the organizer is publishing or drafting.
	 */
	const SKIPPED_POST_STATUSES = array( 'trash', 'auto-draft' );

	/**
	 * Set the publication status of an event and its linked posts.
	 *
	 * @param EventDates $event_date Event date the action was opened from.
	 * @param string     $status     Target status ('publish' or 'draft').
	 * @return true|WP_Error True on success; an error when nothing was changed.
	 */
	public static function set_status( $event_date, $status ) {
		if ( ! in_array( $status, self::STATUSES, true ) ) {
			return new WP_Error(
				'rest_invalid_publication_status',
				__( 'The publication status must be "publish" or "draft".', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$owner = self::resolve_owner( $event_date );
		$posts = self::get_linked_posts( $owner );

		$preflight = self::preflight( $owner, $posts, $status );
		if ( is_wp_error( $preflight ) ) {
			return $preflight;
		}

		$previous_statuses = array();
		foreach ( $posts as $post ) {
			if ( $post->post_status === $status ) {
				continue;
			}

			$result = wp_update_post(
				array(
					'ID'          => $post->ID,
					'post_status' => $status,
				),
				true
			);

			if ( is_wp_error( $result ) || ! $result ) {
				return self::failure( $post, self::restore_posts( $previous_statuses ) );
			}

			$previous_statuses[ $post->ID ] = $post->post_status;
		}

		if ( $owner->publication_status !== $status
			&& ! EventDates::update_by_id( $owner->id, array( 'publication_status' => $status ) )
		) {
			return self::failure( null, self::restore_posts( $previous_statuses ) );
		}

		return true;
	}

	/**
	 * Posts whose status follows the event's: every post in the event's link
	 * records, minus missing, trashed and placeholder posts.
	 *
	 * @param EventDates $event_date Event date, or any date of its series.
	 * @return \WP_Post[] Linked posts.
	 */
	public static function get_linked_posts( $event_date ) {
		$owner    = self::resolve_owner( $event_date );
		$post_ids = EventDates::get_linked_post_ids( $owner->id );
		if ( $owner->event_id ) {
			$post_ids[] = (int) $owner->event_id;
		}

		$posts = array();
		foreach ( array_unique( array_map( 'intval', $post_ids ) ) as $post_id ) {
			$post = get_post( $post_id );
			if ( $post && ! in_array( $post->post_status, self::SKIPPED_POST_STATUSES, true ) ) {
				$posts[] = $post;
			}
		}

		return $posts;
	}

	/**
	 * Resolve a generated occurrence to the master holding its series' state.
	 *
	 * @param EventDates $event_date Event date.
	 * @return EventDates Single or master event date.
	 */
	private static function resolve_owner( $event_date ) {
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master ) {
				return $master;
			}
		}

		return $event_date;
	}

	/**
	 * Check every linked post before anything is written.
	 *
	 * @param EventDates $owner  Single or master event date.
	 * @param \WP_Post[] $posts  Linked posts.
	 * @param string     $status Target status.
	 * @return true|WP_Error True when the action can go ahead.
	 */
	private static function preflight( $owner, $posts, $status ) {
		foreach ( $posts as $post ) {
			$other_event_ids = array_values(
				array_diff( EventDates::get_link_owner_ids_for_post( $post->ID ), array( (int) $owner->id ) )
			);

			if ( ! empty( $other_event_ids ) ) {
				$other_event = EventDates::get_by_id( $other_event_ids[0] );
				$other_title = $other_event ? $other_event->get_display_title() : '';

				return new WP_Error(
					'rest_post_linked_to_other_event',
					sprintf(
						/* translators: 1: title of the linked page, 2: title of the other event */
						__( '“%1$s” is also linked to another event (%2$s), so changing it here would change that event too. Unlink it from one of the two events and try again. Nothing was changed.', 'fair-events' ),
						$post->post_title,
						'' !== (string) $other_title ? $other_title : __( '(untitled event)', 'fair-events' )
					),
					array(
						'status'         => 409,
						'post_id'        => $post->ID,
						'event_date_ids' => $other_event_ids,
					)
				);
			}
		}

		foreach ( $posts as $post ) {
			if ( $post->post_status === $status ) {
				continue;
			}

			$allowed = current_user_can( 'edit_post', $post->ID )
				&& ( 'publish' !== $status || current_user_can( 'publish_post', $post->ID ) );

			if ( ! $allowed ) {
				return new WP_Error(
					'rest_cannot_change_linked_post',
					sprintf(
						'publish' === $status
							/* translators: %s: title of the linked page */
							? __( 'You are not allowed to publish “%s”, which is linked to this event. Nothing was changed.', 'fair-events' )
							/* translators: %s: title of the linked page */
							: __( 'You are not allowed to move “%s”, which is linked to this event, to draft. Nothing was changed.', 'fair-events' ),
						$post->post_title
					),
					array(
						'status'  => 403,
						'post_id' => $post->ID,
					)
				);
			}
		}

		return true;
	}

	/**
	 * Put posts back to the statuses they had before the action.
	 *
	 * @param array<int, string> $previous_statuses Map of post ID to previous status.
	 * @return int[] IDs of the posts that could not be restored.
	 */
	private static function restore_posts( $previous_statuses ) {
		$not_restored = array();

		foreach ( $previous_statuses as $post_id => $previous_status ) {
			$result = wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => $previous_status,
				),
				true
			);

			if ( is_wp_error( $result ) || ! $result ) {
				$not_restored[] = (int) $post_id;
			}
		}

		return $not_restored;
	}

	/**
	 * Build the error for a write that failed part-way.
	 *
	 * @param \WP_Post|null $failed_post  Post that could not be updated, or null when the event itself failed.
	 * @param int[]         $not_restored IDs of posts left in the new status.
	 * @return WP_Error
	 */
	private static function failure( $failed_post, $not_restored ) {
		if ( ! empty( $not_restored ) ) {
			$titles = array_map( 'get_the_title', $not_restored );

			return new WP_Error(
				'rest_publication_status_inconsistent',
				sprintf(
					/* translators: %s: comma-separated titles of linked pages */
					__( 'The change failed and these pages could not be put back: %s. Check their status, then try again.', 'fair-events' ),
					implode( ', ', $titles )
				),
				array(
					'status'                => 500,
					'not_restored_post_ids' => $not_restored,
				)
			);
		}

		if ( $failed_post ) {
			return new WP_Error(
				'rest_publication_status_failed',
				sprintf(
					/* translators: %s: title of the linked page */
					__( '“%s” could not be updated, so nothing was changed.', 'fair-events' ),
					$failed_post->post_title
				),
				array(
					'status'  => 500,
					'post_id' => $failed_post->ID,
				)
			);
		}

		return new WP_Error(
			'rest_publication_status_failed',
			__( 'The event could not be updated, so nothing was changed.', 'fair-events' ),
			array( 'status' => 500 )
		);
	}
}
