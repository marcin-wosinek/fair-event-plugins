<?php
/**
 * Test suite for HourlyRange PHP class
 */

use FairTimetable\HourlyRange;
use PHPUnit\Framework\TestCase;

/**
 * Tests for HourlyRange class
 */
class HourlyRangeTest extends TestCase {

	/**
	 * Test constructor with valid string inputs
	 */
	public function test_constructor_with_valid_inputs() {
		$range = new HourlyRange(
			array(
				'startTime' => '11:30',
				'endTime'   => '12:30',
			)
		);

		$this->assertEquals( 11.5, $range->start_hour );
		$this->assertEquals( 12.5, $range->end_hour );
		$this->assertEquals( 1.0, $range->get_duration() );
	}

	/**
	 * Test constructor with the specific example from requirements
	 */
	public function test_constructor_example_case() {
		$range = new HourlyRange(
			array(
				'startTime' => '11:30',
				'endTime'   => '12:30',
			)
		);

		$this->assertEquals( 11.5, $range->start_hour, 'startHour should be 11.5' );
		$this->assertEquals( 12.5, $range->end_hour, 'endHour should be 12.5' );
		$this->assertEquals( 1.0, $range->get_duration(), 'getDuration() should return 1' );
	}

	/**
	 * Test constructor with midnight times
	 */
	public function test_constructor_midnight_times() {
		$range = new HourlyRange(
			array(
				'startTime' => '00:00',
				'endTime'   => '01:30',
			)
		);

		$this->assertEquals( 0.0, $range->start_hour );
		$this->assertEquals( 1.5, $range->end_hour );
		$this->assertEquals( 1.5, $range->get_duration() );
	}

	/**
	 * Test constructor with cross-midnight scenarios
	 */
	public function test_constructor_cross_midnight() {
		$range = new HourlyRange(
			array(
				'startTime' => '23:00',
				'endTime'   => '01:00',
			)
		);

		$this->assertEquals( 23.0, $range->start_hour );
		$this->assertEquals( 1.0, $range->end_hour );
		$this->assertEquals( 2.0, $range->get_duration() ); // 23:00 to 01:00 = 2 hours
	}

	/**
	 * Test constructor throws error for missing startTime
	 */
	public function test_constructor_missing_start_time() {
		$this->expectException( InvalidArgumentException::class );
		$this->expectExceptionMessage( 'HourlyRange requires both startTime and endTime' );

		new HourlyRange( array( 'endTime' => '12:30' ) );
	}

	/**
	 * Test constructor throws error for missing endTime
	 */
	public function test_constructor_missing_end_time() {
		$this->expectException( InvalidArgumentException::class );
		$this->expectExceptionMessage( 'HourlyRange requires both startTime and endTime' );

		new HourlyRange( array( 'startTime' => '11:30' ) );
	}

	/**
	 * Test constructor throws error for empty parameters
	 */
	public function test_constructor_empty_parameters() {
		$this->expectException( InvalidArgumentException::class );
		$this->expectExceptionMessage( 'HourlyRange requires both startTime and endTime' );

		new HourlyRange( array() );
	}

	/**
	 * Test constructor throws error for empty time strings
	 */
	public function test_constructor_empty_time_strings() {
		$this->expectException( InvalidArgumentException::class );
		$this->expectExceptionMessage( 'HourlyRange requires both startTime and endTime to be non-empty' );

		new HourlyRange(
			array(
				'startTime' => '',
				'endTime'   => '12:30',
			)
		);
	}

