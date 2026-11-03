/**
 * Read the timing of a URL lookup response into form values.
 *
 * Shared-package parsers since 0.2.9 return split site-local fields
 * (`start_date`, `start_time`, `end_date`, `end_time`). Older copies, which a
 * sibling plugin's vendor directory can still load first, return only the
 * combined site-local `start_datetime` / `end_datetime` ('Y-m-d H:i:s').
 *
 * The split fields win whenever the response has them, including a
 * deliberate null; the combined fields are read only when the split ones
 * are absent. Both are site-local already, so they are split as text,
 * never parsed as Date objects (which would shift them by a timezone).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{2}:\d{2})(:\d{2})?$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/;

const readDate = ( value ) =>
	typeof value === 'string' && DATE.test( value ) ? value : '';

const readTime = ( value ) => {
	const match = typeof value === 'string' && value.match( TIME );
	return match ? match[ 1 ] : '';
};

const readDatetime = ( value ) => {
	const match = typeof value === 'string' && value.match( DATETIME );
	return match ? { date: match[ 1 ], time: match[ 2 ] } : null;
};

/**
 * @param {Object} metadata Lookup response.
 * @return {{allDay: boolean, startDate: string, startTime: string, endDate: string, endTime: string}|null}
 *         Form timing, or null when the response has no usable start.
 */
export function getLookupTiming( metadata ) {
	if ( ! metadata || typeof metadata !== 'object' ) {
		return null;
	}

	const allDay = Boolean( metadata.all_day );

	if ( 'start_date' in metadata ) {
		const startDate = readDate( metadata.start_date );
		if ( ! startDate ) {
			return null;
		}
		return {
			allDay,
			startDate,
			startTime: allDay ? '' : readTime( metadata.start_time ),
			// The page's own end, or none: the end date falls back to the
			// start day, and no end time is invented.
			endDate: readDate( metadata.end_date ) || startDate,
			endTime: allDay ? '' : readTime( metadata.end_time ),
		};
	}

	const start = readDatetime( metadata.start_datetime );
	if ( ! start ) {
		return null;
	}
	const end = readDatetime( metadata.end_datetime );

	return {
		allDay,
		startDate: start.date,
		// Older parsers stored a date-only value as midnight and flagged it
		// with all_day, so that midnight isn't a time from the page.
		startTime: allDay ? '' : start.time,
		endDate: end ? end.date : start.date,
		endTime: allDay || ! end ? '' : end.time,
	};
}
