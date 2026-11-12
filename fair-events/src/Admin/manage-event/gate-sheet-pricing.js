/**
 * Price selection for the printable gate sheet (#2212).
 *
 * The gate sheet lists what people arriving at the event pay, so prices are
 * picked for the moment the selected event starts, not for today. Period
 * boundaries resolve exactly like the Prices tab and runtime availability
 * (resolveEffectiveSalePeriods(), mirroring TicketAvailability): starts are
 * inclusive, ends exclusive, and the last period never continues past its
 * end — TicketAvailability never enables that fallback. When no single
 * period covers the event start, the organizer picks one.
 *
 * A missing price stays null and is never shown as free; only a stored zero
 * is free.
 *
 * @package FairEvents
 */

import { resolveEffectiveSalePeriods } from './salePeriodBoundaries.js';

export const GATE_PRICING_RESOLVED = 'resolved';
export const GATE_PRICING_NEEDS_PERIOD = 'needs_period';
export const GATE_PRICING_NO_PERIODS = 'no_periods';

/**
 * Calendar day of a stored date or datetime value.
 *
 * @param {string|null} value 'Y-m-d', 'Y-m-d H:i:s' or ISO value.
 * @return {string} Day (Y-m-d), or '' when unset.
 */
function dayOf( value ) {
	return value ? String( value ).split( ' ' )[ 0 ].split( 'T' )[ 0 ] : '';
}

/**
 * The calendar day after a day, as the exclusive end of the last
 * occurrence's day (TicketAvailability::compute_default_sale_end()).
 *
 * @param {string} day Day (Y-m-d).
 * @return {string} Next day (Y-m-d)
 */
export function dayAfter( day ) {
	const [ year, month, date ] = day.split( '-' ).map( Number );
	return new Date( Date.UTC( year, month - 1, date + 1 ) )
		.toISOString()
		.slice( 0, 10 );
}

/**
 * Site-local start moment of an event date, comparable with stored
 * datetimes. A date without a start time (or all-day) starts at midnight.
 *
 * @param {Object|null} timing Object with `start_date`, `start_time`, `all_day`.
 * @return {string} 'Y-m-d H:i:s', or '' without a start date.
 */
export function eventStartMoment( timing ) {
	if ( ! timing?.start_date ) {
		return '';
	}
	const time = ( ! timing.all_day && timing.start_time ) || '00:00:00';
	const padded = /^\d{2}:\d{2}$/.test( time ) ? `${ time }:00` : time;
	return `${ timing.start_date } ${ padded }`;
}

/**
 * A number from a stored price, or null when none is stored.
 *
 * @param {*} value Stored price.
 * @return {number|null} Price
 */
function storedPrice( value ) {
	if ( value === null || value === undefined || value === '' ) {
		return null;
	}
	const number = Number( value );
	return Number.isFinite( number ) ? number : null;
}

/**
 * Whether a ticket type can be bought at the given moment: not switched off
 * and not past its scheduled cutoff. Mirrors
 * TicketAvailability::is_ticket_type_enabled().
 *
 * @param {Object} ticketType Ticket type with `disabled` and `disable_at`.
 * @param {string} moment     Site-local 'Y-m-d H:i:s'.
 * @return {boolean} Whether the type is enabled then
 */
export function isTicketTypeEnabledAt( ticketType, moment ) {
	return (
		! ticketType.disabled &&
		( ! ticketType.disable_at || ticketType.disable_at > moment )
	);
}

/**
 * Resolve the configured periods' effective boundaries for the event.
 *
 * @param {Object}      args
 * @param {Object[]}    args.salePeriods         Saved sale periods, in order.
 * @param {string}      args.siteToday           Site-local today (Y-m-d).
 * @param {string|null} args.finalOccurrenceDate End day of the event or series' final occurrence.
 * @param {string|null} args.createdDate         Creation day of the event or series.
 * @return {Object[]} Periods with `effectiveStart` / `effectiveEnd` (Y-m-d or null)
 */
export function resolveGatePeriods( {
	salePeriods,
	siteToday,
	finalOccurrenceDate,
	createdDate,
} ) {
	return resolveEffectiveSalePeriods(
		( salePeriods || [] ).map( ( period ) => ( {
			...period,
			sale_start: dayOf( period.sale_start ),
			sale_end: dayOf( period.sale_end ),
		} ) ),
		siteToday,
		finalOccurrenceDate ? dayAfter( dayOf( finalOccurrenceDate ) ) : null,
		createdDate
	);
}

