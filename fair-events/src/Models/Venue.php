<?php
/**
 * Venue model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

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
	 * Google Maps link
	 *
	 * @var string|null
	 */
	public $google_maps_link;

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
		$allowed_columns = array( 'id', 'name', 'address', 'google_maps_link', 'latitude', 'longitude', 'facebook_page_link', 'created_at', 'updated_at' );
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
	 * @param string|null $google_maps_link   Google Maps URL.
	 * @param string|null $latitude           Latitude coordinate.
	 * @param string|null $longitude          Longitude coordinate.
	 * @param string|null $facebook_page_link Facebook page URL.
	 * @return int|false The venue ID on success, false on failure.
	 */
	public static function create( $name, $address = null, $google_maps_link = null, $latitude = null, $longitude = null, $facebook_page_link = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'               => $name,
			'address'            => $address,
			'google_maps_link'   => $google_maps_link,
			'latitude'           => $latitude,
			'longitude'          => $longitude,
			'facebook_page_link' => $facebook_page_link,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%s' );

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
	 * @param string|null $google_maps_link   Google Maps URL.
	 * @param string|null $latitude           Latitude coordinate.
	 * @param string|null $longitude          Longitude coordinate.
	 * @param string|null $facebook_page_link Facebook page URL.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $name, $address = null, $google_maps_link = null, $latitude = null, $longitude = null, $facebook_page_link = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'               => $name,
			'address'            => $address,
			'google_maps_link'   => $google_maps_link,
			'latitude'           => $latitude,
			'longitude'          => $longitude,
			'facebook_page_link' => $facebook_page_link,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%s' );

		$result = $wpdb->update(
			$table_name,
			$data,
			array( 'id' => $id ),
			$format,
			array( '%d' )
		);

		return $result !== false;
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

		return $result !== false;
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
		$venue->google_maps_link   = $row->google_maps_link;
		$venue->latitude           = $row->latitude;
		$venue->longitude          = $row->longitude;
		$venue->facebook_page_link = $row->facebook_page_link;
		$venue->created_at         = $row->created_at;
		$venue->updated_at         = $row->updated_at;

		return $venue;
	}

	/**
	 * Convert venue to array
	 *
	 * @return array Venue data as array.
	 */
	public function to_array() {
		return array(
			'id'                 => $this->id,
			'name'               => $this->name,
			'address'            => $this->address,
			'google_maps_link'   => $this->google_maps_link,
			'latitude'           => $this->latitude,
			'longitude'          => $this->longitude,
			'facebook_page_link' => $this->facebook_page_link,
			'created_at'         => $this->created_at,
			'updated_at'         => $this->updated_at,
		);
	}
}
