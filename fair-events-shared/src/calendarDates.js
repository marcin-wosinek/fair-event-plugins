/**
 * Date-only calendar arithmetic on `YYYY-MM-DD` strings.
 *
 * A calendar date is a site-local wall-clock day, not an instant, so these
 * helpers never go through the browser timezone: all arithmetic runs on UTC
 * midnights, where every day is exactly 24 hours long. A daylight-saving
 * transition in the browser's zone can therefore never add or lose a day.
 *
 * Shared by Fair Events (event date editing) and Fair Calendar Button
 * (all-day event length).
 *
 * @package FairEventsShared
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// A leading `YYYY-MM-DD`, optionally followed by a time (`T` or space).
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

const pad = ( value, length = 2 ) => String( value ).padStart( length, '0' );

/**
 * UTC midnight of a calendar date, or null for an empty or impossible date.
 *
 * Built with setUTCFullYear so years 0–99 are not mapped to 1900–1999.
 *
 * @param {string} value Date string, `YYYY-MM-DD` (a trailing time is ignored).
 * @return {number|null} Timestamp of that day's UTC midnight, or null.
 */
function toUtcDay( value ) {
	if ( typeof value !== 'string' ) return null;
	const match = DATE_PATTERN.exec( value );
	if ( ! match ) return null;

	const year = Number( match[ 1 ] );
	const month = Number( match[ 2 ] );
	const day = Number( match[ 3 ] );
	const date = new Date( 0 );
	date.setUTCFullYear( year, month - 1, day );

	// Reject rolled-over dates such as 2026-02-30.
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date.getTime();
}

/**
 * Format a UTC-midnight timestamp as `YYYY-MM-DD`, or '' outside 0000–9999.
 *
 * @param {number} time UTC-midnight timestamp.
 * @return {string} Date string, or ''.
 */
function fromUtcDay( time ) {
	const date = new Date( time );
	const year = date.getUTCFullYear();
	if ( Number.isNaN( year ) || year < 0 || year > 9999 ) return '';
	return `${ pad( year, 4 ) }-${ pad( date.getUTCMonth() + 1 ) }-${ pad(
		date.getUTCDate()
	) }`;
}

/**
 * Whether a value is a real calendar date in strict `YYYY-MM-DD` form.
 *
 * @param {*} value Value to check.
 * @return {boolean} True for e.g. '2024-02-29', false for '2025-02-29', '' or a datetime.
 */
export function isValidDateString( value ) {
	return (
		typeof value === 'string' &&
		value.length === 10 &&
		toUtcDay( value ) !== null
	);
}

/**
 * Move a calendar date by a whole number of days.
 *
 * @param {string} date Date string (`YYYY-MM-DD`).
 * @param {number} days Days to add; negative moves earlier.
 * @return {string} Shifted `YYYY-MM-DD`, or '' when the date or day count is invalid.
 */
export function addCalendarDays( date, days ) {
	const time = toUtcDay( date );
	if ( time === null || ! Number.isInteger( days ) ) return '';
	return fromUtcDay( time + days * DAY_MS );
}

/**
 * Calendar days from `earlier` to `later` (negative when `later` is before).
 *
 * @param {string} later   Date string (`YYYY-MM-DD`).
 * @param {string} earlier Date string (`YYYY-MM-DD`).
 * @return {number|null} Whole days between the two dates, or null when either is invalid.
 */
export function differenceInCalendarDays( later, earlier ) {
	const laterTime = toUtcDay( later );
	const earlierTime = toUtcDay( earlier );
	if ( laterTime === null || earlierTime === null ) return null;
	return Math.round( ( laterTime - earlierTime ) / DAY_MS );
}

/**
 * Inclusive length in days of a date range (a same-day range is 1 day).
 *
 * @param {string} startDate Start date string (`YYYY-MM-DD`).
 * @param {string} endDate   End date string (`YYYY-MM-DD`).
 * @return {number|null} Inclusive day count (0 or less for a reversed range), or null if invalid.
 */
export function calculateDaysInclusive( startDate, endDate ) {
	const difference = differenceInCalendarDays( endDate, startDate );
	return difference === null ? null : difference + 1;
}

/**
 * End date of a range that starts on `startDate` and lasts `days` days,
 * counting the start day.
 *
 * @param {string}        startDate Start date string (`YYYY-MM-DD`).
 * @param {number|string} days      Inclusive day count, e.g. 2 or '2'.
 * @return {string} End date (`YYYY-MM-DD`), or '' when the input is invalid or `days` is 'other'.
 */
export function calculateEndDate( startDate, days ) {
	if ( ! startDate || ! days || days === 'other' ) return '';
	const count = parseInt( days, 10 );
	if ( Number.isNaN( count ) ) return '';
	return addCalendarDays( startDate, count - 1 );
}
