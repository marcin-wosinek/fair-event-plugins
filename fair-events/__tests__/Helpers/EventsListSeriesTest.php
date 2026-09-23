<?php
/**
 * Tests for EventsListSeries' Upcoming grouping and nested-block context.
 *
 * Series metadata is injected through the loader argument, so no database
 * is needed. Dates are in 2040 so DateRangeFormatter always appends the year.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventsListSeries;
use FairEvents\Models\EventDates;

/**
 * Unit tests for EventsListSeries.
 */
class EventsListSeriesTest extends TestCase {

	const NOW = '2040-10-01 18:00:00';

	/**
	 * Make sure no context leaks between tests.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		while ( null !== EventsListSeries::current_context() ) {
			EventsListSeries::pop_context();
		}

		parent::tearDown();
	}

	/**
	 * Build an occurrence DTO.
	 *
	 * @param string   $uid       Unique ID.
	 * @param string   $start     Start.
	 * @param int|null $series_id Series ID.
	 * @param array    $overrides Other fields.
	 * @return array
	 */
	private function occurrence( $uid, $start, $series_id = null, array $overrides = array() ) {
		return array_merge(
			array(
				'uid'       => $uid,
				'title'     => 'Yoga',
				'start'     => $start,
				'end'       => substr( $start, 0, 11 ) . '20:00:00',
				'all_day'   => false,
				'source'    => 'standalone',
				'event_id'  => null,
				'series_id' => $series_id,
			),
			$overrides
		);
	}

	/**
	 * Series loader returning weekly metadata for any ID, recording calls.
	 *
	 * @param array $calls Receives each requested series ID.
	 * @return callable
	 */
	private function loader( &$calls = array() ) {
		return function ( $series_id ) use ( &$calls ) {
			$calls[] = $series_id;
			return array(
				'id'              => $series_id,
				'rrule'           => 'FREQ=WEEKLY',
				'recurrence_mode' => 'rule',
				'anchor_start'    => '2040-01-02 18:00:00',
				'all_day'         => false,
			);
		};
	}

	/**
	 * A series collapses to its next occurrence and mixes chronologically
	 * with single events; each series is loaded once.
	 */
	public function test_series_collapse_to_next_occurrence_in_chronological_order() {
		$calls  = array();
		$result = EventsListSeries::upcoming(
			array(
				$this->occurrence( 'yoga-1', '2040-10-01 18:00:00', 5 ),
				$this->occurrence( 'concert', '2040-10-03 20:00:00' ),
				$this->occurrence( 'yoga-2', '2040-10-08 18:00:00', 5 ),
				$this->occurrence( 'yoga-3', '2040-10-15 18:00:00', 5 ),
			),
			self::NOW,
			$this->loader( $calls )
		);

		$this->assertSame( array( 'yoga-1', 'concert' ), array_column( $result, 'uid' ) );
		$this->assertSame( 5, $result[0]['series']['id'] );
		$this->assertArrayNotHasKey( 'series', $result[1] );
		$this->assertSame( array( 5 ), $calls );
	}

	/**
	 * The boundary is inclusive: an occurrence starting exactly now is
	 * upcoming; one that started a second earlier (still running) is not,
	 * so its series is represented by the following occurrence.
	 */
	public function test_exact_now_is_upcoming_and_running_occurrence_is_skipped() {
		$result = EventsListSeries::upcoming(
			array(
				$this->occurrence( 'running', '2040-10-01 17:59:59', 5 ),
				$this->occurrence( 'exact', '2040-10-01 18:00:00' ),
				$this->occurrence( 'next-week', '2040-10-08 18:00:00', 5 ),
			),
			self::NOW,
			$this->loader()
		);

		$this->assertSame( array( 'exact', 'next-week' ), array_column( $result, 'uid' ) );
	}

	/**
	 * Distinct series with the same title stay separate: grouping is by
	 * series ID, never by title. External occurrences are never grouped.
	 */
	public function test_distinct_series_and_external_occurrences_are_not_merged() {
		$result = EventsListSeries::upcoming(
			array(
				$this->occurrence( 'a-1', '2040-10-01 18:00:00', 5 ),
				$this->occurrence( 'b-1', '2040-10-02 18:00:00', 9 ),
				$this->occurrence( 'ext-1', '2040-10-03 18:00:00', null, array( 'source' => 'ical' ) ),
				$this->occurrence( 'ext-2', '2040-10-10 18:00:00', null, array( 'source' => 'ical' ) ),
				$this->occurrence( 'a-2', '2040-10-08 18:00:00', 5 ),
			),
			self::NOW,
			$this->loader()
		);

		$this->assertSame( array( 'a-1', 'b-1', 'ext-1', 'ext-2' ), array_column( $result, 'uid' ) );
	}

