/**
 * Translated duration labels for the shared DurationOptions helper.
 *
 * DurationOptions lives in fair-events-shared and cannot declare an
 * extractable text domain, so the strings are declared here as literal
 * `fair-events` calls and injected into it.
 */

import { _n, _x, sprintf } from '@wordpress/i18n';

const formatMinutes = ( minutes ) =>
	sprintf(
		/* translators: %d: number of minutes */
		_n( '%d minute', '%d minutes', minutes, 'fair-events' ),
		minutes
	);

const formatHours = ( hours ) =>
	sprintf(
		/* translators: %d: number of hours */
		_n( '%d hour', '%d hours', hours, 'fair-events' ),
		hours
	);

const formatDays = ( days ) =>
	sprintf(
		/* translators: %d: number of days */
		_n( '%d day', '%d days', days, 'fair-events' ),
		days
	);

/**
 * Format a duration in minutes, split into hours and minutes.
 *
 * @param {number} totalMinutes Duration in minutes.
 * @return {string} Translated label, e.g. "1 hour 30 minutes".
 */
const formatTimedDuration = ( totalMinutes ) => {
	const rounded = Math.round( totalMinutes );
	const hours = Math.floor( rounded / 60 );
	const minutes = rounded % 60;

	if ( hours === 0 ) {
		return formatMinutes( minutes );
	}
	if ( minutes === 0 ) {
		return formatHours( hours );
	}
	return sprintf(
		/* translators: 1: number of hours, e.g. "2 hours"; 2: number of minutes, e.g. "30 minutes" */
		_x( '%1$s %2$s', 'duration: hours, then minutes', 'fair-events' ),
		formatHours( hours ),
		formatMinutes( minutes )
	);
};

/**
 * Format a duration option label, matching the DurationOptions formatLabel
 * signature.
 *
 * @param {number} value Duration value.
 * @param {string} unit  Unit type: 'hours', 'minutes', or 'days'.
 * @return {string} Translated label.
 */
export const formatDurationLabel = ( value, unit = 'hours' ) => {
	switch ( unit ) {
		case 'minutes':
			return formatTimedDuration( value );
		case 'days':
			return formatDays( value );
		case 'hours':
		default:
			return formatTimedDuration( value * 60 );
	}
};

/**
 * Label of the "Other" duration option.
 *
 * @return {string} Translated label.
 */
export const getOtherDurationLabel = () =>
	_x( 'Other', 'custom duration option', 'fair-events' );

/**
 * DurationOptions config entries that make its labels translated.
 *
 * Call it at render time (not module load) so the active locale data is used.
 *
 * @return {Object} `formatLabel` and `otherLabel` config entries.
 */
export const getDurationLabelConfig = () => ( {
	formatLabel: formatDurationLabel,
	otherLabel: getOtherDurationLabel(),
} );
