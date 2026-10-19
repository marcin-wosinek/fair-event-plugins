/**
 * Pure helpers for deriving display-only sale-period boundaries when a
 * period's outer start/end is left unset ("automatic"). Mirrors
 * TicketAvailability::resolve_periods() on the PHP side so the admin
 * editor and calendar always agree with runtime availability about what an
 * unset boundary currently means — without ever writing an inferred value
 * back into a period's own sale_start/sale_end (see #1582).
 *
 * @package FairEvents
 */

import { timingStartKey } from 'fair-events-shared/src/dateTime.js';

/**
 * Resolve the lazy default start of the first sale period: the earlier of
 * the site-local day the event (or its series) was created and today.
 * Mirrors TicketAvailability::compute_default_sale_start() — a missing or
 * malformed creation day falls back to today (#1841).
 *
 * @param {string}      siteToday   Site-local today's date (Y-m-d).
 * @param {string|null} createdDate Site-local creation day (Y-m-d), or null.
 * @return {string} Default sale start (Y-m-d), or '' without a site today.
 */
export function resolveDefaultSaleStart( siteToday, createdDate ) {
	if ( ! siteToday ) {
		return '';
	}
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( createdDate || '' ) ) {
		return siteToday;
	}
	return createdDate < siteToday ? createdDate : siteToday;
}

/**
 * Resolve each period's effective sale_start/sale_end for display, without
 * mutating the raw saved values.
 *
 * Only the first period may infer a missing start: it becomes the earlier
 * of the event's creation day and today (see resolveDefaultSaleStart()), as
 * long as that day precedes its effective end. A period that has already
 * ended keeps its inferred start so its range stays visible, matching the
 * backend. Only the last period may infer a missing end: it becomes the day
 * after the event/series' final active occurrence. A missing boundary
 * anywhere else (an interior period, or a first/last period with nothing to
 * infer from) is left null.
 *
 * @param {Object[]}    periods            Raw sale periods (Y-m-d `sale_start`/`sale_end` strings, in sort order).
 * @param {string}      siteToday          Site-local today's date (Y-m-d).
 * @param {string|null} finalOccurrenceEnd Lazy default sale_end for the last period (Y-m-d, exclusive), or null/empty when unavailable.
 * @param {string|null} createdDate        Site-local creation day of the event or its series (Y-m-d), or null.
 * @return {Object[]} Periods augmented with `effectiveStart`, `effectiveEnd`, `isAutomaticStart`, `isAutomaticEnd`.
 */
export function resolveEffectiveSalePeriods(
	periods,
	siteToday,
	finalOccurrenceEnd,
	createdDate = null
) {
	const lastIndex = periods.length - 1;
	const defaultStart = resolveDefaultSaleStart( siteToday, createdDate );

	return periods.map( ( period, index ) => {
		const isFirst = index === 0;
		const isLast = index === lastIndex;

		let effectiveEnd = period.sale_end || null;
		let isAutomaticEnd = false;
		if ( ! effectiveEnd && isLast && finalOccurrenceEnd ) {
			effectiveEnd = finalOccurrenceEnd;
			isAutomaticEnd = true;
		}

		let effectiveStart = period.sale_start || null;
		let isAutomaticStart = false;
		if (
			! effectiveStart &&
			isFirst &&
			effectiveEnd &&
			defaultStart &&
			defaultStart < effectiveEnd
		) {
			effectiveStart = defaultStart;
			isAutomaticStart = true;
		}

		return {
			...period,
			effectiveStart,
			effectiveEnd,
			isAutomaticStart,
			isAutomaticEnd,
		};
	} );
}

/**
 * Resolve the event/series' final active occurrence's end date, mirroring
 * EventDates::get_last_occurrence_boundary() on the backend. Used as the
 * anchor for the ticket editor's lazily-resolved default sale end (day after
 * the last occurrence). The final occurrence is the one starting last.
 *
 * @param {Object|null} eventDate Event date object with `start_date`, `start_time`, `end_date`, and `generated_occurrences` (each with the same fields and `status`).
 * @return {string|null} The final active occurrence's end date (Y-m-d), or null when there's nothing to anchor to.
 */
export function resolveFinalOccurrenceDate( eventDate ) {
	if ( ! eventDate ) {
		return null;
	}

	const occurrences = [
		eventDate,
		...( eventDate.generated_occurrences || [] ).filter(
			( o ) => o.status !== 'cancelled'
		),
	].filter( ( o ) => o.start_date );

	if ( ! occurrences.length ) {
		return null;
	}

	const final = occurrences.sort( ( a, b ) =>
		timingStartKey( a ) < timingStartKey( b ) ? 1 : -1
	)[ 0 ];

	return final.end_date || final.start_date;
}

/**
 * Whether a resolved period sequence has a usable display range: every
 * period must have resolved to both a start and an end. Mirrors
 * TicketAvailability's "leave unresolved boundaries out of the active pick"
 * behavior for the calendar's "nothing sensible to shade" check.
 *
 * @param {Object[]} resolvedPeriods Output of resolveEffectiveSalePeriods().
 * @return {boolean} True when every period has both boundaries resolved.
 */
export function hasUsableSalePeriodRange( resolvedPeriods ) {
	return (
		resolvedPeriods.length > 0 &&
		resolvedPeriods.every(
			( period ) => period.effectiveStart && period.effectiveEnd
		)
	);
}
