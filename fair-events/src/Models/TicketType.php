<?php
/**
 * Ticket Type model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Type model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketType {

	/**
	 * Ticket type ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Event date ID
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Name
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Capacity (null = no limit)
	 *
	 * @var int|null
	 */
	public $capacity;

	/**
	 * Seats consumed per ticket (1 = single seat, 2 = pair/+1, etc.)
	 *
	 * @var int
	 */
	public $seats_per_ticket = 1;

	/**
	 * Sort order
	 *
	 * @var int
	 */
	public $sort_order;

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
		return $wpdb->prefix . 'fair_events_ticket_types';
	}

	/**
	 * Get ticket type by ID
	 *
	 * @param int $id Ticket type ID.
	 * @return TicketType|null Ticket type object or null if not found.
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
	 * Get all ticket types for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketType[] Array of TicketType objects.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY sort_order ASC, id ASC',
				$table_name,
				$event_date_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$items = array();
		foreach ( $results as $result ) {
			$items[] = self::hydrate( $result );
		}

		return $items;
	}

	/**
	 * Create a new ticket type
	 *
	 * @param int      $event_date_id Event date ID.
	 * @param string   $name          Name.
	 * @param int|null $capacity         Capacity (null = no limit).
	 * @param int      $sort_order       Sort order.
	 * @param int      $seats_per_ticket Seats consumed per ticket (default 1).
	 * @return int|false The ticket type ID on success, false on failure.
	 */
	public static function create( $event_date_id, $name, $capacity, $sort_order, $seats_per_ticket = 1 ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id'    => $event_date_id,
				'name'             => $name,
				'capacity'         => $capacity,
				'seats_per_ticket' => max( 1, (int) $seats_per_ticket ),
				'sort_order'       => $sort_order,
			),
			array( '%d', '%s', '%d', '%d', '%d' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a ticket type
	 *
	 * @param int   $id   Ticket type ID.
	 * @param array $data Data to update.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $data ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$update_data   = array();
		$update_format = array();

		if ( isset( $data['name'] ) ) {
			$update_data['name'] = $data['name'];
			$update_format[]     = '%s';
		}

		if ( array_key_exists( 'capacity', $data ) ) {
			$update_data['capacity'] = $data['capacity'];
			$update_format[]         = '%d';
		}

		if ( isset( $data['seats_per_ticket'] ) ) {
			$update_data['seats_per_ticket'] = max( 1, (int) $data['seats_per_ticket'] );
			$update_format[]                 = '%d';
		}

		if ( isset( $data['sort_order'] ) ) {
			$update_data['sort_order'] = $data['sort_order'];
			$update_format[]           = '%d';
		}

		if ( empty( $update_data ) ) {
			return false;
		}

		$result = $wpdb->update(
			$table_name,
			$update_data,
			array( 'id' => $id ),
			$update_format,
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete a ticket type
	 *
	 * @param int $id Ticket type ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all ticket types for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'event_date_id' => $event_date_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Hydrate a ticket type object from a database row
	 *
	 * @param object $row Database row.
	 * @return TicketType Ticket type object.
	 */
	private static function hydrate( $row ) {
		$item                   = new self();
		$item->id               = (int) $row->id;
		$item->event_date_id    = (int) $row->event_date_id;
		$item->name             = $row->name;
		$item->capacity         = null !== $row->capacity ? (int) $row->capacity : null;
		$item->seats_per_ticket = isset( $row->seats_per_ticket ) ? max( 1, (int) $row->seats_per_ticket ) : 1;
		$item->sort_order       = (int) $row->sort_order;
		$item->created_at       = $row->created_at;
		$item->updated_at       = $row->updated_at;

		return $item;
	}

	/**
	 * Convert to array
	 *
	 * @return array Data as array.
	 */
	public function to_array() {
		return array(
			'id'               => $this->id,
			'event_date_id'    => $this->event_date_id,
			'name'             => $this->name,
			'capacity'         => $this->capacity,
			'seats_per_ticket' => $this->seats_per_ticket,
			'sort_order'       => $this->sort_order,
			'created_at'       => $this->created_at,
			'updated_at'       => $this->updated_at,
		);
	}
}
