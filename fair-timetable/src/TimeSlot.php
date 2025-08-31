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
 * Placeholder class for time slot functionality.
 * Logic will be added later.
 */
class TimeSlot {

	/**
	 * Start hour as decimal number (e.g., 9.5 for 09:30)
	 *
	 * @var float
	 */
	private $startHour;

	/**
	 * End hour as decimal number (e.g., 17.25 for 17:15)
	 *
	 * @var float
	 */
	private $endHour;

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
		$this->startHour          = $this->parseHourString( $attributes['startHour'] ?? '09:00' );
		$this->endHour            = $this->parseHourString( $attributes['endHour'] ?? '10:00' );
		$this->timetableStartHour = $this->parseHourString( $context['fair-timetable/startHour'] ?? '09:00' );
	}

	/**
	 * Parse hour string (HH:mm) to decimal hour
	 *
	 * @param string $hourString Time in HH:mm format
	 * @return float Decimal hour (e.g., 9.5 for 09:30)
	 */
	private function parseHourString( string $hourString ): float {
		$parts = explode( ':', $hourString );
		if ( count( $parts ) !== 2 ) {
			return 9.0; // Default fallback
		}

		$hours   = (int) $parts[0];
		$minutes = (int) $parts[1];

		// Validate hour and minute ranges
		if ( $hours < 0 || $hours > 23 || $minutes < 0 || $minutes > 59 ) {
			return 9.0; // Default fallback for invalid values
		}

		return $hours + ( $minutes / 60 );
	}

	/**
	 * Calculate offset from timetable start in hours
	 *
	 * @return float Offset in hours
	 */
	public function calculateOffset(): float {
		$offsetHours = $this->startHour - $this->timetableStartHour;

		// If slot start is before timetable start, add 24 hours (next day)
		if ( $offsetHours < 0 ) {
			$offsetHours += 24;
		}

		return $offsetHours;
	}
}
