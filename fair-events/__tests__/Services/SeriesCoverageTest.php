<?php
/**
 * SeriesCoverage tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Models\EventDates;
use FairEvents\Services\SeriesCoverage;
use FairEvents\Services\TicketCapacity;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;

require_once __DIR__ . '/Coverage_Test_WPDB.php';

/**
 * Covers the coverage payload the signup form reads.
 */
class SeriesCoverageTest extends TestCase {

	/**
	 * The bootstrap's $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * The test double.
	 *
	 * @var Coverage_Test_WPDB
	 */
	private $wpdb;

	/**
	 * Install the double and empty the master cache.
	 */
	protected function setUp(): void {
		parent::setUp();

		$this->original_wpdb = $GLOBALS['wpdb'];
		$this->wpdb          = new Coverage_Test_WPDB();
		$GLOBALS['wpdb']     = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- swapped for the test double, restored in tearDown().
		self::reset_master_cache();
	}

	/**
	 * Restore the bootstrap's $wpdb and empty the master cache.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the bootstrap's $wpdb.
		self::reset_master_cache();

		parent::tearDown();
	}

	/**
	 * Empty EventDates' per-request master cache.
	 *
	 * @return void
	 */
	private static function reset_master_cache() {
		$property = new ReflectionProperty( EventDates::class, 'master_cache' );
		$property->setValue( null, array() );
	}

	/**
	 * Picker rows the way the render context holds them.
	 *
	 * @param int[] $ids       Event date IDs.
	 * @param int[] $signed_up IDs the viewer already holds.
	 * @return array[]
	 */
	private function picker( array $ids, array $signed_up = array() ) {
		return array_map(
			function ( $id ) use ( $signed_up ) {
				$row = $this->wpdb->dates[ $id ];
				return array(
					'id'        => $id,
					'timing'    => array(
						'start_date' => $row->start_date,
						'end_date'   => $row->end_date,
						'start_time' => $row->start_time,
						'end_time'   => $row->end_time,
						'all_day'    => false,
					),
					'signed_up' => in_array( $id, $signed_up, true ),
				);
			},
			$ids
		);
	}

	/**
	 * Coverage of a fresh series of the given size, with the queries it ran.
	 *
	 * @param int      $count    Dates in the series.
	 * @param int|null $capacity Places per date.
	 * @return Coverage_Test_WPDB
	 */
	private function trace_series( $count, $capacity ) {
		$this->wpdb      = new Coverage_Test_WPDB();
		$GLOBALS['wpdb'] = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- swapped for the test double, restored in tearDown().
		self::reset_master_cache();

		$ids = $this->wpdb->seed_series( 100, $count, $capacity );
		SeriesCoverage::for_event_date( 100, $this->picker( $ids ) );

		return $this->wpdb;
	}

	/**
	 * Describing a longer series reads no more event date rows: dates are
	 * read together, and an unlimited series counts no admissions (#1996).
	 */
	public function test_unlimited_series_reads_do_not_grow_with_its_dates() {
		$small = $this->trace_series( 3, null );
		$large = $this->trace_series( 48, null );

		$this->assertSame( array(), $large->single_date_reads() );
		$this->assertSame( array(), $large->admission_counts() );
		$this->assertCount( count( $small->queries ), $large->queries );
	}

	/**
	 * A limited series still counts each date's admissions fresh, but reads
	 * no date row one by one: it grows by exactly one admission count per
	 * extra date.
	 */
	public function test_limited_series_grows_only_by_admission_counts() {
		$small = $this->trace_series( 3, 5 );
		$large = $this->trace_series( 48, 5 );

		$this->assertSame( array(), $large->single_date_reads() );
		$this->assertCount( 2 * 48, $large->admission_counts() );

		$before = count( $large->queries );
		TicketCapacity::count_event_date( 101 );
		$count_cost = count( $large->queries ) - $before;

		$this->assertSame( ( 48 - 3 ) * $count_cost, $before - count( $small->queries ) );
	}

