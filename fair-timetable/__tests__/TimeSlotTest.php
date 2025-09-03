<?php
/**
 * Unit tests for TimeSlot class
 *
 * @package FairTimetable
 */

// Define WordPress constants for testing
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

use PHPUnit\Framework\TestCase;
use FairTimetable\TimeSlot;

class TimeSlotTest extends TestCase {

	public function test_constructor_with_default_values() {
		$timeSlot = new TimeSlot();

		// Since properties are private, we test through behavior
		// Default values should be '09:00' and '10:00'
		$this->assertInstanceOf( TimeSlot::class, $timeSlot );
	}

	public function test_constructor_with_custom_attributes() {
		$attributes = array(
			'startTime' => '10:30',
			'endTime'   => '15:45',
		);

		$timeSlot = new TimeSlot( $attributes );

		$this->assertInstanceOf( TimeSlot::class, $timeSlot );
	}

	public function test_getStartHour_whole_hours() {
		// Test whole hours via TimeSlot constructor and getStartHour()
		$timeSlot1 = new TimeSlot(
			array(
				'startTime' => '09:00',
				'endTime'   => '10:00',
			)
		);
		$this->assertEquals( 9.0, $timeSlot1->getStartHour() );

		$timeSlot2 = new TimeSlot(
			array(
				'startTime' => '17:00',
				'endTime'   => '18:00',
			)
		);
		$this->assertEquals( 17.0, $timeSlot2->getStartHour() );

		$timeSlot3 = new TimeSlot(
			array(
				'startTime' => '00:00',
				'endTime'   => '01:00',
			)
		);
		$this->assertEquals( 0.0, $timeSlot3->getStartHour() );

		$timeSlot4 = new TimeSlot(
			array(
				'startTime' => '23:00',
				'endTime'   => '23:30',
			)
		);
		$this->assertEquals( 23.0, $timeSlot4->getStartHour() );
	}

	public function test_getStartHour_with_minutes() {
		// Test hours with minutes via TimeSlot constructor and getStartHour()
		$timeSlot1 = new TimeSlot(
			array(
				'startTime' => '09:30',
				'endTime'   => '10:30',
			)
		);
		$this->assertEquals( 9.5, $timeSlot1->getStartHour() );

		$timeSlot2 = new TimeSlot(
			array(
				'startTime' => '10:15',
				'endTime'   => '11:15',
			)
		);
		$this->assertEquals( 10.25, $timeSlot2->getStartHour() );

		$timeSlot3 = new TimeSlot(
			array(
				'startTime' => '17:45',
				'endTime'   => '18:45',
			)
		);
		$this->assertEquals( 17.75, $timeSlot3->getStartHour() );

		$timeSlot4 = new TimeSlot(
			array(
				'startTime' => '12:50',
				'endTime'   => '13:50',
			)
		);
		$this->assertEqualsWithDelta( 12.833, $timeSlot4->getStartHour(), 0.01 );
	}

	public function test_invalid_time_format_throws_exception() {
		// Test that invalid time formats throw exceptions (handled by HourlyRange)
		$this->expectException( InvalidArgumentException::class );
		new TimeSlot(
			array(
				'startTime' => 'invalid',
				'endTime'   => '10:00',
			)
		);
	}

	public function test_edge_case_time_formats() {
		// Test edge cases with valid times
		$timeSlot1 = new TimeSlot(
			array(
				'startTime' => '00:00',
				'endTime'   => '01:00',
			)
		);
		$this->assertEquals( 0.0, $timeSlot1->getStartHour() );

		$timeSlot2 = new TimeSlot(
			array(
				'startTime' => '23:59',
				'endTime'   => '23:59',
			)
		);
		$this->assertEquals( 23.983, round( $timeSlot2->getStartHour(), 3 ) );

		$timeSlot3 = new TimeSlot(
			array(
				'startTime' => '12:00',
				'endTime'   => '13:00',
			)
		);
		$this->assertEquals( 12.0, $timeSlot3->getStartHour() );

		$timeSlot4 = new TimeSlot(
			array(
				'startTime' => '00:01',
				'endTime'   => '01:01',
			)
		);
		$this->assertEquals( 0.017, round( $timeSlot4->getStartHour(), 3 ) );
	}

