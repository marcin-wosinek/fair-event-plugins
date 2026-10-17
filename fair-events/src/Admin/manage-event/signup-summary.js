/**
 * Signup summary text builder.
 *
 * Builds the plain-text summary the List tab's "Summary" button copies: the
 * number of confirmed tickets on the date, the tickets sold per ticket type
 * and the tickets holding each add-on, ready to paste into a message. Only
 * names and counts are copied, never participant details.
 *
 * Test-mode purchases are counted apart, in their own section, so they never
 * inflate the operational totals.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';

export const SUMMARY_TICKETS_PENDING = 'tickets_pending';
export const SUMMARY_UNKNOWN_PAYMENT_MODE = 'unknown_payment_mode';
export const SUMMARY_UNKNOWN_TICKET_TYPE = 'unknown_ticket_type';
export const SUMMARY_UNKNOWN_ADDON = 'unknown_addon';

/**
 * Counts of one section of the summary.
 *
 * @return {{total: number, untyped: number, types: Map<number, number>, addons: Map<number, number>}} Empty counts
 */
function emptyCounts() {
	return { total: 0, untyped: 0, types: new Map(), addons: new Map() };
}

/**
 * Add one to a count kept by ID.
 *
 * @param {Map<number, number>} counts Counts by ID.
 * @param {number}              id     ID to count.
 */
function increment( counts, id ) {
	counts.set( id, ( counts.get( id ) || 0 ) + 1 );
}

/**
 * Count the confirmed tickets of the List into a summary: one count per
 * ticket, by its own type and the add-ons confirmed on it. Configured ticket
 * types and add-ons keep their order and stay listed with zero counts; types
 * and add-ons used outside the configuration follow, ordered by ID.
 *
 * The summary is refused when any count could be wrong: a registration whose
 * tickets were not created yet, a purchase whose payment mode is unknown, or
 * a ticket type or add-on whose name cannot be resolved.
 *
 * @param {Object} args
 * @param {Array}  args.rows        Rows from expandTicketRows() over every
 *                                  confirmed registration, unfiltered.
 * @param {Array}  args.ticketTypes Ticket types of the event, in order.
 * @param {Array}  args.options     Add-ons of the event, in order.
 * @return {{error: string}|{types: Array, addons: Array, hasUntyped: boolean, operational: Object, test: Object}} Summary, or the reason it is unavailable
 */
export function buildSignupSummary( { rows, ticketTypes, options } ) {
	const typeNames = new Map(
		ticketTypes.map( ( type ) => [ Number( type.id ), type.name ] )
	);
	const addonNames = new Map(
		options.map( ( option ) => [
			Number( option.id ),
			option.short_name || option.name,
		] )
	);
	const operational = emptyCounts();
	const test = emptyCounts();

	for ( const { signup, ticket } of rows ) {
		if ( ! ticket ) {
			return { error: SUMMARY_TICKETS_PENDING };
		}
		if ( typeof signup.is_test_payment !== 'boolean' ) {
			return { error: SUMMARY_UNKNOWN_PAYMENT_MODE };
		}
		const counts = signup.is_test_payment ? test : operational;
		counts.total += 1;

		if ( ticket.ticket_type_id ) {
			const typeId = Number( ticket.ticket_type_id );
			if ( ! typeNames.has( typeId ) ) {
				if ( ! ticket.ticket_type_name ) {
					return { error: SUMMARY_UNKNOWN_TICKET_TYPE };
				}
				typeNames.set( typeId, ticket.ticket_type_name );
			}
			increment( counts.types, typeId );
		} else {
			counts.untyped += 1;
		}

		for ( const addonId of ( ticket.confirmed_activity_ids || [] ).map(
			Number
		) ) {
			if ( ! addonNames.has( addonId ) ) {
				return { error: SUMMARY_UNKNOWN_ADDON };
			}
			increment( counts.addons, addonId );
		}
	}

	// Configured entries first, in their order; then the ones found only on
	// tickets, by ID.
	const entries = ( names, configured ) => {
		const configuredIds = configured.map( ( item ) => Number( item.id ) );
		const otherIds = [ ...names.keys() ]
			.filter( ( id ) => ! configuredIds.includes( id ) )
			.sort( ( a, b ) => a - b );
		return [ ...configuredIds, ...otherIds ].map( ( id ) => ( {
			id,
			name: names.get( id ),
		} ) );
	};

	return {
		types: entries( typeNames, ticketTypes ),
		addons: entries( addonNames, options ),
		hasUntyped: operational.untyped + test.untyped > 0,
		operational,
		test,
	};
}

/**
 * Why the summary is unavailable, as the List explains it.
 *
 * @param {string} error One of the SUMMARY_* reasons.
 * @return {string} Explanation
 */
export function signupSummaryErrorMessage( error ) {
	switch ( error ) {
		case SUMMARY_TICKETS_PENDING:
			return __(
				'The summary is unavailable while some older registrations are still being split into individual tickets. Reload this page in a few minutes and try again.',
				'fair-events'
			);
		case SUMMARY_UNKNOWN_PAYMENT_MODE:
			return __(
				'The summary is unavailable because it could not be determined whether some purchases were test payments.',
				'fair-events'
			);
		case SUMMARY_UNKNOWN_TICKET_TYPE:
			return __(
				'The summary is unavailable because some tickets have a ticket type whose name could not be found.',
				'fair-events'
			);
		default:
			return __(
				'The summary is unavailable because some tickets hold an add-on that is no longer configured for this event.',
				'fair-events'
			);
	}
}

/**
 * Lines of one section: its total and the ticket-type and add-on lists.
 *
 * @param {Object} summary Summary from buildSignupSummary().
 * @param {Object} counts  Counts of the section.
 * @return {string[]} Lines
 */
function sectionLines( summary, counts ) {
	const entryLine = ( name, count ) => `- ${ name }: ${ count }`;
	const typeLines = summary.types.map( ( { id, name } ) =>
		entryLine( name, counts.types.get( id ) || 0 )
	);
	if ( summary.hasUntyped ) {
		typeLines.push(
			entryLine( __( 'No ticket type', 'fair-events' ), counts.untyped )
		);
	}
	const addonLines = summary.addons.map( ( { id, name } ) =>
		entryLine( name, counts.addons.get( id ) || 0 )
	);
	const none = `- ${ __( 'none', 'fair-events' ) }`;

	return [
		sprintf(
			/* translators: %d: number of confirmed tickets */
			_n(
				'Total tickets: %d',
				'Total tickets: %d',
				counts.total,
				'fair-events'
			),
			counts.total
		),
		'',
		__( 'Ticket types:', 'fair-events' ),
		...( typeLines.length ? typeLines : [ none ] ),
		'',
		__( 'Add-ons:', 'fair-events' ),
		...( addonLines.length ? addonLines : [ none ] ),
	];
}

/**
 * Plain text of the summary: the operational counts, then, when there are
 * confirmed test purchases, their counts in a separate section.
 *
 * @param {Object} summary Summary from buildSignupSummary().
 * @return {string} Summary text
 */
export function formatSignupSummary( summary ) {
	const lines = sectionLines( summary, summary.operational );
	if ( summary.test.total > 0 ) {
		lines.push(
			'',
			__(
				'Test payments — excluded from operational totals',
				'fair-events'
			),
			'',
			...sectionLines( summary, summary.test )
		);
	}
	return lines.join( '\n' );
}
