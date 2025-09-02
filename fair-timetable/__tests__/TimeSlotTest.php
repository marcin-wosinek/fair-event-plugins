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
			'startHour' => '10:30',
			'endHour'   => '15:45',
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
			array( 'startHour' => '09:00' ),
			array( 'fair-timetable/startHour' => '09:00' )
		);

		$this->assertEquals( 0.0, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_slot_after_timetable_start() {
		// When slot starts 2.5 hours after timetable start
		$timeSlot = new TimeSlot(
			array( 'startHour' => '11:30' ),
			array( 'fair-timetable/startHour' => '09:00' )
		);

		$this->assertEquals( 2.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_slot_before_timetable_start() {
		// When slot starts before timetable start (next day)
		$timeSlot = new TimeSlot(
			array( 'startHour' => '08:00' ),
			array( 'fair-timetable/startHour' => '09:00' )
		);

		// Should add 24 hours: 8 - 9 + 24 = 23 hours
		$this->assertEquals( 23.0, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_with_minutes() {
		// Test with minutes in both times
		$timeSlot = new TimeSlot(
			array( 'startHour' => '14:45' ),
			array( 'fair-timetable/startHour' => '09:15' )
		);

		// 14.75 - 9.25 = 5.5 hours
		$this->assertEquals( 5.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_cross_day_boundary() {
		// When slot is very late and timetable starts early next day
		$timeSlot = new TimeSlot(
			array( 'startHour' => '23:30' ),
			array( 'fair-timetable/startHour' => '08:00' )
		);

		// 23.5 - 8 = 15.5 hours
		$this->assertEquals( 15.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_uses_default_timetable_start() {
		// When no timetable start provided, should use default 09:00
		$timeSlot = new TimeSlot( array( 'startHour' => '10:30' ) );

		// 10.5 - 9 = 1.5 hours
		$this->assertEquals( 1.5, $timeSlot->calculateOffset() );
	}

	public function test_calculateOffset_early_morning_slot() {
		// Timetable starts at 10:00, slot at 0:30 (next day)
		$timeSlot = new TimeSlot(
			array( 'startHour' => '00:30' ),
			array( 'fair-timetable/startHour' => '10:00' )
		);

		// 0.5 - 10 + 24 = 14.5 hours
		$this->assertEquals( 14.5, $timeSlot->calculateOffset() );
	}


	public function test_constructor_handles_empty_attributes() {
		$timeSlot = new TimeSlot( array() );

		$this->assertInstanceOf( TimeSlot::class, $timeSlot );
	}

	public function test_constructor_handles_partial_attributes() {
		// Only startHour provided
		$timeSlot1 = new TimeSlot( array( 'startHour' => '14:30' ) );
		$this->assertInstanceOf( TimeSlot::class, $timeSlot1 );

		// Only endHour provided
		$timeSlot2 = new TimeSlot( array( 'endHour' => '16:45' ) );
		$this->assertInstanceOf( TimeSlot::class, $timeSlot2 );
	}

	public function test_calculateDuration_whole_hours() {
		// Test 1 hour duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '09:00',
				'endHour'   => '10:00',
			)
		);
		$this->assertEquals( 1.0, $timeSlot->calculateDuration() );

		// Test 8 hour duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '09:00',
				'endHour'   => '17:00',
			)
		);
		$this->assertEquals( 8.0, $timeSlot->calculateDuration() );

		// Test 0 hour duration (same start and end)
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '12:00',
				'endHour'   => '12:00',
			)
		);
		$this->assertEquals( 0.0, $timeSlot->calculateDuration() );
	}

	public function test_calculateDuration_with_minutes() {
		// Test 1.5 hour duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '09:00',
				'endHour'   => '10:30',
			)
		);
		$this->assertEquals( 1.5, $timeSlot->calculateDuration() );

		// Test 2.75 hour duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '14:15',
				'endHour'   => '17:00',
			)
		);
		$this->assertEquals( 2.75, $timeSlot->calculateDuration() );

		// Test 45 minute duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '10:15',
				'endHour'   => '11:00',
			)
		);
		$this->assertEquals( 0.75, $timeSlot->calculateDuration() );
	}

	public function test_calculateDuration_next_day_scenario() {
		// End time is before start time (next day)
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '23:00',
				'endHour'   => '01:00',
			)
		);
		// 1 - 23 + 24 = 2 hours
		$this->assertEquals( 2.0, $timeSlot->calculateDuration() );

		// Late evening to early morning
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '22:30',
				'endHour'   => '06:15',
			)
		);
		// 6.25 - 22.5 + 24 = 7.75 hours
		$this->assertEquals( 7.75, $timeSlot->calculateDuration() );

		// Midnight crossing
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '23:45',
				'endHour'   => '00:15',
			)
		);
		// 0.25 - 23.75 + 24 = 0.5 hours (30 minutes)
		$this->assertEquals( 0.5, $timeSlot->calculateDuration() );
	}

	public function test_calculateDuration_edge_cases() {
		// Full day duration
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '00:00',
				'endHour'   => '00:00',
			)
		);
		$this->assertEquals( 0.0, $timeSlot->calculateDuration() );

		// Almost full day
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '00:01',
				'endHour'   => '00:00',
			)
		);
		// 0 - 0.017 + 24 = 23.983 hours
		$this->assertEqualsWithDelta( 23.983, $timeSlot->calculateDuration(), 0.01 );

		// Exact 12 hours
		$timeSlot = new TimeSlot(
			array(
				'startHour' => '06:00',
				'endHour'   => '18:00',
			)
		);
		$this->assertEquals( 12.0, $timeSlot->calculateDuration() );
	}

	public function test_calculateDuration_uses_default_values() {
		// Test with default constructor values (09:00 to 10:00)
		$timeSlot = new TimeSlot();
		$this->assertEquals( 1.0, $timeSlot->calculateDuration() );
	}

	public function test_calculateDuration_with_invalid_times() {
		// Constructor should handle invalid times with fallback to defaults
		$timeSlot = new TimeSlot(
			array(
				'startHour' => 'invalid',
				'endHour'   => 'also-invalid',
			)
		);
		// Both should fall back to 9.0, so duration = 9.0 - 9.0 = 0.0
		$this->assertEquals( 0.0, $timeSlot->calculateDuration() );
	}
}
