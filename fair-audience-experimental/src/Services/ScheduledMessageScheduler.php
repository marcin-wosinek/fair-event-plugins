<?php
/**
 * Scheduled Message Scheduler
 *
 * Resolves the concrete send time for a scheduled message from its anchor
 * (an event date's start/end) plus a signed minute offset. Shared by the REST
 * controller (on create/edit) and the reschedule hooks (when an anchor moves).
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Services;

use FairAudienceExperimental\Models\ScheduledMessage;

defined( 'WPINC' ) || die;

/**
 * Computes scheduled_for from an anchor + offset.
 */
class ScheduledMessageScheduler {

	/**
	 * Anchor types backed by an event date (supported in #606).
	 */
	const EVENT_DATE_ANCHORS = array( 'event_date_start', 'event_date_end' );

	/**
	 * Whether an anchor type is supported yet.
	 *
	 * Sale-period anchors (#617) are not resolvable until that work lands.
	 *
	 * @param string $anchor_type Anchor type.
	 * @return bool True if supported.
	 */
	public static function is_supported_anchor( $anchor_type ) {
		return in_array( $anchor_type, self::EVENT_DATE_ANCHORS, true );
	}

	/**
	 * Compute the send time for an anchor + offset, in WP-local wall time.
	 *
	 * Returned string is comparable to current_time( 'mysql' ), the same frame
	 * the cron picker uses. Returns null when the anchor row is missing, the
	 * anchor has no time (an event date whose start or end time is not set
	 * yet), or the anchor type is unsupported. A null send time is never
	 * picked up by the cron, and the next change to the event date
	 * recomputes it.
	 *
	 * @param string $anchor_type    Anchor type.
	 * @param int    $anchor_ref_id  Anchor row ID (event_date id for event_date_*).
	 * @param int    $offset_minutes Signed offset in minutes.
	 * @return string|null Computed datetime ('Y-m-d H:i:s') or null.
	 */
	public function compute_scheduled_for( $anchor_type, $anchor_ref_id, $offset_minutes ) {
		if ( ! self::is_supported_anchor( $anchor_type ) ) {
			return null;
		}

		$base = $this->get_event_date_anchor_time( $anchor_type, (int) $anchor_ref_id );
		if ( empty( $base ) ) {
			return null;
		}

		$dt = date_create( $base, wp_timezone() );
		if ( false === $dt ) {
			return null;
		}

		$offset_minutes = (int) $offset_minutes;
		$sign           = $offset_minutes < 0 ? '-' : '+';
		$dt->modify( $sign . abs( $offset_minutes ) . ' minutes' );

		return $dt->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Recompute and persist scheduled_for for a message from its own anchor.
	 *
	 * @param ScheduledMessage $message Message to recompute.
	 * @return bool Whether the save succeeded.
	 */
	public function recompute( ScheduledMessage $message ) {
		$message->scheduled_for = $this->compute_scheduled_for(
			$message->anchor_type,
			$message->anchor_ref_id,
			$message->offset_minutes
		);

		return $message->save();
	}

	/**
	 * Read the start/end moment of an event date.
	 *
	 * An exact time is required: a timed event date without the anchored
	 * time has no moment, so nothing guesses one. All-day dates keep
	 * anchoring at the start of their first and last day, as they always
	 * have.
	 *
	 * @param string $anchor_type   event_date_start or event_date_end.
	 * @param int    $event_date_id Event date row ID.
	 * @return string|null Datetime string, or null if not found or not timed.
	 */
	private function get_event_date_anchor_time( $anchor_type, $event_date_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table,
				$event_date_id
			),
			ARRAY_A
		);

		if ( ! $row ) {
			return null;
		}

		return self::anchor_time_from_row( $anchor_type, $row );
	}

	/**
	 * The anchor moment of an event date row.
	 *
	 * Reads the row's date and optional time: an all-day date anchors at the
	 * start of its day, and a timed date without the needed time has no
	 * anchor moment.
	 *
	 * @param string $anchor_type event_date_start or event_date_end.
	 * @param array  $row         Event date row.
	 * @return string|null Site-local 'Y-m-d H:i:s', or null when there is no such time.
	 */
	public static function anchor_time_from_row( $anchor_type, array $row ) {
		$is_end = 'event_date_end' === $anchor_type;

		$date = $is_end ? ( $row['end_date'] ?? null ) : ( $row['start_date'] ?? null );
		if ( empty( $date ) ) {
			return null;
		}

		if ( ! empty( $row['all_day'] ) ) {
			return $date . ' 00:00:00';
		}

		$time = $is_end ? ( $row['end_time'] ?? null ) : ( $row['start_time'] ?? null );

		return empty( $time ) ? null : $date . ' ' . $time;
	}
}
