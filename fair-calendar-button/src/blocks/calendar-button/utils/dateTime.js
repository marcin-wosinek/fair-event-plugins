/**
 * Date and time utility functions for calendar button block
 */

import { addMinutes, parseISO, format, isValid, isBefore } from 'date-fns';

// All-day length helpers are calendar-date arithmetic shared with Fair Events
// (#2089); re-exported so existing imports from this module keep working.
export {
	calculateDaysInclusive,
	calculateEndDate,
} from 'fair-events-shared/src/calendarDates.js';

/**
 * Calculate end time based on start time and duration
 *
 * @param {string} startTime       Start datetime string (ISO format)
 * @param {number|string} durationMinutes Duration in minutes
 * @return {string} End datetime string in datetime-local format, or empty string if invalid
 */
export const calculateEndTime = ( startTime, durationMinutes ) => {
	if ( ! startTime || ! durationMinutes || durationMinutes === 'other' ) {
		return '';
	}

	try {
		// Parse the datetime-local input value
		const startDate = parseISO( startTime );

		// Validate the parsed date
		if ( ! isValid( startDate ) ) {
			return '';
		}

		// Add the duration minutes to get end time
		const endDate = addMinutes( startDate, parseInt( durationMinutes ) );

		// Format for datetime-local input (YYYY-MM-DDTHH:mm)
		return format( endDate, "yyyy-MM-dd'T'HH:mm" );
	} catch ( error ) {
		return '';
	}
};

/**
 * Format a Date object for datetime-local input
 *
 * @param {Date} date Date object to format
 * @return {string} Formatted datetime string (YYYY-MM-DDTHH:mm)
 */
export const formatForDateTimeLocal = ( date ) => {
	if ( ! date || ! isValid( date ) ) {
		return '';
	}

	try {
		return format( date, "yyyy-MM-dd'T'HH:mm" );
	} catch ( error ) {
		return '';
	}
};

/**
 * Convert datetime string to date-only format
 *
 * @param {string} datetimeString Datetime string (YYYY-MM-DDTHH:mm)
 * @return {string} Date-only string (YYYY-MM-DD)
 */
export const convertToDateOnly = ( datetimeString ) => {
	if ( ! datetimeString || ! datetimeString.includes( 'T' ) ) {
		return datetimeString || '';
	}

	return datetimeString.split( 'T' )[ 0 ];
};

/**
 * Extract time part from datetime string
 *
 * @param {string} datetimeString Datetime string (YYYY-MM-DDTHH:mm)
 * @param {string} defaultTime    Default time to return if no time found
 * @return {string} Time string (HH:mm)
 */
export const extractTimeFromDatetime = (
	datetimeString,
	defaultTime = '09:00'
) => {
	if ( ! datetimeString || ! datetimeString.includes( 'T' ) ) {
		return defaultTime;
	}

	return datetimeString.split( 'T' )[ 1 ] || defaultTime;
};

/**
 * Extract date part from datetime string
 *
 * @param {string} datetimeString Datetime string (YYYY-MM-DDTHH:mm)
 * @param {string} defaultDate    Default date to return if no date found
 * @return {string} Date string (YYYY-MM-DD)
 */
export const extractDateFromDatetime = (
	datetimeString,
	defaultDate = null
) => {
	if ( ! datetimeString || ! datetimeString.includes( 'T' ) ) {
		return defaultDate || new Date().toISOString().split( 'T' )[ 0 ];
	}

	return datetimeString.split( 'T' )[ 0 ];
};

/**
 * Combine date and time strings into datetime string
 *
 * @param {string} dateString Date string (YYYY-MM-DD)
 * @param {string} timeString Time string (HH:mm)
 * @return {string} Combined datetime string (YYYY-MM-DDTHH:mm)
 */
export const combineDateAndTime = ( dateString, timeString ) => {
	if ( ! dateString || ! timeString ) {
		return '';
	}

	return `${ dateString }T${ timeString }`;
};

/**
 * Validate that end date/time is not before start date/time
 *
 * @param {string} startDateTime Start date or datetime string
 * @param {string} endDateTime   End date or datetime string
 * @return {boolean} True if valid (end is after or equal to start), false if invalid
 */
export const validateDateTimeOrder = ( startDateTime, endDateTime ) => {
	if ( ! startDateTime || ! endDateTime ) {
		return true; // Consider empty dates as valid (no validation error)
	}

	try {
		const start = parseISO( startDateTime );
		const end = parseISO( endDateTime );

		if ( ! isValid( start ) || ! isValid( end ) ) {
			return true; // Invalid dates are handled elsewhere
		}

		// End should not be before start
		return ! isBefore( end, start );
	} catch ( error ) {
		return true; // Consider parsing errors as valid (handled elsewhere)
	}
};

/**
 * Get validation error message for invalid date/time order
 *
 * @param {string} startDateTime Start date or datetime string
 * @param {string} endDateTime   End date or datetime string
 * @param {boolean} isAllDay     Whether this is an all-day event
 * @return {string|null} Error message if invalid, null if valid
 */
export const getDateTimeValidationError = (
	startDateTime,
	endDateTime,
	isAllDay = false
) => {
	if ( ! startDateTime || ! endDateTime ) {
		return null;
	}

	if ( ! validateDateTimeOrder( startDateTime, endDateTime ) ) {
		return isAllDay
			? 'End date cannot be before start date'
			: 'End date/time cannot be before start date/time';
	}

	return null;
};
