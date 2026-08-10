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

	/**
	 * Build a minimal Offer array with the given price.
	 *
	 * @param float $price Offer price.
	 * @return array Offer object.
	 */
	private function make_offer( $price ): array {
		return array(
			'@type'         => 'Offer',
			'price'         => (string) $price,
			'priceCurrency' => 'EUR',
			'availability'  => 'https://schema.org/InStock',
			'url'           => 'https://example.com/event',
		);
	}

	/**
	 * An offer set where every offer is priced at zero is free.
	 *
	 * @return void
	 */
	public function test_is_free_offer_set_true_when_all_zero() {
		$offers = array( $this->make_offer( 0 ), $this->make_offer( 0.0 ) );

		$this->assertTrue( EventSchema::is_free_offer_set( $offers ) );
	}

	/**
	 * A mix of zero-priced and priced offers is not free.
	 *
	 * @return void
	 */
	public function test_is_free_offer_set_false_when_mixed() {
		$offers = array( $this->make_offer( 0 ), $this->make_offer( 15 ) );

		$this->assertFalse( EventSchema::is_free_offer_set( $offers ) );
	}

	/**
	 * An offer set with only priced offers is not free.
	 *
	 * @return void
	 */
	public function test_is_free_offer_set_false_when_all_priced() {
		$offers = array( $this->make_offer( 10 ), $this->make_offer( 15 ) );

		$this->assertFalse( EventSchema::is_free_offer_set( $offers ) );
	}

	/**
	 * An empty offer set is not free — it means ticketing isn't configured,
	 * not that the event is free, so it must not claim `isAccessibleForFree`.
	 *
	 * @return void
	 */
	public function test_is_free_offer_set_false_when_empty() {
		$this->assertFalse( EventSchema::is_free_offer_set( array() ) );
	}

	/**
	 * A null neutral location location_to_jsonld()s to the site-name Place backstop.
	 *
	 * @return void
	 */
	public function test_location_to_jsonld_null_neutral_is_site_backstop() {
		$node = EventSchema::location_to_jsonld( null );

		$this->assertSame( 'Place', $node['@type'] );
		$this->assertSame( 'Test Site', $node['name'] );
	}

	/**
	 * In-person mode location_to_jsonld()s to a single Place node.
	 *
	 * @return void
	 */
	public function test_location_to_jsonld_in_person_is_place() {
		$node = EventSchema::location_to_jsonld(
			array(
				'mode'    => 'in_person',
				'name'    => 'Venue Name',
				'address' => '123 Main St',
			)
		);

		$this->assertSame( 'Place', $node['@type'] );
		$this->assertSame( 'Venue Name', $node['name'] );
		$this->assertSame( '123 Main St', $node['address']['name'] );
	}

	/**
	 * Online mode location_to_jsonld()s to a single VirtualLocation node.
	 *
	 * @return void
	 */
	public function test_location_to_jsonld_online_is_virtual_location() {
		$node = EventSchema::location_to_jsonld(
			array(
				'mode'        => 'online',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertSame( 'VirtualLocation', $node['@type'] );
		$this->assertSame( 'https://example.com/meet', $node['url'] );
	}

	/**
	 * Hybrid mode location_to_jsonld()s to an array of both a Place and a
	 * VirtualLocation node — search engines require both entries.
	 *
	 * @return void
	 */
	public function test_location_to_jsonld_hybrid_is_both_nodes() {
		$nodes = EventSchema::location_to_jsonld(
			array(
				'mode'        => 'hybrid',
				'name'        => 'Venue Name',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertCount( 2, $nodes );
		$this->assertSame( 'Place', $nodes[0]['@type'] );
		$this->assertSame( 'Venue Name', $nodes[0]['name'] );
		$this->assertSame( 'VirtualLocation', $nodes[1]['@type'] );
		$this->assertSame( 'https://example.com/meet', $nodes[1]['url'] );
	}

	/**
	 * Hybrid mode with no physical fields falls back to the site-name Place
	 * backstop for the Place side, still alongside the VirtualLocation node.
	 *
	 * @return void
	 */
	public function test_location_to_jsonld_hybrid_with_no_physical_uses_backstop() {
		$nodes = EventSchema::location_to_jsonld(
			array(
				'mode'        => 'hybrid',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertSame( 'Place', $nodes[0]['@type'] );
		$this->assertSame( 'Test Site', $nodes[0]['name'] );
		$this->assertSame( 'VirtualLocation', $nodes[1]['@type'] );
	}

	/**
	 * Build a minimal EventDates fixture with no venue_id (so the optional
	 * Venue model is never touched) and post_id 0 (so get_post_meta(), which
	 * isn't stubbed, is never called).
	 *
	 * @param array $overrides Property overrides.
	 * @return \FairEvents\Models\EventDates Fixture.
	 */
	private function make_event_date_fixture( array $overrides = array() ) {
		$event_date                  = new \FairEvents\Models\EventDates();
		$event_date->id              = 1;
		$event_date->link_type       = 'none';
		$event_date->attendance_mode = 'in_person';

		foreach ( $overrides as $key => $value ) {
			$event_date->$key = $value;
		}

		return $event_date;
	}

	/**
	 * Get_jsonld_location() reports the correct eventAttendanceMode for each
	 * of the three explicit modes, driven end-to-end from an EventDates row.
	 *
	 * @return void
	 */
	public function test_get_jsonld_location_attendance_mode_values() {
		$in_person = EventSchema::get_jsonld_location(
			$this->make_event_date_fixture( array( 'address' => '123 Main St' ) ),
			0
		);
		$this->assertSame( 'https://schema.org/OfflineEventAttendanceMode', $in_person['attendance_mode'] );

		$online = EventSchema::get_jsonld_location(
			$this->make_event_date_fixture(
				array(
					'attendance_mode' => 'online',
					'joining_link'    => 'https://example.com/meet',
				)
			),
			0
		);
		$this->assertSame( 'https://schema.org/OnlineEventAttendanceMode', $online['attendance_mode'] );
		$this->assertSame( 'VirtualLocation', $online['location']['@type'] );

		$hybrid = EventSchema::get_jsonld_location(
			$this->make_event_date_fixture(
				array(
					'attendance_mode' => 'hybrid',
					'address'         => '123 Main St',
					'joining_link'    => 'https://example.com/meet',
				)
			),
			0
		);
		$this->assertSame( 'https://schema.org/MixedEventAttendanceMode', $hybrid['attendance_mode'] );
		$this->assertCount( 2, $hybrid['location'] );
	}

	/**
	 * Build a minimal ticket type stub.
	 *
	 * @param int    $id       Ticket type ID.
	 * @param string $name     Ticket type name.
	 * @param bool   $disabled Whether the type is manually disabled.
	 * @return object Anonymous ticket type object exposing id/name/disabled.
	 */
	private function ticket_type( $id, $name, $disabled = false ) {
		return (object) array(
			'id'       => $id,
			'name'     => $name,
			'disabled' => $disabled,
		);
	}

	/**
	 * Multiple paid types with a resolved price each yield one named offer per
	 * type.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_multiple_paid_types_each_named() {
		$types = array(
			$this->ticket_type( 1, 'Single class' ),
			$this->ticket_type( 2, '3-class pass' ),
		);

		$offers = EventSchema::build_offers_for_types(
			$types,
			array(
				1 => 15.0,
				2 => 40.0,
			),
			array(
				1 => true,
				2 => true,
			),
			null,
			'EUR',
			'https://example.com/event'
		);

		$this->assertCount( 2, $offers );
		$this->assertSame( 'Single class', $offers[0]['name'] );
		$this->assertSame( '15', $offers[0]['price'] );
		$this->assertSame( '3-class pass', $offers[1]['name'] );
		$this->assertSame( '40', $offers[1]['price'] );
	}

	/**
	 * A free type (no price row anywhere) yields a named, zero-priced offer.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_free_type_is_named_and_zero_priced() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'RSVP' ) ),
			array(),
			array(),
			null,
			'EUR',
			'https://example.com/event'
		);

		$this->assertCount( 1, $offers );
		$this->assertSame( 'RSVP', $offers[0]['name'] );
		$this->assertSame( '0', $offers[0]['price'] );
	}

	/**
	 * A paid type with no price in the resolved window, but priced elsewhere
	 * (closed sale), yields no offer for that type.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_closed_sale_paid_type_yields_no_offer() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class' ) ),
			array(),
			array( 1 => true ),
			null,
			'EUR',
			'https://example.com/event'
		);

		$this->assertSame( array(), $offers );
	}

	/**
	 * No ticket types yields an empty array.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_no_types_yields_empty_array() {
		$offers = EventSchema::build_offers_for_types( array(), array(), array(), null, 'EUR', 'https://example.com/event' );

		$this->assertSame( array(), $offers );
	}

	/**
	 * A disabled type is skipped even when priced.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_skips_disabled_type() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class', true ) ),
			array( 1 => 15.0 ),
			array( 1 => true ),
			null,
			'EUR',
			'https://example.com/event'
		);

		$this->assertSame( array(), $offers );
	}

	/**
	 * An upcoming (not yet active) window's validFrom carries through to the
	 * built offer.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_carries_valid_from() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class' ) ),
			array( 1 => 15.0 ),
			array( 1 => true ),
			'2026-09-01T00:00:00+00:00',
			'EUR',
			'https://example.com/event'
		);

		$this->assertSame( '2026-09-01T00:00:00+00:00', $offers[0]['validFrom'] );
	}

	/**
	 * A blank ticket type name is omitted rather than serialized as an empty
	 * string — an empty `name` is itself a structured-data quality issue.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_omits_blank_name() {
		$paid_offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, '' ) ),
			array( 1 => 15.0 ),
			array( 1 => true ),
			null,
			'EUR',
			'https://example.com/event'
		);
		$this->assertArrayNotHasKey( 'name', $paid_offers[0] );

		$free_offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, '' ) ),
			array(),
			array(),
			null,
			'EUR',
			'https://example.com/event'
		);
		$this->assertArrayNotHasKey( 'name', $free_offers[0] );
	}
}
