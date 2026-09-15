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

/**
 * Resolve each period's effective sale_start/sale_end for display, without
 * mutating the raw saved values.
 *
 * Only the first period may infer a missing start: it becomes the
 * site-local today's date, and only while today precedes its effective
 * end — an already-elapsed period never shows as automatically reactivated.
 * Only the last period may infer a missing end: it becomes the day after
 * the event/series' final active occurrence. A missing boundary anywhere
 * else (an interior period, or a first/last period with nothing to infer
 * from) is left null.
 *
 * @param {Object[]}    periods            Raw sale periods (Y-m-d `sale_start`/`sale_end` strings, in sort order).
 * @param {string}      siteToday          Site-local today's date (Y-m-d).
 * @param {string|null} finalOccurrenceEnd Lazy default sale_end for the last period (Y-m-d, exclusive), or null/empty when unavailable.
 * @return {Object[]} Periods augmented with `effectiveStart`, `effectiveEnd`, `isAutomaticStart`, `isAutomaticEnd`.
 */
export function resolveEffectiveSalePeriods(
	periods,
	siteToday,
	finalOccurrenceEnd
) {
	const lastIndex = periods.length - 1;

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
			siteToday &&
			siteToday < effectiveEnd
		) {
			effectiveStart = siteToday;
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
 * Resolve the event/series' final active occurrence's own end_datetime — or,
 * when that occurrence has no end set, its start_datetime instead — mirroring
 * EventDates::get_last_occurrence_boundary() on the backend. Used as the
 * anchor for the ticket editor's lazily-resolved default sale end (day after
 * the last occurrence), so an occurrence with a start but no end still
 * yields a usable default.
 *
 * @param {Object|null} eventDate Event date object with `start_datetime`, `end_datetime`, and `generated_occurrences` (each with `start_datetime`, `end_datetime`, `status`).
 * @return {string|null} The final active occurrence's end (or start) datetime, or null when there's nothing to anchor to.
 */
export function resolveFinalOccurrenceDatetime( eventDate ) {
	if ( ! eventDate ) {
		return null;
	}

	const occurrences = [
		{
			start_datetime: eventDate.start_datetime,
			end_datetime: eventDate.end_datetime,
		},
		...( eventDate.generated_occurrences || [] )
			.filter( ( o ) => o.status !== 'cancelled' )
			.map( ( o ) => ( {
				start_datetime: o.start_datetime,
				end_datetime: o.end_datetime,
			} ) ),
	].filter( ( o ) => o.start_datetime );

	if ( ! occurrences.length ) {
		return null;
	}

	const final = occurrences.sort( ( a, b ) =>
		a.start_datetime < b.start_datetime ? 1 : -1
	)[ 0 ];

	return final.end_datetime || final.start_datetime;
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
