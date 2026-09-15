/**
 * @jest-environment jsdom
 *
 * Component tests for the Connected Site Budget association (#1612).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectedSitesApp from '../ConnectedSitesApp.js';

jest.mock( '@wordpress/api-fetch' );

const budgetA = { id: 3, name: 'Acroyoga club' };

const siteWithBudget = {
	id: 1,
	label: 'acroyoga-club.es',
	base_url: 'https://acroyoga-club.es',
	budget_id: budgetA.id,
	scopes: [],
	status: 'connected',
	last_sync_at: null,
};

const siteWithDeletedBudget = {
	id: 2,
	label: 'other-site.example',
	base_url: 'https://other-site.example',
	budget_id: 99,
	scopes: [],
	status: 'unverified',
	last_sync_at: null,
};

const siteWithoutBudget = {
	id: 3,
	label: 'no-budget.example',
	base_url: 'https://no-budget.example',
	budget_id: null,
	scopes: [],
	status: 'unverified',
	last_sync_at: null,
};

function mockApiFetchByPath( { sites = [], budgets = [ budgetA ] } = {} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( budgets );
		}
		if ( path === '/fair-payments-connector/v1/admin/connected-sites' ) {
			if ( method === 'POST' ) {
				return Promise.resolve( {
					id: 4,
					label: data.label,
					base_url: data.base_url,
					budget_id: data.budget_id,
					scopes: [],
					status: 'unverified',
					last_sync_at: null,
				} );
			}
			return Promise.resolve( sites );
		}
		return Promise.resolve( {} );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ConnectedSitesApp — budget association (#1612)', () => {
	it( 'shows the linked budget name in the table', async () => {
		mockApiFetchByPath( { sites: [ siteWithBudget ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect( screen.getByText( 'Acroyoga club' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows "No budget" when the site has no association', async () => {
		mockApiFetchByPath( { sites: [ siteWithoutBudget ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect( screen.getByText( 'No budget' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows an unlinked fallback when the referenced budget no longer resolves', async () => {
		mockApiFetchByPath( { sites: [ siteWithDeletedBudget ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect( screen.getByText( 'Unlinked' ) ).toBeInTheDocument()
		);
	} );

	it( 'prefills the Budget selector when editing a site and submits the change', async () => {
		mockApiFetchByPath( { sites: [ siteWithBudget ] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect( screen.getByText( 'acroyoga-club.es' ) ).toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );

		const select = await screen.findByLabelText( 'Budget' );
		expect( select.value ).toBe( String( budgetA.id ) );

		fireEvent.change( select, { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/admin/connected-sites/1',
					method: 'PUT',
					data: expect.objectContaining( { budget_id: null } ),
				} )
			)
		);
	} );

	it( 'submits the chosen budget_id when adding a new site', async () => {
		mockApiFetchByPath( { sites: [] } );
		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect(
				screen.getByText(
					'No connected sites yet. Add one to pull data from another site.'
				)
			).toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Add Site' } ) );

		fireEvent.change( screen.getByLabelText( 'Label' ), {
			target: { value: 'new-site.example' },
		} );
		fireEvent.change( screen.getByLabelText( 'Base URL' ), {
			target: { value: 'https://new-site.example' },
		} );
		fireEvent.change( screen.getByLabelText( 'Token' ), {
			target: { value: 'sekrit-token' },
		} );
		fireEvent.change( screen.getByLabelText( 'Budget' ), {
			target: { value: String( budgetA.id ) },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add Site' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/admin/connected-sites',
					method: 'POST',
					data: expect.objectContaining( { budget_id: budgetA.id } ),
				} )
			)
		);
	} );

	it( 'keeps the site usable when the budgets endpoint is unavailable', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === '/fair-finance/v1/budgets' ) {
				return Promise.reject( new Error( 'Not found' ) );
			}
			if (
				path === '/fair-payments-connector/v1/admin/connected-sites'
			) {
				return Promise.resolve( [ siteWithoutBudget ] );
			}
			return Promise.resolve( {} );
		} );

		render( <ConnectedSitesApp /> );

		await waitFor( () =>
			expect(
				screen.getByText( 'no-budget.example' )
			).toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );

		expect(
			await screen.findByText(
				'Budgets are unavailable right now; the site can still be saved without one.'
			)
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Budget' ) ).not.toBeInTheDocument();
	} );
} );
