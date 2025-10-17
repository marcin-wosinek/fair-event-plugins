<?php
/**
 * HourlyRange class for managing time ranges in PHP
 *
 * This class mirrors the JavaScript HourlyRange functionality,
 * converting HH:mm time strings to decimal hours and providing
 * duration calculations and utility methods.
 *
 * @package FairTimetable
 */

namespace FairTimetable;

/**
 * HourlyRange class for managing time ranges with string input and numeric output
 */
class HourlyRange {
	/**
	 * Start hour as decimal number (e.g., 11.5 for 11:30)
	 *
	 * @var float
	 */
	public float $start_hour;

	/**
	 * End hour as decimal number (e.g., 12.5 for 12:30)
	 *
	 * @var float
	 */
	public float $end_hour;

	/**
	 * Constructor
	 *
	 * @param array $time_range Associative array with startTime and endTime keys
	 *                          - startTime: Start time in HH:mm format (e.g., '11:30')
	 *                          - endTime: End time in HH:mm format (e.g., '12:30')
	 *
	 * @throws \InvalidArgumentException If startTime or endTime is missing or invalid
	 */
	public function __construct( array $time_range ) {
		if ( ! isset( $time_range['startTime'] ) || ! isset( $time_range['endTime'] ) ) {
			throw new \InvalidArgumentException( 'HourlyRange requires both startTime and endTime' );
		}

		$start_time = $time_range['startTime'];
		$end_time   = $time_range['endTime'];

		if ( empty( $start_time ) || empty( $end_time ) ) {
			throw new \InvalidArgumentException( 'HourlyRange requires both startTime and endTime to be non-empty' );
		}

		// Parse to decimal hours
		$this->start_hour = $this->parse_time( $start_time );
		$this->end_hour   = $this->parse_time( $end_time );
	}

	/**
	 * Parse time string to decimal hours
	 *
	 * @param string $time_string Time in HH:mm format
	 *
	 * @return float Time as decimal hours (e.g., "11:30" becomes 11.5)
	 *
	 * @throws \InvalidArgumentException If time string format is invalid
	 */
	private function parse_time( string $time_string ): float {
		if ( ! preg_match( '/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/', $time_string, $matches ) ) {
			$safe_time = function_exists( 'esc_html' ) ? esc_html( $time_string ) : htmlspecialchars( $time_string, ENT_QUOTES, 'UTF-8' );
			throw new \InvalidArgumentException( 'Invalid time format: ' . $safe_time . '. Expected HH:mm format.' );
		}

		$hours   = (int) $matches[1];
		$minutes = (int) $matches[2];

		return $hours + ( $minutes / 60 );
	}

	/**
	 * Format decimal hours to time string
	 *
	 * @param float $decimal_hours Hours in decimal format (e.g., 11.5)
	 *
	 * @return string Time in HH:mm format (e.g., "11:30")
	 */
	private function format_time( float $decimal_hours ): string {
		if ( $decimal_hours < 0 ) {
			return '00:00';
		}

		$hours   = (int) floor( $decimal_hours ) % 24; // Handle overflow past 24h
		$minutes = (int) round( ( $decimal_hours - floor( $decimal_hours ) ) * 60 );

		return sprintf( '%02d:%02d', $hours, $minutes );
	}

	/**
	 * Get duration in hours
	 *
	 * @return float Duration in decimal hours
	 */
	public function get_duration(): float {
		$duration = $this->end_hour - $this->start_hour;

		// Handle negative duration (next day scenario)
		if ( $duration < 0 ) {
			$duration += 24;
		}

		return $duration;
	}



	/**
	 * Get formatted time range string
	 *
	 * @return string Time range in "HH:mm—HH:mm" format
	 */
	public function get_time_range_string(): string {
		return $this->format_time( $this->start_hour ) . '—' . $this->format_time( $this->end_hour );
	}
}