	/**
	 * Dates keep the picker's order and the viewer's own holds; a limited
	 * date with no place left is full, and the whole series covers them all.
	 */
	public function test_limited_dates_report_full_in_picker_order() {
		$this->wpdb->seed_series( 100, 3, 2 );
		$this->wpdb->taken[101] = 2;
		$this->wpdb->taken[102] = 1;

		$picker   = $this->picker( array( 102, 100, 101 ), array( 100 ) );
		$coverage = SeriesCoverage::for_event_date( 100, $picker );

		$this->assertSame( array( 102, 100, 101 ), array_column( $coverage['dates'], 'id' ) );
		$this->assertSame( array( false, false, true ), array_column( $coverage['dates'], 'full' ) );
		$this->assertSame( array( false, true, false ), array_column( $coverage['dates'], 'signed_up' ) );
		$this->assertSame( array( 102, 100, 101 ), $coverage['whole_series'] );
		$this->assertSame( DateRangeFormatter::format_timing( $picker[0]['timing'] ), $coverage['dates'][0]['label'] );
	}

	/**
	 * A whole-series date the picker doesn't list is appended from the same
	 * batch read; a picker date with no row is still listed, never full.
	 */
	public function test_unlisted_whole_series_dates_are_appended() {
		$this->wpdb->seed_series( 100, 3, 1 );
		$this->wpdb->taken[102] = 1;

		$picker   = $this->picker( array( 100 ) );
		$picker[] = array(
			'id'     => 555,
			'timing' => $picker[0]['timing'],
		);
		$coverage = SeriesCoverage::for_event_date( 100, $picker );

		$this->assertSame( array( 100, 555, 101, 102 ), array_column( $coverage['dates'], 'id' ) );
		$this->assertSame( array( false, false, false, true ), array_column( $coverage['dates'], 'full' ) );
		$this->assertSame( array( 100, 101, 102 ), $coverage['whole_series'] );
		$this->assertSame( array(), $this->wpdb->single_date_reads() );
	}

	/** A form without series dates shows no coverage and reads nothing. */
	public function test_no_picker_dates_means_no_coverage() {
		$this->assertNull( SeriesCoverage::for_event_date( 100, array() ) );
		$this->assertSame( array(), $this->wpdb->queries );
	}

	/** Whole-series dates follow the date order, not the ID order. */
	public function test_whole_series_follows_date_order() {
		$coverage = SeriesCoverage::build(
			array(
				array(
					'id'    => 9,
					'label' => 'Sat, 1 Mar',
					'full'  => false,
				),
				array(
					'id'    => 4,
					'label' => 'Sat, 8 Mar',
					'full'  => true,
				),
				array(
					'id'    => 7,
					'label' => 'Sat, 15 Mar',
					'full'  => false,
				),
			),
			array( 4, 7, 9 )
		);

		$this->assertSame( array( 9, 4, 7 ), $coverage['whole_series'] );
	}

	/** Each date carries its label, availability and the viewer's own hold. */
	public function test_dates_are_normalized() {
		$coverage = SeriesCoverage::build(
			array(
				array(
					'id'        => '5',
					'label'     => 'Sat, 1 Mar',
					'full'      => 1,
					'signed_up' => true,
				),
			),
			array()
		);

		$this->assertSame(
			array(
				array(
					'id'        => 5,
					'label'     => 'Sat, 1 Mar',
					'full'      => true,
					'signed_up' => true,
				),
			),
			$coverage['dates']
		);
		$this->assertSame( array(), $coverage['whole_series'] );
	}

	/** A covered date missing from the dates is left out rather than shown unlabelled. */
	public function test_unknown_covered_date_is_left_out() {
		$coverage = SeriesCoverage::build(
			array(
				array(
					'id'    => 1,
					'label' => 'Sat, 1 Mar',
					'full'  => false,
				),
			),
			array( 1, 99 )
		);

		$this->assertSame( array( 1 ), $coverage['whole_series'] );
	}
}
