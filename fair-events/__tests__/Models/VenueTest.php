<?php
/**
 * Venue model unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

use PHPUnit\Framework\TestCase;
use FairEvents\Models\Venue;

/**
 * Tests the pure URL-building logic of Venue::build_maps_url().
 * Database-backed lookups are exercised via API integration tests.
 */
class VenueTest extends TestCase {
 // phpcs:disable Squiz.Commenting.FunctionComment.Missing

	public function test_lat_lng_produces_coordinate_query() {
		$url = Venue::build_maps_url( '39.4878023', '-0.3613204', null );
		$this->assertNotNull( $url );
		$this->assertStringContainsString( 'query=39.4878023%2C-0.3613204', $url );
		$this->assertStringContainsString( 'google.com/maps', $url );
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

	public function test_partial_coordinates_return_null_even_with_address() {
		$url = Venue::build_maps_url( '39.4878023', '', 'Fallback Address' );
		$this->assertNull( $url );
		$this->assertNull( Venue::build_maps_url( '', '-0.3613204', 'Fallback Address' ) );
	}

	public function test_invalid_coordinates_return_null_even_with_address() {
		$this->assertNull( Venue::build_maps_url( '91', '0', 'Fallback Address' ) );
		$this->assertNull( Venue::build_maps_url( 'not-a-number', '0', 'Fallback Address' ) );
	}

	public function test_decimal_comma_coordinates_are_normalized_in_url() {
		$url = Venue::build_maps_url( '39,48', '-0,36', null );
		$this->assertStringContainsString( 'query=39.48%2C-0.36', $url );
	}

	public function test_zero_coordinates_produce_coordinate_query() {
		$url = Venue::build_maps_url( '0', '0', 'Fallback Address' );
		$this->assertStringContainsString( 'query=0%2C0', $url );
		$this->assertStringNotContainsString( 'Fallback', $url );
	}

	public function test_both_coordinates_empty_is_valid() {
		$result = Venue::validate_coordinates( '', '' );
		$this->assertTrue( $result['valid'] );
		$this->assertNull( $result['latitude'] );
		$this->assertNull( $result['longitude'] );

		$result = Venue::validate_coordinates( null, null );
		$this->assertTrue( $result['valid'] );
	}

	public function test_valid_coordinates_pass_through() {
		$result = Venue::validate_coordinates( '39.4878023', '-0.3613204' );
		$this->assertTrue( $result['valid'] );
		$this->assertSame( '39.4878023', $result['latitude'] );
		$this->assertSame( '-0.3613204', $result['longitude'] );
	}

	public function test_decimal_comma_is_normalized_to_dot() {
		$result = Venue::validate_coordinates( '39,48', '-0,36' );
		$this->assertTrue( $result['valid'] );
		$this->assertSame( '39.48', $result['latitude'] );
		$this->assertSame( '-0.36', $result['longitude'] );
	}

	public function test_pasted_pair_is_split_across_fields() {
		$result = Venue::validate_coordinates( '39.4878023, -0.3613204', '' );
		$this->assertTrue( $result['valid'] );
		$this->assertSame( '39.4878023', $result['latitude'] );
		$this->assertSame( '-0.3613204', $result['longitude'] );
	}

	public function test_only_one_coordinate_filled_is_rejected() {
		$result = Venue::validate_coordinates( '39.4878023', '' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_pair_incomplete', $result['code'] );

		$result = Venue::validate_coordinates( '', '-0.3613204' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_pair_incomplete', $result['code'] );
	}

	public function test_non_numeric_coordinates_are_rejected() {
		$result = Venue::validate_coordinates( 'not-a-number', '-0.3613204' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_not_numeric', $result['code'] );
	}

	public function test_out_of_range_latitude_is_rejected() {
		$result = Venue::validate_coordinates( '90.0001', '0' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_out_of_range', $result['code'] );

		$valid = Venue::validate_coordinates( '90', '0' );
		$this->assertTrue( $valid['valid'] );
	}

	public function test_out_of_range_longitude_is_rejected() {
		$result = Venue::validate_coordinates( '0', '180.0001' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_out_of_range', $result['code'] );

		$valid = Venue::validate_coordinates( '0', '-180' );
		$this->assertTrue( $valid['valid'] );
	}

	public function test_coordinates_exceeding_stored_length_are_rejected() {
		// Long, but within range, so this exercises the length check specifically
		// rather than being caught earlier by the range check.
		$too_long = '0.1234567890123456789';
		$this->assertGreaterThan( 20, strlen( $too_long ) );

		$result = Venue::validate_coordinates( $too_long, '0' );
		$this->assertFalse( $result['valid'] );
		$this->assertSame( 'coordinate_too_long', $result['code'] );
	}
}
