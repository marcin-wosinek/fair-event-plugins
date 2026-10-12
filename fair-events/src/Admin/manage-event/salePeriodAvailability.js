/**
 * Pure helpers for finding the dates inside a sale period on which no ticket
 * type can be bought. Derived from the ticket editor's own draft state, so
 * the warning follows unsaved edits and matches what a save would store.
 *
 * Mirrors the backend rules: a ticket type is purchasable only while it is
 * enabled (TicketAvailability::is_ticket_type_enabled()) and has an explicit
 * price row for the active period (TicketPricing::resolve_unit_price()).
 * Capacity, payment setup, and participant-specific eligibility are separate
 * concerns and never produce a gap here.
 *
 * Every date is a site-local Y-m-d string and all arithmetic stays on those
 * strings, so the browser's timezone can never shift a date.
 *
 * @package FairEvents
 */

const shiftDate = ( dateStr, days ) => {
	const [ year, month, day ] = dateStr.split( '-' ).map( Number );
	return new Date( Date.UTC( year, month - 1, day + days ) )
		.toISOString()
		.slice( 0, 10 );
};

/**
 * The first calendar date on which a ticket type with a scheduled cutoff is
 * unavailable for the whole day. The backend compares full timestamps, so a
 * type that disables during a day is still on sale for part of that day —
 * only a cutoff at exactly midnight makes its own date unavailable.
 *
 * @param {string|null|undefined} disableAt Site-local cutoff (`Y-m-d H:i[:s]`, space or `T` separated), or empty when the type has no cutoff.
 * @return {string|null} First fully unavailable date (Y-m-d), or null when the type never disables.
 */
export function firstUnavailableDate( disableAt ) {
	if ( ! disableAt ) {
		return null;
	}

	const [ datePart, timePart = '' ] = String( disableAt ).split( /[ T]/ );
	const isMidnight = ! /[1-9]/.test( timePart );

	return isMidnight ? datePart : shiftDate( datePart, 1 );
}

/**
 * Whether saving a draft price cell would store a price row. Matches
 * buildSavePayload() in EventTickets.js: an unticked "Available" checkbox
 * (multiple-periods mode only) or a wholly empty cell stores nothing, while a
 * blank price next to a capacity stores an explicit zero price.
 *
 * @param {Object|null|undefined} cell                 Draft cell (`price`/`capacity` strings, `enabled` flag).
 * @param {boolean}               respectAvailableFlag Whether the "Available" checkbox applies (multiple-periods mode).
 * @return {boolean} True when the cell saves as a price row.
 */
export function hasPriceRow( cell, respectAvailableFlag ) {
	if ( ! cell ) {
		return false;
	}
	if ( respectAvailableFlag && ! cell.enabled ) {
		return false;
	}

	return cell.price !== '' || cell.capacity !== '';
}

/**
 * Find, for every sale period, the dates on which no ticket type is on sale.
 *
 * A ticket type only ever stops being available (manual disabling applies to
 * every date, a scheduled cutoff to every date after it), so a period's
 * unavailable dates always form a single range reaching the period's end.
 *
 * Periods with an unresolved boundary are skipped rather than given invented
 * dates. An event with no ticket types at all is not ticketed, so it has no
 * gaps to report.
 *
 * @param {Object}   args
 * @param {Object[]} args.ticketTypes          Draft ticket types (`disabled`, `disable_at`).
 * @param {Object[]} args.periods              Resolved periods (`effectiveStart` inclusive, `effectiveEnd` exclusive; see salePeriodBoundaries.js).
 * @param {Function} args.getPriceCell         `( ticketType, periodIndex ) => cell` returning the draft price cell.
 * @param {boolean}  args.respectAvailableFlag Whether the "Available" checkbox applies (multiple-periods mode).
 * @return {Object[]} One `{ periodIndex, start, end }` entry per affected period, with `start`/`end` as inclusive Y-m-d dates.
 */
export function findUnavailableSaleDates( {
	ticketTypes,
	periods,
	getPriceCell,
	respectAvailableFlag,
} ) {
	if ( ! ticketTypes || ticketTypes.length === 0 ) {
		return [];
	}

	const gaps = [];

	( periods || [] ).forEach( ( period, periodIndex ) => {
		const start = period.effectiveStart;
		const end = period.effectiveEnd;
		if ( ! start || ! end || start >= end ) {
			return;
		}

		// The earliest date by which every priced, enabled type has already
		// disabled — meaningless while one of them never disables.
		let gapStart = start;
		const hasOpenEndedType = ticketTypes.some( ( type ) => {
			if (
				type.disabled ||
				! hasPriceRow(
					getPriceCell( type, periodIndex ),
					respectAvailableFlag
				)
			) {
				return false;
			}

			const cutoff = firstUnavailableDate( type.disable_at );
			if ( ! cutoff ) {
				return true;
			}
			if ( cutoff > gapStart ) {
				gapStart = cutoff;
			}
			return false;
		} );

		if ( hasOpenEndedType || gapStart >= end ) {
			return;
		}

		gaps.push( {
			periodIndex,
			start: gapStart,
			end: shiftDate( end, -1 ),
		} );
	} );

	return gaps;
}
