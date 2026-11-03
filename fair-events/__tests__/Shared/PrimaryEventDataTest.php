<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\PrimaryEventData.
 *
 * Lives in fair-events/__tests__/ per TESTING.md — this plugin tests exactly
 * the vendored copy that ships in its build.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\PageMetadataParser;
use FairEventsShared\Helpers\PrimaryEventData;

/**
 * Tests primary-event selection, session ambiguity, and timezone handling
 * against fixture HTML (no network).
 */
class PrimaryEventDataTest extends TestCase {

	const OONA_URL = 'https://oona.es/evento/emuna-yoga-expande-martes-y-jueves-4d79e226';

	/**
	 * Reset the stubbed site timezone before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'UTC';
	}

	/**
	 * Run the parser and the primary-event pass, as lookup_url() does.
	 *
	 * @param string $html Page HTML.
	 * @param string $url  Page URL.
	 * @return array Metadata.
	 */
	private function lookup( $html, $url = 'https://example.com/event' ) {
		return PrimaryEventData::apply( $url, $html, PageMetadataParser::parse( $html ) );
	}

	/**
	 * Wrap JSON-LD values in a page.
	 *
	 * @param array  $blocks JSON-LD blocks.
	 * @param string $head   Extra head markup.
	 * @return string HTML.
	 */
	private function page( $blocks, $head = '' ) {
		$html = '<html><head>' . $head;
		foreach ( $blocks as $block ) {
			$html .= '<script type="application/ld+json">' . wp_json_encode( $block ) . '</script>';
		}
		return $html . '</head><body></body></html>';
	}

