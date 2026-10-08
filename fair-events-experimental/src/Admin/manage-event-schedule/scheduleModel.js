/**
 * Schedule editor model - pure helpers
 *
 * Converts between the REST shape (naive site-local `YYYY-MM-DD HH:MM:SS`
 * strings) and the editor's entries (separate date and time fields), and
 * derives what the editor shows from them. Dates and times are handled as
 * the strings the organizer typed: nothing here goes through a timezone.
 *
 * @package FairEventsExperimental
 */

import { __ } from '@wordpress/i18n';

let nextKey = 0;

/**
 * A key that identifies an entry in the editor, saved or not.
 *
 * @return {string} Unique key for this page view.
 */
export const newEntryKey = () => `new-${ ++nextKey }`;

const splitDatetime = ( value ) => {
	const [ date = '', time = '' ] = String( value || '' )
		.replace( 'T', ' ' )
		.split( ' ' );
	return { date, time: time.substring( 0, 5 ) };
};

const joinDatetime = ( date, time ) =>
	date && time ? `${ date } ${ time }:00` : '';

const pad = ( value ) => String( value ).padStart( 2, '0' );

/**
 * Add minutes to a naive date and time, staying on the wall clock.
 *
 * @param {string} date    `YYYY-MM-DD`.
 * @param {string} time    `HH:MM`.
 * @param {number} minutes Minutes to add.
 * @return {{date: string, time: string}} The later date and time.
 */
export const addMinutes = ( date, time, minutes ) => {
	const [ year, month, day ] = date.split( '-' ).map( Number );
	const [ hours, mins ] = time.split( ':' ).map( Number );
	// UTC arithmetic on the typed numbers: no daylight-saving jump can move
	// the result off the wall clock.
	const later = new Date(
		Date.UTC( year, month - 1, day, hours, mins + minutes )
	);
	return {
		date: `${ later.getUTCFullYear() }-${ pad(
			later.getUTCMonth() + 1
		) }-${ pad( later.getUTCDate() ) }`,
		time: `${ pad( later.getUTCHours() ) }:${ pad(
			later.getUTCMinutes()
		) }`,
	};
};

/**
 * Turn a saved schedule item into an editor entry.
 *
 * @param {Object} item Item from the REST response.
 * @return {Object} Editor entry.
 */
export const entryFromItem = ( item ) => {
	const start = splitDatetime( item.start_datetime );
	const end = splitDatetime( item.end_datetime );
	return {
		key: `saved-${ item.id }`,
		id: item.id,
		ticket_option_id: item.ticket_option_id || null,
		bookable: !! item.bookable,
		title: item.title || '',
		startDate: start.date,
		startTime: start.time,
		endDate: end.date,
		endTime: end.time,
		description: item.description || '',
		location: item.location || '',
	};
};

/**
 * A new entry starting when the event does and lasting an hour.
 *
 * @param {Object}      eventDate Event the schedule belongs to.
 * @param {Object|null} option    Ticket option to link, or null for a program item.
 * @return {Object} Editor entry.
 */
export const newEntry = ( eventDate, option = null ) => {
	const start = splitDatetime( eventDate?.start_datetime );
	const startTime = start.time || '09:00';
	const end = start.date
		? addMinutes( start.date, startTime, 60 )
		: { date: '', time: '' };
	return {
		key: newEntryKey(),
		id: null,
		ticket_option_id: option ? option.id : null,
		// A workshop from Prices is bookable unless the organizer says
		// otherwise; a program item never is.
		bookable: !! option,
		title: option ? option.name : '',
		startDate: start.date,
		startTime: start.date ? startTime : '',
		endDate: end.date,
		endTime: end.time,
		description: '',
		location: '',
	};
};

/**
 * The REST payload for the editor's entries, in display order.
 *
 * @param {Object[]} entries Editor entries.
 * @return {Object[]} Items for `PUT …/schedule`.
 */
