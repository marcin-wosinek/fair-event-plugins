/**
 * HourlyRange class for managing time ranges
 */

import { parseTime, formatTime } from '@utils/timeUtils.js';

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
	 * Get formatted start time
	 *
	 * @return {string} Start time in HH:mm format
	 */
	getStartTime() {
		return formatTime(this.startHour);
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

	/**
	 * Set new end time while keeping start time constant
	 *
	 * @param {string} newEndTime - New end time in HH:mm format
	 */
	setEndTime(newEndTime) {
		if (!newEndTime || typeof newEndTime !== 'string') {
			return;
		}

		// Parse new end time
		const newEndHour = parseTime(newEndTime);

		// Update end hour
		this.endHour = newEndHour;
	}
}
