/**
 * Event date timing for specs that compute a start and end as naive
 * site-local datetimes: the REST API takes and returns dates with
 * independently optional times (#1819).
 */

/**
 * Split a naive datetime into a date and an optional time.
 *
 * @param {string|null} value "Y-m-d H:i:s", "Y-m-dTH:i:s" or "Y-m-d".
 * @return {{date: string|null, time: string|null}} Parts.
 */
function split(value) {
	if (!value) {
		return { date: null, time: null };
	}
	const [date, time] = String(value).split(/[ T]/);
	return {
		date,
		time: time ? time.slice(0, 8).padEnd(8, ':00') : null,
	};
}

/**
 * Request fields for an event date from naive start and end datetimes.
 *
 * @param {string}      start Start ("Y-m-d H:i:s", "Y-m-dTH:i:s" or "Y-m-d").
 * @param {string|null} end   End, or null for none.
 * @return {Object} start_date, end_date, start_time and end_time.
 */
export function timingFields(start, end = null) {
	const from = split(start);
	const to = split(end);
	return {
		start_date: from.date,
		end_date: to.date || from.date,
		start_time: from.time,
		end_time: to.time,
	};
}

/**
 * The naive start of an event date from a REST response, for comparing
 * and ordering: its date and start time, or the date alone without one.
 *
 * @param {Object} eventDate Object with start_date and start_time.
 * @return {string} "Y-m-d H:i:s", "Y-m-d", or '' when undated.
 */
export function startOf(eventDate) {
	if (!eventDate?.start_date) {
		return '';
	}
	return eventDate.start_time
		? `${eventDate.start_date} ${eventDate.start_time}`
		: eventDate.start_date;
}

/**
 * The naive end of an event date from a REST response: its end date and
 * end time, or the end date alone without one.
 *
 * @param {Object} eventDate Object with end_date and end_time.
 * @return {string} "Y-m-d H:i:s", "Y-m-d", or '' when undated.
 */
export function endOf(eventDate) {
	if (!eventDate?.end_date) {
		return '';
	}
	return eventDate.end_time
		? `${eventDate.end_date} ${eventDate.end_time}`
		: eventDate.end_date;
}
