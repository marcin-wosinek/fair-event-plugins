/**
 * Date and time utility functions for calendar button block
 */

import {
	addMinutes,
	addDays,
	parseISO,
	format,
	isValid,
	differenceInMinutes,
	differenceInDays,
} from 'date-fns';

/**
 * Calculate duration between two datetime strings in minutes
 *
 * @param {string} startTime Start datetime string (ISO format)
 * @param {string} endTime   End datetime string (ISO format)
 * @return {number|null} Duration in minutes, or null if invalid
 */
export const calculateDuration = (startTime, endTime) => {
	if (!startTime || !endTime) {
		return null;
	}

	try {
		const startDate = parseISO(startTime);
		const endDate = parseISO(endTime);

		if (!isValid(startDate) || !isValid(endDate)) {
			return null;
		}

		return differenceInMinutes(endDate, startDate);
	} catch (error) {
		return null;
	}
};

/**
 * Calculate end time based on start time and duration
 *
 * @param {string} startTime       Start datetime string (ISO format)
 * @param {number|string} durationMinutes Duration in minutes
 * @return {string} End datetime string in datetime-local format, or empty string if invalid
 */
export const calculateEndTime = (startTime, durationMinutes) => {
	if (!startTime || !durationMinutes || durationMinutes === 'other') {
		return '';
	}

	try {
		// Parse the datetime-local input value
		const startDate = parseISO(startTime);

		// Validate the parsed date
		if (!isValid(startDate)) {
			return '';
		}

		// Add the duration minutes to get end time
		const endDate = addMinutes(startDate, parseInt(durationMinutes));

		// Format for datetime-local input (YYYY-MM-DDTHH:mm)
		return format(endDate, "yyyy-MM-dd'T'HH:mm");
	} catch (error) {
		return '';
	}
};

/**
 * Format a Date object for datetime-local input
 *
 * @param {Date} date Date object to format
 * @return {string} Formatted datetime string (YYYY-MM-DDTHH:mm)
 */
export const formatForDateTimeLocal = (date) => {
	if (!date || !isValid(date)) {
		return '';
	}

	try {
		return format(date, "yyyy-MM-dd'T'HH:mm");
	} catch (error) {
		return '';
	}
};

/**
 * Convert datetime string to date-only format
 *
 * @param {string} datetimeString Datetime string (YYYY-MM-DDTHH:mm)
 * @return {string} Date-only string (YYYY-MM-DD)
 */
export const convertToDateOnly = (datetimeString) => {
	if (!datetimeString || !datetimeString.includes('T')) {
		return datetimeString || '';
	}

	return datetimeString.split('T')[0];
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
	if (!datetimeString || !datetimeString.includes('T')) {
		return defaultTime;
	}

	return datetimeString.split('T')[1] || defaultTime;
};

/**
 * Extract date part from datetime string
 *
 * @param {string} datetimeString Datetime string (YYYY-MM-DDTHH:mm)
 * @param {string} defaultDate    Default date to return if no date found
 * @return {string} Date string (YYYY-MM-DD)
 */
export const extractDateFromDatetime = (datetimeString, defaultDate = null) => {
	if (!datetimeString || !datetimeString.includes('T')) {
		return defaultDate || new Date().toISOString().split('T')[0];
	}

	return datetimeString.split('T')[0];
};

/**
 * Combine date and time strings into datetime string
 *
 * @param {string} dateString Date string (YYYY-MM-DD)
 * @param {string} timeString Time string (HH:mm)
 * @return {string} Combined datetime string (YYYY-MM-DDTHH:mm)
 */
export const combineDateAndTime = (dateString, timeString) => {
	if (!dateString || !timeString) {
		return '';
	}

	return `${dateString}T${timeString}`;
};

/**
 * Calculate duration between two date strings in days
 *
 * @param {string} startDate Start date string (YYYY-MM-DD)
 * @param {string} endDate   End date string (YYYY-MM-DD)
 * @return {number|null} Duration in days (inclusive), or null if invalid
 */
export const calculateDaysInclusive = (startDate, endDate) => {
	if (!startDate || !endDate) {
		return null;
	}

	try {
		const start = parseISO(startDate);
		const end = parseISO(endDate);

		if (!isValid(start) || !isValid(end)) {
			return null;
		}

		// Calculate inclusive days (add 1 because the end date is included)
		return differenceInDays(end, start) + 1;
	} catch (error) {
		return null;
	}
};

/**
 * Calculate end date based on start date and number of days
 *
 * @param {string} startDate Start date string (YYYY-MM-DD)
 * @param {number|string} days Number of days (inclusive)
 * @return {string} End date string (YYYY-MM-DD), or empty string if invalid
 */
export const calculateEndDate = (startDate, days) => {
	if (!startDate || !days || days === 'other') {
		return '';
	}

	try {
		const start = parseISO(startDate);

		if (!isValid(start)) {
			return '';
		}

		// For inclusive days, subtract 1 (e.g., 2 days means start + 1 day)
		const endDate = addDays(start, parseInt(days) - 1);

		return format(endDate, 'yyyy-MM-dd');
	} catch (error) {
		return '';
	}
};
