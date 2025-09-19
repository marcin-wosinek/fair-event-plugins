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
		this.selectedValue = null;
	}

	/**
	 * Set the selected value (from predefined list or custom)
	 *
	 * @param {number} value - Selected value in decimal hours
	 */
	setValue(value) {
		this.selectedValue = value;
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
	 * Check if the selected value exists in the predefined values
	 * Uses 0.01 tolerance for floating point comparison
	 *
	 * @return {boolean} True if the selected value matches a predefined value
	 */
	hasMatchingValue() {
		if (this.selectedValue === null) {
			return false;
		}

		return this.values.some((value) =>
			Math.abs(value - this.selectedValue) < 0.01
		);
	}

	/**
	 * Get length options as formatted option objects
	 * If a custom selectedValue is set and not in the predefined list, it's temporarily added
	 *
	 * @return {Object[]} Array of option objects with label and value properties
	 */
	getLengthOptions() {
		let options = this.values.map((value) => ({
			label: LengthOptions.formatLengthLabel(value),
			value: value,
		}));

		// If selectedValue is set and not in the predefined list, add it temporarily
		if (this.selectedValue !== null && !this.hasMatchingValue() && this.selectedValue > 0) {
			options.push({
				label: LengthOptions.formatLengthLabel(this.selectedValue),
				value: this.selectedValue,
			});

			// Sort options by value
			options.sort((a, b) => a.value - b.value);
		}

		return options;
	}
}