	/**
	 * Test time parsing with various formats
	 */
	public function test_time_parsing_various_formats() {
		$test_cases = array(
			array(
				'startTime'      => '00:00',
				'endTime'        => '01:00',
				'expected_start' => 0.0,
				'expected_end'   => 1.0,
			),
			array(
				'startTime'      => '00:15',
				'endTime'        => '01:00',
				'expected_start' => 0.25,
				'expected_end'   => 1.0,
			),
			array(
				'startTime'      => '00:30',
				'endTime'        => '01:00',
				'expected_start' => 0.5,
				'expected_end'   => 1.0,
			),
			array(
				'startTime'      => '00:45',
				'endTime'        => '01:00',
				'expected_start' => 0.75,
				'expected_end'   => 1.0,
			),
			array(
				'startTime'      => '01:00',
				'endTime'        => '02:00',
				'expected_start' => 1.0,
				'expected_end'   => 2.0,
			),
			array(
				'startTime'      => '09:30',
				'endTime'        => '12:00',
				'expected_start' => 9.5,
				'expected_end'   => 12.0,
			),
			array(
				'startTime'      => '12:15',
				'endTime'        => '15:00',
				'expected_start' => 12.25,
				'expected_end'   => 15.0,
			),
			array(
				'startTime'      => '23:59',
				'endTime'        => '00:00',
				'expected_start' => 23.983333333333334,
				'expected_end'   => 0.0,
			),
		);

		foreach ( $test_cases as $case ) {
			$range = new HourlyRange(
				array(
					'startTime' => $case['startTime'],
					'endTime'   => $case['endTime'],
				)
			);

			$this->assertEqualsWithDelta( $case['expected_start'], $range->start_hour, 0.00001, "Failed for startTime: {$case['startTime']}" );
			$this->assertEqualsWithDelta( $case['expected_end'], $range->end_hour, 0.00001, "Failed for endTime: {$case['endTime']}" );
		}
	}

	/**
	 * Test invalid time string formats
	 */
	public function test_invalid_time_formats() {
		$invalid_formats = array(
			'invalid',
			'25:00',
			'12:60',
			'1:30',  // Should be 01:30
			'12:5',  // Should be 12:05
			'12',
			'12:',
			':30',
			'',
			'24:00',
		);

		foreach ( $invalid_formats as $invalid_time ) {
			$this->expectException( InvalidArgumentException::class );
			$this->expectExceptionMessage( "Invalid time format: {$invalid_time}. Expected HH:mm format." );

			new HourlyRange(
				array(
					'startTime' => $invalid_time,
					'endTime'   => '12:00',
				)
			);
		}
	}






	/**
	 * Test get_time_range_string method
	 */
	public function test_get_time_range_string() {
		$range = new HourlyRange(
			array(
				'startTime' => '09:30',
				'endTime'   => '11:15',
			)
		);

		$this->assertEquals( '09:30—11:15', $range->get_time_range_string() );
	}

	/**
	 * Test get_time_range_string with midnight
	 */
	public function test_get_time_range_string_midnight() {
		$range = new HourlyRange(
			array(
				'startTime' => '00:00',
				'endTime'   => '01:30',
			)
		);

		$this->assertEquals( '00:00—01:30', $range->get_time_range_string() );
	}

	/**
	 * Test get_time_range_string with cross-midnight
	 */
	public function test_get_time_range_string_cross_midnight() {
		$range = new HourlyRange(
			array(
				'startTime' => '23:30',
				'endTime'   => '01:00',
			)
		);

		$this->assertEquals( '23:30—01:00', $range->get_time_range_string() );
	}

	/**
	 * Test get_duration method with various scenarios
	 */
	public function test_get_duration_various_scenarios() {
		// Normal case
		$range1 = new HourlyRange(
			array(
				'startTime' => '09:00',
				'endTime'   => '11:30',
			)
		);
		$this->assertEquals( 2.5, $range1->get_duration() );

		// Cross-midnight case
		$range2 = new HourlyRange(
			array(
				'startTime' => '23:00',
				'endTime'   => '02:00',
			)
		);
		$this->assertEquals( 3.0, $range2->get_duration() ); // 23:00 to 02:00 = 3 hours

		// Same time case
		$range3 = new HourlyRange(
			array(
				'startTime' => '12:00',
				'endTime'   => '12:00',
			)
		);
		$this->assertEquals( 0.0, $range3->get_duration() );
	}



	/**
	 * Test edge cases with 24-hour format
	 */
	public function test_24_hour_edge_cases() {
		$range = new HourlyRange(
			array(
				'startTime' => '00:01',
				'endTime'   => '23:59',
			)
		);

		$this->assertEqualsWithDelta( 23.966666666666665, $range->get_duration(), 0.00001 );
	}

	/**
	 * Test fractional minutes precision
	 */
	public function test_fractional_minutes_precision() {
		// Testing edge cases with precision
		$range1 = new HourlyRange(
			array(
				'startTime' => '09:00',
				'endTime'   => '09:01',
			)
		);

		$range2 = new HourlyRange(
			array(
				'startTime' => '09:00',
				'endTime'   => '09:59',
			)
		);

		$this->assertEqualsWithDelta( 0.016666666666666666, $range1->get_duration(), 0.00001 );
		$this->assertEqualsWithDelta( 0.9833333333333333, $range2->get_duration(), 0.00001 );
	}
}
