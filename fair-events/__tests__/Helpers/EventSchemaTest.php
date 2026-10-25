<?php
/**
 * Tests for EventSchema::item_list_from_occurrences() behaviour.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventSchema;
use FairEvents\Services\TicketAvailability;

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
	 * Canonical timing.
	 *
	 * @param string      $start_date Start date.
	 * @param string      $end_date   End date.
	 * @param string|null $start_time Start time.
	 * @param string|null $end_time   End time.
	 * @param bool        $all_day    All-day flag.
	 * @return array
	 */
	private function timing( $start_date, $end_date, $start_time, $end_time, $all_day = false ): array {
		return array(
			'start_date' => $start_date,
			'end_date'   => $end_date,
			'start_time' => $start_time,
			'end_time'   => $end_time,
			'all_day'    => $all_day,
		);
	}

	/**
	 * A supplied time becomes a datetime with the site offset; a missing
	 * time becomes a bare date, never midnight. A single-day event without
	 * an end time has no end.
	 *
	 * @return void
	 */
	public function test_timing_to_dates_never_invents_a_time() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$both       = EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-15', '10:00:00', '12:00:00' ) );
		$start_only = EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-15', '10:00:00', null ) );
		$end_only   = EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-15', null, '12:00:00' ) );
		$neither    = EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-15', null, null ) );
		$midnight   = EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-16', '00:00:00', '00:00:00' ) );

		unset( $GLOBALS['_fair_test_timezone'] );

		$this->assertSame(
			array(
				'start' => '2026-07-15T10:00:00+02:00',
				'end'   => '2026-07-15T12:00:00+02:00',
			),
			$both
		);
		$this->assertSame( array( 'start' => '2026-07-15T10:00:00+02:00' ), $start_only );
		$this->assertSame(
			array(
				'start' => '2026-07-15',
				'end'   => '2026-07-15T12:00:00+02:00',
			),
			$end_only
		);
		$this->assertSame( array( 'start' => '2026-07-15' ), $neither );
		$this->assertSame(
			array(
				'start' => '2026-07-15T00:00:00+02:00',
				'end'   => '2026-07-16T00:00:00+02:00',
			),
			$midnight
		);
	}

	/**
	 * All-day and multi-day events without times use dates at both ends.
	 *
	 * @return void
	 */
	public function test_timing_to_dates_all_day_and_multi_day() {
		$this->assertSame(
			array(
				'start' => '2026-07-15',
				'end'   => '2026-07-15',
			),
			EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-15', null, null, true ) )
		);
		$this->assertSame(
			array(
				'start' => '2026-07-15',
				'end'   => '2026-07-17',
			),
			EventSchema::timing_to_dates( $this->timing( '2026-07-15', '2026-07-17', null, null ) )
		);
		$this->assertNull( EventSchema::timing_to_dates( \FairEvents\Helpers\EventTiming::undated() ) );
	}

	/**
	 * A DTO's canonical timing wins over its legacy start/end strings.
	 *
	 * @return void
	 */
	public function test_dto_timing_gives_date_only_values() {
		$dto = $this->make_dto(
			array(
				'start'  => '2026-07-15 00:00:00',
				'end'    => '2026-07-15 00:00:00',
				'timing' => $this->timing( '2026-07-15', '2026-07-15', null, null ),
			)
		);

		$event = EventSchema::occurrence_to_jsonld( $dto );

		$this->assertSame( '2026-07-15', $event['startDate'] );
		$this->assertArrayNotHasKey( 'endDate', $event );
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
	 * @param int         $id         Ticket type ID.
	 * @param string      $name       Ticket type name.
	 * @param bool        $disabled   Whether the type is manually disabled.
	 * @param string|null $disable_at Scheduled disable datetime, or null.
	 * @return object Anonymous ticket type object exposing id/name/disabled/disable_at.
	 */
	private function ticket_type( $id, $name, $disabled = false, $disable_at = null ) {
		return (object) array(
			'id'         => $id,
			'name'       => $name,
			'disabled'   => $disabled,
			'disable_at' => $disable_at,
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
	 * An explicit zero-priced row yields a named, zero-priced offer — the
	 * only way a type is advertised as free (issue #1624).
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_explicit_zero_row_is_named_and_zero_priced() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'RSVP' ) ),
			array( 1 => 0.0 ),
			null,
			'EUR',
			'https://example.com/event'
		);

		$this->assertCount( 1, $offers );
		$this->assertSame( 'RSVP', $offers[0]['name'] );
		$this->assertSame( '0', $offers[0]['price'] );
	}

	/**
	 * A type with no explicit price row for the resolved window is
	 * unavailable, not free — it yields no offer, whether or not it's priced
	 * in some other period.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_no_row_in_window_yields_no_offer() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class' ) ),
			array(),
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
		$offers = EventSchema::build_offers_for_types( array(), array(), null, 'EUR', 'https://example.com/event' );

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
			'2026-09-01T00:00:00+00:00',
			'EUR',
			'https://example.com/event'
		);

		$this->assertSame( '2026-09-01T00:00:00+00:00', $offers[0]['validFrom'] );
	}

	/**
	 * A scheduled disable boundary already reached keeps a paid type out of
	 * structured data, just like manual disabling — the existing
	 * inconsistency issue #1581 fixes: build_offers_for_types() previously
	 * checked only `disabled`, never `disable_at`.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_skips_type_past_disable_at() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class', false, '2026-01-01 12:00:00' ) ),
			array( 1 => 15.0 ),
			null,
			'EUR',
			'https://example.com/event',
			'2026-01-01 12:00:00'
		);

		$this->assertSame( array(), $offers );
	}

	/**
	 * A scheduled disable boundary still in the future keeps the type in
	 * structured data.
	 *
	 * @return void
	 */
	public function test_build_offers_for_types_keeps_type_before_disable_at() {
		$offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, 'Single class', false, '2026-01-01 12:00:01' ) ),
			array( 1 => 15.0 ),
			null,
			'EUR',
			'https://example.com/event',
			'2026-01-01 12:00:00'
		);

		$this->assertCount( 1, $offers );
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
			null,
			'EUR',
			'https://example.com/event'
		);
		$this->assertArrayNotHasKey( 'name', $paid_offers[0] );

		$free_offers = EventSchema::build_offers_for_types(
			array( $this->ticket_type( 1, '' ) ),
			array( 1 => 0.0 ),
			null,
			'EUR',
			'https://example.com/event'
		);
		$this->assertArrayNotHasKey( 'name', $free_offers[0] );
	}

	/**
	 * Build a sale period stub for offer-window selection.
	 *
	 * @param int         $id         Period ID.
	 * @param string|null $sale_start Sale start datetime.
	 * @param string|null $sale_end   Sale end datetime.
	 * @return object Period stub.
	 */
	private function sale_period( $id, $sale_start, $sale_end ) {
		return (object) array(
			'id'         => $id,
			'sale_start' => $sale_start,
			'sale_end'   => $sale_end,
		);
	}

	/**
	 * Select the offer period from raw periods, resolved like
	 * get_jsonld_offers() does.
	 *
	 * @param object[] $periods       Raw sale periods.
	 * @param string   $now           Current site datetime.
	 * @param string   $default_start Default first-period start.
	 * @return object|null Selected period.
	 */
	private function offer_period( array $periods, $now, $default_start = '2026-03-10 00:00:00' ) {
		return EventSchema::select_offer_period(
			TicketAvailability::resolve_periods( $periods, $now, null, $default_start ),
			$now
		);
	}

	/**
	 * An active period with an explicit start is selected with that start,
	 * which becomes validFrom (issue #1841).
	 */
	public function test_select_offer_period_active_explicit_start() {
		$selected = $this->offer_period(
			array( $this->sale_period( 1, '2026-04-01 00:00:00', '2026-06-01 00:00:00' ) ),
			'2026-05-20 09:00:00'
		);

		$this->assertSame( 1, $selected->id );
		$this->assertSame( '2026-04-01 00:00:00', $selected->sale_start );
	}

	/**
	 * Before sales open, the upcoming period keeps its explicit future start.
	 */
	public function test_select_offer_period_future_explicit_start() {
		$selected = $this->offer_period(
			array( $this->sale_period( 1, '2026-07-01 00:00:00', '2026-08-01 00:00:00' ) ),
			'2026-05-20 09:00:00'
		);

		$this->assertSame( '2026-07-01 00:00:00', $selected->sale_start );
	}

	/**
	 * An empty first start uses the same inferred start as the price display.
	 */
	public function test_select_offer_period_empty_first_start_uses_default_start() {
		$selected = $this->offer_period(
			array( $this->sale_period( 1, null, '2026-06-01 00:00:00' ) ),
			'2026-05-20 09:00:00'
		);

		$this->assertSame( '2026-03-10 00:00:00', $selected->sale_start );
	}

	/**
	 * A paid window that has closed is not selected, so no offer is emitted;
	 * neither is anything without a sale period.
	 */
	public function test_select_offer_period_none_when_closed_or_unconfigured() {
		$this->assertNull(
			$this->offer_period(
				array( $this->sale_period( 1, null, '2026-04-01 00:00:00' ) ),
				'2026-05-20 09:00:00'
			)
		);
		$this->assertNull( $this->offer_period( array(), '2026-05-20 09:00:00' ) );
	}

	/**
	 * The selected start reaches every emitted offer as validFrom, with the
	 * site's offset.
	 */
	public function test_valid_from_of_inferred_start_reaches_offers() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		try {
			$offers = EventSchema::build_offers_for_types(
				array(
					(object) array(
						'id'   => 1,
						'name' => 'General',
					),
				),
				array( 1 => 15.0 ),
				\FairEvents\Helpers\DateHelper::local_to_iso8601( '2026-03-10 00:00:00' ),
				'EUR',
				'https://example.com/event',
				'2026-05-20 09:00:00'
			);

			$this->assertSame( '2026-03-10T00:00:00+01:00', $offers[0]['validFrom'] );
		} finally {
			unset( $GLOBALS['_fair_test_timezone'] );
		}
	}

	/**
	 * Build a ticket type stub with an extension rule.
	 *
	 * @param int      $id       Ticket type ID.
	 * @param int      $minimum  Minimum extensions.
	 * @param int|null $maximum  Maximum extensions, or null for no limit.
	 * @param bool     $enabled  Whether extension selection is enabled.
	 * @param string   $scope    Recurrence scope.
	 * @return object Ticket type stub.
	 */
	private function extension_type( $id, $minimum, $maximum = null, $enabled = true, $scope = 'single_instance' ) {
		return (object) array(
			'id'                 => $id,
			'name'               => 'Type ' . $id,
			'disabled'           => false,
			'disable_at'         => null,
			'activities_enabled' => $enabled,
			'recurrence_scope'   => $scope,
			'minimum_activities' => $minimum,
			'maximum_activities' => $maximum,
		);
	}

	/**
	 * Required paid extensions add the cheapest required ones; free
	 * extensions contribute zero.
	 */
	public function test_cheapest_extension_selection_cost_sums_cheapest_required() {
		$this->assertSame( 0.0, EventSchema::cheapest_extension_selection_cost( array( 12.0, 0.0, 5.0 ), 1, null ) );
		$this->assertSame( 5.0, EventSchema::cheapest_extension_selection_cost( array( 12.0, 0.0, 5.0 ), 2, null ) );
		$this->assertSame( 13.5, EventSchema::cheapest_extension_selection_cost( array( 12.0, 5.5, 8.0 ), 2, 3 ) );
	}

	/**
	 * Too few selectable extensions, or a maximum below the minimum, cannot
	 * satisfy the requirement.
	 */
	public function test_cheapest_extension_selection_cost_unsatisfiable_is_null() {
		$this->assertNull( EventSchema::cheapest_extension_selection_cost( array( 5.0 ), 2, null ) );
		$this->assertNull( EventSchema::cheapest_extension_selection_cost( array(), 1, null ) );
		$this->assertNull( EventSchema::cheapest_extension_selection_cost( array( 5.0, 6.0, 7.0 ), 2, 1 ) );
	}

	/**
	 * Optional negative-price extensions lower the cost while the maximum
	 * allows them; positive ones beyond the minimum are never added.
	 */
	public function test_cheapest_extension_selection_cost_includes_negative_within_maximum() {
		$this->assertSame( -13.0, EventSchema::cheapest_extension_selection_cost( array( -8.0, -5.0, 3.0 ), 1, 2 ) );
		$this->assertSame( -8.0, EventSchema::cheapest_extension_selection_cost( array( -8.0, -5.0, 3.0 ), 1, 1 ) );
		$this->assertSame( -10.0, EventSchema::cheapest_extension_selection_cost( array( 4.0, -6.0, -4.0, 2.0 ), 1, null ) );
		$this->assertSame( -2.0, EventSchema::cheapest_extension_selection_cost( array( 4.0, -6.0, 2.0, 2.0 ), 3, null ) );
	}

	/**
	 * Extension prices are rounded like line items.
	 */
	public function test_cheapest_extension_selection_cost_keeps_monetary_precision() {
		$this->assertSame( 0.3, EventSchema::cheapest_extension_selection_cost( array( 0.1, 0.2 ), 2, null ) );
		$this->assertSame( 2.01, EventSchema::cheapest_extension_selection_cost( array( 1.005, 1.0 ), 2, null ) );
	}

	/**
	 * Each type uses its own rule: a positive minimum adds the cheapest
	 * selection, a zero minimum or disabled extensions (including
	 * multi-occurrence tickets) keep the base price, and an unsatisfiable
	 * requirement drops the type.
	 */
	public function test_add_required_extension_costs_per_type() {
		$types = array(
			$this->extension_type( 1, 1 ),
			$this->extension_type( 2, 0 ),
			$this->extension_type( 3, 2, null, false ),
			$this->extension_type( 4, 2, null, true, 'multiple_instances' ),
			$this->extension_type( 5, 3 ),
			$this->extension_type( 6, 2, 1 ),
			$this->extension_type( 7, 2 ),
		);
		$base  = array(
			1 => 0.0,
			2 => 10.0,
			3 => 10.0,
			4 => 30.0,
			5 => 10.0,
			6 => 10.0,
			7 => 10.0,
		);

		$this->assertSame(
			array(
				1 => 5.0,
				2 => 10.0,
				3 => 10.0,
				4 => 30.0,
				7 => 27.0,
			),
			EventSchema::add_required_extension_costs( $types, $base, array( 12.0, 5.0 ) )
		);
	}

	/**
	 * A type without a price row stays omitted, even with a requirement.
	 */
	public function test_add_required_extension_costs_keeps_unpriced_type_omitted() {
		$this->assertSame(
			array(),
			EventSchema::add_required_extension_costs( array( $this->extension_type( 1, 1 ) ), array(), array( 5.0 ) )
		);
	}

	/**
	 * The combined total is floored at zero: a 10 EUR ticket with minimum 1,
	 * maximum 2, and extensions at -8 and -5 EUR advertises 0.
	 */
	public function test_add_required_extension_costs_floors_total_at_zero() {
		$prices = EventSchema::add_required_extension_costs(
			array( $this->extension_type( 1, 1, 2 ) ),
			array( 1 => 10.0 ),
			array( -8.0, -5.0 )
		);

		$this->assertSame( array( 1 => 0.0 ), $prices );

		$offers = EventSchema::build_offers_for_types( array( $this->extension_type( 1, 1, 2 ) ), $prices, null, 'EUR', 'https://example.com/event' );
		$this->assertSame( '0', $offers[0]['price'] );
		$this->assertTrue( EventSchema::is_free_offer_set( $offers ) );
	}

	/**
	 * A zero ticket that requires a paid extension is no longer advertised
	 * as free; the free-event flag follows the adjusted offers.
	 */
	public function test_required_paid_extension_clears_free_flag() {
		$types  = array(
			$this->extension_type( 1, 1 ),
			$this->extension_type( 2, 0 ),
		);
		$prices = EventSchema::add_required_extension_costs(
			$types,
			array(
				1 => 0.0,
				2 => 0.0,
			),
			array( 7.5 )
		);
		$offers = EventSchema::build_offers_for_types( $types, $prices, null, 'EUR', 'https://example.com/event' );

		$this->assertSame( '7.5', $offers[0]['price'] );
		$this->assertSame( '0', $offers[1]['price'] );
		$this->assertFalse( EventSchema::is_free_offer_set( $offers ) );

		$this->assertFalse(
			EventSchema::is_free_offer_set(
				EventSchema::build_offers_for_types(
					$types,
					EventSchema::add_required_extension_costs( array( $types[0] ), array( 1 => 0.0 ), array() ),
					null,
					'EUR',
					'https://example.com/event'
				)
			)
		);
	}
}
