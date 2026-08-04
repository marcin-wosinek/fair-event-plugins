<?php
/**
 * Tests for EventLocation::resolve() across attendance modes.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventLocation;
use FairEvents\Models\EventDates;

/**
 * Unit tests for EventLocation::resolve().
 *
 * No venue_id is set on any fixture, so the optional Venue model (from
 * fair-events-experimental) is never touched, and post_id is always null/0
 * so get_post_meta() (unstubbed) is never called — these tests exercise the
 * free-text address / attendance-mode fallback chain only.
 */
class EventLocationTest extends TestCase {

	/**
	 * Reset the fake $wpdb before each test so junction-table seeding
	 * (get_primary_linked_post_id()'s get_col() lookup) never leaks between tests.
	 */
	protected function setUp(): void {
		parent::setUp();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
	}

	/**
	 * Build a minimal EventDates fixture.
	 *
	 * @param array $overrides Property overrides.
	 * @return EventDates Fixture.
	 */
	private function make_event_date( array $overrides = array() ): EventDates {
		$event_date                  = new EventDates();
		$event_date->id              = 1;
		$event_date->link_type       = 'none';
		$event_date->attendance_mode = 'in_person';

		foreach ( $overrides as $key => $value ) {
			$event_date->$key = $value;
		}

		return $event_date;
	}

	/**
	 * In-person with a free-text address resolves the physical fields, no mode-specific keys.
	 */
	public function test_in_person_with_address() {
		$event_date = $this->make_event_date( array( 'address' => '123 Main St' ) );

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'in_person', $location['mode'] );
		$this->assertSame( '123 Main St', $location['address'] );
		$this->assertArrayNotHasKey( 'joining_url', $location );
	}

	/**
	 * In-person with nothing resolved (no venue, no address, no post meta) is null.
	 */
	public function test_in_person_with_nothing_resolved_is_null() {
		$event_date = $this->make_event_date();

		$this->assertNull( EventLocation::resolve( $event_date, null ) );
	}

	/**
	 * Online with an explicit joining_link uses it directly, and never carries
	 * physical fields even when an address also happens to be set.
	 */
	public function test_online_uses_explicit_joining_link() {
		$event_date = $this->make_event_date(
			array(
				'attendance_mode' => 'online',
				'address'         => '123 Main St',
				'joining_link'    => 'https://example.com/meet',
			)
		);

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'online', $location['mode'] );
		$this->assertSame( 'https://example.com/meet', $location['joining_url'] );
		$this->assertArrayNotHasKey( 'address', $location );
		$this->assertArrayNotHasKey( 'name', $location );
	}

	/**
	 * Online with no joining_link falls back to the event's own page URL
	 * (get_event_page_url()), never the external_url configured for
	 * `link_type = 'external'` — that's an unrelated calendar/RSVP target,
	 * not the event's own page.
	 */
	public function test_online_falls_back_to_event_page_url() {
		$event_date = $this->make_event_date(
			array(
				'id'              => 7,
				'attendance_mode' => 'online',
				'link_type'       => 'external',
				'external_url'    => 'https://example.com/unrelated-listing',
			)
		);
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb']->seed_col( 'wp_fair_event_date_posts', 7, array( 42 ) );

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'online', $location['mode'] );
		// Falls back to the event's own page permalink, ignoring the unrelated external_url.
		$this->assertSame( 'https://example.com/?p=42', $location['joining_url'] );
	}

	/**
	 * A blank external_url (empty-string regression) still falls back to the
	 * event's own page permalink rather than producing an empty joining URL.
	 */
	public function test_online_falls_back_to_event_page_url_with_blank_external_url() {
		$event_date = $this->make_event_date(
			array(
				'id'              => 8,
				'attendance_mode' => 'online',
				'link_type'       => 'external',
				'external_url'    => '',
			)
		);
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb']->seed_col( 'wp_fair_event_date_posts', 8, array( 43 ) );

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'online', $location['mode'] );
		$this->assertSame( 'https://example.com/?p=43', $location['joining_url'] );
	}

	/**
	 * Hybrid with an address carries both the physical fields and the joining URL.
	 */
	public function test_hybrid_with_address_carries_both() {
		$event_date = $this->make_event_date(
			array(
				'attendance_mode' => 'hybrid',
				'address'         => '123 Main St',
				'joining_link'    => 'https://example.com/meet',
			)
		);

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'hybrid', $location['mode'] );
		$this->assertSame( '123 Main St', $location['address'] );
		$this->assertSame( 'https://example.com/meet', $location['joining_url'] );
	}

	/**
	 * Hybrid with no physical location resolved still returns the joining
	 * URL, with no address/name keys (EventSchema applies the site-name
	 * backstop for the Place side, not EventLocation).
	 */
	public function test_hybrid_with_no_physical_location() {
		$event_date = $this->make_event_date(
			array(
				'attendance_mode' => 'hybrid',
				'joining_link'    => 'https://example.com/meet',
			)
		);

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'hybrid', $location['mode'] );
		$this->assertArrayNotHasKey( 'address', $location );
		$this->assertArrayNotHasKey( 'name', $location );
		$this->assertSame( 'https://example.com/meet', $location['joining_url'] );
	}

	/**
	 * A null attendance_mode (pre-migration row, or a generated occurrence
	 * whose master is also null) defaults to in_person.
	 */
	public function test_null_attendance_mode_defaults_to_in_person() {
		$event_date = $this->make_event_date(
			array(
				'attendance_mode' => null,
				'address'         => '123 Main St',
			)
		);

		$location = EventLocation::resolve( $event_date, null );

		$this->assertSame( 'in_person', $location['mode'] );
	}
}
