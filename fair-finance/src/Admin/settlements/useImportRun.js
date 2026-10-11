/**
 * WordPress dependencies
 */
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { startImport, stepImport } from './settlements-api.js';

/**
 * Drive a Mollie import from the browser, one request at a time.
 *
 * The server holds the cursor; this only keeps asking for the next step
 * while the run is running, and stops when the run stops or the page goes
 * away. `run` and `working` are the single source of truth for every
 * control that depends on the import.
 *
 * @param {Object}   options
 * @param {Function} options.onFinished Called with the run once it stops.
 * @return {Object} `{ run, working, error, start, resume, adopt }`.
 */
export default function useImportRun( { onFinished } ) {
	const [ run, setRun ] = useState( null );
	const [ working, setWorking ] = useState( false );
	const [ error, setError ] = useState( null );
	const mounted = useRef( true );
	const finished = useRef( onFinished );

	finished.current = onFinished;

	useEffect( () => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [] );

	const drive = useCallback( async ( first ) => {
		let current = first;
		setWorking( true );
		setError( null );

		try {
			// A stopped run is resumed by its first step.
			do {
				current = ( await stepImport( current.id ) ).run;
				if ( ! mounted.current ) {
					return;
				}
				setRun( current );
			} while ( current.status === 'running' );
		} catch ( stepError ) {
			if ( mounted.current ) {
				setError(
					stepError?.message ||
						__(
							'The import could not continue. Reload the page to see where it stopped.',
							'fair-finance'
						)
				);
			}
		}

		if ( mounted.current ) {
			setWorking( false );
			finished.current?.( current );
		}
	}, [] );

	const start = useCallback(
		async ( kind, settlementId = 0 ) => {
			setWorking( true );
			setError( null );
			try {
				const started = await startImport( kind, settlementId );
				if ( ! mounted.current ) {
					return;
				}
				setRun( started.run );
				await drive( started.run );
			} catch ( startError ) {
				if ( mounted.current ) {
					setWorking( false );
					setError(
						startError?.message ||
							__(
								'The import could not be started.',
								'fair-finance'
							)
					);
				}
			}
		},
		[ drive ]
	);

	const resume = useCallback( () => {
		if ( run ) {
			drive( run );
		}
	}, [ drive, run ] );

	return { run, working, error, start, resume, adopt: setRun };
}
