<?php
/**
 * Ticket Option model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Option model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketOption {

	/**
	 * Ticket option ID
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
	 * Price per option
	 *
	 * @var float
	 */
	public $price;

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
		return $wpdb->prefix . 'fair_events_ticket_options';
	}

	/**
	 * Get all ticket options for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketOption[] Array of TicketOption objects.
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
	 * Get a single ticket option by ID
	 *
	 * @param int $id Option ID.
	 * @return TicketOption|null Option or null if not found.
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
	 * Create a new ticket option
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $name          Option name.
	 * @param float  $price         Option price.
	 * @param int    $sort_order    Sort order.
	 * @return int|false The option ID on success, false on failure.
	 */
	public static function create( $event_date_id, $name, $price, $sort_order ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id' => $event_date_id,
				'name'          => $name,
				'price'         => (float) $price,
				'sort_order'    => $sort_order,
			),
			array( '%d', '%s', '%f', '%d' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Delete all ticket options for an event date
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
	 * Hydrate a ticket option object from a database row
	 *
	 * @param object $row Database row.
	 * @return TicketOption Ticket option object.
	 */
	private static function hydrate( $row ) {
		$item                = new self();
		$item->id            = (int) $row->id;
		$item->event_date_id = (int) $row->event_date_id;
		$item->name          = $row->name;
		$item->price         = (float) $row->price;
		$item->sort_order    = (int) $row->sort_order;
		$item->created_at    = $row->created_at;
		$item->updated_at    = $row->updated_at;

		return $item;
	}

	/**
	 * Convert to array
	 *
	 * @return array Data as array.
	 */
	public function to_array() {
		return array(
			'id'            => $this->id,
			'event_date_id' => $this->event_date_id,
			'name'          => $this->name,
			'price'         => $this->price,
			'sort_order'    => $this->sort_order,
			'created_at'    => $this->created_at,
			'updated_at'    => $this->updated_at,
		);
	}
}
