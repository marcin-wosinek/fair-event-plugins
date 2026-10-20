/**
 * Mapping between Fair Events' event data and the calendar button's
 * attributes, used by "Keep in sync with event data".
 *
 * Fair Events stores site-local dates with independently optional times
 * (`start_date`, `end_date`, `start_time`, `end_time`, `all_day`). Mirrors
 * `FairCalendarButton\Integration\FairEventsData` on the server: nothing
 * substitutes a missing time or infers an all-day event.
 */

/**
 * Store registered by Fair Events' editor scripts. It holds the edited
 * event's data, including unsaved changes in the Event Details panel.
 */
export const EVENT_DATA_STORE = 'fair-events/event-data';

/**
 * Pick the post's primary event date from the `event_id` list, the way
 * Fair Events' `EventDates::get_by_event_id()` does: the single or series
 * row, a dated one before an undated one, then the oldest.
 *
 * @param {Array} rows Event dates returned for the post.
 * @return {Object|null} The primary event date, or null when there is none.
 */
export function primaryEventDate( rows ) {
	const candidates = ( Array.isArray( rows ) ? rows : [] ).filter(
		( row ) =>
			row &&
			( row.occurrence_type === 'single' ||
				row.occurrence_type === 'master' )
	);

	candidates.sort( ( a, b ) => {
		const undatedA = a.start_date ? 0 : 1;
		const undatedB = b.start_date ? 0 : 1;
		return undatedA - undatedB || a.id - b.id;
	} );

	return candidates[ 0 ] || null;
}

/**
 * Calendar timing for an event date, or null when it can't be added to a
 * calendar: it needs a start date, and either the all-day flag or both a
 * start and an end time.
 *
 * @param {Object} eventDate Event date with the canonical timing fields.
 * @return {{start: string, end: string, allDay: boolean}|null} Attributes.
 */
export function toCalendarTiming( eventDate ) {
	if ( ! eventDate?.start_date ) {
		return null;
	}

	const endDate = eventDate.end_date || eventDate.start_date;

	if ( eventDate.all_day ) {
		return { start: eventDate.start_date, end: endDate, allDay: true };
	}

	if ( ! eventDate.start_time || ! eventDate.end_time ) {
		return null;
	}

	return {
		start: `${ eventDate.start_date }T${ eventDate.start_time.substring(
			0,
			5
		) }`,
		end: `${ endDate }T${ eventDate.end_time.substring( 0, 5 ) }`,
		allDay: false,
	};
}

/**
 * The event's location: the venue's name and address, or the event date's
 * own address when no venue is selected.
 *
 * @param {Object}      eventDate Event date.
 * @param {Object|null} venue     The selected venue, when there is one.
 * @return {string} Location text, empty when the event has none.
 */
export function eventLocation( eventDate, venue ) {
	if ( venue?.name ) {
		return venue.address
			? `${ venue.name }, ${ venue.address }`
			: venue.name;
	}

	return eventDate?.address || '';
}
