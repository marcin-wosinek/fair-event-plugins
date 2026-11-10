<?php
/**
 * Extras selected with a booking
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventTicket;
use FairEvents\Models\EventTicketActivity;
use FairEvents\Models\TicketOption;

defined( 'WPINC' ) || die;

/**
 * Resolves the extras (ticket options) selected with one booking, for its
 * confirmation email (issue #2213).
 *
 * Only the signup's own tickets are read, so another booking by the same
 * participant for the same date never leaks in. A selection counts once it
 * is confirmed, whatever its price; an add-on still awaiting its own payment
 * does not. Both confirmation senders — fair-events' baseline EmailService
 * and fair-audience's — read the names through for_signup(), so the list is
 * identical whichever plugin sends the email.
 */
class BookingExtras {

	/**
	 * Names of the extras confirmed on a signup's tickets, each listed once,
	 * in the order they were selected. Unescaped: escape at the output.
	 *
	 * Prefers the option's current name so a rename is reflected, falling
	 * back to the name stored with the selection when the option is gone or
	 * its name is empty.
	 *
	 * @param int $signup_id The fair_events_signups row ID.
	 * @return string[]
	 */
	public static function for_signup( $signup_id ) {
		$signup_id = (int) $signup_id;
		if ( $signup_id <= 0 ) {
			return array();
		}

		$ticket_ids = array();
		foreach ( EventTicket::get_by_signup_id( $signup_id ) as $ticket ) {
			$ticket_ids[] = (int) $ticket->id;
		}

		$names   = array();
		$options = array();
		foreach ( EventTicketActivity::get_by_ticket_ids( $ticket_ids ) as $rows ) {
			foreach ( $rows as $row ) {
				if ( 'confirmed' !== $row->status ) {
					continue;
				}

				$option_id = (int) $row->ticket_option_id;
				if ( ! array_key_exists( $option_id, $options ) ) {
					$options[ $option_id ] = $option_id > 0 ? TicketOption::get_by_id( $option_id ) : null;
				}
				$option = $options[ $option_id ];

				$name = $option && '' !== (string) $option->name
					? (string) $option->name
					: (string) ( $row->ticket_option_name ?? '' );
				if ( '' !== $name ) {
					$names[] = $name;
				}
			}
		}

		return array_values( array_unique( $names ) );
	}
}
