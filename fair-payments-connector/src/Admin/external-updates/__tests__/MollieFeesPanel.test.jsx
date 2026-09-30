/**
 * Loading missing Mollie fees from External Updates (#1695): a server-owned
 * run, batches of ten carrying its ID, visible progress, and the server's
 * outcome as feedback.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MollieFeesPanel from '../components/MollieFeesPanel.js';

jest.mock( '@wordpress/api-fetch' );

const RUNS = '/fair-payments-connector/v1/external-updates/runs';
const BATCH = '/fair-payments-connector/v1/transactions/sync-mollie-batch';

// The accessibility live region echoes notice text alongside the visible
// Notice, so scope matches to the rendered notice itself.
const noticeText = ( text ) =>
	screen.queryByText(
		( content, element ) =>
			content === text &&
			element?.className === 'components-notice__content'
	);

const renderPanel = ( props = {} ) => {
	const onBegin = jest.fn( () => true );
	const onEnd = jest.fn();
	const utils = render(
		<MollieFeesPanel
			activeAction={ null }
			onBegin={ onBegin }
			onEnd={ onEnd }
			{ ...props }
		/>
	);
	return { ...utils, onBegin, onEnd };
};

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'syncs in batches of ten with the run ID, keeps going past a failed batch, and reports the server outcome', async () => {
	const ids = Array.from( { length: 25 }, ( _, i ) => i + 1 );
	const batches = [];
	const deferred = [];

	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === RUNS ) {
			return Promise.resolve( {
				run: { id: 7, status: 'running' },
				ids,
			} );
		}
		if ( options.path === BATCH ) {
			batches.push( options.data );
			return new Promise( ( resolve, reject ) =>
				deferred.push( { resolve, reject } )
			);
		}
		if ( options.path === `${ RUNS }/7/finish` ) {
			return Promise.resolve( {
				run: {
					id: 7,
					status: 'partial',
					counts: { created: 0, updated: 13, skipped: 0, failed: 12 },
					error_message: 'Some requests did not complete.',
				},
			} );
		}
		return Promise.reject( new Error( `unexpected ${ options.path }` ) );
	} );

	const { onBegin, onEnd } = renderPanel();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
	);

	expect( onBegin ).toHaveBeenCalledWith( 'load_missing_mollie_fees' );
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: RUNS,
			method: 'POST',
			data: { action: 'load_missing_mollie_fees', source_id: 'live' },
		} )
	);

	await waitFor( () => expect( deferred ).toHaveLength( 1 ) );
	expect( batches[ 0 ] ).toEqual( {
		ids: ids.slice( 0, 10 ),
		run_id: 7,
	} );
	deferred[ 0 ].resolve( { processed: 10, updated: 9, failed: 1 } );
	await waitFor( () =>
		expect(
			noticeText(
				'Loading Mollie fees: 10 of 25 (updated: 9, failed: 1)'
			)
		).toBeInTheDocument()
	);

	await waitFor( () => expect( deferred ).toHaveLength( 2 ) );
	deferred[ 1 ].reject( new Error( 'network error' ) );
	await waitFor( () =>
		expect(
			noticeText(
				'Loading Mollie fees: 20 of 25 (updated: 9, failed: 11)'
			)
		).toBeInTheDocument()
	);

	await waitFor( () => expect( deferred ).toHaveLength( 3 ) );
	expect( batches[ 2 ].ids ).toHaveLength( 5 );
	deferred[ 2 ].resolve( { processed: 5, updated: 4, failed: 1 } );

	await waitFor( () =>
		expect(
			noticeText(
				'Partly completed: 13 updated, 12 failed. Some requests did not complete.'
			)
		).toBeInTheDocument()
	);
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: `${ RUNS }/7/finish`,
			method: 'POST',
		} )
	);
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
} );

it( 'says so when no transaction is missing fee data', async () => {
	apiFetch.mockResolvedValueOnce( {
		run: { id: 8, status: 'succeeded', counts: {} },
		ids: [],
	} );

	renderPanel();
	fireEvent.change( screen.getByLabelText( 'Transactions' ), {
		target: { value: '' },
	} );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
	);

	await waitFor( () =>
		expect(
			noticeText( 'No paid transactions are missing Mollie fee data.' )
		).toBeInTheDocument()
	);
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			data: { action: 'load_missing_mollie_fees', source_id: 'all' },
		} )
	);
	expect( apiFetch ).toHaveBeenCalledTimes( 1 );
} );

it( 'shows the server refusal when another update is running', async () => {
	apiFetch.mockRejectedValueOnce( {
		code: 'external_update_in_progress',
		message:
			'Another external update is still running. Wait for it to finish, then try again.',
		data: { status: 409 },
	} );

	const { onEnd } = renderPanel();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
	);

	await waitFor( () =>
		expect(
			noticeText(
				'Another external update is still running. Wait for it to finish, then try again.'
			)
		).toBeInTheDocument()
	);
	expect( onEnd ).toHaveBeenCalled();
} );

it( 'cannot start while another action is running on the page', () => {
	renderPanel( { activeAction: 'import_mollie_payments' } );

	expect(
		screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
	).toBeDisabled();
} );
