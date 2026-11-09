<?php
/**
 * Time periods of the events-list block
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Normalizes the events-list block's selected time periods (Past, Current,
 * Future) and turns a selection into the query arguments and per-occurrence
 * checks both rendering paths use.
 *
 * Each single period keeps the timing of the dropdown option it replaces
 * ("upcoming", "ongoing", "past"); all three keep "all". Any other
 * combination is the union of its periods, applied once per date so a date
 * matching two periods is never listed twice.
 *
 * The editor's matching normalization lives in
 * src/blocks/events-list/timeFilters.js.
 */
class EventsListTimeFilters {

	const PAST    = 'past';
	const CURRENT = 'current';
	const FUTURE  = 'future';

	/**
	 * Mode of a selection that is no single legacy filter.
	 */
	const MODE_COMBINED = 'combined';

	/**
	 * Mode of an empty selection.
	 */
	const MODE_NONE = 'none';

	/**
	 * Every period, in display order.
	 *
	 * @return string[]
	 */
	public static function all_periods() {
		return array( self::PAST, self::CURRENT, self::FUTURE );
	}

	/**
	 * Selected periods of a block, in display order.
	 *
	 * `timeFilters` wins whenever it is present, even empty (no periods
	 * selected). Otherwise the legacy single `timeFilter` decides, defaulting
	 * to Future like a newly inserted block.
	 *
	 * @param array $attributes Block attributes.
	 * @return string[] Selected periods.
	 */
	public static function normalize( array $attributes ) {
		if ( isset( $attributes['timeFilters'] ) && is_array( $attributes['timeFilters'] ) ) {
			return array_values( array_intersect( self::all_periods(), $attributes['timeFilters'] ) );
		}

		switch ( $attributes['timeFilter'] ?? 'upcoming' ) {
			case 'all':
				return self::all_periods();
			case 'past':
				return array( self::PAST );
			case 'ongoing':
				return array( self::CURRENT );
			case 'upcoming':
			default:
				return array( self::FUTURE );
		}
	}

	/**
	 * Rendering mode of a selection: the legacy filter it equals ('upcoming',
	 * 'ongoing', 'past', 'all'), MODE_COMBINED, or MODE_NONE.
	 *
	 * Only 'upcoming' collapses recurring series (EventsListSeries).
	 *
	 * @param string[] $periods Normalized periods.
	 * @return string Mode.
	 */
	public static function mode( array $periods ) {
		if ( empty( $periods ) ) {
			return self::MODE_NONE;
		}

		if ( count( $periods ) === count( self::all_periods() ) ) {
			return 'all';
		}

		if ( 1 === count( $periods ) ) {
			$legacy = array(
				self::PAST    => 'past',
				self::CURRENT => 'ongoing',
				self::FUTURE  => 'upcoming',
			);

			return $legacy[ $periods[0] ];
		}

		return self::MODE_COMBINED;
	}

	/**
	 * Display order: Past alone lists the most recent first; every other
	 * selection is chronological.
	 *
	 * @param string[] $periods Normalized periods.
	 * @return string 'ASC' or 'DESC'.
	 */
	public static function order( array $periods ) {
		return array( self::PAST ) === $periods ? 'DESC' : 'ASC';
	}

	/**
	 * QueryHelper `fair_events_date_query` value for the Query Loop path.
	 *
	 * @param string[] $periods Normalized, non-empty periods.
	 * @param string   $now     Site-local 'Y-m-d H:i:s'.
	 * @return array|true Criteria, `any` of several criteria sets, or true
	 *                    for every date.
	 */
	public static function query_date_filter( array $periods, $now ) {
		if ( 'all' === self::mode( $periods ) ) {
			return true;
		}

		$criteria = array(
			self::PAST    => array( 'end_before' => $now ),
			self::CURRENT => array(
				'start_before' => $now,
				'end_after'    => $now,
			),
			self::FUTURE  => array( 'start_after' => $now ),
		);

		if ( 1 === count( $periods ) ) {
			return $criteria[ $periods[0] ];
		}

		return array(
			'any' => array_map(
				static function ( $period ) use ( $criteria ) {
					return $criteria[ $period ];
				},
				$periods
			),
		);
	}

	/**
	 * Candidate range for EventFeedProvider::get_occurrences(), covering
	 * every selected period; matches() then narrows it.
	 *
	 * @param string[] $periods Normalized, non-empty periods.
	 * @param string   $now     Site-local 'Y-m-d H:i:s'.
	 * @return array{0: string|null, 1: string|null} Range start and end.
	 */
	public static function provider_range( array $periods, $now ) {
		$has_past   = in_array( self::PAST, $periods, true );
		$has_future = in_array( self::FUTURE, $periods, true );

		return array(
			$has_past ? null : $now,
			$has_future ? null : $now,
		);
	}

	/**
	 * Whether an occurrence from provider_range() belongs to the selection.
	 *
	 * Only used for combinations: single periods and All keep their legacy
	 * narrowing in render.php. Future follows SessionStatus::is_upcoming(),
	 * Past SessionStatus::has_ended() (an occurrence without timing counts as
	 * past, as before), and Current is the provider's overlap with now.
	 *
	 * @param array    $occurrence Occurrence DTO.
	 * @param string[] $periods    Normalized periods.
	 * @param string   $now        Site-local 'Y-m-d H:i:s'.
	 * @return bool True when the occurrence matches any selected period.
	 */
	public static function matches( array $occurrence, array $periods, $now ) {
		$timing = $occurrence['timing'] ?? array();

		foreach ( $periods as $period ) {
			if ( self::FUTURE === $period && ! empty( $timing ) && SessionStatus::is_upcoming( $timing, $now ) ) {
				return true;
			}

			if ( self::PAST === $period
				&& ( empty( $timing ) || SessionStatus::has_ended( $timing, new \DateTimeImmutable( $now, wp_timezone() ) ) )
			) {
				return true;
			}

			if ( self::CURRENT === $period && ! empty( $timing ) && self::overlaps_now( $timing, $now ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * The provider's range overlap (EventTimingSql::overlaps()) for a range
	 * that is just `$now`: started by now and not ended before it.
	 *
	 * @param array  $timing Canonical timing.
	 * @param string $now    Site-local 'Y-m-d H:i:s'.
	 * @return bool True when the session spans now.
	 */
	private static function overlaps_now( array $timing, $now ) {
		$timing = array_merge( EventTiming::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return false;
		}

		$start = $timing['start_date'] . ' ' . ( $timing['start_time'] ?? '00:00:00' );
		$end   = ( $timing['end_date'] ?? $timing['start_date'] ) . ' ' . ( $timing['end_time'] ?? '23:59:59' );

		return $start <= $now && $end >= $now;
	}
}
