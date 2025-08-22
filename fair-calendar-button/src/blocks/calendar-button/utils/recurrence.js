/**
 * Recurrence and RRULE utility functions for calendar button block
 */

/**
 * Build RRULE string from frequency, count, and until date
 *
 * @param {string} freq  Frequency (DAILY, WEEKLY, BIWEEKLY, etc.)
 * @param {number} count Number of repetitions
 * @param {string} until Until date (YYYY-MM-DD format)
 * @return {string} RRULE string
 */
export const buildRRule = (freq, count, until) => {
	if (!freq) return '';

	let rrule;
	if (freq === 'BIWEEKLY') {
		// Convert BIWEEKLY to proper RRULE format: FREQ=WEEKLY;INTERVAL=2
		rrule = 'FREQ=WEEKLY;INTERVAL=2';
	} else {
		rrule = `FREQ=${freq}`;
	}

	if (count && count > 0) {
		rrule += `;COUNT=${count}`;
	} else if (until) {
		// Convert date to YYYYMMDD format for RRULE
		const untilFormatted = until.replace(/-/g, '');
		rrule += `;UNTIL=${untilFormatted}`;
	}

	return rrule;
};
