import { useState, useCallback, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

export const BUDGETS_PATH = '/fair-finance/v1/budgets';

/**
 * Budgets from Fair Finance, loaded on demand.
 *
 * `status` is `idle` until the first load, then `loading`, `success`,
 * `unavailable` or `error`. `unavailable` means the budgets route does not
 * exist, which is the case while Fair Finance is not active; every other
 * failure (permissions, network) is `error`. The list is empty while a load is
 * in flight and after a failure, so a select built from it never offers a
 * budget that was not just confirmed.
 *
 * @return {{status: string, budgets: Array, error: ?Object, load: Function}} Budget state and loader.
 */
export default function useBudgets() {
	const [ state, setState ] = useState( {
		status: 'idle',
		budgets: [],
		error: null,
	} );
	// Only the latest request may settle the state.
	const latestRequest = useRef( 0 );

	const load = useCallback( () => {
		const request = ++latestRequest.current;
		setState( { status: 'loading', budgets: [], error: null } );

		return apiFetch( { path: BUDGETS_PATH } )
			.then( ( data ) => {
				if ( request !== latestRequest.current ) {
					return;
				}
				setState( {
					status: 'success',
					budgets: Array.isArray( data ) ? data : [],
					error: null,
				} );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading budgets:', err );
				if ( request !== latestRequest.current ) {
					return;
				}
				setState( {
					status:
						err?.code === 'rest_no_route' ? 'unavailable' : 'error',
					budgets: [],
					error: err,
				} );
			} );
	}, [] );

	return { ...state, load };
}
