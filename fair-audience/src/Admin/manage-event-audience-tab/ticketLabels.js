/**
 * Labels for the Audience tab's ticket rows.
 *
 * @package FairAudience
 */

import { __, sprintf } from '@wordpress/i18n';

const TICKET_STATUS_DISPLAY = {
	confirmed: __( 'Confirmed', 'fair-audience' ),
	pending_payment: __( 'Awaiting payment', 'fair-audience' ),
};

/**
 * Display name of a ticket's status.
 *
 * @param {string} status Ticket status from the participants endpoint.
 * @return {string} Label.
 */
export const ticketStatusLabel = ( status ) =>
	TICKET_STATUS_DISPLAY[ status ] || status;

/**
 * Ticket number and reference, without the ticket type, for rows that
 * show the type in a column of its own.
 *
 * @param {Object} ticket   Ticket from the participants endpoint.
 * @param {number} position 1-based number of the ticket within its purchase.
 * @return {string} Label.
 */
export const ticketShortLabel = ( ticket, position ) =>
	sprintf(
		/* translators: 1: ticket number within its purchase, 2: short ticket reference */
		__( 'Ticket %1$d (%2$s)', 'fair-audience' ),
		position,
		ticket.reference
	);

/**
 * Short, human-readable name for one of a participant's tickets.
 *
 * @param {Object} ticket   Ticket from the participants endpoint.
 * @param {number} position 1-based number of the ticket within its purchase.
 * @return {string} Label.
 */
export const ticketLabel = ( ticket, position ) =>
	ticket.ticket_type_name
		? sprintf(
				/* translators: 1: ticket number within its purchase, 2: ticket type name, 3: short ticket reference */
				__( 'Ticket %1$d — %2$s (%3$s)', 'fair-audience' ),
				position,
				ticket.ticket_type_name,
				ticket.reference
		  )
		: ticketShortLabel( ticket, position );
