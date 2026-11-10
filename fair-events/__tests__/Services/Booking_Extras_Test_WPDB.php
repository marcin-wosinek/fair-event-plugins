<?php
/**
 * $wpdb double for booking extras tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

/**
 * Extends the bootstrap's Fair_Test_WPDB with the two multi-row reads
 * BookingExtras::for_signup() makes — a signup's tickets and those
 * tickets' activity rows — answered from seeded rows. Ticket options are
 * resolved through the parent's seed_row()/get_row().
 */
class Booking_Extras_Test_WPDB extends \Fair_Test_WPDB {

	/**
	 * Seeded tickets, keyed by signup ID.
	 *
	 * @var array<int, object[]>
	 */
	private $tickets = array();

	/**
	 * Seeded activity rows, keyed by ticket ID.
	 *
	 * @var array<int, object[]>
	 */
	private $activities = array();

	/**
	 * Next generated activity row ID.
	 *
	 * @var int
	 */
	private $next_activity_id = 1;

	/**
	 * Seed a ticket on a signup.
	 *
	 * @param int $signup_id Signup row ID.
	 * @param int $ticket_id Ticket ID.
	 * @return void
	 */
	public function seed_ticket( $signup_id, $ticket_id ) {
		$this->tickets[ $signup_id ][] = (object) array(
			'id'            => $ticket_id,
			'signup_id'     => $signup_id,
			'unit_position' => count( $this->tickets[ $signup_id ] ?? array() ),
		);
	}

	/**
	 * Seed an activity selected on a ticket.
	 *
	 * @param int         $ticket_id   Ticket ID.
	 * @param int         $option_id   Ticket option ID.
	 * @param string      $stored_name Name stored with the selection.
	 * @param string      $status      Selection status.
	 * @param string|null $expires_at  Hold expiry.
	 * @return void
	 */
	public function seed_activity( $ticket_id, $option_id, $stored_name, $status = 'confirmed', $expires_at = null ) {
		$this->activities[ $ticket_id ][] = (object) array(
			'id'                 => $this->next_activity_id++,
			'ticket_id'          => $ticket_id,
			'ticket_option_id'   => $option_id,
			'ticket_option_name' => $stored_name,
			'status'             => $status,
			'expires_at'         => $expires_at,
		);
	}

	/**
	 * Seed a ticket option row for TicketOption::get_by_id().
	 *
	 * @param int    $option_id Option ID.
	 * @param string $name      Current option name.
	 * @param float  $price     Option price.
	 * @return void
	 */
	public function seed_option( $option_id, $name, $price = 0.0 ) {
		$this->seed_row(
			$this->prefix . 'fair_events_ticket_options',
			$option_id,
			(object) array(
				'id'            => $option_id,
				'event_date_id' => 1,
				'name'          => $name,
				'short_name'    => null,
				'price'         => $price,
				'sort_order'    => 0,
				'created_at'    => '2026-01-01 00:00:00',
				'updated_at'    => '2026-01-01 00:00:00',
			)
		);
	}

	/**
	 * Answer the ticket and activity reads from seeded rows.
	 *
	 * @param array|mixed $query Value returned by prepare().
	 * @return array
	 */
	public function get_results( $query ) {
		if ( ! is_array( $query ) ) {
			return array();
		}

		if ( $this->prefix . 'fair_events_tickets' === $query['table'] && str_contains( $query['query'], 'WHERE signup_id = %d' ) ) {
			return $this->tickets[ (int) $query['args'][1] ] ?? array();
		}

		if ( $this->prefix . 'fair_events_ticket_activities' === $query['table'] && str_contains( $query['query'], 'WHERE ticket_id IN' ) ) {
			$rows = array();
			foreach ( array_slice( $query['args'], 1 ) as $ticket_id ) {
				foreach ( $this->activities[ (int) $ticket_id ] ?? array() as $row ) {
					$rows[] = $row;
				}
			}
			usort(
				$rows,
				static function ( $a, $b ) {
					return $a->id <=> $b->id;
				}
			);
			return $rows;
		}

		return parent::get_results( $query );
	}
}
