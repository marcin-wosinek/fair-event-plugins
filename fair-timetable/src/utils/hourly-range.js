/**
 * HourlyRange class for managing time ranges
 */

import { parse, isValid } from 'date-fns';

/**
 * Parse time string to decimal hours
 *
 * @param {string} timeString - Time in HH:mm format
 * @return {number} Time as decimal hours (e.g., "09:30" becomes 9.5)
 */
function parseTime(timeString) {
	if (!timeString || typeof timeString !== 'string') {
		return 0;
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
function formatTime(decimalHours) {
	if (typeof decimalHours !== 'number' || decimalHours < 0) {
		return '00:00';
	}

	const hours = Math.floor(decimalHours) % 24; // Handle overflow past 24h
	const minutes = Math.round((decimalHours - Math.floor(decimalHours)) * 60);

	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * HourlyRange class for managing time ranges with string input and numeric output
 */
export class HourlyRange {
	/**
	 * Constructor
	 *
	 * @param {Object} timeRange - Time range object
	 * @param {string} timeRange.startTime - Start time in HH:mm format
	 * @param {string} timeRange.endTime - End time in HH:mm format
	 */
	constructor({ startTime, endTime }) {
		if (!startTime || !endTime) {
			throw new Error('HourlyRange requires both startTime and endTime');
		}

		// Parse to decimal hours
		this.startHour = parseTime(startTime);
		this.endHour = parseTime(endTime);

		// Calculate duration
		this.duration = this.endHour - this.startHour;

		// Handle negative duration (next day scenario)
		if (this.duration < 0) {
			this.duration += 24;
		}
	}

	/**
	 * Check if this time object overlaps with another
	 *
	 * @param {HourlyRange} other - Another HourlyRange instance
	 * @return {boolean} True if time ranges overlap
	 */
	overlapsWith(other) {
		if (!(other instanceof HourlyRange)) return false;

		return this.startHour < other.endHour && this.endHour > other.startHour;
	}

	/**
	 * Check if this time object is before another
	 *
	 * @param {HourlyRange} other - Another HourlyRange instance
	 * @return {boolean} True if this starts before the other
	 */
	isBefore(other) {
		if (!(other instanceof HourlyRange)) return false;

		return this.startHour < other.startHour;
	}

	/**
	 * Check if this time object is after another
	 *
	 * @param {HourlyRange} other - Another HourlyRange instance
	 * @return {boolean} True if this starts after the other
	 */
	isAfter(other) {
		if (!(other instanceof HourlyRange)) return false;

		return this.startHour > other.startHour;
	}

	/**
	 * Get formatted time range string
	 *
	 * @return {string} Time range in "HH:mm - HH:mm" format
	 */
	getTimeRangeString() {
		return `${formatTime(this.startHour)}—${formatTime(this.endHour)}`;
	}

	/**
	 * Get duration in hours
	 *
	 * @return {number} Duration in decimal hours
	 */
	getDuration() {
		let duration = this.endHour - this.startHour;

		// Handle negative duration (next day scenario)
		if (duration < 0) {
			duration += 24;
		}

		return duration;
	}

	/**
	 * Convert to plain object
	 *
	 * @return {Object} Plain object representation
	 */
	toObject() {
		return {
			startHour: this.startHour,
			endHour: this.endHour,
			duration: this.duration,
		};
	}

	/**
	 * Get debug information
	 *
	 * @return {Object} Debug information
	 */
	getDebugInfo() {
		return {
			timeRange: this.getTimeRangeString(),
			startHour: this.startHour,
			endHour: this.endHour,
			duration: this.duration,
		};
	}
}
