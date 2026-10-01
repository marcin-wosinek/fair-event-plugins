/**
 * Pure helpers for the Compare events page: URL state, event labels, and the
 * alignment of two Statistics responses on one event-relative timeline.
 *
 * @package FairEventsExperimental
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';
import { getEventDisplayTitle } from 'fair-events-shared';
import { toFilenamePart } from 'fair-events/src/Admin/event-statistics/exportChartImage.js';

export const SLOTS = [ 'current', 'comparison' ];

export const URL_PARAMS = {
	current: 'current_event_date_id',
	comparison: 'comparison_event_date_id',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read one occurrence ID from a query-parameter value.
 *
 * @param {string|null} raw Raw parameter value.
 * @return {{id: number|null, invalid: boolean}} The ID, or `invalid` when the
 *                                               parameter is present but is not a positive integer.
 */
export function parseEventDateId( raw ) {
	if ( raw === null || raw === undefined || raw === '' ) {
		return { id: null, invalid: false };
	}
	if ( ! /^[1-9]\d*$/.test( String( raw ) ) ) {
		return { id: null, invalid: true };
	}
	return { id: Number( raw ), invalid: false };
}

/**
 * Read both selections from a query string.
 *
 * @param {string} search Query string, such as `window.location.search`.
 * @return {Object} `{ current, comparison }`, each as parseEventDateId() returns.
 */
export function readSelection( search ) {
	const params = new URLSearchParams( search );
	return {
		current: parseEventDateId( params.get( URL_PARAMS.current ) ),
		comparison: parseEventDateId( params.get( URL_PARAMS.comparison ) ),
	};
}

/**
 * Build the query string that stores one changed selection, leaving every
 * other parameter (the admin page slug, the other selection) untouched.
 *
 * @param {string}      search Current query string.
 * @param {string}      slot   `current` or `comparison`.
 * @param {number|null} id     Selected occurrence ID, or null to clear.
 * @return {string} Query string including the leading `?`.
 */
export function writeSelection( search, slot, id ) {
	const params = new URLSearchParams( search );
	if ( id ) {
		params.set( URL_PARAMS[ slot ], String( id ) );
	} else {
		params.delete( URL_PARAMS[ slot ] );
	}
	return `?${ params.toString() }`;
}

/**
 * Format an occurrence's start as a site-local date, with the time unless the
 * event lasts all day.
 *
 * The stored value is already wall-clock site time, so it is formatted as UTC
 * to keep dateI18n from applying the site offset a second time.
 *
 * @param {Object} event Event date with `start_datetime` and `all_day`.
 * @return {string} Formatted date, or '' when the event has no start.
 */
export function formatEventStart( event ) {
	if ( ! event?.start_datetime ) {
		return '';
	}
	const { formats } = getSettings();
	return dateI18n(
		event.all_day ? formats.date : formats.datetime,
		`${ String( event.start_datetime ).replace( ' ', 'T' ) }Z`,
		true
	);
}

/**
 * Name one occurrence: its title and start, so two dates of the same series
 * stay distinguishable.
 *
 * @param {Object} event Event date with `title`, `start_datetime`, `all_day`.
 * @return {string} Label such as "Yoga retreat — October 12, 2026 6:00 pm".
 */
export function getEventLabel( event ) {
	const title = getEventDisplayTitle( event?.title );
	const start = formatEventStart( event );
	if ( ! start ) {
		return title;
	}
	return sprintf(
		/* translators: 1: event name, 2: event start date. */
		__( '%1$s — %2$s', 'fair-events-experimental' ),
		title,
		start
	);
}

/**
 * Flatten a page of the paginated event-date list into selectable
 * occurrences: every single event, every series start, and every further date
 * of a series. Cancelled occurrences are left out.
 *
 * @param {Array} items Response of `/fair-events/v1/event-dates/all`.
 * @return {Array} Occurrences, newest first.
 */
export function flattenOccurrences( items ) {
	const occurrences = [];
	( items || [] ).forEach( ( item ) => {
		occurrences.push( item );
		( item.children || [] ).forEach( ( child ) => {
			// A further date of a series stores no title of its own.
			occurrences.push( { ...child, title: child.title || item.title } );
		} );
	} );
	return occurrences
		.filter( ( occurrence ) => occurrence.status !== 'cancelled' )
		.sort( ( a, b ) =>
			String( b.start_datetime ).localeCompare(
				String( a.start_datetime )
			)
		);
}

function toUtcDay( date ) {
	const [ year, month, day ] = String( date )
		.slice( 0, 10 )
		.split( '-' )
		.map( Number );
	return Date.UTC( year, month - 1, day );
}

