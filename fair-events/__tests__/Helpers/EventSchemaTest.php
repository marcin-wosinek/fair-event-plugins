<?php
/**
 * Tests for EventSchema::item_list_from_occurrences() behaviour.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventSchema;

/**
 * Unit tests for building a Schema.org ItemList from occurrence DTOs.
 *
 * These tests exercise external (ical/api) DTOs only, since the
 * post/standalone `location` merge calls EventDates::get_by_id() (a real DB
 * call) — that path is covered by the WP-CLI manual check instead.
 */
class EventSchemaTest extends TestCase {

	/**
	 * Build a minimal external occurrence DTO.
	 *
	 * @param array $overrides Property overrides.
	 * @return array Occurrence DTO.
	 */
	private function make_dto( array $overrides = array() ): array {
		return array_merge(
			array(
				'uid'             => 'ical-1@example.com',
				'event_date_id'   => null,
				'event_id'        => null,
				'occurrence_type' => 'external',
				'title'           => 'Test Event',
				'description'     => 'A test description',
				'start'           => '2026-07-15 10:00:00',
				'end'             => '2026-07-15 12:00:00',
				'all_day'         => false,
				'url'             => 'https://example.com/event',
				'categories'      => array(),
				'source'          => 'ical',
				'is_draft'        => false,
				'source_color'    => '#4caf50',
			),
			$overrides
		);
	}

	/**
	 * An empty occurrence list yields no ItemList.
	 *
	 * @return void
	 */
	public function test_empty_input_returns_null() {
		$this->assertNull( EventSchema::item_list_from_occurrences( array() ) );
	}

	/**
	 * A single occurrence yields an ItemList with exactly one ListItem.
	 *
	 * @return void
	 */
	public function test_single_dto_yields_one_list_item() {
		$item_list = EventSchema::item_list_from_occurrences( array( $this->make_dto() ) );

		$this->assertNotNull( $item_list );
		$this->assertSame( 'https://schema.org', $item_list['@context'] );
		$this->assertSame( 'ItemList', $item_list['@type'] );
		$this->assertCount( 1, $item_list['itemListElement'] );
		$this->assertSame( 1, $item_list['itemListElement'][0]['position'] );
	}

	/**
	 * Multiple occurrences get sequential 1..n positions.
	 *
	 * @return void
	 */
	public function test_assigns_sequential_positions() {
		$occurrences = array(
			$this->make_dto( array( 'uid' => 'a' ) ),
			$this->make_dto( array( 'uid' => 'b' ) ),
			$this->make_dto( array( 'uid' => 'c' ) ),
		);

		$item_list = EventSchema::item_list_from_occurrences( $occurrences );

		$positions = array_column( $item_list['itemListElement'], 'position' );
		$this->assertSame( array( 1, 2, 3 ), $positions );
	}

	/**
	 * External (ical/api) DTOs become thin Events: no `location`, since
	 * there is no EventDates row to derive it from.
	 *
	 * @return void
	 */
	public function test_external_dtos_are_thin_items() {
		$item_list = EventSchema::item_list_from_occurrences( array( $this->make_dto() ) );

		$event = $item_list['itemListElement'][0]['item'];

		$this->assertSame( 'Event', $event['@type'] );
		$this->assertSame( 'Test Event', $event['name'] );
		$this->assertSame( 'https://example.com/event', $event['url'] );
		$this->assertArrayHasKey( 'startDate', $event );
		$this->assertArrayHasKey( 'endDate', $event );
		$this->assertArrayHasKey( 'description', $event );
		$this->assertArrayNotHasKey( 'location', $event );
		$this->assertArrayNotHasKey( 'offers', $event );
		$this->assertArrayNotHasKey( 'organizer', $event );
		$this->assertArrayNotHasKey( 'eventStatus', $event );
	}

	/**
	 * StartDate/endDate carry the site's local offset, not a hardcoded UTC one.
	 *
	 * @return void
	 */
	public function test_dates_use_site_local_offset() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$item_list = EventSchema::item_list_from_occurrences( array( $this->make_dto() ) );
		$event     = $item_list['itemListElement'][0]['item'];

		unset( $GLOBALS['_fair_test_timezone'] );

		$this->assertStringEndsWith( '+02:00', $event['startDate'] );
		$this->assertStringEndsWith( '+02:00', $event['endDate'] );
	}

	/**
	 * A DTO with no start is dropped rather than producing a half-valid Event.
	 *
	 * @return void
	 */
	public function test_dto_without_start_is_dropped() {
		$occurrences = array(
			$this->make_dto( array( 'uid' => 'a' ) ),
			$this->make_dto(
				array(
					'uid'   => 'b',
					'start' => '',
				)
			),
		);

		$item_list = EventSchema::item_list_from_occurrences( $occurrences );

		$this->assertCount( 1, $item_list['itemListElement'] );
	}
}
