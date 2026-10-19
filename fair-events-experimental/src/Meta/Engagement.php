<?php
/**
 * Event context and abuse limits for Meta button-click engagement.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Resolves which public event a click belongs to and limits capture per visitor. */
class Engagement {
	public const RATE_LIMIT  = 60;
	public const RATE_WINDOW = 3600;

	/**
	 * The event context an event page bootstraps its click capture with.
	 *
	 * @param int $post_id Queried post ID.
	 * @return array|null `postId` and the shown occurrence's `eventDateId`, or
	 *                    null when the page is not a public event page.
	 */
	public static function page_context( $post_id ) {
		if ( ! class_exists( \FairEvents\Helpers\SelectedOccurrence::class ) || ! self::public_event_post( $post_id ) ) {
			return null;
		}
		// Honors ?event_date= the same way the calendar button does.
		$occurrence = \FairEvents\Helpers\SelectedOccurrence::resolve( (int) $post_id );
		if ( ! $occurrence ) {
			return null;
		}
		return array(
			'postId'      => (int) $post_id,
			'eventDateId' => (int) $occurrence->id,
		);
	}

	/**
	 * Validate submitted event context: the date must belong to the public
	 * event post — its own row, its series master, or a session of that
	 * series — so a request cannot attribute a click to another event.
	 *
	 * @param int $post_id Source post ID. @param int $event_date_id Event date ID.
	 * @return array|null `post_id`, `event_date_id` and the server-derived
	 *                    `source_url`, or null when they do not match.
	 */
	public static function event_context( $post_id, $event_date_id ) {
		$dates = self::event_dates( $post_id );
		if ( ! $dates ) {
			return null;
		}
		list( $own, $root ) = $dates;
		$date               = (int) $own->id === (int) $event_date_id ? $own : \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id );
		if ( ! $date || ! self::belongs( $date, $own, $root ) ) {
			return null;
		}
		return array(
			'post_id'       => (int) $post_id,
			'event_date_id' => (int) $date->id,
			'source_url'    => (string) get_permalink( (int) $post_id ),
		);
	}

	/**
	 * The dates {@see event_context()} accepts for a post, checked against
	 * one lookup of the post's dates instead of one per date.
	 *
	 * @param int   $post_id Source post ID.
	 * @param array $dates   Event date rows or models with `id` and `master_id`.
	 * @return array The accepted dates, in the order given.
	 */
	public static function eligible_dates( $post_id, array $dates ) {
		$event_dates = self::event_dates( $post_id );
		if ( ! $event_dates ) {
			return array();
		}
		list( $own, $root ) = $event_dates;
		return array_values(
			array_filter(
				$dates,
				static function ( $date ) use ( $own, $root ) {
					return self::belongs( $date, $own, $root );
				}
			)
		);
	}

	/**
	 * @param int $post_id Source post ID.
	 * @return array|null The post's own date and its series root, or null
	 *                    when the post is not a public event post.
	 */
	private static function event_dates( $post_id ) {
		if ( ! class_exists( \FairEvents\Models\EventDates::class ) || ! self::public_event_post( $post_id ) ) {
			return null;
		}
		$own = \FairEvents\Models\EventDates::get_by_event_id( (int) $post_id );
		if ( ! $own ) {
			return null;
		}
		$root = $own;
		if ( 'generated' === $own->occurrence_type && $own->master_id ) {
			$master = \FairEvents\Models\EventDates::get_by_id( (int) $own->master_id );
			$root   = $master ? $master : $own;
		}
		return array( $own, $root );
	}

	/** @param object $date Event date. @param object $own The post's own date. @param object $root Its series root. @return bool */
	private static function belongs( $date, $own, $root ) {
		return in_array( (int) $date->id, array( (int) $own->id, (int) $root->id ), true )
			|| ( 'master' === $root->occurrence_type && (int) $date->master_id === (int) $root->id );
	}

	/** @param int $post_id Post ID. @return bool Whether it is a published, unprotected post of an event-enabled type. */
	private static function public_event_post( $post_id ) {
		if ( ! class_exists( \FairEvents\Settings\Settings::class ) ) {
			return false;
		}
		$post = get_post( (int) $post_id );
		return $post
			&& 'publish' === $post->post_status
			&& '' === (string) $post->post_password
			&& is_post_publicly_viewable( $post )
			&& in_array( $post->post_type, \FairEvents\Settings\Settings::get_enabled_post_types(), true );
	}

	/**
	 * Count one capture attempt for a client address and report whether it is
	 * within {@see RATE_LIMIT} per {@see RATE_WINDOW}. The window restarts
	 * with each attempt. Like the checkout limits, it is not atomic under
	 * concurrent requests.
	 *
	 * @param string $address Client address.
	 * @return bool False once the limit is reached.
	 */
	public static function allow( $address ) {
		$key   = 'fair_events_experimental_meta_engagement_' . md5( (string) $address );
		$count = (int) get_transient( $key );
		if ( $count >= self::RATE_LIMIT ) {
			return false;
		}
		set_transient( $key, $count + 1, self::RATE_WINDOW );
		return true;
	}
}
