/**
 * RRULE Manager for the Calendar Button block.
 *
 * Adapts the block's recurrence attributes to the shared recurrence logic in
 * fair-events-shared, so rules and occurrence dates match Fair Events.
 */

import { format, isValid, parseISO } from 'date-fns';
import {
	buildRRule,
	expandRRulePreview,
} from 'fair-events-shared/src/recurrence.js';

const UNTIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Translate the block's recurrence attributes into the shared recurrence shape.
 *
 * @param {Object} uiState Block recurrence attributes (frequency, interval, count, until).
 * @return {Object} Shared recurrence shape accepted by `buildRRule()`.
 */
function toSharedRecurrence( uiState ) {
	const hasFrequency = !! uiState?.frequency;
	let frequency = hasFrequency ? String( uiState.frequency ) : '';

	// A stored two-week interval is the shared "biweekly" frequency. Other
	// intervals are outside the shared vocabulary and are dropped.
	if ( frequency === 'WEEKLY' && Number( uiState.interval ) === 2 ) {
		frequency = 'BIWEEKLY';
	}

	const count = Number( uiState?.count ) > 0 ? Number( uiState.count ) : null;
	const until =
		typeof uiState?.until === 'string' &&
		UNTIL_DATE_PATTERN.test( uiState.until )
			? uiState.until
			: '';

	return {
		enabled: hasFrequency,
		frequency: frequency.toLowerCase(),
		endType: ! count && until ? 'until' : 'count',
		count,
		until,
	};
}

/**
 * Normalize a block start value to the naive local datetime the shared
 * expansion expects. A date-only value becomes local midnight, so it is not
 * read as UTC.
 *
 * @param {string} startDate Start date string (YYYY-MM-DD or datetime format).
 * @return {string} Local "Y-m-dTH:i:s" string, or '' when the value is not a date.
 */
function toLocalStartDatetime( startDate ) {
	if ( ! startDate || typeof startDate !== 'string' ) {
		return '';
	}

	const start = parseISO( startDate );
	return isValid( start ) ? format( start, "yyyy-MM-dd'T'HH:mm:ss" ) : '';
}

/**
 * Convert a "Y-m-d" string to a Date at local midnight.
 *
 * @param {string} dateString Date string in YYYY-MM-DD format.
 * @return {Date} Local date.
 */
function toLocalDate( dateString ) {
	const [ year, month, day ] = dateString.split( '-' ).map( Number );
	return new Date( year, month - 1, day );
}

/**
 * RRuleManager class for managing RRULE generation and occurrence previews
 */
export class RRuleManager {
	/**
	 * Convert UI state to RRULE string
	 *
	 * @param {Object} uiState UI state object
	 * @return {string} RRULE string
	 */
	toRRule( uiState ) {
		return buildRRule( toSharedRecurrence( uiState ) ) || '';
	}

	/**
	 * Generate array of event dates based on recurrence rule
	 *
	 * @param {Object} uiState      UI state object with frequency, count, until, and interval
	 * @param {string} startDate    Start date string (YYYY-MM-DD or datetime format)
	 * @param {number} maxInstances Maximum number of instances to generate (default: 10)
	 * @return {Array<Date>} Array of local-midnight Date objects, one per occurrence day
	 */
	generateEvents( uiState, startDate, maxInstances = 10 ) {
		const rrule = this.toRRule( uiState );
		const start = toLocalStartDatetime( startDate );
		if ( ! rrule || ! start ) {
			return [];
		}

		return expandRRulePreview( rrule, start, maxInstances ).dates.map(
			toLocalDate
		);
	}
}

// Export default instance for convenience
export const rruleManager = new RRuleManager();
