/**
 * External Updates operation log (#1695).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import OperationLog from '../components/OperationLog.js';

jest.mock( '@wordpress/api-fetch' );

const run = ( overrides ) => ( {
	id: 1,
	action: 'import_connected_site',
	action_label: 'Import transactions',
	source_type: 'connected_site',
	source_id: '3',
	source_label: 'shop.example',
	status: 'succeeded',
	user_id: 1,
	user_name: 'Admin',
	started_at: '2026-09-30 10:15:00',
	finished_at: '2026-09-30 10:15:04',
	counts: { created: 2, updated: 1, skipped: 0, failed: 0 },
	error_code: null,
	error_message: null,
	...overrides,
} );

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'shows each run with its time, source, action, initiator, outcome and counts', async () => {
	apiFetch.mockResolvedValueOnce( {
		items: [
			run( {
				id: 2,
				status: 'interrupted',
				source_label: 'Mollie (all modes)',
				action_label: 'Load missing fees',
				counts: { created: 0, updated: 4, skipped: 0, failed: 0 },
				error_message:
					'The run stopped before it finished, for example because a request timed out or the page was closed.',
			} ),
			run( {} ),
		],
		total: 2,
		pages: 1,
		page: 1,
	} );

	render( <OperationLog refreshKey={ 0 } /> );

	expect( await screen.findByText( 'shop.example' ) ).toBeInTheDocument();
	const rows = screen.getAllByRole( 'row' );
	// Header, then newest first as returned by the server.
	expect( rows[ 1 ] ).toHaveTextContent( 'Mollie (all modes)' );
	expect( rows[ 1 ] ).toHaveTextContent( 'Interrupted' );
	expect( rows[ 1 ] ).toHaveTextContent( '4 updated' );
	expect( rows[ 1 ] ).toHaveTextContent(
		'The run stopped before it finished'
	);
	expect( rows[ 2 ] ).toHaveTextContent( '2026-09-30 10:15:00' );
	expect( rows[ 2 ] ).toHaveTextContent( 'Import transactions' );
	expect( rows[ 2 ] ).toHaveTextContent( 'Admin' );
	expect( rows[ 2 ] ).toHaveTextContent( 'Succeeded' );
	expect( rows[ 2 ] ).toHaveTextContent( '2 new, 1 updated' );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-payments-connector/v1/external-updates/runs?page=1&per_page=20',
	} );
} );

it( 'pages through older runs and reloads when a run ends', async () => {
	apiFetch.mockResolvedValue( {
		items: [ run( {} ) ],
		total: 25,
		pages: 2,
		page: 1,
	} );

	const { rerender } = render( <OperationLog refreshKey={ 0 } /> );

	fireEvent.click( await screen.findByRole( 'button', { name: 'Older' } ) );
	await waitFor( () =>
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-payments-connector/v1/external-updates/runs?page=2&per_page=20',
		} )
	);

	rerender( <OperationLog refreshKey={ 1 } /> );
	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 3 ) );
} );

it( 'shows an empty state', async () => {
	apiFetch.mockResolvedValueOnce( {
		items: [],
		total: 0,
		pages: 0,
		page: 1,
	} );

	render( <OperationLog refreshKey={ 0 } /> );

	expect(
		await screen.findByText( 'No external updates have run yet.' )
	).toBeInTheDocument();
} );
