/**
 * Search and CSV export of the Audience tab's tickets.
 *
 * The tab searches by purchaser, assignee, email and ticket reference. One
 * pass decides which tickets match; the table and the ticket export both
 * read its result, so they never disagree.
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';

const includesTerm = ( value, term ) =>
	String( value ?? '' )
		.toLowerCase()
		.includes( term );

/**
 * Whether a ticket matches a search term: by its reference, or by the name
 * or email of its purchaser or assignee.
 *
 * @param {Object} ticket Ticket from the participants endpoint.
 * @param {string} term   Lowercase search term.
 * @return {boolean} Whether it matches.
 */
export const ticketMatches = ( ticket, term ) =>
	includesTerm( ticket.reference, term ) ||
	[ ticket.purchaser, ticket.assignee ].some(
		( person ) =>
			includesTerm( person?.name, term ) ||
			includesTerm( person?.email, term )
	);

/**
 * Narrow participants to those a search term finds, each with only its
 * matching tickets.
 *
 * A participant is listed when their own name or email matches, or when one
 * of the tickets they hold does. Within a listed participant only matching
 * tickets are kept, so two tickets bought with one email are told apart by
 * assignee or reference. `holds_tickets` records that the participant holds
 * tickets even when none of them is shown.
 *
 * @param {Array}  participants Participants from the participants endpoint.
 * @param {string} searchText   Search text as typed.
 * @return {Array} Matching participants.
 */
export const searchParticipants = ( participants, searchText ) => {
	const term = ( searchText || '' ).trim().toLowerCase();
	if ( ! term ) {
		return participants;
	}

	const matched = [];
	participants.forEach( ( p ) => {
		const tickets = ( p.tickets || [] ).filter( ( t ) =>
			ticketMatches( t, term )
		);
		const cancelled = ( p.cancelled_tickets || [] ).filter( ( t ) =>
			ticketMatches( t, term )
		);
		const participantMatches =
			includesTerm( p.participant_name, term ) ||
			includesTerm( p.participant_email, term );

		if (
			! participantMatches &&
			tickets.length === 0 &&
			cancelled.length === 0
		) {
			return;
		}

		matched.push( {
			...p,
			tickets,
			cancelled_tickets: cancelled,
			holds_tickets: ( p.tickets || [] ).length > 0,
		} );
	} );

	return matched;
};

/**
 * Every ticket of the given participants, active ones first within each
 * participant, as the table lists them.
 *
 * @param {Array} participants Participants, already narrowed by the search.
 * @return {Array} Tickets.
 */
export const ticketsOf = ( participants ) =>
	participants.flatMap( ( p ) => [
		...( p.tickets || [] ),
		...( p.cancelled_tickets || [] ),
	] );

/**
 * Escape one CSV field. Every field is quoted, with interior quotes
 * doubled. A value a spreadsheet would run as a formula (starting with =,
 * +, - or @, or with a tab or carriage return) is prefixed with an
 * apostrophe so it stays text.
 *
 * @param {*} value Field value.
 * @return {string} Escaped field.
 */
export const escapeCsvField = ( value ) => {
	let text = value === null || value === undefined ? '' : String( value );
	if ( /^[=+\-@\t\r]/.test( text ) ) {
		text = `'${ text }`;
	}
	return `"${ text.replace( /"/g, '""' ) }"`;
};

/**
 * Build the tickets CSV: one row per ticket, naming its purchaser and its
 * assignee.
 *
 * @param {Object}   args
 * @param {Array}    args.tickets       Tickets to export.
 * @param {Function} args.eventDate     Given an event date ID, its date as text.
 * @param {Function} args.statusLabel   Given a ticket status, its display name.
 * @return {string} CSV text.
 */
export const buildTicketsCsv = ( { tickets, eventDate, statusLabel } ) => {
	const header = [
		__( 'Ticket ID', 'fair-audience' ),
		__( 'Reference', 'fair-audience' ),
		__( 'Event date', 'fair-audience' ),
		__( 'Ticket type', 'fair-audience' ),
		__( 'Status', 'fair-audience' ),
		__( 'Activities', 'fair-audience' ),
		__( 'Checked in', 'fair-audience' ),
		__( 'Purchaser ID', 'fair-audience' ),
		__( 'Purchaser name', 'fair-audience' ),
		__( 'Purchaser email', 'fair-audience' ),
		__( 'Assignee ID', 'fair-audience' ),
		__( 'Assignee name', 'fair-audience' ),
		__( 'Assignee email', 'fair-audience' ),
	];

	const rows = tickets.map( ( ticket ) => [
		ticket.id,
		ticket.reference,
		eventDate( ticket.event_date_id ),
		ticket.ticket_type_name,
		statusLabel( ticket.status ),
		( ticket.activity_names || [] ).join( '; ' ),
		ticket.attended_at,
		ticket.purchaser?.participant_id,
		ticket.purchaser?.name,
		ticket.purchaser?.email,
		ticket.assignee?.participant_id,
		ticket.assignee?.name,
		ticket.assignee?.email,
	] );

	return [ header, ...rows ]
		.map( ( row ) => row.map( escapeCsvField ).join( ',' ) )
		.join( '\r\n' );
};

/**
 * Download text as a UTF-8 CSV file, with a BOM so spreadsheets detect the
 * encoding.
 *
 * @param {string} text     CSV text.
 * @param {string} filename File name.
 */
export const downloadCsvFile = ( text, filename ) => {
	const blob = new Blob( [ '﻿' + text ], {
		type: 'text/csv;charset=utf-8;',
	} );
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL( url );
};
