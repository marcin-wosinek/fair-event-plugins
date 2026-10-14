<?php
/**
 * SeriesCoverage tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\SeriesCoverage;
use PHPUnit\Framework\TestCase;

/**
 * Covers the coverage payload the signup form reads.
 */
class SeriesCoverageTest extends TestCase {

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
