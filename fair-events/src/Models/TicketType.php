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
	 * Whether this ticket type requires an invitation token
	 *
	 * @var bool
	 */
	public $invitation_only = false;

	/**
	 * Minimum activities this ticket type requires (0 = inherit event-date global).
	 *
	 * Only ever raises the event-date-wide minimum; a value below the global is
	 * ignored at enforcement time.
	 *
	 * @var int
	 */
	public $minimum_activities = 0;

	/**
	 * Date/time after which this ticket type is no longer available (null = no end date)
	 *
	 * @var string|null
	 */
	public $disable_at;

	/**
	 * Whether this ticket type covers a single occurrence or the whole recurring series
	 *
	 * @var string 'single_instance'|'whole_series'
	 */
	public $recurrence_scope = 'single_instance';

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
	 * Valid values for the recurrence_scope column.
	 */
	const RECURRENCE_SCOPES = array( 'single_instance', 'whole_series' );

	/**
	 * Create a new ticket type
	 *
	 * @param int         $event_date_id      Event date ID.
	 * @param string      $name               Name.
	 * @param int|null    $capacity           Capacity (null = no limit).
	 * @param int         $sort_order         Sort order.
	 * @param int         $seats_per_ticket   Seats consumed per ticket (default 1).
	 * @param bool        $invitation_only    Whether this ticket requires an invitation token.
	 * @param int         $minimum_activities Minimum activities this type requires (0 = inherit global).
	 * @param string|null $disable_at         Date/time after which this ticket type is unavailable (null = no end date).
	 * @param string      $recurrence_scope   'single_instance' or 'whole_series'.
	 * @return int|false The ticket type ID on success, false on failure.
	 */
	public static function create( $event_date_id, $name, $capacity, $sort_order, $seats_per_ticket = 1, $invitation_only = false, $minimum_activities = 0, $disable_at = null, $recurrence_scope = 'single_instance' ) {
		global $wpdb;

		$table_name = self::get_table_name();

		if ( ! in_array( $recurrence_scope, self::RECURRENCE_SCOPES, true ) ) {
			$recurrence_scope = 'single_instance';
		}

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id'      => $event_date_id,
				'name'               => $name,
				'capacity'           => $capacity,
				'seats_per_ticket'   => max( 1, (int) $seats_per_ticket ),
				'invitation_only'    => $invitation_only ? 1 : 0,
				'minimum_activities' => max( 0, (int) $minimum_activities ),
				'disable_at'         => $disable_at,
				'recurrence_scope'   => $recurrence_scope,
				'sort_order'         => $sort_order,
			),
			array( '%d', '%s', '%d', '%d', '%d', '%d', '%s', '%s', '%d' )
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

		if ( array_key_exists( 'invitation_only', $data ) ) {
			$update_data['invitation_only'] = $data['invitation_only'] ? 1 : 0;
			$update_format[]                = '%d';
		}

		if ( array_key_exists( 'minimum_activities', $data ) ) {
			$update_data['minimum_activities'] = max( 0, (int) $data['minimum_activities'] );
			$update_format[]                   = '%d';
		}

		if ( array_key_exists( 'disable_at', $data ) ) {
			$update_data['disable_at'] = $data['disable_at'];
			$update_format[]           = '%s';
		}

		if ( isset( $data['recurrence_scope'] ) ) {
			$scope                           = in_array( $data['recurrence_scope'], self::RECURRENCE_SCOPES, true )
				? $data['recurrence_scope']
				: 'single_instance';
			$update_data['recurrence_scope'] = $scope;
			$update_format[]                 = '%s';
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
		$item                     = new self();
		$item->id                 = (int) $row->id;
		$item->event_date_id      = (int) $row->event_date_id;
		$item->name               = $row->name;
		$item->capacity           = null !== $row->capacity ? (int) $row->capacity : null;
		$item->seats_per_ticket   = isset( $row->seats_per_ticket ) ? max( 1, (int) $row->seats_per_ticket ) : 1;
		$item->invitation_only    = isset( $row->invitation_only ) && (int) $row->invitation_only === 1;
		$item->minimum_activities = isset( $row->minimum_activities ) ? (int) $row->minimum_activities : 0;
		$item->disable_at         = $row->disable_at ?? null;
		$raw_scope                = $row->recurrence_scope ?? 'single_instance';
		$item->recurrence_scope   = in_array( $raw_scope, self::RECURRENCE_SCOPES, true ) ? $raw_scope : 'single_instance';
		$item->sort_order         = (int) $row->sort_order;
		$item->created_at         = $row->created_at;
		$item->updated_at         = $row->updated_at;

		return $item;
	}

	/**
	 * Whether this ticket type covers the whole recurring series.
	 *
	 * @return bool
	 */
	public function is_whole_series() {
		return 'whole_series' === $this->recurrence_scope;
	}

	/**
	 * Convert to array
	 *
	 * @return array Data as array.
	 */
	public function to_array() {
		return array(
			'id'                 => $this->id,
			'event_date_id'      => $this->event_date_id,
			'name'               => $this->name,
			'capacity'           => $this->capacity,
			'seats_per_ticket'   => $this->seats_per_ticket,
			'invitation_only'    => $this->invitation_only,
			'minimum_activities' => $this->minimum_activities,
			'disable_at'         => $this->disable_at,
			'recurrence_scope'   => $this->recurrence_scope,
			'sort_order'         => $this->sort_order,
			'created_at'         => $this->created_at,
			'updated_at'         => $this->updated_at,
		);
	}
}
