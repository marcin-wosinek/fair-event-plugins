/**
 * DurationOptions class for managing duration options across different units
 *
 * Labels are untranslated English by default. A shared module cannot declare
 * a text domain that `wp i18n make-pot` can extract, so a consuming plugin
 * that needs translated labels passes its own `formatLabel` and `otherLabel`
 * built from literal `__()` / `_n()` calls under its own domain.
 */

/**
 * DurationOptions class for generating and managing duration options
 * Supports hours, minutes, and days with automatic "Other" option
 */
export class DurationOptions {
	/**
	 * Constructor
	 *
	 * @param {Object}   config             - Configuration object
	 * @param {number[]} config.values      - Array of duration values
	 * @param {string}   config.unit        - Unit type: 'hours', 'minutes', or 'days'
	 * @param {number}   config.tolerance   - Tolerance for floating point comparison (default: 0.01)
	 * @param {Function} config.formatLabel - Formats a value as `( value, unit ) => string` (default: English labels)
	 * @param {string}   config.otherLabel  - Label of the "Other" option (default: 'Other')
	 */
	constructor( {
		values,
		unit = 'hours',
		tolerance = 0.01,
		formatLabel = DurationOptions.formatDurationLabel,
		otherLabel = 'Other',
	} ) {
		this.values = values;
		this.unit = unit;
		this.tolerance = tolerance;
		this.formatLabel = formatLabel;
		this.otherLabel = otherLabel;
		this.selectedValue = null;
	}

	/**
	 * Format duration label for hours
	 *
	 * @param {number} hours - Duration in hours
	 * @return {string} Formatted duration string
	 */
	static formatHoursLabel( hours ) {
		const wholeHours = Math.floor( hours );
		const minutes = Math.round( ( hours - wholeHours ) * 60 );

		if ( minutes === 0 ) {
			return `${ wholeHours } hours`;
		} else if ( wholeHours === 0 ) {
			return `${ minutes } minutes`;
		} else {
			return `${ wholeHours } hours, ${ minutes } minutes`;
		}
	}

	/**
	 * Format duration label for minutes
	 *
	 * @param {number} minutes - Duration in minutes
	 * @return {string} Formatted duration string
	 */
	static formatMinutesLabel( minutes ) {
		const hours = Math.floor( minutes / 60 );
		const remainingMinutes = minutes % 60;

		if ( hours === 0 ) {
			return `${ minutes } minutes`;
		} else if ( remainingMinutes === 0 ) {
			return `${ hours } hour${ hours > 1 ? 's' : '' }`;
		} else {
			return `${ hours } hour${
				hours > 1 ? 's' : ''
			} ${ remainingMinutes } minutes`;
		}
	}

	/**
	 * Format duration label for days
	 *
	 * @param {number} days - Duration in days
	 * @return {string} Formatted duration string
	 */
	static formatDaysLabel( days ) {
		return `${ days } day${ days > 1 ? 's' : '' }`;
	}

	/**
	 * Format duration for display based on unit type
	 *
	 * @param {number} value - Duration value
	 * @param {string} unit  - Unit type: 'hours', 'minutes', or 'days'
	 * @return {string} Formatted duration string
	 */
	static formatDurationLabel( value, unit = 'hours' ) {
		switch ( unit ) {
			case 'minutes':
				return DurationOptions.formatMinutesLabel( value );
			case 'days':
				return DurationOptions.formatDaysLabel( value );
			case 'hours':
			default:
				return DurationOptions.formatHoursLabel( value );
		}
	}

	/**
	 * Set the selected value (from predefined list or custom)
	 * If the value is within tolerance of a predefined value, it will be rounded to that value
	 *
	 * @param {number} value - Selected value
	 */
	setValue( value ) {
		const matchingValue = this.getMatchingValue( value );
		this.selectedValue =
			matchingValue !== undefined ? matchingValue : value;
	}

	/**
	 * Get matching predefined value
	 * Uses tolerance for floating point comparison
	 *
	 * @param {number|null} value - Value to check
	 * @return {number|undefined} Matching predefined value or undefined if no match
	 */
	getMatchingValue( value ) {
		if ( value === null || value === undefined ) {
			return undefined;
		}

		return this.values.find(
			( predefinedValue ) =>
				Math.abs( predefinedValue - value ) < this.tolerance
		);
	}

	/**
	 * Get current selection value for a given duration
	 * Returns the matching predefined value or 'other' if no match
	 *
	 * @param {number|null} currentValue - Current duration value
	 * @return {number|string} Matching predefined value or 'other'
	 */
	getCurrentSelection( currentValue ) {
		const matchingValue = this.getMatchingValue( currentValue );
		return matchingValue !== undefined ? matchingValue : 'other';
	}

	/**
	 * Get duration options as formatted option objects
	 * Always includes "Other" as the first option
	 * If a custom selectedValue is set (via setValue), it's automatically added to the list
	 *
	 * @return {Object[]} Array of option objects with label and value properties
	 */
	getDurationOptions() {
		const options = [
			{
				label: this.otherLabel,
				value: 'other',
			},
		];

		// Collect all values (predefined + custom if applicable)
		let allValues = [ ...this.values ];

		// If selectedValue is set and not in the predefined list, add it temporarily
		if (
			this.selectedValue !== null &&
			this.getMatchingValue( this.selectedValue ) === undefined &&
			this.selectedValue > 0
		) {
			allValues.push( this.selectedValue );
			// Sort all values
			allValues.sort( ( a, b ) => a - b );
		}

		// Add all values as options
		allValues.forEach( ( value ) => {
			options.push( {
				label: this.formatLabel( value, this.unit ),
				value: value,
			} );
		} );

		return options;
	}
}
