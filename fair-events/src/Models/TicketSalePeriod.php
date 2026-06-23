<?php
/**
 * Ticket Sale Period model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Sale Period model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketSalePeriod {

	/**
	 * Sale period ID
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
	 * Name (nullable)
	 *
	 * @var string|null
	 */
	public $name;

	/**
	 * Sale start datetime
	 *
	 * @var string
	 */
	public $sale_start;

	/**
	 * Sale end datetime
	 *
	 * @var string
	 */
	public $sale_end;

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
		return $wpdb->prefix . 'fair_events_ticket_sale_periods';
	}

	/**
	 * Get sale period by ID
	 *
	 * @param int $id Sale period ID.
	 * @return TicketSalePeriod|null Sale period object or null if not found.
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
	 * Get all sale periods for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketSalePeriod[] Array of TicketSalePeriod objects.
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
	 * Create a new sale period
	 *
	 * @param int         $event_date_id Event date ID.
	 * @param string|null $name          Name.
	 * @param string      $sale_start    Sale start datetime.
	 * @param string      $sale_end      Sale end datetime.
	 * @param int         $sort_order    Sort order.
	 * @return int|false The sale period ID on success, false on failure.
	 */
	public static function create( $event_date_id, $name, $sale_start, $sale_end, $sort_order ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id' => $event_date_id,
				'name'          => $name,
				'sale_start'    => $sale_start,
				'sale_end'      => $sale_end,
				'sort_order'    => $sort_order,
			),
			array( '%d', '%s', '%s', '%s', '%d' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a sale period
	 *
	 * @param int   $id   Sale period ID.
	 * @param array $data Data to update.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $data ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$update_data   = array();
		$update_format = array();

		if ( array_key_exists( 'name', $data ) ) {
			$update_data['name'] = $data['name'];
			$update_format[]     = '%s';
		}

		if ( isset( $data['sale_start'] ) ) {
			$update_data['sale_start'] = $data['sale_start'];
			$update_format[]           = '%s';
		}

		if ( isset( $data['sale_end'] ) ) {
			$update_data['sale_end'] = $data['sale_end'];
			$update_format[]         = '%s';
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
	 * Delete a sale period
	 *
	 * @param int $id Sale period ID.
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
	 * Delete all sale periods for an event date
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
	 * Hydrate a sale period object from a database row
	 *
	 * @param object $row Database row.
	 * @return TicketSalePeriod Sale period object.
	 */
	private static function hydrate( $row ) {
		$item                = new self();
		$item->id            = (int) $row->id;
		$item->event_date_id = (int) $row->event_date_id;
		$item->name          = $row->name;
		$item->sale_start    = $row->sale_start;
		$item->sale_end      = $row->sale_end;
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
			'sale_start'    => $this->sale_start,
			'sale_end'      => $this->sale_end,
			'sort_order'    => $this->sort_order,
			'created_at'    => $this->created_at,
			'updated_at'    => $this->updated_at,
		);
	}
}
