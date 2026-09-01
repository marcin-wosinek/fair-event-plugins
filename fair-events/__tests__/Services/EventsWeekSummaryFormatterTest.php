<?php
/**
 * EventsWeekSummaryFormatter unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\EventsWeekSummaryFormatter;
use PHPUnit\Framework\TestCase;

/**
 * Tests weekly clipboard summary formatting.
 */
class EventsWeekSummaryFormatterTest extends TestCase {

	/**
	 * Build a minimal occurrence DTO.
	 *
	 * @param string $title   Event title.
	 * @param string $start   Start datetime.
	 * @param string $end     End datetime.
	 * @param bool   $all_day Whether the event is all day.
	 * @param string $url     Event URL.
	 * @return array Occurrence DTO.
	 */
	private function occurrence( $title, $start, $end, $all_day = true, $url = 'https://example.com/event' ) {
		return array(
			'title'   => $title,
			'start'   => $start,
			'end'     => $end,
			'all_day' => $all_day,
			'url'     => $url,
		);
	}

	/**
	 * Format occurrences in a fixed Monday-to-Sunday week.
	 *
	 * @param array[] $occurrences Occurrence DTOs.
	 * @return string Summary.
	 */
	private function format( array $occurrences ) {
		return EventsWeekSummaryFormatter::format(
			$occurrences,
			'2026-08-31 00:00:00',
			'2026-09-06 23:59:59',
			'Events (https://example.com/events)',
			'31 Aug – 6 Sep 2026'
		);
	}

	/** Single-day timed occurrences retain all existing details. */
	public function test_single_day_timed_occurrence_retains_time_title_and_url() {
		$summary = $this->format(
			array( $this->occurrence( 'Workshop', '2026-09-01 18:30:00', '2026-09-01 20:00:00', false ) )
		);

		$this->assertSame( "Events (https://example.com/events), 31 Aug – 6 Sep 2026:\n* Tue, 18:30, Workshop: https://example.com/event", $summary );
	}

	/** Two-day occurrences produce one ranged line. */
	public function test_two_day_occurrence_produces_one_ranged_line() {
		$summary = $this->format(
			array( $this->occurrence( 'Convention', '2026-09-05 00:00:00', '2026-09-06 00:00:00' ) )
		);

		$this->assertSame( 1, substr_count( $summary, '* Sat–Sun, Convention: https://example.com/event' ) );
	}

	/** Longer spans include only their first and last visible weekdays. */
	public function test_long_span_uses_only_first_and_last_weekdays() {
		$summary = $this->format(
			array( $this->occurrence( 'Festival', '2026-09-01 00:00:00', '2026-09-04 00:00:00' ) )
		);

		$this->assertStringContainsString( '* Tue–Fri, Festival', $summary );
		$this->assertStringNotContainsString( 'Wed', $summary );
	}

	/** Identical flat DTOs remain distinct summary entries. */
	public function test_identical_recurring_occurrences_remain_separate() {
		$occurrence = $this->occurrence( 'Class', '2026-09-01 19:00:00', '2026-09-01 20:00:00', false );
		$summary    = $this->format( array( $occurrence, $occurrence ) );

		$this->assertSame( 2, substr_count( $summary, '* Tue, 19:00, Class: https://example.com/event' ) );
	}

	/** Spans are clipped to both selected-week boundaries. */
	public function test_occurrences_are_clipped_at_both_week_boundaries() {
		$summary = $this->format(
			array(
				$this->occurrence( 'Starts earlier', '2026-08-28 00:00:00', '2026-09-01 00:00:00' ),
				$this->occurrence( 'Ends later', '2026-09-05 00:00:00', '2026-09-09 00:00:00' ),
			)
		);

		$this->assertStringContainsString( '* Mon–Tue, Starts earlier', $summary );
		$this->assertStringContainsString( '* Sat–Sun, Ends later', $summary );
	}

	/** Events without URLs retain the existing title-only form. */
	public function test_occurrence_without_url_retains_existing_form() {
		$summary = $this->format(
			array( $this->occurrence( 'No link', '2026-09-02 00:00:00', '2026-09-02 00:00:00', true, '' ) )
		);

		$this->assertStringContainsString( "\n* Wed, No link", $summary );
		$this->assertStringNotContainsString( 'No link:', $summary );
	}

	/** The formatter retains the provider's input order. */
	public function test_input_order_is_retained() {
		$summary = $this->format(
			array(
				$this->occurrence( 'Second by date', '2026-09-03 00:00:00', '2026-09-03 00:00:00' ),
				$this->occurrence( 'First by date', '2026-09-01 00:00:00', '2026-09-01 00:00:00' ),
			)
		);

		$this->assertLessThan( strpos( $summary, 'First by date' ), strpos( $summary, 'Second by date' ) );
	}
}
