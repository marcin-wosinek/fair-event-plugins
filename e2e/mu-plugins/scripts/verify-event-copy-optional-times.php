<?php
/**
 * Live copy regression (#1819): copies keep missing times, shift dates by
 * whole days, and carry occurrence timing overrides and cancellations.
 *
 * @package FairEvents
 */

use FairEvents\Models\EventDates;
use FairEvents\Services\EventCopyService;
use FairEvents\Services\RecurrenceService;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- CLI assertion messages, never HTML.
wp_set_current_user( 1 );

$assert = static function ( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
};
$timing = static function ( $start_date, $start_time, $end_time, $end_date = null ) {
	return array(
		'start_date' => $start_date,
		'end_date'   => $end_date ?? $start_date,
		'start_time' => $start_time,
		'end_time'   => $end_time,
		'all_day'    => false,
	);
};
$owned  = array();
$result = array();
try {
	// Hand-picked series without a start time, with one date owning its
	// times, one moved to the next day and one cancelled.
	$manual_id = EventDates::create_standalone(
		array_merge(
			$timing( '2041-01-07', null, '20:00:00' ),
			array(
				'title'     => 'Optional times manual copy',
				'link_type' => 'none',
			)
		)
	);
	$owned[]   = $manual_id;
	$assert( 4 === RecurrenceService::set_manual_occurrences( $manual_id, array( '2041-01-07', '2041-01-14', '2041-01-21', '2041-01-28' ) ), 'Manual seed failed.' );
	$children = array_values( EventDates::get_generated_by_master_id( $manual_id ) );
	EventDates::update_by_id(
		$children[0]->id,
		array(
			'start_time'     => '15:00:00',
			'end_time'       => null,
			'times_override' => 1,
		)
	);
	EventDates::update_by_id(
		$children[1]->id,
		array(
			'start_date'     => '2041-01-22',
			'end_date'       => '2041-01-22',
			'dates_override' => 1,
		)
	);
	EventDates::update_by_id( $children[2]->id, array( 'status' => 'cancelled' ) );

	$source = EventCopyService::resolve_source( $manual_id );
	$assert( ! is_wp_error( $source ), 'Cannot resolve an untimed source.' );
	$copy = ( new EventCopyService() )->copy( $source, 'Optional times manual copy (Copy)', $timing( '2041-02-04', null, '20:00:00' ) );
	$assert( ! is_wp_error( $copy ), 'Manual copy failed.' );
	$owned[] = $copy['event_date_id'];

	$copied = EventDates::get_by_id( $copy['event_date_id'] );
	$assert( $timing( '2041-02-04', null, '20:00:00' ) === $copied->get_timing(), 'Copy invented a start time.' );
	$rows = array();
	foreach ( EventDates::get_generated_by_master_id( $copied->id, true ) as $row ) {
		$rows[ $row->recurrence_anchor ] = array(
			'timing'    => $row->get_timing(),
			'overrides' => $row->timing_overrides,
			'status'    => $row->status,
		);
	}
	$assert(
		array(
			'2041-02-11' => array(
				'timing'    => $timing( '2041-02-11', '15:00:00', null ),
				'overrides' => array(
					'dates' => false,
					'times' => true,
				),
				'status'    => 'active',
			),
			'2041-02-18' => array(
				'timing'    => $timing( '2041-02-19', null, '20:00:00' ),
				'overrides' => array(
					'dates' => true,
					'times' => false,
				),
				'status'    => 'active',
			),
			'2041-02-25' => array(
				'timing'    => $timing( '2041-02-25', null, '20:00:00' ),
				'overrides' => array(
					'dates' => false,
					'times' => false,
				),
				'status'    => 'cancelled',
			),
		) === $rows,
		'Manual copy did not shift dates and carry overrides: ' . wp_json_encode( $rows )
	);
	$result['manual'] = true;

	// Rule series of a multi-day event without times.
	$rule_id = EventDates::create_standalone(
		array_merge(
			$timing( '2041-03-01', null, null, '2041-03-02' ),
			array(
				'title'     => 'Optional times rule copy',
				'link_type' => 'none',
				'rrule'     => 'FREQ=WEEKLY;COUNT=3',
			)
		)
	);
	$owned[] = $rule_id;
	$assert( 3 === RecurrenceService::regenerate_standalone_occurrences( $rule_id, 'FREQ=WEEKLY;COUNT=3' ), 'Rule seed failed.' );
	$rule_copy = ( new EventCopyService() )->copy( EventCopyService::resolve_source( $rule_id ), 'Optional times rule copy (Copy)', $timing( '2041-04-05', null, null, '2041-04-06' ) );
	$assert( ! is_wp_error( $rule_copy ), 'Rule copy failed.' );
	$owned[] = $rule_copy['event_date_id'];
	$last    = array_values( EventDates::get_generated_by_master_id( $rule_copy['event_date_id'] ) )[1];
	$assert( $timing( '2041-04-19', null, null, '2041-04-20' ) === $last->get_timing(), 'Rule copy lost the day span or invented times.' );
	$result['rule'] = true;

	// Without a start time on either side, deadlines move by whole days.
	$shift = EventCopyService::get_date_shift( $timing( '2041-03-01', null, null ), $timing( '2041-04-05', '10:00:00', null ) );
	$assert( 35 === (int) $shift->days && 0 === $shift->h && 0 === $shift->i, 'Shift used an invented time.' );
	$result['shift'] = true;

	echo 'EVENT_COPY_OPTIONAL_TIMES:' . wp_json_encode( $result );
} finally {
	foreach ( $owned as $event_date_id ) {
		if ( $event_date_id ) {
			EventDates::delete_by_id( $event_date_id );
		}
	}
}
