<?php
/**
 * EventsListTimeFilters unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventsListTimeFilters;

/**
 * Tests for the events-list block's time periods.
 */
class EventsListTimeFiltersTest extends TestCase {

	const NOW = '2026-06-10 12:00:00';

	/**
	 * Pin the site timezone.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
	}

	/**
	 * Restore the default timezone.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * An occurrence DTO with the given timing.
	 *
	 * @param string      $start_date Start date.
	 * @param string|null $start_time Start time.
	 * @param string|null $end_date   End date.
	 * @param string|null $end_time   End time.
	 * @param bool        $all_day    All-day flag.
	 * @return array Occurrence.
	 */
	private static function occurrence( $start_date, $start_time, $end_date, $end_time, $all_day = false ) {
		return array(
			'timing' => array(
				'start_date' => $start_date,
				'start_time' => $start_time,
				'end_date'   => $end_date,
				'end_time'   => $end_time,
				'all_day'    => $all_day,
			),
		);
	}

	/**
	 * Legacy attributes map onto periods; an explicit array wins, even empty.
	 *
	 * @param array    $attributes Block attributes.
	 * @param string[] $expected   Periods.
	 */
	#[DataProvider( 'normalize_cases' )]
	public function test_normalize( array $attributes, array $expected ) {
		$this->assertSame( $expected, EventsListTimeFilters::normalize( $attributes ) );
	}

	/**
	 * Cases for test_normalize().
	 *
	 * @return array
	 */
	public static function normalize_cases() {
		return array(
			'new block defaults to Future' => array( array(), array( 'future' ) ),
			'legacy upcoming'              => array( array( 'timeFilter' => 'upcoming' ), array( 'future' ) ),
			'legacy ongoing'               => array( array( 'timeFilter' => 'ongoing' ), array( 'current' ) ),
			'legacy past'                  => array( array( 'timeFilter' => 'past' ), array( 'past' ) ),
			'legacy all'                   => array( array( 'timeFilter' => 'all' ), array( 'past', 'current', 'future' ) ),
			'empty array means none'       => array(
				array(
					'timeFilter'  => 'all',
					'timeFilters' => array(),
				),
				array(),
			),
			'array is ordered and cleaned' => array( array( 'timeFilters' => array( 'future', 'bogus', 'current' ) ), array( 'current', 'future' ) ),
		);
	}

	/**
	 * Single periods and All keep their legacy mode, order and query args;
	 * combinations OR their periods' criteria.
	 *
	 * @param string[]   $periods    Periods.
	 * @param string     $mode       Expected mode.
	 * @param string     $order      Expected order.
	 * @param array      $range      Expected provider range.
	 * @param array|bool $date_query Expected QueryHelper criteria.
	 */
	#[DataProvider( 'combination_cases' )]
	public function test_combination( array $periods, $mode, $order, array $range, $date_query ) {
		$this->assertSame( $mode, EventsListTimeFilters::mode( $periods ) );
		$this->assertSame( $order, EventsListTimeFilters::order( $periods ) );

		if ( empty( $periods ) ) {
			return;
		}

		$this->assertSame( $range, EventsListTimeFilters::provider_range( $periods, self::NOW ) );
		$this->assertSame( $date_query, EventsListTimeFilters::query_date_filter( $periods, self::NOW ) );
	}

	/**
	 * All eight selections.
	 *
	 * @return array
	 */
	public static function combination_cases() {
		$past    = array( 'end_before' => self::NOW );
		$current = array(
			'start_before' => self::NOW,
			'end_after'    => self::NOW,
		);
		$future  = array( 'start_after' => self::NOW );

		return array(
			'none'             => array( array(), 'none', 'ASC', array(), null ),
			'past'             => array( array( 'past' ), 'past', 'DESC', array( null, self::NOW ), $past ),
			'current'          => array( array( 'current' ), 'ongoing', 'ASC', array( self::NOW, self::NOW ), $current ),
			'future'           => array( array( 'future' ), 'upcoming', 'ASC', array( self::NOW, null ), $future ),
			'past+current'     => array( array( 'past', 'current' ), 'combined', 'ASC', array( null, self::NOW ), array( 'any' => array( $past, $current ) ) ),
			'past+future'      => array( array( 'past', 'future' ), 'combined', 'ASC', array( null, null ), array( 'any' => array( $past, $future ) ) ),
			'current+future'   => array( array( 'current', 'future' ), 'combined', 'ASC', array( self::NOW, null ), array( 'any' => array( $current, $future ) ) ),
			'all three is all' => array( array( 'past', 'current', 'future' ), 'all', 'ASC', array( null, null ), true ),
		);
	}

	/**
	 * Per-occurrence checks of combinations, at exact boundaries too.
	 *
	 * @param array $occurrence Occurrence.
	 * @param array $expected   Map of combination label => expected match.
	 */
	#[DataProvider( 'match_cases' )]
	public function test_matches( array $occurrence, array $expected ) {
		$combinations = array(
			'past+current'   => array( 'past', 'current' ),
			'past+future'    => array( 'past', 'future' ),
			'current+future' => array( 'current', 'future' ),
		);

		foreach ( $combinations as $label => $periods ) {
			$this->assertSame(
				$expected[ $label ],
				EventsListTimeFilters::matches( $occurrence, $periods, self::NOW ),
				$label
			);
		}
	}

	/**
	 * Occurrences around NOW.
	 *
	 * @return array
	 */
	public static function match_cases() {
		$all = static function ( $past_current, $past_future, $current_future ) {
			return array(
				'past+current'   => $past_current,
				'past+future'    => $past_future,
				'current+future' => $current_future,
			);
		};

		return array(
			'ended yesterday'          => array( self::occurrence( '2026-06-09', '10:00:00', '2026-06-09', '11:00:00' ), $all( true, true, false ) ),
			'happening now'            => array( self::occurrence( '2026-06-10', '11:00:00', '2026-06-10', '13:00:00' ), $all( true, false, true ) ),
			'starts tomorrow'          => array( self::occurrence( '2026-06-11', '10:00:00', '2026-06-11', '11:00:00' ), $all( false, true, true ) ),
			'starts exactly now'       => array( self::occurrence( '2026-06-10', '12:00:00', '2026-06-10', '13:00:00' ), $all( true, true, true ) ),
			'ends exactly now'         => array( self::occurrence( '2026-06-10', '10:00:00', '2026-06-10', '12:00:00' ), $all( true, true, true ) ),
			'all day today'            => array( self::occurrence( '2026-06-10', null, '2026-06-10', null, true ), $all( true, false, true ) ),
			'all day yesterday'        => array( self::occurrence( '2026-06-09', null, '2026-06-09', null, true ), $all( true, true, false ) ),
			'started today, no end'    => array( self::occurrence( '2026-06-10', '09:00:00', '2026-06-10', null ), $all( true, true, true ) ),
			'no timing counts as past' => array( array(), $all( true, true, false ) ),
		);
	}
}