export const toPayload = ( entries ) =>
	entries.map( ( entry ) => ( {
		key: entry.key,
		...( entry.id ? { id: entry.id } : {} ),
		ticket_option_id: entry.ticket_option_id,
		bookable: entry.bookable,
		title: entry.ticket_option_id ? '' : entry.title.trim(),
		start_datetime: joinDatetime( entry.startDate, entry.startTime ),
		end_datetime: joinDatetime( entry.endDate, entry.endTime ),
		description: entry.description,
		location: entry.location.trim(),
	} ) );

/**
 * What identifies the entries' saved state, for unsaved-change detection.
 * Editor keys are left out: they change when a new entry gets its ID.
 *
 * @param {Object[]} entries Editor entries.
 * @return {string} Serialized state.
 */
export const serialize = ( entries ) =>
	JSON.stringify(
		toPayload( entries ).map( ( item ) => ( { ...item, key: undefined } ) )
	);

/**
 * Check the entries the way the server will, so the organizer sees what to
 * fix without a round trip.
 *
 * @param {Object[]} entries Editor entries.
 * @return {Object} Messages by entry key, then field.
 */
export const validateEntries = ( entries ) => {
	const errors = {};
	const add = ( key, field, message ) => {
		errors[ key ] = { ...( errors[ key ] || {} ), [ field ]: message };
	};

	entries.forEach( ( entry ) => {
		if ( ! entry.ticket_option_id && ! entry.title.trim() ) {
			add(
				entry.key,
				'title',
				__( 'Enter a title.', 'fair-events-experimental' )
			);
		}
		if ( ! entry.startDate || ! entry.startTime ) {
			add(
				entry.key,
				'start_datetime',
				__(
					'Enter a valid start date and time.',
					'fair-events-experimental'
				)
			);
		}
		if ( ! entry.endDate || ! entry.endTime ) {
			add(
				entry.key,
				'end_datetime',
				__(
					'Enter a valid end date and time.',
					'fair-events-experimental'
				)
			);
		}
		const start = joinDatetime( entry.startDate, entry.startTime );
		const end = joinDatetime( entry.endDate, entry.endTime );
		if ( start && end && end <= start ) {
			add(
				entry.key,
				'end_datetime',
				__(
					'The end must be after the start.',
					'fair-events-experimental'
				)
			);
		}
	} );

	return errors;
};

/**
 * Group the server's per-field errors by entry.
 *
 * @param {Object[]} serverErrors `data.errors` of a rejected save.
 * @return {Object} Messages by entry key, then field.
 */
export const errorsByEntry = ( serverErrors ) => {
	const errors = {};
	( serverErrors || [] ).forEach( ( { key, field, message } ) => {
		if ( ! key ) {
			return;
		}
		// The first message for a field is the one to act on.
		errors[ key ] = { [ field ]: message, ...( errors[ key ] || {} ) };
	} );
	return errors;
};

/**
 * Which other entries run at the same time as each entry. Parallel sessions
 * are fine; this only helps the organizer see them.
 *
 * @param {Object[]} entries Editor entries.
 * @return {Object} Overlapping entries by entry key.
 */
export const overlapsByEntry = ( entries ) => {
	const timed = entries
		.map( ( entry ) => ( {
			entry,
			start: joinDatetime( entry.startDate, entry.startTime ),
			end: joinDatetime( entry.endDate, entry.endTime ),
		} ) )
		.filter( ( { start, end } ) => start && end && end > start );

	const overlaps = {};
	timed.forEach( ( current ) => {
		const others = timed
			.filter(
				( other ) =>
					other.entry.key !== current.entry.key &&
					other.start < current.end &&
					current.start < other.end
			)
			.map( ( other ) => other.entry );
		if ( others.length ) {
			overlaps[ current.entry.key ] = others;
		}
	} );
	return overlaps;
};

/**
 * The name an entry is shown and referred to by.
 *
 * @param {Object} entry Editor entry.
 * @return {string} Its title, or a fallback for an untitled program item.
 */
export const entryName = ( entry ) =>
	entry.title.trim() || __( '(untitled item)', 'fair-events-experimental' );
