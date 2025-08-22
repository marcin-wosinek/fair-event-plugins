/**
 * RRULE Manager for centralized parsing and generation
 * Handles bidirectional conversion between UI state and RRULE strings
 */

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
}

// Export default instance for convenience
export const rruleManager = new RRuleManager();
