/**
 * Calendar utility functions for event-related plugins
 */

/**
 * Format a date as YYYY-MM-DD in local time (not UTC)
 *
 * @param {Date} date - Date object to format
 * @return {string} Date string in YYYY-MM-DD format
 */
export const formatLocalDate = (date) => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

/**
 * Generate localized weekday labels starting from a given start of week
 *
 * @param {number} startOfWeek - Start of week (0 = Sunday, 1 = Monday, etc.)
 * @param {Object} options - Options for formatting
 * @param {string} options.weekday - Weekday format ('short', 'long', 'narrow')
 * @return {string[]} Array of 7 localized weekday labels
 */
export const getWeekdayLabels = (startOfWeek = 1, options = {}) => {
	const { weekday = 'short' } = options;
	const labels = [];

	// Ensure startOfWeek is a number (wp_localize_script passes strings)
	const start = Number(startOfWeek);

	// January 7, 2024 is a Sunday (weekday 0)
	// Adding N days gives us the weekday N
	const baseSunday = new Date(2024, 0, 7);

	for (let i = 0; i < 7; i++) {
		const dayOfWeek = (start + i) % 7;
		const date = new Date(baseSunday);
		date.setDate(7 + dayOfWeek);
		labels.push(date.toLocaleDateString(undefined, { weekday }));
	}

	return labels;
};

/**
 * Calculate how many leading days are needed from the previous month
 *
 * @param {Date} firstDayOfMonth - First day of the target month
 * @param {number} startOfWeek - Start of week (0 = Sunday, 1 = Monday, etc.)
 * @return {number} Number of leading days (0-6)
 */
export const calculateLeadingDays = (firstDayOfMonth, startOfWeek = 1) => {
	// Ensure startOfWeek is a number (wp_localize_script passes strings)
	const start = Number(startOfWeek);
	return (firstDayOfMonth.getDay() - start + 7) % 7;
};

/**
 * Group events by date for calendar display
 *
 * @param {Array} events - Array of events with start/end properties
 * @return {Object} Object mapping date strings (YYYY-MM-DD) to arrays of events
 */
export const groupEventsByDate = (events) => {
	const eventsByDate = {};

	events.forEach((event) => {
		const startDate = event.start ? new Date(event.start) : null;
		const endDate = event.end ? new Date(event.end) : startDate;

		if (!startDate) return;

		// Add event to all days it spans
		let loopDate = new Date(
			startDate.getFullYear(),
			startDate.getMonth(),
			startDate.getDate()
		);
		const endLoop = new Date(
			endDate.getFullYear(),
			endDate.getMonth(),
			endDate.getDate()
		);

		while (loopDate <= endLoop) {
			const dateKey = formatLocalDate(loopDate);
			if (!eventsByDate[dateKey]) {
				eventsByDate[dateKey] = [];
			}
			eventsByDate[dateKey].push(event);
			loopDate.setDate(loopDate.getDate() + 1);
		}
	});

	return eventsByDate;
};