	public function test_calculateOffset_same_start_time() {
		// When slot starts at same time as timetable
		$timeSlot = new TimeSlot(
			array( 'startTime' => '09:00' ),
			array( 'fair-timetable/startTime' => '09:00' )
		);

		$this->assertEquals( 0.0, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_slot_after_timetable_start() {
		// When slot starts 2.5 hours after timetable start
		$timeSlot = new TimeSlot(
			array( 'startTime' => '11:30' ),
			array( 'fair-timetable/startTime' => '09:00' )
		);

		$this->assertEquals( 2.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_slot_before_timetable_start() {
		// When slot starts before timetable start (next day)
		$timeSlot = new TimeSlot(
			array( 'startTime' => '08:00' ),
			array( 'fair-timetable/startTime' => '09:00' )
		);

		// Should add 24 hours: 8 - 9 + 24 = 23 hours
		$this->assertEquals( 23.0, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_with_minutes() {
		// Test with minutes in both times
		$timeSlot = new TimeSlot(
			array( 'startTime' => '14:45' ),
			array( 'fair-timetable/startTime' => '09:15' )
		);

		// 14.75 - 9.25 = 5.5 hours
		$this->assertEquals( 5.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_cross_day_boundary() {
		// When slot is very late and timetable starts early next day
		$timeSlot = new TimeSlot(
			array( 'startTime' => '23:30' ),
			array( 'fair-timetable/startTime' => '08:00' )
		);

		// 23.5 - 8 = 15.5 hours
		$this->assertEquals( 15.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_uses_default_timetable_start() {
		// When no timetable start provided, should use default 09:00
		$timeSlot = new TimeSlot( array( 'startTime' => '10:30' ) );

		// 10.5 - 9 = 1.5 hours
		$this->assertEquals( 1.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_early_morning_slot() {
		// Timetable starts at 10:00, slot at 0:30 (next day)
		$timeSlot = new TimeSlot(
			array( 'startTime' => '00:30' ),
			array( 'fair-timetable/startTime' => '10:00' )
		);

		// 0.5 - 10 + 24 = 14.5 hours
		$this->assertEquals( 14.5, $timeSlot->calculateOffset() );
	}


	public function test_constructor_handles_empty_attributes() {
		$timeSlot = new TimeSlot( array() );

		$this->assertInstanceOf( TimeSlot::class, $timeSlot );
	}

	public function test_constructor_handles_partial_attributes() {
		// Only startTime provided
		$timeSlot1 = new TimeSlot( array( 'startTime' => '14:30' ) );
		$this->assertInstanceOf( TimeSlot::class, $timeSlot1 );

		// Only endTime provided
		$timeSlot2 = new TimeSlot( array( 'endTime' => '16:45' ) );
		$this->assertInstanceOf( TimeSlot::class, $timeSlot2 );
	}

	public function test_new_hourly_range_methods() {
		$timeSlot = new TimeSlot(
			array(
				'startTime' => '09:30',
				'endTime'   => '11:15',
			),
			array( 'fair-timetable/startTime' => '09:00' )
		);

		// Test new methods that delegate to HourlyRange
		$this->assertEquals( 1.75, $timeSlot->getDuration() );
		$this->assertEquals( 9.5, $timeSlot->getStartHour() );
		$this->assertEquals( 11.25, $timeSlot->getEndHour() );
		$this->assertEquals( '09:30—11:15', $timeSlot->getTimeRangeString() );
	}

	public function test_overlaps_with_method() {
		$timeSlot1 = new TimeSlot(
			array(
				'startTime' => '09:00',
				'endTime'   => '11:00',
			)
		);
		$timeSlot2 = new TimeSlot(
			array(
				'startTime' => '10:00',
				'endTime'   => '12:00',
			)
		);
		$timeSlot3 = new TimeSlot(
			array(
				'startTime' => '12:00',
				'endTime'   => '13:00',
			)
		);

		// Test overlap detection
		$this->assertTrue( $timeSlot1->overlapsWith( $timeSlot2 ) );
		$this->assertFalse( $timeSlot1->overlapsWith( $timeSlot3 ) );
		$this->assertFalse( $timeSlot2->overlapsWith( $timeSlot3 ) );
	}
}
