/**
 * TimeColumn class for managing a column of time slots within a time range
 */

import { HourlyRange } from './HourlyRange.js';
import { TimeSlot } from './TimeSlot.js';

/**
 * TimeColumn class for managing time slots within a defined time range
 */
export class TimeColumn {
	/**
	 * Constructor
	 *
	 * @param {Object} timeRange - Time range object
	 * @param {string} timeRange.startTime - Start time in HH:mm format
	 * @param {string} timeRange.endTime - End time in HH:mm format
	 * @param {Array} timeSlots - Array of time slot objects (optional)
	 */
	constructor({ startTime, endTime }, timeSlots = []) {
		// Create HourlyRange for the column's time boundaries
		this.timeRange = new HourlyRange({ startTime, endTime });

		// Initialize time slots array
		this.timeSlots = timeSlots.map((slotData) => {
			if (slotData instanceof TimeSlot) {
				return slotData;
			}
			// Create TimeSlot instance with column start time as timetable start
			return new TimeSlot(slotData, this.timeRange.getStartTime());
		});
	}

	/**
	 * Get start hour as decimal
	 *
	 * @return {number} Start hour in decimal format
	 */
	getStartHour() {
		return this.timeRange.startHour;
	}

	/**
	 * Get end hour as decimal
	 *
	 * @return {number} End hour in decimal format
	 */
	getEndHour() {
		return this.timeRange.endHour;
	}

	/**
	 * Get duration of the time column
	 *
	 * @return {number} Duration in decimal hours
	 */
	getDuration() {
		return this.timeRange.getDuration();
	}

	/**
	 * Get formatted start time
	 *
	 * @return {string} Start time in HH:mm format
	 */
	getStartTime() {
		return this.timeRange.getStartTime();
	}

	/**
	 * Get formatted end time
	 *
	 * @return {string} End time in HH:mm format
	 */
	getEndTime() {
		return this.timeRange.getEndTime();
	}

	/**
	 * Get formatted time range string
	 *
	 * @return {string} Time range in "HH:mm—HH:mm" format
	 */
	getTimeRangeString() {
		return this.timeRange.getTimeRangeString();
	}

	/**
	 * Find the first available hour
	 * Returns startHour if no time slots, otherwise the latest endHour of time slots
	 *
	 * @return {number} First available hour in decimal format
	 */
	getFirstAvailableHour() {
		if (this.timeSlots.length === 0) {
			return this.getStartHour();
		}

		// Find the latest endHour among all time slots
		const latestEndHour = Math.max(
			...this.timeSlots.map((slot) => slot.endHour)
		);
		return latestEndHour;
	}
}
