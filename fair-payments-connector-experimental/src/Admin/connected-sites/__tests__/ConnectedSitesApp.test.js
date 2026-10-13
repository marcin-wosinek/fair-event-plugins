/**
 * @jest-environment jsdom
 *
 * Component tests for the Connected Site Budget association (#1612) and
 * connection-test feedback (#1799).
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
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

const SITES_PATH = '/fair-payments-connector/v1/admin/connected-sites';

// `listSites` and `testSite` are called per request, so a test can change
// what the next refresh or the next connection test returns.
function mockConnectionTest( { listSites, testSite } ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( [ budgetA ] );
		}
		if ( path === SITES_PATH ) {
			return listSites();
		}
		if ( method === 'POST' && path.endsWith( '/test' ) ) {
			return testSite( path );
		}
		return Promise.resolve( {} );
	} );
}

// A Notice's text is mirrored into the a11y-speak live region, so feedback
// is always looked up inside the rendered notice itself.
const notices = () =>
	Array.from( document.querySelectorAll( '.components-notice' ) );
const noticeTexts = () =>
	notices().map(
		( notice ) =>
			notice.querySelector( '.components-notice__content' ).textContent
	);

// Clicking inside an async act() lets the request chain that follows the
// click settle before the test goes on to its assertions.
async function clickTest( label ) {
	const cell = await screen.findByText( label );
	const button = within( cell.closest( 'tr' ) ).getByRole( 'button', {
		name: 'Test',
	} );
	await waitFor( () => expect( button ).toBeEnabled() );
	await act( async () => {
		fireEvent.click( button );
	} );
}

async function renderAndTest( label = siteWithBudget.label ) {
	render( <ConnectedSitesApp /> );
	await clickTest( label );
}

describe( 'ConnectedSitesApp — connection test feedback (#1799)', () => {
	it( 'keeps the failure, naming the site, after a delayed refresh updates the status', async () => {
		let resolveRefresh;
		let listCalls = 0;
		mockConnectionTest( {
			listSites: () => {
				listCalls++;
				if ( listCalls === 1 ) {
					return Promise.resolve( [ siteWithBudget ] );
				}
				return new Promise( ( resolve ) => {
					resolveRefresh = resolve;
				} );
			},
			testSite: () =>
				Promise.reject( {
					code: 'rest_connected_site_test_failed',
					message: 'The remote site returned an unexpected response.',
					data: { status: 400 },
				} ),
		} );

		await renderAndTest();

		const expected =
			'Connection test failed for acroyoga-club.es: The remote site returned an unexpected response.';
		await waitFor( () => expect( noticeTexts() ).toEqual( [ expected ] ) );
		await waitFor( () => expect( resolveRefresh ).toBeDefined() );

		await act( async () => {
			resolveRefresh( [ { ...siteWithBudget, status: 'error' } ] );
		} );

		expect( await screen.findByText( 'Error' ) ).toBeInTheDocument();
		expect( noticeTexts() ).toEqual( [ expected ] );
		expect( notices()[ 0 ] ).toHaveClass( 'is-error' );
		expect( screen.getByRole( 'button', { name: 'Test' } ) ).toBeEnabled();
	} );

	it.each( [
		[ 'no message', {} ],
		[ 'a blank message', { message: '   ' } ],
		[ 'a non-string message', { message: { detail: 'boom' } } ],
		[ 'a non-object rejection', undefined ],
	] )(
		'falls back to a generic reason for %s',
		async ( _name, rejection ) => {
			mockConnectionTest( {
				listSites: () => Promise.resolve( [ siteWithBudget ] ),
				testSite: () => Promise.reject( rejection ),
			} );

			await renderAndTest();

			await waitFor( () =>
				expect( noticeTexts() ).toEqual( [
					'Connection test failed for acroyoga-club.es: Connection test failed.',
				] )
			);
		}
	);

	it( 'uses a nested data.message when the top-level message is unusable', async () => {
		mockConnectionTest( {
			listSites: () => Promise.resolve( [ siteWithBudget ] ),
			testSite: () =>
				Promise.reject( {
					message: '',
					data: { message: 'Could not reach the remote site.' },
				} ),
		} );

		await renderAndTest();

		await waitFor( () =>
			expect( noticeTexts() ).toEqual( [
				'Connection test failed for acroyoga-club.es: Could not reach the remote site.',
			] )
		);
	} );

	it( 'renders the diagnostic as text, not markup', async () => {
		mockConnectionTest( {
			listSites: () => Promise.resolve( [ siteWithBudget ] ),
			testSite: () =>
				Promise.reject( { message: '<img src=x onerror=alert(1)>' } ),
		} );

		await renderAndTest();

		await waitFor( () =>
			expect( noticeTexts() ).toEqual( [
				'Connection test failed for acroyoga-club.es: <img src=x onerror=alert(1)>',
			] )
		);
		expect( notices()[ 0 ].querySelector( 'img' ) ).toBeNull();
	} );

	it( 'can be dismissed', async () => {
		mockConnectionTest( {
			listSites: () => Promise.resolve( [ siteWithBudget ] ),
			testSite: () => Promise.reject( { message: 'Nope.' } ),
		} );

		await renderAndTest();
		await waitFor( () => expect( notices() ).toHaveLength( 1 ) );
		await screen.findByRole( 'button', { name: 'Test' } );

		fireEvent.click(
			within( notices()[ 0 ] ).getByRole( 'button', { name: 'Close' } )
		);

		expect( notices() ).toHaveLength( 0 );
	} );

	it( 'clears stale feedback when another test starts', async () => {
		let resolveSecondTest;
		mockConnectionTest( {
			listSites: () =>
				Promise.resolve( [ siteWithBudget, siteWithoutBudget ] ),
			testSite: ( path ) =>
				path.includes( `/${ siteWithBudget.id }/` )
					? Promise.reject( { message: 'Nope.' } )
					: new Promise( ( resolve ) => {
							resolveSecondTest = resolve;
					  } ),
		} );

		await renderAndTest();
		await waitFor( () => expect( notices() ).toHaveLength( 1 ) );

		await clickTest( siteWithoutBudget.label );

		await waitFor( () => expect( notices() ).toHaveLength( 0 ) );

		await act( async () => {
			resolveSecondTest( { ok: true, scopes: [] } );
		} );

		await waitFor( () =>
			expect( noticeTexts() ).toEqual( [
				'Connection succeeded. Granted scopes: no scopes',
			] )
		);
	} );

	it( 'shows the granted scopes after a successful test', async () => {
		mockConnectionTest( {
			listSites: () => Promise.resolve( [ siteWithBudget ] ),
			testSite: () =>
				Promise.resolve( {
					ok: true,
					scopes: [ 'transactions:read', 'events:read' ],
				} ),
		} );

		await renderAndTest();

		await waitFor( () =>
			expect( noticeTexts() ).toEqual( [
				'Connection succeeded. Granted scopes: transactions:read, events:read',
			] )
		);
		expect( notices()[ 0 ] ).toHaveClass( 'is-success' );
	} );

	it( 'keeps the test failure next to a separate error when the refresh fails', async () => {
		let listCalls = 0;
		mockConnectionTest( {
			listSites: () => {
				listCalls++;
				return listCalls === 1
					? Promise.resolve( [ siteWithBudget ] )
					: Promise.reject( { message: 'Could not load sites.' } );
			},
			testSite: () =>
				Promise.reject( {
					message: 'The remote site rejected the token.',
				} ),
		} );

		await renderAndTest();

		await waitFor( () =>
			expect( noticeTexts() ).toEqual( [
				'Could not load sites.',
				'Connection test failed for acroyoga-club.es: The remote site rejected the token.',
			] )
		);
	} );
} );
