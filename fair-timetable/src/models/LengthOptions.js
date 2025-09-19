/**
 * LengthOptions class for managing time duration options
 */

import { __ } from '@wordpress/i18n';

/**
 * LengthOptions class for generating and managing time duration options
 */
export class LengthOptions {
	/**
	 * Constructor
	 *
	 * @param {number[]} values - Array of length values in decimal hours
	 */
	constructor(values) {
		this.values = values;
	}

	/**
	 * Format duration for display
	 *
	 * @param {number} lengthInHours - Length in hours
	 * @return {string} Formatted duration string
	 */
	static formatLengthLabel(lengthInHours) {
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
	 * Get length options as formatted option objects
	 *
	 * @return {Object[]} Array of option objects with label and value properties
	 */
	getLengthOptions() {
		return this.values.map((value) => ({
			label: LengthOptions.formatLengthLabel(value),
			value: value,
		}));
	}
}
