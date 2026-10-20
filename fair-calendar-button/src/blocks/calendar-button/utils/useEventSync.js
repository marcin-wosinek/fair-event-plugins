/**
 * Synchronization state for "Keep in sync with event data".
 */

import apiFetch from '@wordpress/api-fetch';
import { useSelect } from '@wordpress/data';
import { useEffect, useMemo, useState } from '@wordpress/element';
import {
	EVENT_DATA_STORE,
	eventLocation,
	primaryEventDate,
	toCalendarTiming,
} from './eventSync.js';

// getEventData() returns null until Fair Events has loaded the event, so an
// unregistered store needs its own marker.
const STORE_MISSING = 'store-missing';

/**
 * Resolve the event data a synchronized calendar button uses.
 *
 * Fair Events' `fair-events/event-data` store carries the edited event,
 * unsaved changes included. Until it holds data — or for a post other than
 * the one being edited — the post's primary event date is read through the
 * REST API. Responses that arrive after the post changes or synchronization
 * is turned off are ignored.
 *
 * Statuses: `off` (not synchronized), `unavailable` (Fair Events is not
 * active), `loading`, `missing` (no event date), `incomplete` (not
 * exportable: no start date, or a timed event without both times), `error`
 * (a request failed) and `synced`, the only status with `values`.
 *
 * @param {Object}  options               Options.
 * @param {boolean} options.enabled       Whether synchronization is on.
 * @param {number}  options.postId        Event post the button belongs to.
 * @param {boolean} options.isCurrentPost Whether that post is being edited.
 * @return {{status: string, values: Object|null, errorMessage: string}} State.
 */
export function useEventSync( { enabled, postId, isCurrentPost } ) {
	const storeEventData = useSelect( ( select ) => {
		const store = select( EVENT_DATA_STORE );
		return store ? store.getEventData() : STORE_MISSING;
	}, [] );

	const storeAvailable = storeEventData !== STORE_MISSING;
	const liveEventData =
		storeAvailable && isCurrentPost && storeEventData
			? storeEventData
			: null;

	const [ request, setRequest ] = useState( { postId: null } );
	const needsRequest =
		enabled && storeAvailable && !! postId && ! liveEventData;

	useEffect( () => {
		if ( ! needsRequest ) {
			return;
		}

		let cancelled = false;
		setRequest( { postId, phase: 'loading' } );

		apiFetch( {
			path: `/fair-events/v1/event-dates?event_id=${ parseInt(
				postId,
				10
			) }`,
		} )
			.then( ( rows ) => {
				if ( ! cancelled ) {
					setRequest( {
						postId,
						phase: 'done',
						eventDate: primaryEventDate( rows ),
					} );
				}
			} )
			.catch( ( error ) => {
				if ( ! cancelled ) {
					setRequest( {
						postId,
						phase: 'error',
						message: error?.message || '',
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ needsRequest, postId ] );

	let eventDate;
	if ( liveEventData ) {
		eventDate = liveEventData;
	} else if ( request.postId === postId && request.phase === 'done' ) {
		eventDate = request.eventDate;
	}

	const venueId = enabled && eventDate?.venue_id ? eventDate.venue_id : 0;
	const [ venueRequest, setVenueRequest ] = useState( { venueId: 0 } );

	useEffect( () => {
		if ( ! venueId ) {
			return;
		}

		let cancelled = false;
		setVenueRequest( { venueId, phase: 'loading' } );

		apiFetch( {
			path: `/fair-events/v1/venues/${ parseInt( venueId, 10 ) }`,
		} )
			.then( ( venue ) => {
				if ( ! cancelled ) {
					setVenueRequest( { venueId, phase: 'done', venue } );
				}
			} )
			.catch( ( error ) => {
				if ( ! cancelled ) {
					setVenueRequest( {
						venueId,
						phase: 'error',
						message: error?.message || '',
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ venueId ] );

	const venueState = venueRequest.venueId === venueId ? venueRequest : null;

	return useMemo( () => {
		const state = ( status, errorMessage = '' ) => ( {
			status,
			values: null,
			errorMessage,
		} );

		if ( ! enabled ) {
			return state( 'off' );
		}
		if ( ! storeAvailable ) {
			return state( 'unavailable' );
		}
		if ( eventDate === undefined ) {
			return request.postId === postId && request.phase === 'error'
				? state( 'error', request.message )
				: state( 'loading' );
		}
		if ( eventDate === null ) {
			return state( 'missing' );
		}

		const timing = toCalendarTiming( eventDate );
		if ( ! timing ) {
			return state( 'incomplete' );
		}

		let venue = null;
		if ( venueId ) {
			if ( venueState?.phase === 'error' ) {
				return state( 'error', venueState.message );
			}
			if ( venueState?.phase !== 'done' ) {
				return state( 'loading' );
			}
			venue = venueState.venue;
		}

		return {
			status: 'synced',
			values: { ...timing, location: eventLocation( eventDate, venue ) },
			errorMessage: '',
		};
	}, [
		enabled,
		storeAvailable,
		eventDate,
		request,
		postId,
		venueId,
		venueState,
	] );
}