/**
 * Calendar days from an event's start to a date; negative before the event.
 *
 * @param {string} date      Point date (Y-m-d).
 * @param {string} startDate Event start date (Y-m-d).
 * @return {number} Whole days.
 */
export function getDayOffset( date, startDate ) {
	return Math.round(
		( toUtcDay( date ) - toUtcDay( startDate ) ) / MS_PER_DAY
	);
}

/**
 * Label one position on the shared event-relative axis.
 *
 * @param {number}  offset       Days from the event start.
 * @param {boolean} hasLaterDays Whether either event runs past its first day.
 * @return {string} Translated label.
 */
export function getOffsetLabel( offset, hasLaterDays ) {
	if ( offset < 0 ) {
		return sprintf(
			/* translators: %d: number of calendar days before the event. */
			_n(
				'%d day before the event',
				'%d days before the event',
				-offset,
				'fair-events-experimental'
			),
			-offset
		);
	}
	if ( offset === 0 && ! hasLaterDays ) {
		return __( 'Day of the event', 'fair-events-experimental' );
	}
	return sprintf(
		/* translators: %d: event-day number, counting the first day as 1. */
		__( 'Day %d of the event', 'fair-events-experimental' ),
		offset + 1
	);
}

function toOffsetValues( statistics, seriesKey, valueKey ) {
	const values = new Map();
	( statistics?.[ seriesKey ] || [] ).forEach( ( point ) => {
		values.set(
			getDayOffset( point.date, statistics.start_date ),
			// A null value is a day that has not happened yet.
			typeof point[ valueKey ] === 'number' ? point[ valueKey ] : null
		);
	} );
	return values;
}

/**
 * Align one series of two Statistics responses by days relative to each
 * event's own start.
 *
 * Each row carries a slot's value only where that event's response has a
 * point: a number for a recorded day (zero included), `null` for a day that
 * has not happened yet, and no key at all outside the event's own window, so
 * nothing is inferred beyond what Statistics returned.
 *
 * @param {Object} statistics Statistics responses keyed by `current` and `comparison`.
 * @param {string} seriesKey  `series` or `amount_series`.
 * @param {string} valueKey   `total` or `amount`.
 * @return {Array} Rows `{ offset, label, current?, comparison? }`, in day order.
 */
export function alignSeries( statistics, seriesKey, valueKey ) {
	const values = {};
	SLOTS.forEach( ( slot ) => {
		values[ slot ] = toOffsetValues(
			statistics[ slot ],
			seriesKey,
			valueKey
		);
	} );
	const offsets = [
		...new Set( SLOTS.flatMap( ( slot ) => [ ...values[ slot ].keys() ] ) ),
	].sort( ( a, b ) => a - b );
	const hasLaterDays = offsets.some( ( offset ) => offset > 0 );

	return offsets.map( ( offset ) => {
		const row = { offset, label: getOffsetLabel( offset, hasLaterDays ) };
		SLOTS.forEach( ( slot ) => {
			if ( values[ slot ].has( offset ) ) {
				row[ slot ] = values[ slot ].get( offset );
			}
		} );
		return row;
	} );
}

/**
 * Find the part of one event's timeline that has not happened yet: from its
 * last recorded day to the last day of its window, at the last recorded value.
 *
 * @param {Array}  rows Rows from alignSeries().
 * @param {string} slot `current` or `comparison`.
 * @return {Array|null} Two `{ x, y }` points, or null when every day is recorded.
 */
export function getFutureHorizon( rows, slot ) {
	const own = rows.filter( ( row ) => row[ slot ] !== undefined );
	let recorded = null;
	own.forEach( ( row ) => {
		if ( typeof row[ slot ] === 'number' ) {
			recorded = row;
		}
	} );
	const last = own.at( -1 );
	if ( ! recorded || recorded === last ) {
		return null;
	}
	return [
		{ x: recorded.label, y: recorded[ slot ] },
		{ x: last.label, y: recorded[ slot ] },
	];
}

function toEventFilenamePart( event, statistics ) {
	return `${ toFilenamePart( event?.title, 'event' ) }-${
		statistics?.start_date || 'date'
	}`;
}

/**
 * Build the download filename for one comparison chart.
 *
 * @param {Object} events     Events keyed by `current` and `comparison`.
 * @param {Object} statistics Statistics responses keyed the same way.
 * @param {string} chartName  Chart title.
 * @return {string} Filename such as
 *                  `spring-ball-2026-04-11-vs-autumn-ball-2026-10-03-cumulative-tickets-sold.png`.
 */
export function buildComparisonFilename( events, statistics, chartName ) {
	return `${ toEventFilenamePart(
		events.current,
		statistics.current
	) }-vs-${ toEventFilenamePart(
		events.comparison,
		statistics.comparison
	) }-${ toFilenamePart( chartName, 'chart' ) }.png`;
}