/**
 * Periods covering the event start: start inclusive, end exclusive, both
 * resolved.
 *
 * @param {Object[]} resolvedPeriods Output of resolveGatePeriods().
 * @param {string}   startDay        Event start day (Y-m-d).
 * @return {Object[]} Matching periods
 */
export function periodsCoveringDay( resolvedPeriods, startDay ) {
	if ( ! startDay ) {
		return [];
	}
	return resolvedPeriods.filter(
		( period ) =>
			period.effectiveStart &&
			period.effectiveEnd &&
			period.effectiveStart <= startDay &&
			startDay < period.effectiveEnd
	);
}

/**
 * Price an extra option for a pricing period, the way
 * ActivityOptionPriceResolver::price_for_period() does.
 *
 * @param {Object}      option Extra as the tickets response lists it.
 * @param {Object|null} period Pricing period, or null when none applies.
 * @return {number|null} Price, or null when none is configured
 */
export function extraPriceForPeriod( option, period ) {
	if ( ! option.derive_price_from_sale_period ) {
		return storedPrice( option.price );
	}
	if ( ! period ) {
		return null;
	}
	const row = ( option.period_prices || [] ).find(
		( entry ) => Number( entry.sale_period_id ) === Number( period.id )
	);
	return row ? storedPrice( row.price ) : null;
}

/**
 * Resolve the price reference printed on the gate sheet.
 *
 * @param {Object}      args
 * @param {Object}      args.config              Saved ticket configuration: `ticketTypes`, `options`, `salePeriods`, `prices`, `createdDate`.
 * @param {Object}      args.eventTiming         Timing of the selected event date.
 * @param {string}      args.siteToday           Site-local today (Y-m-d).
 * @param {string|null} args.finalOccurrenceDate End day of the event or series' final occurrence.
 * @param {number|null} args.selectedPeriodId    Period chosen by the organizer, if any.
 * @return {Object} `{ status, period, isManualPeriod, periods, tickets, extras, hasMissingPrice }`
 */
export function resolveGatePricing( {
	config,
	eventTiming,
	siteToday,
	finalOccurrenceDate,
	selectedPeriodId = null,
} ) {
	const moment = eventStartMoment( eventTiming );
	const periods = resolveGatePeriods( {
		salePeriods: config.salePeriods,
		siteToday,
		finalOccurrenceDate,
		createdDate: config.createdDate,
	} );

	let status = GATE_PRICING_RESOLVED;
	let period = null;
	let isManualPeriod = false;
	if ( periods.length === 0 ) {
		status = GATE_PRICING_NO_PERIODS;
	} else {
		const chosen =
			selectedPeriodId !== null && selectedPeriodId !== undefined
				? periods.find(
						( entry ) =>
							Number( entry.id ) === Number( selectedPeriodId )
					)
				: null;
		const covering = periodsCoveringDay( periods, dayOf( moment ) );
		if ( chosen ) {
			period = chosen;
			isManualPeriod = true;
		} else if ( covering.length === 1 ) {
			period = covering[ 0 ];
		} else {
			status = GATE_PRICING_NEEDS_PERIOD;
		}
	}

	const prices = config.prices || [];
	const tickets = ( config.ticketTypes || [] ).map( ( type ) => {
		const row = period
			? prices.find(
					( entry ) =>
						Number( entry.ticket_type_id ) === Number( type.id ) &&
						Number( entry.sale_period_id ) === Number( period.id )
				)
			: null;
		return {
			id: type.id,
			name: type.name,
			price: row ? storedPrice( row.price ) : null,
			isAvailable: isTicketTypeEnabledAt( type, moment ),
		};
	} );
	const extras = ( config.options || [] ).map( ( option ) => ( {
		id: option.id,
		name: option.name,
		price: extraPriceForPeriod( option, period ),
	} ) );

	return {
		status,
		period,
		isManualPeriod,
		periods,
		tickets,
		extras,
		hasMissingPrice: [ ...tickets, ...extras ].some(
			( entry ) => entry.price === null
		),
	};
}
