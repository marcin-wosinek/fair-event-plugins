<?php
/**
 * Dates a series ticket can cover at signup.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Resolves what the Event Signup form shows about a series' dates: each
 * upcoming date with its site-local label and whether it still has a place,
 * and the dates a whole-series ticket bought now covers. Shared by the block's
 * render (cache-safe baseline) and the viewer-context endpoint (fresh, with
 * the viewer's own signed-up dates), so both describe coverage the way
 * checkout counts it: TicketCapacity decides both the whole-series dates and
 * the remaining places. Checkout still validates and reserves under its own
 * lock; this only explains the choice before it.
 */
class SeriesCoverage {

	/**
	 * Coverage for the form of one event date.
	 *
	 * @param int     $event_date_id          Event date the form signs up for.
	 * @param array[] $occurrences_for_picker Upcoming series dates (id, start_datetime, end_datetime, all_day, signed_up), as the render context holds them.
	 * @return array{dates: array[], whole_series: int[]}|null Null when the form offers no series dates.
	 */
	public static function for_event_date( int $event_date_id, array $occurrences_for_picker ) {
		if ( empty( $occurrences_for_picker ) ) {
			return null;
		}

		$dates = array();
		foreach ( $occurrences_for_picker as $occurrence ) {
			$dates[] = self::describe(
				(int) $occurrence['id'],
				$occurrence['start_datetime'],
				$occurrence['end_datetime'],
				! empty( $occurrence['all_day'] ),
				! empty( $occurrence['signed_up'] )
			);
		}

		// A whole-series date the pickers don't list (another occurrence
		// kind) is still described, so the summary never drops one.
		$whole_series = TicketCapacity::get_whole_series_occurrence_ids( $event_date_id );
		$listed       = array_column( $dates, 'id' );
		foreach ( $whole_series as $covered_id ) {
			if ( in_array( $covered_id, $listed, true ) ) {
				continue;
			}
			$event_date = EventDates::get_by_id( $covered_id );
			if ( $event_date ) {
				$dates[] = self::describe(
					$covered_id,
					$event_date->start_datetime,
					$event_date->end_datetime,
					(bool) $event_date->all_day,
					false
				);
			}
		}

		return self::build( $dates, $whole_series );
	}

	/**
	 * Assemble the coverage payload: dates keep their given order, and the
	 * whole-series list follows that order too.
	 *
	 * @param array[] $dates        Each: id, label, full, signed_up.
	 * @param int[]   $whole_series Dates a whole-series ticket covers.
	 * @return array{dates: array[], whole_series: int[]}
	 */
	public static function build( array $dates, array $whole_series ) {
		$covered = array_map( 'intval', $whole_series );
		$ordered = array();
		foreach ( $dates as $date ) {
			if ( in_array( (int) $date['id'], $covered, true ) ) {
				$ordered[] = (int) $date['id'];
			}
		}

		return array(
			'dates'        => array_values(
				array_map(
					static function ( $date ) {
						return array(
							'id'        => (int) $date['id'],
							'label'     => (string) $date['label'],
							'full'      => ! empty( $date['full'] ),
							'signed_up' => ! empty( $date['signed_up'] ),
						);
					},
					$dates
				)
			),
			'whole_series' => $ordered,
		);
	}

	/**
	 * One date's label and availability.
	 *
	 * @param int    $id             Event date ID.
	 * @param string $start_datetime Site-local start.
	 * @param string $end_datetime   Site-local end.
	 * @param bool   $all_day        Whether it is an all-day date.
	 * @param bool   $signed_up      Whether the viewer already holds it.
	 * @return array
	 */
	private static function describe( $id, $start_datetime, $end_datetime, $all_day, $signed_up ) {
		return array(
			'id'        => $id,
			'label'     => DateRangeFormatter::format( $start_datetime, $end_datetime, $all_day ),
			'full'      => 0 === TicketCapacity::remaining_for_event_date( $id ),
			'signed_up' => $signed_up,
		);
	}
}