	/**
	 * A series whose master can't be loaded still appears once, with a plain
	 * date instead of a summary.
	 */
	public function test_series_without_metadata_still_collapses() {
		$result = EventsListSeries::group(
			array(
				$this->occurrence( 'a-1', '2040-10-01 18:00:00', 5 ),
				$this->occurrence( 'a-2', '2040-10-08 18:00:00', 5 ),
			),
			function () {
				return null;
			}
		);

		$this->assertCount( 1, $result );
		$this->assertSame( '18:00—20:00, 1 October 2040', EventsListSeries::date_text( $result[0] ) );
	}

	/**
	 * Grouped entries read as a schedule summary; single events as a date range.
	 */
	public function test_date_text() {
		$result = EventsListSeries::upcoming(
			array(
				$this->occurrence( 'yoga-2', '2040-10-08 18:00:00', 5 ),
				$this->occurrence( 'concert', '2040-10-10 20:00:00', null, array( 'end' => '2040-10-10 22:00:00' ) ),
			),
			self::NOW,
			$this->loader()
		);

		$this->assertSame( 'Weekly on Mondays at 18:00; next occurrence: 8 October 2040', EventsListSeries::date_text( $result[0] ) );
		$this->assertSame( '20:00—22:00, 10 October 2040', EventsListSeries::date_text( $result[1] ) );
	}

	/**
	 * Series identity: masters are their own series, generated rows point at
	 * their master, single rows have none.
	 */
	public function test_series_id_for_row() {
		$master                  = new EventDates();
		$master->id              = 5;
		$master->occurrence_type = 'master';

		$generated                  = new EventDates();
		$generated->id              = 6;
		$generated->occurrence_type = 'generated';
		$generated->master_id       = 5;

		$single                  = new EventDates();
		$single->id              = 8;
		$single->occurrence_type = 'single';

		$this->assertSame( 5, EventsListSeries::series_id_for_row( $master ) );
		$this->assertSame( 5, EventsListSeries::series_id_for_row( $generated ) );
		$this->assertNull( EventsListSeries::series_id_for_row( $single ) );
	}

	/**
	 * The schedule anchor is the master's original date at its start time,
	 * so rescheduling the master's own occurrence keeps the regular weekday.
	 */
	public function test_series_from_master_pins_anchor_date() {
		$master                    = new EventDates();
		$master->id                = 5;
		$master->occurrence_type   = 'master';
		$master->start_datetime    = '2040-01-04 18:00:00';
		$master->recurrence_anchor = '2040-01-02';
		$master->rrule             = 'FREQ=WEEKLY';
		$master->recurrence_mode   = 'rule';
		$master->all_day           = false;

		$series = EventsListSeries::series_from_master( $master );

		$this->assertSame( '2040-01-02 18:00:00', $series['anchor_start'] );
	}

	/**
	 * A nested event-dates block describes the list's occurrence in the
	 * Upcoming view, and resolves on its own otherwise.
	 */
	public function test_nested_block_uses_occurrence_context_only_for_upcoming() {
		$this->assertNull( EventsListSeries::date_text_for_nested_block( 12 ) );

		$occurrence = $this->occurrence(
			'post-1',
			'2040-10-10 20:00:00',
			null,
			array(
				'source'   => 'post',
				'event_id' => 12,
				'end'      => '2040-10-10 22:00:00',
			)
		);

		EventsListSeries::push_context(
			array(
				'mode'        => EventsListSeries::MODE_OCCURRENCE,
				'time_filter' => 'upcoming',
				'occurrence'  => $occurrence,
			)
		);
		$this->assertSame( '20:00—22:00, 10 October 2040', EventsListSeries::date_text_for_nested_block( 12 ) );
		// A block pointed at another post falls through to its own resolution.
		$this->assertNull( EventsListSeries::date_text_for_nested_block( 99 ) );
		EventsListSeries::pop_context();

		EventsListSeries::push_context(
			array(
				'mode'        => EventsListSeries::MODE_OCCURRENCE,
				'time_filter' => 'past',
				'occurrence'  => $occurrence,
			)
		);
		$this->assertNull( EventsListSeries::date_text_for_nested_block( 12 ) );
		EventsListSeries::pop_context();

		$this->assertNull( EventsListSeries::current_context() );
	}
}
