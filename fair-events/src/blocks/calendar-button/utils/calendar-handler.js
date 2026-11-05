/**
 * Calendar utility functions
 */

import { google, outlook, yahoo, ics } from 'calendar-link';
import {
	faGoogle,
	faMicrosoft,
	faYahoo,
} from '@fortawesome/free-brands-svg-icons';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { icon } from '@fortawesome/fontawesome-svg-core';
import { __ } from '@wordpress/i18n';
import { openCalendarDropdown } from 'fair-events-shared/src/calendar-dropdown.js';

/**
 * Handle calendar button click - shows a dropdown with provider options
 *
 * @param {Object}      eventData     - Event data object
 * @param {HTMLElement} buttonElement - The clicked button element
 */
export function handleCalendarClick( eventData, buttonElement ) {
	openCalendarDropdown( eventData, buttonElement, {
		generators: { google, outlook, yahoo, ics },
		icons: {
			google: faGoogle,
			outlook: faMicrosoft,
			yahoo: faYahoo,
			ics: faDownload,
		},
		renderIcon: icon,
		icsLabel: __( 'Download ICS', 'fair-events' ),
		onProviderSelect: trackProviderSelect,
	} );
}

/**
 * Track the chosen provider with Plausible (if available).
 *
 * @param {string} provider - Provider key.
 */
function trackProviderSelect( provider ) {
	if ( typeof window.plausible === 'function' ) {
		window.plausible( 'Fair calendar button', {
			props: { provider },
		} );
	}
}

/**
 * Reduce a datetime string to its calendar date (YYYY-MM-DD) for all-day
 * events. calendar-link reads date-only strings as that calendar day in
 * every timezone, whereas a Date object can be shifted by the viewer's
 * offset (e.g. UTC noon is local midnight in UTC+12).
 *
 * @param {string} datetimeStr - Date or datetime string
 * @param {number} addDays     - Days to add to the date
 * @return {string} Date in YYYY-MM-DD format
 */
function toCalendarDate( datetimeStr, addDays = 0 ) {
	const [ year, month, day ] = datetimeStr
		.split( /[ T]/ )[ 0 ]
		.split( '-' )
		.map( Number );
	return new Date( Date.UTC( year, month - 1, day + addDays ) )
		.toISOString()
		.slice( 0, 10 );
}

/**
 * Whether event attributes can be exported to a calendar: an all-day event
 * with a start date, or a timed event with both a start and an end. A
 * missing time is never replaced by midnight or a guessed duration, so such
 * an event gets no calendar link or download.
 *
 * @param {Object}  attributes        - Block attributes
 * @param {string}  attributes.start  - Start date or datetime
 * @param {string}  attributes.end    - End date or datetime
 * @param {boolean} attributes.allDay - Whether the event is all-day
 * @return {boolean} True when the event can be exported
 */
export function isCalendarExportable( { start, end, allDay } ) {
	return allDay ? Boolean( start ) : Boolean( start && end );
}

/**
 * Convert block attributes to calendar event data
 *
 * @param {Object} attributes - Block attributes
 * @return {Object} Event data for calendar-link
 */
export function createEventData( attributes ) {
	const {
		start,
		end,
		allDay,
		description,
		location,
		title,
		recurring,
		rRule,
		url,
	} = attributes;
	const eventData = {};

	if ( start ) {
		eventData.start = allDay ? toCalendarDate( start ) : new Date( start );
	}
	if ( end ) {
		// For all-day events, make the end date inclusive by adding one day
		// This ensures multi-day all-day events include the end date
		eventData.end = allDay
			? toCalendarDate( end, start && end !== start ? 1 : 0 )
			: new Date( end );
	}
	if ( allDay !== undefined ) eventData.allDay = allDay;
	if ( description ) eventData.description = description;
	if ( location ) eventData.location = location;
	if ( title ) eventData.title = title;
	if ( url ) eventData.url = url;

	// Include rRule if recurring is enabled and rRule is provided
	if ( recurring && rRule ) {
		eventData.rRule = rRule;
	}

	return eventData;
}
