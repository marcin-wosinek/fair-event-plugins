<?php
/**
 * TimeSlot class for handling time slot calculations and rendering
 *
 * @package FairTimetable
 */

namespace FairTimetable;

defined( 'WPINC' ) || die;

/**
 * TimeSlot class
 *
 * Handles time slot functionality using HourlyRange for robust time calculations.
 */
class TimeSlot {

	/**
	 * Time slot range using HourlyRange
	 *
	 * @var HourlyRange
	 */
	private $timeRange;

	/**
	 * Timetable start hour as decimal number
	 *
	 * @var float
	 */
	private $timetableStartHour;

	/**
	 * Constructor
	 *
	 * @param array $attributes Block attributes
	 * @param array $context Block context from parent
	 */
	public function __construct( array $attributes = array(), array $context = array() ) {
		// Create HourlyRange for the time slot
		$this->timeRange = new HourlyRange(
			array(
				'startTime' => $attributes['startTime'] ?? '09:00',
				'endTime'   => $attributes['endTime'] ?? '10:00',
			)
		);

		// Parse timetable start time using HourlyRange's parsing logic
		$timetableRange           = new HourlyRange(
			array(
				'startTime' => $context['fair-timetable/startTime'] ?? '09:00',
				'endTime'   => '09:01', // Dummy end time for parsing start time
			)
		);
		$this->timetableStartHour = $timetableRange->start_hour;
	}

	/**
	 * Get duration of the time slot
	 *
	 * @return float Duration in decimal hours
	 */
	public function getDuration(): float {
		return $this->timeRange->get_duration();
	}

	/**
	 * Get start hour as decimal
	 *
	 * @return float Start hour in decimal format
	 */
	public function getStartHour(): float {
		return $this->timeRange->start_hour;
	}

	/**
	 * Get end hour as decimal
	 *
	 * @return float End hour in decimal format
	 */
	public function getEndHour(): float {
		return $this->timeRange->end_hour;
	}

	/**
	 * Get formatted time range string
	 *
	 * @return string Time range in "HH:mm—HH:mm" format
	 */
	public function getTimeRangeString(): string {
		return $this->timeRange->get_time_range_string();
	}


	/**
	 * Calculate time from timetable start in hours
	 *
	 * @return float Time from start in hours
	 */
	public function calculateTimeFromStart(): float {
		$timeFromStart = $this->timeRange->start_hour - $this->timetableStartHour;

		// If slot start is before timetable start, add 24 hours (next day)
		if ( $timeFromStart < 0 ) {
			$timeFromStart += 24;
		}

		return $timeFromStart;
	}
}
