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
	 * Get formatted end time
	 *
	 * @return {string} End time in HH:mm format
	 */
	getEndTime() {
		return formatTime(this.endHour);
	}

	/**
	 * Set new start time while keeping duration constant
	 *
	 * @param {string} newStartTime - New start time in HH:mm format
	 */
	setStartTime(newStartTime) {
		if (!newStartTime || typeof newStartTime !== 'string') {
			return;
		}

		// Calculate current duration
		const currentDuration = this.getDuration();

		// Parse new start time
		const newStartHour = parseTime(newStartTime);

		// Update start hour and calculate new end hour
		this.startHour = newStartHour;
		this.endHour = newStartHour + currentDuration;
	}

	/**
	 * Set new duration while keeping start time constant
	 *
	 * @param {number} newDuration - New duration in decimal hours
	 */
	setDuration(newDuration) {
		if (typeof newDuration !== 'number' || newDuration < 0) {
			return;
		}

		// Update end hour based on start hour and new duration
		this.endHour = this.startHour + newDuration;
	}
}
