<?php
/**
 * Venue model unit tests
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Models;

use PHPUnit\Framework\TestCase;
use FairEventsExperimental\Models\Venue;

/**
 * Tests the pure URL-building logic of Venue::build_maps_url().
 * Database-backed lookups are exercised via API integration tests.
 */
class VenueTest extends TestCase {

	public function test_lat_lng_produces_coordinate_query() {
		$url = Venue::build_maps_url( '39.4878023', '-0.3613204', null );
		$this->assertNotNull( $url );
		$this->assertStringContainsString( 'query=39.4878023%2C-0.3613204', $url );
		$this->assertStringContainsString( 'maps.google.com', $url );
	}

	public function test_lat_lng_takes_priority_over_address() {
		$url = Venue::build_maps_url( '39.4878023', '-0.3613204', 'Some Street 1' );
		$this->assertNotNull( $url );
		$this->assertStringContainsString( 'query=39.4878023%2C-0.3613204', $url );
		$this->assertStringNotContainsString( 'Some+Street', $url );
	}

	public function test_address_only_produces_encoded_address_query() {
		$url = Venue::build_maps_url( null, null, 'Gran Via 1, Valencia' );
		$this->assertNotNull( $url );
		$this->assertStringContainsString( 'query=Gran%20Via%201%2C%20Valencia', $url );
	}

	public function test_empty_inputs_return_null() {
		$this->assertNull( Venue::build_maps_url( null, null, null ) );
		$this->assertNull( Venue::build_maps_url( '', '', '' ) );
	}

	public function test_partial_coordinates_fall_back_to_address() {
		$url = Venue::build_maps_url( '39.4878023', '', 'Fallback Address' );
		$this->assertNotNull( $url );
		$this->assertStringContainsString( 'Fallback', rawurldecode( $url ) );
	}
}
