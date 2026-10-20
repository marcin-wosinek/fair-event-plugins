/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { errorMessage } from './shared.js';

/**
 * A route with query arguments; empty ones are left out.
 *
 * @param {string} path  Route.
 * @param {Object} query Query arguments.
 * @return {string} Path.
 */
export function withQuery( path, query ) {
	const params = new URLSearchParams();
	Object.entries( query ).forEach( ( [ name, value ] ) => {
		if ( '' !== value && null !== value && undefined !== value ) {
			params.set( name, String( value ) );
		}
	} );
	const search = params.toString();
	return search ? `${ path }?${ search }` : path;
}

/**
 * Read a history route, with the totals of a paginated one.
 *
 * @param {string} path  Route.
 * @param {Object} query Query arguments.
 * @return {Promise<Object>} `items` (the body), `total` and `totalPages`.
 */
export async function fetchHistory( path, query = {} ) {
	let response;
	try {
		response = await apiFetch( {
			path: withQuery( path, query ),
			parse: false,
		} );
	} catch ( error ) {
		// Without parsing, a refused request rejects with its response.
		if ( 'function' === typeof error?.json ) {
			throw await error.json().catch( () => ( {} ) );
		}
		throw error;
	}
	const items = await response.json();
	const header = ( name ) => parseInt( response.headers?.get( name ), 10 );
	return {
		items,
		total: header( 'X-WP-Total' ) || 0,
		totalPages: header( 'X-WP-TotalPages' ) || 0,
	};
}

/**
 * A history request that follows its route and query. A response that
 * arrives after a newer request was issued is dropped.
 *
 * @param {string|null} path     Route, or null to request nothing.
 * @param {Object}      query    Query arguments.
 * @param {string}      fallback Error message when the server gives none.
 * @return {Object} `result`, `error` with its `errorCode`, `loading` and
 *     `retry()`.
 */
export default function useHistoryRequest( path, query, fallback ) {
	const [ state, setState ] = useState( {
		result: null,
		error: null,
		loading: !! path,
	} );
	const request = useRef( 0 );
	const key = JSON.stringify( [ path, query ] );

	const load = useCallback( () => {
		const issued = ++request.current;
		if ( ! path ) {
			return;
		}
		setState( ( current ) => ( { ...current, loading: true } ) );
		fetchHistory( path, query ).then(
			( result ) => {
				if ( issued === request.current ) {
					setState( { result, error: null, loading: false } );
				}
			},
			( error ) => {
				if ( issued === request.current ) {
					setState( {
						result: null,
						error: errorMessage( error, fallback ),
						errorCode: error?.code || null,
						loading: false,
					} );
				}
			}
		);
		// `key` stands for path and query.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ key, fallback ] );

	useEffect( () => {
		load();
	}, [ load ] );

	return { ...state, retry: load };
}
