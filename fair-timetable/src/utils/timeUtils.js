/**
 * Time utility functions
 */

import { parse, isValid } from 'date-fns';

/**
 * Parse time string to decimal hours
 *
 * @param {string} timeString - Time in HH:mm format
 * @return {number} Time as decimal hours (e.g., "09:30" becomes 9.5)
 */
export function parseTime(timeString) {
	if (!timeString || typeof timeString !== 'string') {
		return 0;
	}

	// Handle single digit hours (except 1 and 2 which could be decimal numbers)
	if (/^\d$/.test(timeString)) {
		const digit = parseInt(timeString);
		if (digit === 1 || digit === 2) {
			return 0; // Could be decimal, don't parse
		}
		if (digit >= 0 && digit <= 9) {
			return digit; // Parse as hour with 0 minutes
		}
	}

	// Handle 2-digit hours up to 24
	if (/^\d{2}$/.test(timeString)) {
		const hours = parseInt(timeString);
		if (hours >= 0 && hours <= 24) {
			return hours; // Parse as hour with 0 minutes
		}
	}

	try {
		const timeDate = parse(timeString, 'HH:mm', new Date());
		if (!isValid(timeDate)) {
			return 0;
		}

		const hours = timeDate.getHours();
		const minutes = timeDate.getMinutes();

		return hours + minutes / 60;
	} catch (error) {
		console.warn('Failed to parse time string:', timeString, error);
		return 0;
	}
}

/**
 * Format decimal hours to time string
 *
 * @param {number} decimalHours - Hours in decimal format (e.g., 9.5)
 * @return {string} Time in HH:mm format (e.g., "09:30")
 */
export function formatTime(decimalHours) {
	if (typeof decimalHours !== 'number' || decimalHours < 0) {
		return '00:00';
	}

	let hours = Math.floor(decimalHours) % 24; // Handle overflow past 24h
	let minutes = Math.round((decimalHours - Math.floor(decimalHours)) * 60);

	// Handle minute overflow (e.g., 60 minutes should become 1 hour, 0 minutes)
	if (minutes >= 60) {
		hours = (hours + 1) % 24;
		minutes = 0;
	}

	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
