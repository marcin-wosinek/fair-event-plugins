<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\PageMetadataParser.
 *
 * Lives in fair-events/__tests__/ per TESTING.md — this plugin already has
 * phpunit.xml, a stub bootstrap, and `npm run test:php` wired into CI, and it
 * tests exactly the vendored copy that ships in this plugin's build.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\PageMetadataParser;

/**
 * Tests schema.org / OpenGraph / title extraction and the site-local date
 * conversion, purely against fixture HTML strings (no network).
 */
class PageMetadataParserTest extends TestCase {

	/**
	 * Reset the stubbed site timezone before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'UTC';
	}

	/**
	 * A schema.org Event with a full datetime start/end wins over OpenGraph
	 * and <title>, and dates convert to site-local 'Y-m-d H:i:s'.
	 *
	 * @return void
	 */
	public function test_parses_schema_event_with_datetime() {
		$html = '<html><head>
			<title>Fallback Title</title>
			<meta property="og:title" content="OG Title">
			<script type="application/ld+json">
			{
				"@context": "https://schema.org",
				"@type": "Event",
				"name": "Community Picnic",
				"startDate": "2026-09-12T18:00:00+00:00",
				"endDate": "2026-09-12T20:00:00+00:00",
				"location": { "@type": "Place", "name": "Central Park" }
			}
			</script>
		</head><body></body></html>';

		$result = PageMetadataParser::parse( $html );

		$this->assertSame( 'Community Picnic', $result['title'] );
		$this->assertSame( '2026-09-12 18:00:00', $result['start_datetime'] );
		$this->assertSame( '2026-09-12 20:00:00', $result['end_datetime'] );
		$this->assertFalse( $result['all_day'] );
		$this->assertSame( 'Central Park', $result['location'] );
		$this->assertSame( 'schema', $result['source'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );
	}

	/**
	 * A date-only schema.org startDate (no time component) is treated as all-day.
	 *
	 * @return void
	 */
	public function test_date_only_schema_start_is_all_day() {
		$html = '<script type="application/ld+json">
			{ "@type": "Event", "name": "All Day Fair", "startDate": "2026-09-12" }
		</script>';

		$result = PageMetadataParser::parse( $html );

		$this->assertSame( '2026-09-12 00:00:00', $result['start_datetime'] );
		$this->assertTrue( $result['all_day'] );
	}

	/**
	 * With no schema.org markup, Open Graph title is used and marked as the source.
	 *
	 * @return void
	 */
	public function test_falls_back_to_open_graph_title() {
		$html = '<html><head>
			<title>Fallback Title</title>
			<meta property="og:title" content="OG Only Title">
		</head></html>';

		$result = PageMetadataParser::parse( $html );

		$this->assertSame( 'OG Only Title', $result['title'] );
		$this->assertSame( 'opengraph', $result['source'] );
		$this->assertNull( $result['start_datetime'] );
		$this->assertSame( array( 'title' ), $result['found'] );
	}

	/**
	 * With no schema.org or Open Graph markup, the <title> tag is used.
	 *
	 * @return void
	 */
	public function test_falls_back_to_title_tag() {
		$html = '<html><head><title>Just A Title</title></head></html>';

		$result = PageMetadataParser::parse( $html );

		$this->assertSame( 'Just A Title', $result['title'] );
		$this->assertSame( 'title', $result['source'] );
	}

	/**
	 * Malformed JSON-LD is skipped without fataling, still falling through to title.
	 *
	 * @return void
	 */
	public function test_malformed_json_ld_falls_through() {
		$html = '<html><head>
			<title>Recovered Title</title>
			<script type="application/ld+json">{ not valid json </script>
		</head></html>';

		$result = PageMetadataParser::parse( $html );

		$this->assertSame( 'Recovered Title', $result['title'] );
		$this->assertSame( 'title', $result['source'] );
	}

	/**
	 * A page with no usable data anywhere yields an entirely empty result.
	 *
	 * @return void
	 */
	public function test_no_usable_data_yields_empty_result() {
		$html = '<html><head></head><body><p>Nothing here.</p></body></html>';

		$result = PageMetadataParser::parse( $html );

		$this->assertNull( $result['title'] );
		$this->assertNull( $result['source'] );
		$this->assertSame( array(), $result['found'] );
	}
}
