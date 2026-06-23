<?php
/**
 * Ticket Price model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Price model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketPrice {

	/**
	 * Price ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Ticket type ID
	 *
	 * @var int
	 */
	public $ticket_type_id;

	/**
	 * Sale period ID
	 *
	 * @var int
	 */
	public $sale_period_id;

	/**
	 * Price
	 *
	 * @var float
	 */
	public $price;

	/**
	 * Capacity (null = no per-period limit)
	 *
	 * @var int|null
	 */
	public $capacity;

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
		return $wpdb->prefix . 'fair_events_ticket_prices';
	}

	/**
	 * Get price by ID
	 *
	 * @param int $id Price ID.
	 * @return TicketPrice|null Price object or null if not found.
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
	 * Get all prices for a ticket type
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return TicketPrice[] Array of TicketPrice objects.
	 */
	public static function get_all_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_type_id = %d ORDER BY id ASC',
				$table_name,
				$ticket_type_id
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
	 * Get price by ticket type and sale period
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @param int $sale_period_id Sale period ID.
	 * @return TicketPrice|null Price object or null if not found.
	 */
	public static function get_by_type_and_period( $ticket_type_id, $sale_period_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_type_id = %d AND sale_period_id = %d LIMIT 1',
				$table_name,
				$ticket_type_id,
				$sale_period_id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get all prices for ticket types belonging to an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketPrice[] Array of TicketPrice objects.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$prices_table = self::get_table_name();
		$types_table  = $wpdb->prefix . 'fair_events_ticket_types';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT p.* FROM %i p INNER JOIN %i t ON p.ticket_type_id = t.id WHERE t.event_date_id = %d ORDER BY p.id ASC',
				$prices_table,
				$types_table,
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
	 * Create a new ticket price
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int      $sale_period_id Sale period ID.
	 * @param float    $price          Price.
	 * @param int|null $capacity       Capacity (null = no per-period limit).
	 * @return int|false The price ID on success, false on failure.
	 */
	public static function create( $ticket_type_id, $sale_period_id, $price, $capacity ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'ticket_type_id' => $ticket_type_id,
				'sale_period_id' => $sale_period_id,
				'price'          => $price,
				'capacity'       => $capacity,
			),
			array( '%d', '%d', '%f', '%d' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a ticket price
	 *
	 * @param int   $id   Price ID.
	 * @param array $data Data to update.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $data ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$update_data   = array();
		$update_format = array();

		if ( isset( $data['price'] ) ) {
			$update_data['price'] = $data['price'];
			$update_format[]      = '%f';
		}

		if ( array_key_exists( 'capacity', $data ) ) {
			$update_data['capacity'] = $data['capacity'];
			$update_format[]         = '%d';
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
	 * Delete a ticket price
	 *
	 * @param int $id Price ID.
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
	 * Delete all prices for a ticket type
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'ticket_type_id' => $ticket_type_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all prices for a sale period
	 *
	 * @param int $sale_period_id Sale period ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_sale_period_id( $sale_period_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'sale_period_id' => $sale_period_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all prices for ticket types belonging to an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return void
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$prices_table = self::get_table_name();
		$types_table  = $wpdb->prefix . 'fair_events_ticket_types';

		$wpdb->query(
			$wpdb->prepare(
				'DELETE p FROM %i p INNER JOIN %i t ON p.ticket_type_id = t.id WHERE t.event_date_id = %d',
				$prices_table,
				$types_table,
				$event_date_id
			)
		);
	}

	/**
	 * Hydrate a price object from a database row
	 *
	 * @param object $row Database row.
	 * @return TicketPrice Price object.
	 */
	private static function hydrate( $row ) {
		$item                 = new self();
		$item->id             = (int) $row->id;
		$item->ticket_type_id = (int) $row->ticket_type_id;
		$item->sale_period_id = (int) $row->sale_period_id;
		$item->price          = (float) $row->price;
		$item->capacity       = null !== $row->capacity ? (int) $row->capacity : null;
		$item->created_at     = $row->created_at;
		$item->updated_at     = $row->updated_at;

		return $item;
	}

	/**
	 * Convert to array
	 *
	 * @return array Data as array.
	 */
	public function to_array() {
		return array(
			'id'             => $this->id,
			'ticket_type_id' => $this->ticket_type_id,
			'sale_period_id' => $this->sale_period_id,
			'price'          => $this->price,
			'capacity'       => $this->capacity,
			'created_at'     => $this->created_at,
			'updated_at'     => $this->updated_at,
		);
	}
}
