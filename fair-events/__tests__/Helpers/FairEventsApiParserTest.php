<?php
/**
 * Tests for FairEventsApiParser's timing on feed import.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\FairEventsApiParser;

/**
 * A Fair Events feed's dates and optional times survive import: supplied
 * times are converted to site-local time, missing times stay missing and
 * dates without a time never shift through a timezone conversion.
 */
class FairEventsApiParserTest extends TestCase {

	/**
	 * Reset the timezone stub after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );

		parent::tearDown();
	}

	/**
	 * Parse feed events one by one, as fetch_and_parse() does after its
	 * request.
	 *
	 * @param array[] $events Feed events.
	 * @return array Parsed events.
	 */
	private function parse( array $events ) {
		$parse_event = new \ReflectionMethod( FairEventsApiParser::class, 'parse_event' );

		return array_map(
			static function ( $event ) use ( $parse_event ) {
				return $parse_event->invoke( null, $event );
			},
			$events
		);
	}

	/**
	 * A feed event in the source site's timezone (Europe/Madrid).
	 *
	 * @param array $overrides Field overrides.
	 * @return array Feed event.
	 */
	private function feed_event( array $overrides ) {
		return array_merge(
			array(
				'uid'     => 'e1',
				'title'   => 'Remote',
				'all_day' => false,
			),
			$overrides
		);
	}

	/**
	 * A start-only event keeps its converted start and no end time.
	 *
	 * @return void
	 */
	public function test_start_only_event_keeps_missing_end_time() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$events = $this->parse(
			array(
				$this->feed_event(
					array(
						'start'      => '2026-07-15T10:00:00+02:00',
						'end'        => '2026-07-15T10:00:00+02:00',
						'start_date' => '2026-07-15',
						'end_date'   => '2026-07-15',
						'start_time' => '10:00:00',
						'end_time'   => null,
					)
				),
			)
		);

		$this->assertSame(
			array(
				'start_date' => '2026-07-15',
				'end_date'   => '2026-07-15',
				'start_time' => '04:00:00',
				'end_time'   => null,
				'all_day'    => false,
			),
			$events[0]['timing']
		);
	}

	/**
	 * An event without times keeps its dates as written, even where the
	 * feed's midnight `start` would land on the previous day here.
	 *
	 * @return void
	 */
	public function test_event_without_times_does_not_shift_its_dates() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$events = $this->parse(
			array(
				$this->feed_event(
					array(
						'start'      => '2026-07-15T00:00:00+02:00',
						'end'        => '2026-07-16T23:59:59+02:00',
						'start_date' => '2026-07-15',
						'end_date'   => '2026-07-16',
						'start_time' => null,
						'end_time'   => null,
					)
				),
			)
		);

		$this->assertSame(
			array(
				'start_date' => '2026-07-15',
				'end_date'   => '2026-07-16',
				'start_time' => null,
				'end_time'   => null,
				'all_day'    => false,
			),
			$events[0]['timing']
		);
		$this->assertSame( '2026-07-15', substr( $events[0]['start'], 0, 10 ) );
	}

	/**
	 * A feed without the canonical fields is read from its datetimes, as
	 * before.
	 *
	 * @return void
	 */
	public function test_feed_without_dates_falls_back_to_datetimes() {
		$events = $this->parse(
			array(
				$this->feed_event(
					array(
						'start' => '2026-07-15T10:00:00+00:00',
						'end'   => '2026-07-15T12:00:00+00:00',
					)
				),
			)
		);

		$this->assertArrayNotHasKey( 'timing', $events[0] );
		$this->assertSame( '2026-07-15 10:00:00', $events[0]['start'] );
		$this->assertSame( '2026-07-15 12:00:00', $events[0]['end'] );
	}
}
