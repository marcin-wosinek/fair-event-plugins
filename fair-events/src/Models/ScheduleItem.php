<?php
/**
 * Schedule Item model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * One entry of an event's program: a workshop linked to a ticket option, or
 * a program item of its own that is never a ticket choice.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ScheduleItem {

	/**
	 * Schedule item ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Event date ID (the series master for a series)
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Linked ticket option ID. Null for a program item of its own.
	 *
	 * @var int|null
	 */
	public $ticket_option_id;

	/**
	 * Whether the linked ticket option can be chosen with a ticket.
	 *
	 * @var bool
	 */
	public $bookable;

	/**
	 * Title of a program item of its own. Empty for a linked workshop, whose
	 * name is the ticket option's.
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Start, as a naive site-local datetime
	 *
	 * @var string
	 */
	public $start_datetime;

	/**
	 * End, as a naive site-local datetime
	 *
	 * @var string
	 */
	public $end_datetime;

	/**
	 * Description
	 *
	 * @var string
	 */
	public $description;

	/**
	 * Room or location
	 *
	 * @var string
	 */
	public $location;

	/**
	 * Sort order
	 *
	 * @var int
	 */
	public $sort_order;

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	public static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_schedule_items';
	}

	/**
	 * Get all schedule items for an event date, earliest first
	 *
	 * @param int $event_date_id Event date ID.
	 * @return ScheduleItem[] Array of ScheduleItem objects.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY start_datetime ASC, sort_order ASC, id ASC',
				self::get_table_name(),
				$event_date_id
			)
		);

		return array_map( array( self::class, 'hydrate' ), (array) $results );
	}

	/**
	 * The ticket options of an event date that its schedule marks as not
	 * bookable.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int[] Ticket option IDs.
	 */
	public static function get_non_bookable_option_ids_by_event_date_id( $event_date_id ) {
		global $wpdb;

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT ticket_option_id FROM %i WHERE event_date_id = %d AND ticket_option_id IS NOT NULL AND bookable = 0',
					self::get_table_name(),
					$event_date_id
				)
			)
		);
	}

	/**
	 * Which of the given ticket options a schedule marks as not bookable.
	 *
	 * @param int[] $ticket_option_ids Ticket option IDs.
	 * @return int[] The not-bookable ones.
	 */
	public static function filter_non_bookable_option_ids( array $ticket_option_ids ) {
		global $wpdb;

		$ticket_option_ids = array_values( array_unique( array_filter( array_map( 'intval', $ticket_option_ids ) ) ) );
		if ( ! $ticket_option_ids ) {
			return array();
		}

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT ticket_option_id FROM %i WHERE bookable = 0 AND ticket_option_id IN (' . implode( ', ', array_fill( 0, count( $ticket_option_ids ), '%d' ) ) . ')',
					array_merge( array( self::get_table_name() ), $ticket_option_ids )
				)
			)
		);
	}

	/**
	 * Which of the given ticket options have a schedule entry.
	 *
	 * @param int[] $ticket_option_ids Ticket option IDs.
	 * @return int[] The scheduled ones.
	 */
	public static function filter_linked_option_ids( array $ticket_option_ids ) {
		global $wpdb;

		$ticket_option_ids = array_values( array_unique( array_filter( array_map( 'intval', $ticket_option_ids ) ) ) );
		if ( ! $ticket_option_ids ) {
			return array();
		}

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT ticket_option_id FROM %i WHERE ticket_option_id IN (' . implode( ', ', array_fill( 0, count( $ticket_option_ids ), '%d' ) ) . ')',
					array_merge( array( self::get_table_name() ), $ticket_option_ids )
				)
			)
		);
	}

	/**
	 * Create a schedule item
	 *
	 * @param array $data event_date_id, ticket_option_id, bookable, title, start_datetime, end_datetime, description, location, sort_order.
	 * @return int|false The item ID on success, false on failure.
	 */
	public static function create( array $data ) {
		global $wpdb;

		$columns = self::columns( $data );
		$result  = $wpdb->insert(
			self::get_table_name(),
			array_merge( array( 'event_date_id' => (int) $data['event_date_id'] ), $columns['values'] ),
			array_merge( array( '%d' ), $columns['formats'] )
		);

		return $result ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Update a schedule item
	 *
	 * @param int   $id   Item ID.
	 * @param array $data Same keys as create(), without event_date_id.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, array $data ) {
		global $wpdb;

		$columns = self::columns( $data );
		$result  = $wpdb->update(
			self::get_table_name(),
			$columns['values'],
			array( 'id' => (int) $id ),
			$columns['formats'],
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete a schedule item
	 *
	 * @param int $id Item ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		return false !== $wpdb->delete( self::get_table_name(), array( 'id' => (int) $id ), array( '%d' ) );
	}

	/**
	 * Delete all schedule items for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		return false !== $wpdb->delete( self::get_table_name(), array( 'event_date_id' => (int) $event_date_id ), array( '%d' ) );
	}

	/**
	 * The writable columns of a row, with their formats. A null
	 * ticket_option_id is written as SQL NULL.
	 *
	 * @param array $data Item data.
	 * @return array{values: array, formats: string[]}
	 */
	private static function columns( array $data ) {
		return array(
			'values'  => array(
				'ticket_option_id' => ! empty( $data['ticket_option_id'] ) ? (int) $data['ticket_option_id'] : null,
				'bookable'         => ! empty( $data['bookable'] ) ? 1 : 0,
				'title'            => (string) ( $data['title'] ?? '' ),
				'start_datetime'   => (string) $data['start_datetime'],
				'end_datetime'     => (string) $data['end_datetime'],
				'description'      => (string) ( $data['description'] ?? '' ),
				'location'         => (string) ( $data['location'] ?? '' ),
				'sort_order'       => (int) ( $data['sort_order'] ?? 0 ),
			),
			'formats' => array( '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%d' ),
		);
	}

	/**
	 * Hydrate a schedule item from a database row
	 *
	 * @param object $row Database row.
	 * @return ScheduleItem Schedule item object.
	 */
	private static function hydrate( $row ) {
		$item                   = new self();
		$item->id               = (int) $row->id;
		$item->event_date_id    = (int) $row->event_date_id;
		$item->ticket_option_id = null !== $row->ticket_option_id ? (int) $row->ticket_option_id : null;
		$item->bookable         = (bool) (int) $row->bookable;
		$item->title            = (string) $row->title;
		$item->start_datetime   = (string) $row->start_datetime;
		$item->end_datetime     = (string) $row->end_datetime;
		$item->description      = (string) $row->description;
		$item->location         = (string) $row->location;
		$item->sort_order       = (int) $row->sort_order;

		return $item;
	}
}
