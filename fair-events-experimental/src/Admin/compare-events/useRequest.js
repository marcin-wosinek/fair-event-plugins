/**
 * Load one REST resource for the Compare events page.
 *
 * @package FairEventsExperimental
 */

import { useCallback, useEffect, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Fetch a REST path and report the request state.
 *
 * The reported state always belongs to the path passed in this render: a
 * response for a path requested earlier is dropped, and until the current
 * path's own response arrives the state is `loading`, so a rapid change never
 * shows the previous result.
 *
 * @param {string|null} path REST path, or null to fetch nothing.
 * @return {{status: string, data: *, error: *, retry: Function}} `status` is
 *         `idle`, `loading`, `ready`, or `error`.
 */
export default function useRequest( path ) {
	const [ result, setResult ] = useState( null );
	const [ attempt, setAttempt ] = useState( 0 );

	useEffect( () => {
		if ( ! path ) {
			return undefined;
		}
		let stale = false;
		apiFetch( { path } )
			.then( ( data ) => {
				if ( ! stale ) {
					setResult( { path, attempt, status: 'ready', data } );
				}
			} )
			.catch( ( error ) => {
				if ( ! stale ) {
					setResult( { path, attempt, status: 'error', error } );
				}
			} );
		return () => {
			stale = true;
		};
	}, [ path, attempt ] );

	const retry = useCallback( () => setAttempt( ( count ) => count + 1 ), [] );

	if ( ! path ) {
		return { status: 'idle', data: null, error: null, retry };
	}
	if ( result?.path !== path || result.attempt !== attempt ) {
		return { status: 'loading', data: null, error: null, retry };
	}
	return {
		status: result.status,
		data: result.data ?? null,
		error: result.error ?? null,
		retry,
	};
}
