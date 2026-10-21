/**
 * Month arithmetic and visible-range calculation for the admin month
 * calendars (event administration and event feed previews).
 *
 * @package FairEventsShared
 */

import {
	formatLocalDate,
	calculateLeadingDays,
	groupEventsByDate,
} from '../calendarUtils.js';

/**
 * First day of the month containing `date`.
 *
 * @param {Date} date Any date.
 * @return {Date} Local midnight on the 1st of that month.
 */
export function startOfMonth( date ) {
	return new Date( date.getFullYear(), date.getMonth(), 1 );
}

/**
 * First day of the month `offset` months away from the one containing `date`.
 *
 * @param {Date}   date   Any date.
 * @param {number} offset Months to move (negative moves back).
 * @return {Date} Local midnight on the 1st of the target month.
 */
export function addMonths( date, offset ) {
	return new Date( date.getFullYear(), date.getMonth() + offset, 1 );
}

/**
 * Format a month as the `month` URL value (YYYY-MM).
 *
 * @param {Date} date Any date in the month.
 * @return {string} YYYY-MM.
 */
export function formatMonthParam( date ) {
	return `${ date.getFullYear() }-${ String( date.getMonth() + 1 ).padStart(
		2,
		'0'
	) }`;
}

/**
 * Parse a `month` URL value (YYYY-MM).
 *
 * @param {string|null} value Raw URL value.
 * @return {Date|null} First day of the month, or null when missing or malformed.
 */
export function parseMonthParam( value ) {
	const match = /^(\d{4})-(\d{2})$/.exec( value || '' );
	if ( ! match ) {
		return null;
	}
	const month = Number( match[ 2 ] );
	if ( month < 1 || month > 12 ) {
		return null;
	}
	return new Date( Number( match[ 1 ] ), month - 1, 1 );
}

/**
 * Days of the month grid, including the adjacent-month days that complete
 * its first and last weeks.
 *
 * @param {Date}     month       Any date in the displayed month.
 * @param {number}   startOfWeek 0 = Sunday, 1 = Monday, ...
 * @param {Object[]} events      Events to place on their start dates.
 * @return {Array<{date: Date, isCurrentMonth: boolean, events: Object[]}>} Days.
 */
export function getCalendarDays( month, startOfWeek, events = [] ) {
	const year = month.getFullYear();
	const monthIndex = month.getMonth();
	const firstDayOfMonth = new Date( year, monthIndex, 1 );
	const daysInMonth = new Date( year, monthIndex + 1, 0 ).getDate();

	const leadingDays = calculateLeadingDays( firstDayOfMonth, startOfWeek );
	const totalCells = leadingDays + daysInMonth;
	const trailingDays = totalCells % 7 === 0 ? 0 : 7 - ( totalCells % 7 );

	// Group events by date (using local time, not UTC)
	const eventsByDate = groupEventsByDate( events );

	const days = [];
	for (
		let day = 1 - leadingDays;
		day <= daysInMonth + trailingDays;
		day++
	) {
		const date = new Date( year, monthIndex, day );
		days.push( {
			date,
			isCurrentMonth: day >= 1 && day <= daysInMonth,
			events: eventsByDate[ formatLocalDate( date ) ] || [],
		} );
	}
	return days;
}

/**
 * Date range of the visible grid, including adjacent-month days.
 *
 * @param {Date}   month       Any date in the displayed month.
 * @param {number} startOfWeek 0 = Sunday, 1 = Monday, ...
 * @return {{startDate: Date, endDate: Date}} Inclusive range.
 */
export function getVisibleRange( month, startOfWeek ) {
	const days = getCalendarDays( month, startOfWeek );
	return {
		startDate: days[ 0 ].date,
		endDate: days[ days.length - 1 ].date,
	};
}
