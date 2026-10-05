<?php
/**
 * Ticket Option Price model for Fair Events
 *
 * Per-(option, sale_period) price row used when the option has
 * `derive_price_from_sale_period` enabled.
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Option Price model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketOptionPrice {

	/**
	 * Ticket option ID
	 *
	 * @var int
	 */
	public $ticket_option_id;

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
		return $wpdb->prefix . 'fair_events_ticket_option_prices';
	}

	/**
	 * Get price row by option + sale period.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @param int $sale_period_id   Sale period ID.
	 * @return TicketOptionPrice|null
	 */
	public static function get_by_option_and_period( $ticket_option_id, $sale_period_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_option_id = %d AND sale_period_id = %d LIMIT 1',
				$table_name,
				$ticket_option_id,
				$sale_period_id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get all price rows for a ticket option.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return TicketOptionPrice[]
	 */
	public static function get_all_by_option_id( $ticket_option_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_option_id = %d ORDER BY sale_period_id ASC',
				$table_name,
				$ticket_option_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$items = array();
		foreach ( $results as $row ) {
			$items[] = self::hydrate( $row );
		}

		return $items;
	}

	/**
	 * Get all price rows for ticket options belonging to an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketOptionPrice[]
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$prices_table  = self::get_table_name();
		$options_table = $wpdb->prefix . 'fair_events_ticket_options';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT p.* FROM %i p INNER JOIN %i o ON p.ticket_option_id = o.id WHERE o.event_date_id = %d',
				$prices_table,
				$options_table,
				$event_date_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$items = array();
		foreach ( $results as $row ) {
			$items[] = self::hydrate( $row );
		}

		return $items;
	}

	/**
	 * Insert or update a price row for (option, period).
	 *
	 * @param int   $ticket_option_id Ticket option ID.
	 * @param int   $sale_period_id   Sale period ID.
	 * @param float $price            Price value.
	 * @return bool True on success.
	 */
	public static function upsert( $ticket_option_id, $sale_period_id, $price ) {
		global $wpdb;

		$table_name = self::get_table_name();
		$existing   = self::get_by_option_and_period( $ticket_option_id, $sale_period_id );

		if ( $existing ) {
			$result = $wpdb->update(
				$table_name,
				array( 'price' => (float) $price ),
				array(
					'ticket_option_id' => $ticket_option_id,
					'sale_period_id'   => $sale_period_id,
				),
				array( '%f' ),
				array( '%d', '%d' )
			);

			return false !== $result;
		}

		$result = $wpdb->insert(
			$table_name,
			array(
				'ticket_option_id' => $ticket_option_id,
				'sale_period_id'   => $sale_period_id,
				'price'            => (float) $price,
			),
			array( '%d', '%d', '%f' )
		);

		return false !== $result;
	}

	/**
	 * Delete all price rows for an option.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return bool
	 */
	public static function delete_by_option_id( $ticket_option_id ) {
		global $wpdb;

		$result = $wpdb->delete(
			self::get_table_name(),
			array( 'ticket_option_id' => $ticket_option_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all price rows for a sale period (called when a period is removed).
	 *
	 * @param int $sale_period_id Sale period ID.
	 * @return bool
	 */
	public static function delete_by_sale_period_id( $sale_period_id ) {
		global $wpdb;

		$result = $wpdb->delete(
			self::get_table_name(),
			array( 'sale_period_id' => $sale_period_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all price rows for ticket options belonging to an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return void
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$prices_table  = self::get_table_name();
		$options_table = $wpdb->prefix . 'fair_events_ticket_options';

		$wpdb->query(
			$wpdb->prepare(
				'DELETE p FROM %i p INNER JOIN %i o ON p.ticket_option_id = o.id WHERE o.event_date_id = %d',
				$prices_table,
				$options_table,
				$event_date_id
			)
		);
	}

	/**
	 * Hydrate from a DB row.
	 *
	 * @param object $row Row.
	 * @return TicketOptionPrice
	 */
	private static function hydrate( $row ) {
		$item                   = new self();
		$item->ticket_option_id = (int) $row->ticket_option_id;
		$item->sale_period_id   = (int) $row->sale_period_id;
		$item->price            = (float) $row->price;
		$item->created_at       = $row->created_at;
		$item->updated_at       = $row->updated_at;

		return $item;
	}

	/**
	 * Convert to array.
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'ticket_option_id' => $this->ticket_option_id,
			'sale_period_id'   => $this->sale_period_id,
			'price'            => $this->price,
			'created_at'       => $this->created_at,
			'updated_at'       => $this->updated_at,
		);
	}
}
