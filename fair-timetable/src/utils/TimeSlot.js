/**
 * TimeSlot class for managing time slots within a timetable
 */

import { HourlyRange } from './hourly-range.js';

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
		const [hours, minutes] = timeString.split(':').map(Number);
		if (
			isNaN(hours) ||
			isNaN(minutes) ||
			hours < 0 ||
			hours > 23 ||
			minutes < 0 ||
			minutes > 59
		) {
			return 0;
		}
		return hours + minutes / 60;
	} catch (error) {
		console.warn('Failed to parse time string:', timeString, error);
		return 0;
	}
}

/**
 * TimeSlot class for managing time slots with timetable context
 */
export class TimeSlot {
	/**
	 * Constructor
	 *
	 * @param {Object} timeRange - Time range object
	 * @param {string} timeRange.startTime - Start time in HH:mm format
	 * @param {string} timeRange.endTime - End time in HH:mm format
	 * @param {string} timetableStartTime - Timetable start time in HH:mm format
	 */
	constructor({ startTime, endTime }, timetableStartTime = '09:00') {
		// Create HourlyRange for the time slot
		this.timeRange = new HourlyRange({ startTime, endTime });

		// Store timetable start time as decimal hours
		this.timetableStartTime = timetableStartTime;
		this.timetableStartHour = parseTime(timetableStartTime);
	}

	/**
	 * Get duration of the time slot
	 *
	 * @return {number} Duration in decimal hours
	 */
	getDuration() {
		return this.timeRange.getDuration();
	}

	/**
	 * Get start hour as decimal
	 *
	 * @return {number} Start hour in decimal format
	 */
	get startHour() {
		return this.timeRange.startHour;
	}

	/**
	 * Get end hour as decimal
	 *
	 * @return {number} End hour in decimal format
	 */
	get endHour() {
		return this.timeRange.endHour;
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
	 * Get formatted end time
	 *
	 * @return {string} End time in HH:mm format
	 */
	getEndTime() {
		return this.timeRange.getEndTime();
	}

	/**
	 * Set new start time while keeping duration constant
	 *
	 * @param {string} newStartTime - New start time in HH:mm format
	 */
	setStartTime(newStartTime) {
		this.timeRange.setStartTime(newStartTime);
	}

	/**
	 * Set new duration while keeping start time constant
	 *
	 * @param {number} newDuration - New duration in decimal hours
	 */
	setDuration(newDuration) {
		this.timeRange.setDuration(newDuration);
	}

	/**
	 * Set new end time while keeping start time constant
	 *
	 * @param {string} newEndTime - New end time in HH:mm format
	 */
	setEndTime(newEndTime) {
		this.timeRange.setEndTime(newEndTime);
	}

	/**
	 * Calculate time from timetable start in hours
	 *
	 * @return {number} Time from timetable start in hours
	 */
	getTimeFromTimetableStart() {
		let timeFromStart = this.timeRange.startHour - this.timetableStartHour;

		// If slot start is before timetable start, add 24 hours (next day)
		if (timeFromStart < 0) {
			timeFromStart += 24;
		}

		return timeFromStart;
	}

	/**
	 * Update timetable start time
	 *
	 * @param {string} newTimetableStartTime - New timetable start time in HH:mm format
	 */
	setTimetableStartTime(newTimetableStartTime) {
		this.timetableStartTime = newTimetableStartTime;
		this.timetableStartHour = parseTime(newTimetableStartTime);
	}
}
