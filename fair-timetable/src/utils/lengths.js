/**
 * Length utility functions for the timetable plugin
 */

import { __ } from '@wordpress/i18n';

/**
 * Format duration for display
 *
 * @param {number} lengthInHours - Length in hours
 * @return {string} Formatted duration string
 */
export function formatLengthLabel(lengthInHours) {
	const hours = Math.floor(lengthInHours);
	const minutes = Math.round((lengthInHours - hours) * 60);

	if (minutes === 0) {
		return __(`${hours} hours`, 'fair-timetable');
	} else if (hours === 0) {
		return __(`${minutes} minutes`, 'fair-timetable');
	} else {
		return __(`${hours} hours, ${minutes} minutes`, 'fair-timetable');
	}
}

/**
 * Generate length options from an array of numeric values
 *
 * @param {number[]} values - Array of length values in decimal hours
 * @return {Object[]} Array of option objects with label and value properties
 */
export function generateLengthOptions(values) {
	return values.map((value) => ({
		label: formatLengthLabel(value),
		value: value,
	}));
}
