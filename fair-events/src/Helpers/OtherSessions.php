<?php
/**
 * Upcoming sessions of a recurring event, for the Other Sessions block.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;
use FairEvents\Models\Venue;

defined( 'WPINC' ) || die;

/**
 * Lists the sessions of the recurring event a page shows that visitors can
 * still attend: future and ongoing ones (see SessionStatus), never the
 * session the page itself shows, and never more than the block's limit.
 *
 * The page is resolved with SelectedOccurrence, like the Event Info block,
 * so overview pages, `?event_date=` selections and pages linked directly to
 * one session agree on which series and session they show.
 */
class OtherSessions {

	/**
	 * Default number of sessions shown.
	 */
	const DEFAULT_LIMIT = 5;

	/**
	 * Smallest allowed number of sessions.
	 */
	const MIN_LIMIT = 1;

	/**
	 * Largest allowed number of sessions; keeps long series cheap to render.
	 */
	const MAX_LIMIT = 20;

	/**
	 * The page's recurring event is a draft, so visitors see none of it.
	 */
	const DRAFT = 'draft';

	/**
	 * Clamp a requested number of sessions to the allowed range.
	 *
	 * @param mixed $value Requested number (block attribute).
	 * @return int Number of sessions to show.
	 */
	public static function clamp_limit( $value ) {
		if ( ! is_numeric( $value ) ) {
			return self::DEFAULT_LIMIT;
		}

		return max( self::MIN_LIMIT, min( self::MAX_LIMIT, (int) $value ) );
	}

	/**
	 * Resolve the sessions to list on a post's page.
	 *
	 * @param int $post_id Post ID.
	 * @param int $limit   Maximum number of sessions (clamped).
	 * @return array{state: string, sessions: array[]}|null `state` is a
	 *               SelectedOccurrence state, or DRAFT (with no sessions).
	 *               Null when the page has no recurring event.
	 */
	public static function for_post( $post_id, $limit ) {
		$selection = SelectedOccurrence::select( $post_id );

		if ( ! $selection || ! $selection['series'] ) {
			return null;
		}

		$series = $selection['series'];

		if ( $series->is_event_draft() ) {
			return array(
				'state'    => self::DRAFT,
				'sessions' => array(),
			);
		}

		$limit      = self::clamp_limit( $limit );
		$exclude_id = SelectedOccurrence::SESSION === $selection['state'] ? (int) $selection['occurrence']->id : 0;

		EventDates::prime_master_cache( array( $series->id ) );

		$rows = self::select_listed(
			EventDates::get_unended_sessions_by_master_id( (int) $series->id, $exclude_id, $limit ),
			$exclude_id,
			$limit
		);

		return array(
			'state'    => $selection['state'],
			'sessions' => self::entries( $rows, $series, $post_id ),
		);
	}

	/**
	 * Keep the sessions to list, in order, up to the limit.
	 *
	 * The query already applies these rules; this applies them with
	 * SessionStatus' exact boundaries (which differ from the query's only
	 * around a daylight-saving change) and is the tested definition.
	 *
	 * @param EventDates[]            $rows       Candidate sessions.
	 * @param int                     $exclude_id Session ID to leave out (0 for none).
	 * @param int                     $limit      Maximum number of sessions.
	 * @param \DateTimeInterface|null $now        Current time; defaults to now.
	 * @return EventDates[] Active, dated, not ended sessions in start order.
	 */
	public static function select_listed( array $rows, $exclude_id, $limit, $now = null ) {
		$listed = array_filter(
			$rows,
			static function ( EventDates $row ) use ( $exclude_id, $now ) {
				return (int) $row->id !== (int) $exclude_id
					&& 'active' === $row->status
					&& ! empty( $row->start_date )
					&& ! SessionStatus::has_ended( $row->get_timing(), $now );
			}
		);

		usort(
			$listed,
			static function ( EventDates $a, EventDates $b ) {
				// Untimed sessions sort first on their date, as in EventTimingSql::order_by().
				return array( $a->start_date, null !== $a->start_time, (string) $a->start_time, (int) $a->id )
					<=> array( $b->start_date, null !== $b->start_time, (string) $b->start_time, (int) $b->id );
			}
		);

		return array_slice( $listed, 0, self::clamp_limit( $limit ) );
	}

	/**
	 * Build the display entries for listed sessions, loading their links
	 * and venues in bulk.
	 *
	 * @param EventDates[] $rows    Listed sessions.
	 * @param EventDates   $series  Series master.
	 * @param int          $post_id Post the block renders on (location fallback).
	 * @return array[] Entries (see entry()).
	 */
	public static function entries( array $rows, EventDates $series, $post_id ) {
		if ( empty( $rows ) ) {
			return array();
		}

		$venue_ids = array();
		foreach ( $rows as $row ) {
			SelectedOccurrence::with_master_venue_fallback( $row, $series );
			$venue_ids[] = (int) $row->venue_id;
		}

		EventDates::preload_linked_post_ids( $rows );
		$venues = Venue::get_by_ids( $venue_ids );

		return array_map(
			static function ( EventDates $row ) use ( $post_id, $venues ) {
				return self::entry( $row, $post_id, $venues );
			},
			$rows
		);
	}

	/**
	 * Build one session's display entry.
	 *
	 * @param EventDates $row     Session.
	 * @param int        $post_id Post the block renders on (location fallback).
	 * @param array|null $venues  Venues loaded in bulk, keyed by ID, or null.
	 * @return array{id: int, date: string, all_day: bool, url: string|null, location: string, mode: string}
	 *               `date` is the full date range with only supplied times,
	 *               `location` the venue name or address ('' when none).
	 */
	public static function entry( EventDates $row, $post_id, $venues = null ) {
		$location = EventLocation::resolve( $row, $post_id, $venues );

		return array(
			'id'       => (int) $row->id,
			'date'     => DateRangeFormatter::format_timing( $row->get_timing(), true ),
			'all_day'  => (bool) $row->all_day,
			'url'      => $row->get_session_page_url(),
			'location' => (string) ( $location['name'] ?? ( $location['address'] ?? '' ) ),
			'mode'     => $location['mode'] ?? ( $row->attendance_mode ?? 'in_person' ),
		);
	}
}
