/**
 * Date and time utility functions for calendar button block
 */

import {
	addMinutes,
	parseISO,
	format,
	isValid,
	differenceInMinutes,
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
