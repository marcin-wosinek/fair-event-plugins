<?php
/**
 * Venue model for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Models;

defined( 'WPINC' ) || die;

/**
 * Venue model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class Venue {

	/**
	 * Venue ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Venue name
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Venue address
	 *
	 * @var string|null
	 */
	public $address;

	/**
	 * Latitude coordinate
	 *
	 * @var string|null
	 */
	public $latitude;

	/**
	 * Longitude coordinate
	 *
	 * @var string|null
	 */
	public $longitude;

	/**
	 * Facebook page link
	 *
	 * @var string|null
	 */
	public $facebook_page_link;

	/**
	 * Instagram handle (without @)
	 *
	 * @var string|null
	 */
	public $instagram_handle;

	/**
	 * Website URL
	 *
	 * @var string|null
	 */
	public $website_url;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_event_venues';
	}

	/**
	 * Get venue by ID
	 *
	 * @param int $id Venue ID.
	 * @return Venue|null Venue object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$table_name,
				$id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get all venues
	 *
	 * @param string $order_by Column to order by (default 'name').
	 * @param string $order    Order direction ASC or DESC (default 'ASC').
	 * @return Venue[] Array of Venue objects.
	 */
	public static function get_all( $order_by = 'name', $order = 'ASC' ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate order_by to prevent SQL injection.
		$allowed_columns = array( 'id', 'name', 'address', 'latitude', 'longitude', 'facebook_page_link', 'instagram_handle', 'website_url', 'created_at', 'updated_at' );
		if ( ! in_array( $order_by, $allowed_columns, true ) ) {
			$order_by = 'name';
		}

		// Validate order direction.
		$order = strtoupper( $order ) === 'DESC' ? 'DESC' : 'ASC';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY %i ' . $order, // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$table_name,
				$order_by
			)
		);

		if ( ! $results ) {
			return array();
		}

		$venues = array();
		foreach ( $results as $result ) {
			$venues[] = self::hydrate( $result );
		}

		return $venues;
	}

	/**
	 * Create a new venue
	 *
	 * @param string      $name               Venue name.
	 * @param string|null $address            Venue address.
	 * @param string|null $latitude           Latitude coordinate.
	 * @param string|null $longitude          Longitude coordinate.
	 * @param string|null $facebook_page_link Facebook page URL.
	 * @param string|null $instagram_handle   Instagram handle (without @).
	 * @param string|null $website_url        Website URL.
	 * @return int|false The venue ID on success, false on failure.
	 */
	public static function create( $name, $address = null, $latitude = null, $longitude = null, $facebook_page_link = null, $instagram_handle = null, $website_url = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'               => $name,
			'address'            => $address,
			'latitude'           => $latitude,
			'longitude'          => $longitude,
			'facebook_page_link' => $facebook_page_link,
			'instagram_handle'   => $instagram_handle,
			'website_url'        => $website_url,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%s', '%s' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a venue
	 *
	 * @param int         $id                 Venue ID.
	 * @param string      $name               Venue name.
	 * @param string|null $address            Venue address.
	 * @param string|null $latitude           Latitude coordinate.
	 * @param string|null $longitude          Longitude coordinate.
	 * @param string|null $facebook_page_link Facebook page URL.
	 * @param string|null $instagram_handle   Instagram handle (without @).
	 * @param string|null $website_url        Website URL.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $name, $address = null, $latitude = null, $longitude = null, $facebook_page_link = null, $instagram_handle = null, $website_url = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'               => $name,
			'address'            => $address,
			'latitude'           => $latitude,
			'longitude'          => $longitude,
			'facebook_page_link' => $facebook_page_link,
			'instagram_handle'   => $instagram_handle,
			'website_url'        => $website_url,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%s', '%s' );

		$result = $wpdb->update(
			$table_name,
			$data,
			array( 'id' => $id ),
			$format,
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete a venue
	 *
	 * @param int $id Venue ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// First, clear venue_id references from event_dates.
		$event_dates_table = $wpdb->prefix . 'fair_event_dates';
		$wpdb->update(
			$event_dates_table,
			array( 'venue_id' => null ),
			array( 'venue_id' => $id ),
			array( '%d' ),
			array( '%d' )
		);

		// Then delete the venue.
		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Hydrate a venue object from a database row
	 *
	 * @param object $row Database row.
	 * @return Venue Venue object.
	 */
	private static function hydrate( $row ) {
		$venue                     = new self();
		$venue->id                 = (int) $row->id;
		$venue->name               = $row->name;
		$venue->address            = $row->address;
		$venue->latitude           = $row->latitude;
		$venue->longitude          = $row->longitude;
		$venue->facebook_page_link = $row->facebook_page_link;
		$venue->instagram_handle   = $row->instagram_handle ?? null;
		$venue->website_url        = $row->website_url ?? null;
		$venue->created_at         = $row->created_at;
		$venue->updated_at         = $row->updated_at;

		return $venue;
	}

	/**
	 * Convert venue to array
	 *
	 * @return array Venue data as array.
	 */
	/**
	 * Build a Google Maps search URL from coordinates or address.
	 *
	 * Uses the keyless /maps/search/ scheme so no API key is required.
	 *
	 * @param string|null $latitude  Latitude.
	 * @param string|null $longitude Longitude.
	 * @param string|null $address   Address text.
	 * @return string|null URL or null when no location data is available.
	 */
	public static function build_maps_url( $latitude, $longitude, $address ) {
		if ( ! empty( $latitude ) && ! empty( $longitude ) ) {
			$query = rawurlencode( $latitude . ',' . $longitude );
			return 'https://www.google.com/maps/search/?api=1&query=' . $query;
		}

		if ( ! empty( $address ) ) {
			return 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( $address );
		}

		return null;
	}

	/**
	 * Get the Google Maps URL for this venue.
	 *
	 * @return string|null URL or null when no location data is available.
	 */
	public function get_maps_url() {
		return self::build_maps_url( $this->latitude, $this->longitude, $this->address );
	}

	/**
	 * Replace a decimal-comma separator with a dot, but only when the value
	 * doesn't already contain a dot (a pair-split result already uses dots).
	 *
	 * @param string $value Raw coordinate value.
	 * @return string Normalized value.
	 */
	private static function normalize_decimal_separator( $value ) {
		if ( '' === $value || false === strpos( $value, ',' ) || false !== strpos( $value, '.' ) ) {
			return $value;
		}

		return str_replace( ',', '.', $value );
	}

	/**
	 * Validate (and normalize) a latitude/longitude pair before it is stored.
	 *
	 * Both empty is valid (coordinates are optional). A decimal comma is
	 * normalized to a dot. A "lat, lng" pair pasted into the latitude field
	 * is split across both fields when longitude is empty — the split only
	 * triggers when the comma is followed by whitespace (the shape mapping
	 * tools paste, e.g. "39.4878023, -0.3613204"), so a plain decimal-comma
	 * value like "39,48" (no space) is normalized instead of misread as a pair.
	 *
	 * @param string|null $latitude  Raw latitude input.
	 * @param string|null $longitude Raw longitude input.
	 * @return array {
	 *     @type bool        $valid     Whether the pair is acceptable.
	 *     @type string|null $latitude  Normalized latitude (only when valid).
	 *     @type string|null $longitude Normalized longitude (only when valid).
	 *     @type string      $code      Error code (only when invalid).
	 *     @type string      $message   Translated error message (only when invalid).
	 * }
	 */
	public static function validate_coordinates( $latitude, $longitude ) {
		$latitude  = null === $latitude ? '' : trim( (string) $latitude );
		$longitude = null === $longitude ? '' : trim( (string) $longitude );

		if ( '' === $longitude && '' !== $latitude
			&& preg_match( '/^(-?[0-9]+(?:\.[0-9]+)?)\s*,\s+(-?[0-9]+(?:\.[0-9]+)?)$/', $latitude, $matches )
		) {
			$latitude  = $matches[1];
			$longitude = $matches[2];
		}

		$latitude  = self::normalize_decimal_separator( $latitude );
		$longitude = self::normalize_decimal_separator( $longitude );

		if ( '' === $latitude && '' === $longitude ) {
			return array(
				'valid'     => true,
				'latitude'  => null,
				'longitude' => null,
			);
		}

		if ( '' === $latitude || '' === $longitude ) {
			return array(
				'valid'   => false,
				'code'    => 'coordinate_pair_incomplete',
				'message' => __( 'Enter both latitude and longitude, or leave both blank.', 'fair-events-experimental' ),
			);
		}

		if ( ! is_numeric( $latitude ) || ! is_numeric( $longitude ) ) {
			return array(
				'valid'   => false,
				'code'    => 'coordinate_not_numeric',
				'message' => __( 'Latitude and longitude must be numbers, e.g. 39.4878023, -0.3613204.', 'fair-events-experimental' ),
			);
		}

		if ( (float) $latitude < -90 || (float) $latitude > 90 ) {
			return array(
				'valid'   => false,
				'code'    => 'coordinate_out_of_range',
				'message' => __( 'Latitude must be between -90 and 90.', 'fair-events-experimental' ),
			);
		}

		if ( (float) $longitude < -180 || (float) $longitude > 180 ) {
			return array(
				'valid'   => false,
				'code'    => 'coordinate_out_of_range',
				'message' => __( 'Longitude must be between -180 and 180.', 'fair-events-experimental' ),
			);
		}

		if ( strlen( $latitude ) > 20 || strlen( $longitude ) > 20 ) {
			return array(
				'valid'   => false,
				'code'    => 'coordinate_too_long',
				'message' => __( 'Latitude and longitude must be 20 characters or fewer.', 'fair-events-experimental' ),
			);
		}

		return array(
			'valid'     => true,
			'latitude'  => $latitude,
			'longitude' => $longitude,
		);
	}

	public function to_array() {
		return array(
			'id'                 => $this->id,
			'name'               => $this->name,
			'address'            => $this->address,
			'maps_url'           => $this->get_maps_url(),
			'latitude'           => $this->latitude,
			'longitude'          => $this->longitude,
			'facebook_page_link' => $this->facebook_page_link,
			'instagram_handle'   => $this->instagram_handle,
			'website_url'        => $this->website_url,
			'created_at'         => $this->created_at,
			'updated_at'         => $this->updated_at,
		);
	}
}
