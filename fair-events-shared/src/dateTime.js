/**
 * Date and time utility functions for event-related plugins
 */

import { parseISO, isValid, differenceInMinutes } from 'date-fns';

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
 * Format a date value with a fallback for empty values
 *
 * @param {string|null|undefined} dateValue Date value to display
 * @param {string} fallback Fallback text to display if date is empty (default: '-')
 * @return {string} Formatted date or fallback text
 */
export const formatDateOrFallback = (dateValue, fallback = '-') => {
	if (!dateValue || dateValue === '') {
		return fallback;
	}
	return dateValue;
};
