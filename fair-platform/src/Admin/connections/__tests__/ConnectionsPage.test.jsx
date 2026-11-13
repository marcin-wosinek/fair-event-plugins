/**
 * Ordinary connection logs (#2231): endpoints, wording, statuses, statistics
 * and Mollie columns.
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectionsPage from '../ConnectionsPage.js';

jest.mock( '@wordpress/api-fetch' );

const ROWS = [
	{
		id: 11,
		site_name: 'Ordinary site',
		status: 'disconnected',
		mollie_organization_id: 'org_123',
		mollie_profile_id: 'pfl_456',
		profile_created: 1,
	},
	{ id: 12, site_name: 'Bare site', status: 'connected' },
];

beforeEach( () => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-platform/v1/connections/stats' ) {
			return Promise.resolve( {
				total_connections: 5,
				successful: 3,
				failed: 1,
				unique_sites: 4,
			} );
		}
		if ( path.startsWith( '/fair-platform/v1/connections/cleanup' ) ) {
			return Promise.resolve( { message: 'Deleted 2.' } );
		}
		return Promise.resolve( { items: ROWS, total_pages: 1 } );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

test( 'renders the ordinary wording, statistics, statuses and Mollie columns', async () => {
	render( <ConnectionsPage /> );

	expect( await screen.findByText( 'Ordinary site' ) ).toBeInTheDocument();
	expect(
		screen.getByRole( 'heading', { name: 'Connection Logs' } )
	).toBeInTheDocument();
	expect(
		screen.getByText( 'Monitor OAuth connections from WordPress sites.' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'heading', { name: 'Connection History' } )
	).toBeInTheDocument();
	expect(
		screen.getByText( 'Unique Sites' ).previousSibling
	).toHaveTextContent( '4' );
	expect(
		within( screen.getByRole( 'table' ) )
			.getAllByRole( 'columnheader' )
			.map( ( th ) => th.textContent )
	).toEqual( [
		'ID',
		'Site',
		'Status',
		'Organization',
		'Profile',
		'Connected At',
		'Last Refresh',
	] );

	const [ , first, second ] = screen.getAllByRole( 'row' );
	expect( first ).toHaveTextContent( 'Disconnected' );
	expect( first ).toHaveTextContent( '✓ Profile created' );
	expect( first ).toHaveTextContent( 'org_123' );
	expect( first ).toHaveTextContent( 'pfl_456' );
	expect( second ).not.toHaveTextContent( 'Profile created' );
	expect(
		within( second )
			.getAllByRole( 'cell' )
			.map( ( cell ) => cell.textContent )
	).toEqual( [ '12', 'Bare site', 'Connected', '-', '-', '-', '-' ] );

	expect(
		within( screen.getByLabelText( 'Status Filter' ) )
			.getAllByRole( 'option' )
			.map( ( option ) => option.value )
	).toEqual( [ '', 'connected', 'failed', 'disconnected' ] );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-platform/v1/connections?page=1&per_page=50&orderby=connected_at&order=DESC',
	} );
} );

test( 'uses the ordinary list fallback and empty message', async () => {
	apiFetch.mockImplementation( ( { path } ) =>
		path.endsWith( '/stats' ) ? Promise.resolve( {} ) : Promise.reject( {} )
	);
	render( <ConnectionsPage /> );

	expect(
		await screen.findByText( 'Failed to load connections', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	expect( screen.getByText( 'No connections found.' ) ).toBeInTheDocument();
} );

test( 'cleans up ordinary logs through its own endpoint', async () => {
	render( <ConnectionsPage /> );
	await screen.findByText( 'Ordinary site' );

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Cleanup Old Logs' } )
	);
	const dialog = screen.getByRole( 'dialog', {
		name: 'Delete old connection logs',
	} );
	expect( dialog ).toHaveTextContent(
		'This deletes every connection log entry older than 90 days.'
	);
	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete old logs' } )
		);
	} );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-platform/v1/connections/cleanup?days=90',
		method: 'DELETE',
	} );
	expect(
		screen.getByText( 'Deleted 2.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
} );
