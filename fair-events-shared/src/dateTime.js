/**
 * Date and time utility functions for event-related plugins
 */

import { parseISO, isValid, differenceInMinutes } from 'date-fns';
import { dateI18n, getSettings } from '@wordpress/date';

/**
 * Calculate duration between two datetime strings in minutes
 *
 * @param {string} startTime Start datetime string (ISO format)
 * @param {string} endTime   End datetime string (ISO format)
 * @return {number|null} Duration in minutes, or null if invalid
 */
export const calculateDuration = ( startTime, endTime ) => {
	if ( ! startTime || ! endTime ) {
		return null;
	}

	try {
		const startDate = parseISO( startTime );
		const endDate = parseISO( endTime );

		if ( ! isValid( startDate ) || ! isValid( endDate ) ) {
			return null;
		}

		return differenceInMinutes( endDate, startDate );
	} catch ( error ) {
		return null;
	}
};

/**
 * Format a date value with a fallback for empty values
 *
 * @param {string|null|undefined} dateValue Date value to display
 * @param {string} fallback Fallback text to display if date is empty (default: '-')
 * @return {string} Formatted date or fallback text
 */
export const formatDateOrFallback = ( dateValue, fallback = '-' ) => {
	if ( ! dateValue || dateValue === '' ) {
		return fallback;
	}
	return dateValue;
};

/**
 * Format a naive "Y-m-d H:i:s" site-local datetime for display without
 * re-applying the site timezone offset (it's already wall-clock local, the
 * same value stored in the DB). Treating it as UTC and formatting with
 * dateI18n (timezone=true) skips that second conversion.
 *
 * @param {string} datetime Naive datetime string, e.g. "2026-09-01 10:00:00".
 * @return {string} Formatted date/time in the site's format.
 */
export function formatSiteLocalDatetime( datetime ) {
	const { formats } = getSettings();
	return dateI18n(
		formats.datetime,
		`${ datetime.replace( ' ', 'T' ) }Z`,
		true
	);
}

/**
 * Same naive-local convention as formatSiteLocalDatetime, but formats only
 * the time portion (e.g. for showing an end time next to an already-printed
 * start date).
 *
 * @param {string} datetime Naive datetime string, e.g. "2026-09-01 10:00:00".
 * @return {string} Formatted time in the site's format.
 */
export function formatSiteLocalTime( datetime ) {
	const { formats } = getSettings();
	return dateI18n( formats.time, `${ datetime.replace( ' ', 'T' ) }Z`, true );
}

// Naive site-local parsing shared by formatDateOnly/formatMonthLabel: slices
// off any time component and re-parses at local midnight so no timezone
// re-conversion happens (see UI_GUIDELINES.md "Dates and times"). `Date`
// inputs (e.g. from MiniCalendar's month grid) pass through unchanged.
function toLocalDate( value ) {
	if ( value instanceof Date ) return value;
	if ( ! value ) return null;
	const [ datePart ] = String( value ).split( /[ T]/ );
	return new Date( `${ datePart }T00:00:00` );
}

const DATE_ONLY_STYLES = {
	long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
	medium: { year: 'numeric', month: 'long', day: 'numeric' },
	short: { year: 'numeric', month: 'short', day: 'numeric' },
	numeric: undefined,
};

/**
 * Format a date-only value (Y-m-d or Y-m-d H:i:s string, or a Date) for
 * display, using the browser locale (these are timezone-agnostic day labels,
 * not a site-formatted datetime — see formatSiteLocalDatetime for that).
 *
 * @param {string|Date|null|undefined} value Date-only/datetime string, or a Date object.
 * @param {string} [style] One of 'long' | 'medium' | 'short' | 'numeric'.
 * @return {string} Formatted date, or '' if value is empty.
 */
export function formatDateOnly( value, style = 'medium' ) {
	const date = toLocalDate( value );
	if ( ! date ) return '';
	return date.toLocaleDateString( undefined, DATE_ONLY_STYLES[ style ] );
}

/**
 * Format a month/year header label (e.g. calendar navigation titles).
 *
 * @param {string|Date|null|undefined} value Date-only/datetime string, or a Date object.
 * @return {string} Formatted "Month YYYY" label, or '' if value is empty.
 */
export function formatMonthLabel( value ) {
	const date = toLocalDate( value );
	if ( ! date ) return '';
	return date.toLocaleDateString( undefined, {
		month: 'long',
		year: 'numeric',
	} );
}

/**
 * Format a site-local date (Y-m-d) in the site's date format, without
 * re-applying the site timezone offset.
 *
 * @param {string} date Date string, e.g. "2026-09-01".
 * @return {string} Formatted date in the site's format.
 */
export function formatSiteLocalDate( date ) {
	const { formats } = getSettings();
	return dateI18n( formats.date, `${ date }T00:00:00Z`, true );
}

/**
 * Format the start of an event date from its canonical timing: the date
 * and start time when a start time is set, the date alone for an all-day
 * date or one without a start time. A missing time is never shown as
 * midnight.
 *
 * @param {Object|null|undefined} timing Object with `start_date`, `start_time` and `all_day`.
 * @return {string} Formatted start, or '' for an undated timing.
 */
export function formatTimingStart( timing ) {
	if ( ! timing?.start_date ) {
		return '';
	}
	if ( ! timing.all_day && timing.start_time ) {
		return formatSiteLocalDatetime(
			`${ timing.start_date } ${ timing.start_time }`
		);
	}
	return formatSiteLocalDate( timing.start_date );
}

/**
 * The formatted pieces of an event date's canonical timing, for composing a
 * translated summary in the consuming plugin. Only supplied times are
 * returned (an all-day date has none), `endDate` only when the date spans
 * several days, and genuine midnight is kept. No string is composed here,
 * so each plugin words the summary under its own text domain.
 *
 * @param {Object|null|undefined} timing Object with `start_date`, `end_date`, `start_time`, `end_time` and `all_day`.
 * @return {{startDate: string, endDate: string|null, startTime: string|null, endTime: string|null}|null}
 *         Formatted parts, or null for an undated timing.
 */
export function formatTimingParts( timing ) {
	if ( ! timing?.start_date ) {
		return null;
	}
	const endDate =
		timing.end_date && timing.end_date !== timing.start_date
			? timing.end_date
			: null;
	const time = ( value, date ) =>
		! timing.all_day && value
			? formatSiteLocalTime( `${ date } ${ value }` )
			: null;

	return {
		startDate: formatSiteLocalDate( timing.start_date ),
		endDate: endDate ? formatSiteLocalDate( endDate ) : null,
		startTime: time( timing.start_time, timing.start_date ),
		endTime: time( timing.end_time, endDate || timing.start_date ),
	};
}

/**
 * Sortable key for the start of an event date's canonical timing: a date
 * without a start time sorts first on its day. Not a time to display.
 *
 * @param {Object|null|undefined} timing Object with `start_date` and `start_time`.
 * @return {string} "Y-m-d H:i:s" key, or '' for an undated timing.
 */
export function timingStartKey( timing ) {
	if ( ! timing?.start_date ) {
		return '';
	}
	return `${ timing.start_date } ${
		( ! timing.all_day && timing.start_time ) || '00:00:00'
	}`;
}
