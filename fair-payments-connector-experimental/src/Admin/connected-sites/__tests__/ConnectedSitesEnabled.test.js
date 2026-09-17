/**
 * @jest-environment jsdom
 *
 * Component tests for Connected Site availability (#1619).
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectedSitesApp from '../ConnectedSitesApp.js';

jest.mock( '@wordpress/api-fetch' );

const enabledSite = {
	id: 1,
	label: 'acroyoga-club.es',
	base_url: 'https://acroyoga-club.es',
	budget_id: null,
	scopes: [],
	status: 'connected',
	enabled: true,
	last_sync_at: null,
};

const disabledSite = {
	id: 2,
	label: 'paused-site.example',
	base_url: 'https://paused-site.example',
	budget_id: null,
	scopes: [],
	status: 'unverified',
	enabled: false,
	last_sync_at: null,
};

function mockApiFetchByPath( { sites = [] } = {} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( [] );
		}
		if ( path === '/fair-payments-connector/v1/admin/connected-sites' ) {
			return Promise.resolve( sites );
		}
		if (
			method === 'PUT' &&
			/\/admin\/connected-sites\/\d+$/.test( path )
		) {
			const id = Number( path.split( '/' ).pop() );
			const site = sites.find( ( s ) => s.id === id );
			return Promise.resolve( { ...site, ...data } );
		}
		return Promise.resolve( {} );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ConnectedSitesApp — availability (#1619)', () => {
	it( 'shows Enabled/Disabled for each site', async () => {
		mockApiFetchByPath( { sites: [ enabledSite, disabledSite ] } );
		render( <ConnectedSitesApp /> );

		const enabledRow = (
			await screen.findByText( enabledSite.label )
		).closest( 'tr' );
		const disabledRow = screen
			.getByText( disabledSite.label )
			.closest( 'tr' );

		expect(
			within( enabledRow ).getByText( 'Enabled' )
		).toBeInTheDocument();
		expect(
			within( disabledRow ).getByText( 'Disabled' )
		).toBeInTheDocument();
	} );

	it( 'disables an enabled site via the row action', async () => {
		mockApiFetchByPath( { sites: [ enabledSite ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect( screen.getByText( 'acroyoga-club.es' ) ).toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Disable' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/admin/connected-sites/1',
					method: 'PUT',
					data: { enabled: false },
				} )
			)
		);
	} );

	it( 'enables a disabled site via the row action', async () => {
		mockApiFetchByPath( { sites: [ disabledSite ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect(
				screen.getByText( 'paused-site.example' )
			).toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Enable' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/admin/connected-sites/2',
					method: 'PUT',
					data: { enabled: true },
				} )
			)
		);
	} );
} );
