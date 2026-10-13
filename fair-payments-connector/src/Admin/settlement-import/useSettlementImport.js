/**
 * WordPress dependencies
 */
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import {
	fetchImport,
	fetchOpenImport,
	startImport,
	stepImport,
} from './api.js';

/**
 * Drive a Mollie settlement import from the browser, one request at a time.
 *
 * The server holds the cursor; this only keeps asking for the next step
 * while the run is running. `run` is always the server's own account of the
 * run: when a request fails, the run is read back instead of keeping what
 * the browser last saw. `run` and `working` are the single source of truth
 * for every control that depends on the import.
 *
 * `error` is `{ phase, message }`, where `phase` is `start`, `step` or
 * `refresh` and `message` is the server's explanation or null. Pages word
 * the fallback themselves.
 *
 * @param {Object}   options
 * @param {Function} [options.onFinished] Called with the run once this page stops driving it.
 * @param {Function} [options.onBegin]    Claims a page-wide busy state; returning false cancels.
 * @param {Function} [options.onEnd]      Releases that busy state.
 * @return {Object} `{ run, working, error, start, resume, refresh, adopt }`.
 */
export default function useSettlementImport( {
	onFinished,
	onBegin,
	onEnd,
} = {} ) {
	const [ run, setRun ] = useState( null );
	const [ working, setWorking ] = useState( false );
	const [ error, setError ] = useState( null );
	const mounted = useRef( true );
	// Read by callbacks that outlive the render they were created in.
	const latest = useRef( null );
	const busy = useRef( false );
	// Bumped whenever this page starts acting on a run, so an answer to an
	// earlier question is dropped instead of replacing a newer run.
	const generation = useRef( 0 );
	const callbacks = useRef( {} );

	callbacks.current = { onFinished, onBegin, onEnd };

	useEffect( () => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [] );

	const show = useCallback( ( next ) => {
		latest.current = next;
		setRun( next );
	}, [] );

	const fail = ( phase, cause ) =>
		setError( { phase, message: cause?.message || null } );

	/**
	 * Claim this page for an import.
	 *
	 * @return {boolean} False when this page is already driving one.
	 */
	const begin = () => {
		if ( busy.current || callbacks.current.onBegin?.() === false ) {
			return false;
		}
		busy.current = true;
		generation.current += 1;
		setWorking( true );
		setError( null );
		return true;
	};

	const end = ( current ) => {
		busy.current = false;
		if ( mounted.current ) {
			setWorking( false );
		}
		callbacks.current.onEnd?.();
		if ( mounted.current ) {
			callbacks.current.onFinished?.( current );
		}
	};

	/**
	 * Step a run until it stops running.
	 *
	 * @param {Object} first Run to drive; a stopped run is resumed by its first step.
	 * @return {Promise<Object>} The run as the server last reported it.
	 */
	const drive = useCallback(
		async ( first ) => {
			let current = first;

			try {
				do {
					current = ( await stepImport( current.id ) ).run;
					if ( ! mounted.current ) {
						return current;
					}
					show( current );
				} while ( current.status === 'running' );
			} catch ( stepError ) {
				if ( ! mounted.current ) {
					return current;
				}
				fail( 'step', stepError );

				// What the browser last saw may no longer be true: the
				// request can have died after the server recorded a failure,
				// or the run can have been replaced from another page.
				try {
					current = ( await fetchImport( current.id ) ).run;
					if ( mounted.current ) {
						show( current );
					}
				} catch ( readError ) {
					// Unreachable server: keep the last known run on screen.
				}
			}

			return current;
		},
		[ show ]
	);

	const start = useCallback(
		async ( kind, settlementId = 0 ) => {
			if ( ! begin() ) {
				return;
			}

			let current = latest.current;
			try {
				current = ( await startImport( kind, settlementId ) ).run;
				if ( mounted.current ) {
					show( current );
					current = await drive( current );
				}
			} catch ( startError ) {
				if ( mounted.current ) {
					fail( 'start', startError );
					// The server names the import that is in the way.
					if ( startError?.data?.run ) {
						current = startError.data.run;
						show( current );
					}
				}
			}

			end( current );
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- begin and end only read refs.
		[ drive, show ]
	);

	const resume = useCallback(
		async () => {
			const first = latest.current;
			if ( ! first || ! begin() ) {
				return;
			}

			end( await drive( first ) );
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- begin and end only read refs.
		[ drive ]
	);

	/**
	 * Read the run back from the server without contacting Mollie.
	 */
	const refresh = useCallback( async () => {
		if ( busy.current ) {
			return;
		}

		const asked = generation.current;
		const known = latest.current;

		try {
			const answer = known
				? await fetchImport( known.id )
				: await fetchOpenImport();

			// A run was started or continued while this was on its way.
			if (
				mounted.current &&
				! busy.current &&
				asked === generation.current
			) {
				setError( null );
				show( answer.run );
			}
		} catch ( readError ) {
			if (
				mounted.current &&
				! busy.current &&
				asked === generation.current
			) {
				fail( 'refresh', readError );
			}
		}
	}, [ show ] );

	/**
	 * Take over a run another request reported, for example the one that was
	 * open when the page loaded.
	 *
	 * @param {Object|null} found Run from the server.
	 */
	const adopt = useCallback(
		( found ) => {
			const known = latest.current;

			// Never trade the run on screen for an older one.
			if ( busy.current || ( known && found && found.id < known.id ) ) {
				return;
			}
			show( found );
		},
		[ show ]
	);

	return { run, working, error, start, resume, refresh, adopt };
}
