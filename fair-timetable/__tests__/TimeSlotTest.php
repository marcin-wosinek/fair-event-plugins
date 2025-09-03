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

	public function test_parseHourString_whole_hours() {
		// Use reflection to test private method
		$timeSlot    = new TimeSlot();
		$reflection  = new ReflectionClass( $timeSlot );
		$parseMethod = $reflection->getMethod( 'parseHourString' );
		$parseMethod->setAccessible( true );

		// Test whole hours
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, '09:00' ) );
		$this->assertEquals( 17.0, $parseMethod->invoke( $timeSlot, '17:00' ) );
		$this->assertEquals( 0.0, $parseMethod->invoke( $timeSlot, '00:00' ) );
		$this->assertEquals( 23.0, $parseMethod->invoke( $timeSlot, '23:00' ) );
	}

	public function test_parseHourString_with_minutes() {
		$timeSlot    = new TimeSlot();
		$reflection  = new ReflectionClass( $timeSlot );
		$parseMethod = $reflection->getMethod( 'parseHourString' );
		$parseMethod->setAccessible( true );

		// Test hours with minutes
		$this->assertEquals( 9.5, $parseMethod->invoke( $timeSlot, '09:30' ) );
		$this->assertEquals( 10.25, $parseMethod->invoke( $timeSlot, '10:15' ) );
		$this->assertEquals( 17.75, $parseMethod->invoke( $timeSlot, '17:45' ) );
		$this->assertEqualsWithDelta( 12.833, $parseMethod->invoke( $timeSlot, '12:50' ), 0.01 );
	}

	public function test_parseHourString_invalid_format() {
		$timeSlot    = new TimeSlot();
		$reflection  = new ReflectionClass( $timeSlot );
		$parseMethod = $reflection->getMethod( 'parseHourString' );
		$parseMethod->setAccessible( true );

		// Test invalid formats - should return default 9.0
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, 'invalid' ) );
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, '25:00' ) );
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, '' ) );
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, '12' ) );
		$this->assertEquals( 9.0, $parseMethod->invoke( $timeSlot, '12:30:00' ) );
	}

	public function test_parseHourString_edge_cases() {
		$timeSlot    = new TimeSlot();
		$reflection  = new ReflectionClass( $timeSlot );
		$parseMethod = $reflection->getMethod( 'parseHourString' );
		$parseMethod->setAccessible( true );

		// Test edge cases
		$this->assertEquals( 0.0, $parseMethod->invoke( $timeSlot, '00:00' ) );
		$this->assertEquals( 23.983, round( $parseMethod->invoke( $timeSlot, '23:59' ), 3 ) );
		$this->assertEquals( 12.0, $parseMethod->invoke( $timeSlot, '12:00' ) );
		$this->assertEquals( 0.017, round( $parseMethod->invoke( $timeSlot, '00:01' ), 3 ) );
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
}