	/**
	 * The captured Oona page converts its UTC interval to Madrid time.
	 *
	 * @return void
	 */
	public function test_oona_page_prefills_site_local_details() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
		$html                           = file_get_contents( dirname( __DIR__ ) . '/fixtures/oona/event-page.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.

		$result = $this->lookup( $html, self::OONA_URL );

		$this->assertSame( 'Emuná Yoga Expande - Todos los Lunes', $result['title'] );
		$this->assertSame( '2026-11-02', $result['start_date'] );
		$this->assertSame( '08:45:00', $result['start_time'] );
		$this->assertSame( '2026-11-02', $result['end_date'] );
		$this->assertSame( '10:00:00', $result['end_time'] );
		$this->assertSame( '2026-11-02 08:45:00', $result['start_datetime'] );
		$this->assertFalse( $result['all_day'] );
		$this->assertSame( 'Valencia, España', $result['location'] );
		$this->assertFalse( $result['timing_ambiguous'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );
	}

	/**
	 * An event matching the page URL wins over an unrelated recommendation
	 * listed first.
	 *
	 * @return void
	 */
	public function test_prefers_event_matching_page_url_over_recommendation() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Other Workshop',
					'url'       => 'https://example.com/other',
					'startDate' => '2026-12-01T10:00:00Z',
					'location'  => array( 'name' => 'Elsewhere' ),
				),
				array(
					'@type'     => 'Event',
					'name'      => 'This Event',
					'url'       => 'https://www.example.com/event/',
					'startDate' => '2026-11-20T18:00:00Z',
				),
			)
		);

		$result = $this->lookup( $html, 'https://example.com/event?utm_source=x' );

		$this->assertSame( 'This Event', $result['title'] );
		$this->assertSame( '2026-11-20', $result['start_date'] );
		$this->assertNull( $result['location'] );
	}

	/**
	 * Events nested elsewhere in the page (here under `subjectOf`) are never
	 * selected; without any page-level Event the parser's output stands.
	 *
	 * @return void
	 */
	public function test_ignores_events_nested_outside_main_entity() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Organization',
					'name'      => 'Studio',
					'subjectOf' => array(
						'@type'     => 'Event',
						'name'      => 'Recommended Class',
						'startDate' => '2026-12-01T10:00:00Z',
					),
				),
			),
			'<title>Studio page</title>'
		);

		$result = $this->lookup( $html );

		$this->assertSame( 'Studio page', $result['title'] );
		$this->assertNull( $result['start_date'] );
		$this->assertFalse( $result['timing_ambiguous'] );
	}

	/**
	 * Several distinct main-entity sessions keep title and location but leave
	 * the timing empty — never the earliest start to the latest end.
	 *
	 * @return void
	 */
	public function test_several_main_entity_sessions_leave_timing_empty() {
		$session = function ( $day ) {
			return array(
				'@type'     => 'Event',
				'name'      => 'Yoga Course',
				'startDate' => "2026-11-{$day}T09:00:00Z",
				'endDate'   => "2026-11-{$day}T10:00:00Z",
				'location'  => array( 'name' => 'Park' ),
			);
		};

		$html = $this->page(
			array(
				array(
					'@type'      => 'WebPage',
					'mainEntity' => array( $session( '03' ), $session( '05' ) ),
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertSame( 'Yoga Course', $result['title'] );
		$this->assertSame( 'Park', $result['location'] );
		$this->assertTrue( $result['timing_ambiguous'] );
		$this->assertNull( $result['start_date'] );
		$this->assertNull( $result['end_date'] );
		$this->assertNull( $result['start_datetime'] );
		$this->assertSame( array( 'title', 'location' ), $result['found'] );
	}

	/**
	 * An event with several sub-events is ambiguous even though the parent
	 * publishes its own overall span.
	 *
	 * @return void
	 */
	public function test_sub_events_leave_timing_empty() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Weekend Course',
					'startDate' => '2026-11-07T09:00:00Z',
					'endDate'   => '2026-11-08T13:00:00Z',
					'subEvent'  => array(
						array(
							'@type'     => 'Event',
							'startDate' => '2026-11-07T09:00:00Z',
						),
						array(
							'@type'     => 'Event',
							'startDate' => '2026-11-08T09:00:00Z',
						),
					),
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertTrue( $result['timing_ambiguous'] );
		$this->assertNull( $result['start_date'] );
		$this->assertNull( $result['end_datetime'] );
	}

	/**
	 * The same event declared twice (graph node and main entity) is one
	 * occurrence, not two sessions.
	 *
	 * @return void
	 */
	public function test_duplicate_declarations_are_not_ambiguous() {
		$event = array(
			'@type'     => 'Event',
			'@id'       => 'https://example.com/event#event',
			'name'      => 'Talk',
			'startDate' => '2026-11-10T17:00:00Z',
		);

		$html = $this->page(
			array(
				array(
					'@graph' => array(
						array(
							'@type'      => 'WebPage',
							'mainEntity' => array( '@id' => 'https://example.com/event#event' ),
						),
						$event,
					),
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertFalse( $result['timing_ambiguous'] );
		$this->assertSame( '17:00:00', $result['start_time'] );
	}

	/**
	 * A recurring-sounding title alone still imports the published interval.
	 *
	 * @return void
	 */
	public function test_recurring_title_keeps_single_occurrence() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Yoga - Every Monday',
					'startDate' => '2026-11-09T07:45:00+00:00',
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertFalse( $result['timing_ambiguous'] );
		$this->assertSame( '2026-11-09', $result['start_date'] );
	}

	/**
	 * Offsets convert to site time across DST and past midnight.
	 *
	 * @return void
	 */
	public function test_converts_offsets_across_dst_and_midnight() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Late Show',
					// Summer time (+02:00): 22:30 UTC is 00:30 the next day.
					'startDate' => '2026-07-10T22:30:00Z',
					'endDate'   => '2026-07-11T01:00:00-01:00',
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertSame( '2026-07-11', $result['start_date'] );
		$this->assertSame( '00:30:00', $result['start_time'] );
		$this->assertSame( '2026-07-11', $result['end_date'] );
		$this->assertSame( '04:00:00', $result['end_time'] );
	}

	/**
	 * A datetime without an offset has no known timezone and is not guessed.
	 *
	 * @return void
	 */
	public function test_rejects_offsetless_datetimes() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Floating',
					'startDate' => '2026-11-10T17:00:00',
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertNull( $result['start_date'] );
		$this->assertNull( $result['start_time'] );
		$this->assertSame( array( 'title' ), $result['found'] );
	}

	/**
	 * Date-only values stay as written; a missing end stays missing.
	 *
	 * @return void
	 */
	public function test_keeps_date_only_value_without_inventing_an_end() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Fair',
					'startDate' => '2026-11-14',
				),
			)
		);

		$result = $this->lookup( $html );

		$this->assertTrue( $result['all_day'] );
		$this->assertSame( '2026-11-14', $result['start_date'] );
		$this->assertNull( $result['start_time'] );
		$this->assertNull( $result['end_date'] );
		$this->assertNull( $result['end_time'] );
	}

	/**
	 * Invalid dates are rejected and an end before the start is dropped.
	 *
	 * @return void
	 */
	public function test_rejects_invalid_dates_and_inconsistent_intervals() {
		$invalid = $this->lookup(
			$this->page(
				array(
					array(
						'@type'     => 'Event',
						'name'      => 'Bad Date',
						'startDate' => '2026-02-30T10:00:00Z',
					),
				)
			)
		);
		$this->assertNull( $invalid['start_date'] );

		$backwards = $this->lookup(
			$this->page(
				array(
					array(
						'@type'     => 'Event',
						'name'      => 'Backwards',
						'startDate' => '2026-11-10T18:00:00Z',
						'endDate'   => '2026-11-10T17:00:00Z',
					),
				)
			)
		);
		$this->assertSame( '18:00:00', $backwards['start_time'] );
		$this->assertNull( $backwards['end_date'] );
		$this->assertNull( $backwards['end_time'] );
		$this->assertSame( array( 'title', 'start' ), $backwards['found'] );
	}

	/**
	 * A primary event without a name falls back to the page's own title, not
	 * another event's.
	 *
	 * @return void
	 */
	public function test_nameless_primary_event_uses_page_title() {
		$html = $this->page(
			array(
				array(
					'@type'     => 'Event',
					'name'      => 'Unrelated',
					'startDate' => '2026-12-01T10:00:00Z',
				),
				array(
					'@type'      => 'WebPage',
					'mainEntity' => array(
						'@type'     => 'Event',
						'startDate' => '2026-11-10T17:00:00Z',
					),
				),
			),
			'<title>The Page</title>'
		);

		$result = $this->lookup( $html );

		$this->assertSame( 'The Page', $result['title'] );
		$this->assertSame( '2026-11-10', $result['start_date'] );
	}

	/**
	 * Pages without JSON-LD events are returned unchanged.
	 *
	 * @return void
	 */
	public function test_pages_without_events_are_unchanged() {
		$html     = '<html><head><meta property="og:title" content="OG Only"></head></html>';
		$metadata = PageMetadataParser::parse( $html );

		$result = PrimaryEventData::apply( 'https://example.com/', $html, $metadata );

		$this->assertSame( 'OG Only', $result['title'] );
		$this->assertSame( 'opengraph', $result['source'] );
		$this->assertFalse( $result['timing_ambiguous'] );
	}
}
