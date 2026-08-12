/**
 * RRULE Manager for centralized parsing and generation
 * Handles bidirectional conversion between UI state and RRULE strings
 */

import { addDays, addWeeks, parseISO, isValid, isAfter } from 'date-fns';

/**
 * RRuleManager class for managing RRULE parsing and generation
 */
export class RRuleManager {
	constructor() {
		this.supportedFields = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'];
	}

	/**
	 * Convert UI state to RRULE string
	 *
	 * @param {Object} uiState UI state object
	 * @return {string} RRULE string
	 */
	toRRule(uiState) {
		if (!uiState || !uiState.frequency) {
			return '';
		}

		const parts = [];

		// Handle frequency - convert BIWEEKLY to WEEKLY with INTERVAL=2
		if (uiState.frequency === 'BIWEEKLY') {
			parts.push('FREQ=WEEKLY');
			parts.push('INTERVAL=2');
		} else {
			parts.push(`FREQ=${uiState.frequency}`);
			if (uiState.interval && uiState.interval > 1) {
				parts.push(`INTERVAL=${uiState.interval}`);
			}
		}

		// Add COUNT or UNTIL (mutually exclusive)
		if (uiState.count && uiState.count > 0) {
			parts.push(`COUNT=${uiState.count}`);
		} else if (uiState.until) {
			const untilFormatted = this.formatUntilDate(uiState.until);
			if (untilFormatted) {
				parts.push(`UNTIL=${untilFormatted}`);
			}
		}

		return parts.join(';');
	}

	/**
	 * Format date for UNTIL clause (YYYYMMDD format)
	 *
	 * @param {string} dateString Date string in YYYY-MM-DD format
	 * @return {string} Formatted date for RRULE (YYYYMMDD)
	 */
	formatUntilDate(dateString) {
		if (!dateString || typeof dateString !== 'string') {
			return '';
		}

		// Remove hyphens and validate format
		const formatted = dateString.replace(/-/g, '');
		if (!/^\d{8}$/.test(formatted)) {
			return '';
		}

		return formatted;
	}

	/**
	 * Generate array of event dates based on recurrence rule
	 *
	 * @param {Object} uiState UI state object with frequency, count, until, and interval
	 * @param {string} startDate Start date string (YYYY-MM-DD or datetime format)
	 * @param {number} maxInstances Maximum number of instances to generate (default: 10)
	 * @return {Array<Date>} Array of Date objects representing event occurrences
	 */
	generateEvents(uiState, startDate, maxInstances = 10) {
		if (!uiState || !uiState.frequency || !startDate) {
			return [];
		}

		const start = parseISO(startDate);
		if (!isValid(start)) {
			return [];
		}

		const events = [start];
		const frequency =
			uiState.frequency === 'BIWEEKLY' ? 'WEEKLY' : uiState.frequency;
		const interval =
			uiState.frequency === 'BIWEEKLY' ? 2 : uiState.interval || 1;

		// Parse until date if provided
		let untilDate = null;
		if (uiState.until) {
			untilDate = parseISO(uiState.until);
			if (!isValid(untilDate)) {
				untilDate = null;
			}
		}

		// Determine how many events to generate
		const targetCount = uiState.count || maxInstances;
		const limit = Math.min(targetCount, maxInstances);

		let currentDate = start;
		for (let i = 1; i < limit; i++) {
			// Calculate next occurrence based on frequency and interval
			switch (frequency) {
				case 'DAILY':
					currentDate = addDays(currentDate, interval);
					break;
				case 'WEEKLY':
					currentDate = addWeeks(currentDate, interval);
					break;
				default:
					// Unknown frequency, stop generating
					return events;
			}

			// Check if we've exceeded the until date
			if (untilDate && isAfter(currentDate, untilDate)) {
				break;
			}

			events.push(currentDate);
		}

		return events;
	}
}

// Export default instance for convenience
export const rruleManager = new RRuleManager();
