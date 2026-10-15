/**
 * Component test for the focused single-entry view of the entries screen
 * (#1291). The transactions list links to `?page=fair-finance-entries&entry_id=N`;
 * the screen must narrow every request to that entry from the first load,
 * say it is narrowed, and clear back to the full list.
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EntriesApp from '../EntriesApp.js';
import { downloadCsv } from '../exportEntriesCsv.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../exportEntriesCsv.js', () => ( {
	...jest.requireActual( '../exportEntriesCsv.js' ),
	downloadCsv: jest.fn(),
} ) );

const BASE_PATH = '/wp-admin/admin.php?page=fair-finance-entries';

const makeEntry = ( overrides = {} ) => ( {
	id: 7,
	entry_date: '2026-09-01',
	entry_type: 'cost',
	amount: 40,
	description: 'Venue deposit',
	budget_id: null,
	event_url: null,
	parent_entry_id: null,
	transaction_ids: [],
	imported_at: null,
	...overrides,
} );

const FULL_LIST_ENTRY = makeEntry( { id: 99, description: 'Unrelated entry' } );

/**
 * Route apiFetch by path. `entries` answers list requests that carry
 * `entry_id`; every other list request gets the full list.
 *
 * @param {Object} options
 * @param {Array}  options.entries Entries for focused list requests.
 * @param {Object} options.totals  Totals for focused totals requests.
 */
const mockApi = ( {
	entries = [ makeEntry() ],
	totals = { total_cost: 40, total_income: 0, balance: -40 },
} = {} ) => {
	apiFetch.mockImplementation( ( { path } ) => {
		const [ route, query = '' ] = path.split( '?' );
		const focused = new URLSearchParams( query ).has( 'entry_id' );

		if ( route === '/fair-finance/v1/financial-entries' ) {
			const list = focused ? entries : [ FULL_LIST_ENTRY ];
			return Promise.resolve( {
				entries: list,
				total: list.length,
				pages: list.length ? 1 : 0,
			} );
		}
		if ( route === '/fair-finance/v1/financial-entries/totals' ) {
			return Promise.resolve(
				focused
					? totals
					: { total_cost: 1000, total_income: 0, balance: -1000 }
			);
		}
		if ( route === '/fair-finance/v1/financial-entries/totals-by-tag' ) {
			return Promise.resolve( {} );
		}
		return Promise.resolve( [] );
	} );
};

const requestsTo = ( route ) =>
	apiFetch.mock.calls
		.map( ( [ { path } ] ) => path )
		.filter( ( path ) => path.split( '?' )[ 0 ] === route )
		.map( ( path ) => new URLSearchParams( path.split( '?' )[ 1 ] || '' ) );

const listRequests = () => requestsTo( '/fair-finance/v1/financial-entries' );
const totalsRequests = () =>
	requestsTo( '/fair-finance/v1/financial-entries/totals' );

const openAt = ( search ) => {
	window.history.replaceState( null, '', `${ BASE_PATH }${ search }` );
};

// Notices are also announced in an a11y live region; match the visible one.
const IN_NOTICE = { selector: '.components-notice__content' };

afterEach( () => {
	jest.clearAllMocks();
	openAt( '' );
} );

describe( 'EntriesApp — focused entry view (#1291)', () => {
	it( 'narrows the first list and totals requests to the entry and says so', async () => {
		openAt( '&entry_id=7&budget_id=3' );
		mockApi();

		render( <EntriesApp /> );

		expect(
			await screen.findByText( 'Showing entry #7', IN_NOTICE )
		).toBeInTheDocument();
		expect( await screen.findByText( 'Venue deposit' ) ).toBeVisible();

		// Every list/totals request is focused; focus beats the budget filter.
		expect( listRequests().length ).toBeGreaterThan( 0 );
		for ( const params of [ ...listRequests(), ...totalsRequests() ] ) {
			expect( params.get( 'entry_id' ) ).toBe( '7' );
			expect( params.has( 'budget_id' ) ).toBe( false );
		}
		expect(
			requestsTo( '/fair-finance/v1/financial-entries/totals-by-tag' )
		).toHaveLength( 0 );

		// Ordinary filters are hidden while focused.
		expect(
			screen.queryByLabelText( 'From Date' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Unrelated entry' )
		).not.toBeInTheDocument();
	} );

	it( 'shows the totals the server returns for the focused entry', async () => {
		openAt( '&entry_id=7' );
		mockApi( {
			totals: { total_cost: 40, total_income: 0, balance: -40 },
		} );

		render( <EntriesApp /> );

		expect( await screen.findByText( '-€40.00' ) ).toBeInTheDocument();
		expect( screen.queryByText( '€1,000.00' ) ).not.toBeInTheDocument();
	} );

	it( 'renders a focused split child as its own row, without siblings', async () => {
		openAt( '&entry_id=8' );
		const parent = makeEntry( {
			id: 5,
			amount: 100,
			description: 'Split parent',
			children: [
				makeEntry( {
					id: 8,
					parent_entry_id: 5,
					description: 'Child A',
				} ),
				makeEntry( {
					id: 9,
					parent_entry_id: 5,
					description: 'Child B',
				} ),
			],
		} );
		mockApi( {
			entries: [
				makeEntry( {
					id: 8,
					parent_entry_id: 5,
					description: 'Child A',
					parent,
				} ),
			],
		} );

		render( <EntriesApp /> );

		expect( await screen.findByText( 'Child A' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Edit Split' } )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Child B' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Split parent' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a focused split parent with its nested children', async () => {
		openAt( '&entry_id=5' );
		mockApi( {
			entries: [
				makeEntry( {
					id: 5,
					amount: 100,
					description: 'Split parent',
					children: [
						makeEntry( {
							id: 8,
							amount: 60,
							parent_entry_id: 5,
							description: 'Child A',
						} ),
						makeEntry( {
							id: 9,
							amount: 40,
							parent_entry_id: 5,
							description: 'Child B',
						} ),
					],
				} ),
			],
			totals: { total_cost: 100, total_income: 0, balance: -100 },
		} );

		render( <EntriesApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: /Split ▸/ } )
		);
		expect( screen.getByText( 'Child A' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Child B' ) ).toBeInTheDocument();
		expect( screen.getByText( '-€100.00' ) ).toBeInTheDocument();
	} );

	it( 'exports only the focused entry', async () => {
		openAt( '&entry_id=7' );
		mockApi();

		render( <EntriesApp /> );
		await screen.findByText( 'Venue deposit' );
		apiFetch.mockClear();

		fireEvent.click( screen.getByRole( 'button', { name: 'Export CSV' } ) );

		await waitFor( () => expect( downloadCsv ).toHaveBeenCalled() );
		expect( listRequests() ).toHaveLength( 1 );
		expect( listRequests()[ 0 ].get( 'entry_id' ) ).toBe( '7' );
		const [ csv, filename ] = downloadCsv.mock.calls[ 0 ];
		expect( filename ).toBe( 'fair-finance-entries-entry-7.csv' );
		expect( csv ).toContain( 'Venue deposit' );
		expect( csv ).not.toContain( 'Unrelated entry' );
	} );

	it( 'clears back to the full list, removing the focus from the URL', async () => {
		openAt( '&entry_id=7' );
		mockApi();

		render( <EntriesApp /> );
		await screen.findByText( 'Venue deposit' );
		apiFetch.mockClear();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Show all entries' } )
		);

		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();
		expect(
			screen.queryByText( 'Showing entry #7', IN_NOTICE )
		).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'From Date' ) ).toBeInTheDocument();
		expect( window.location.search ).toBe( '?page=fair-finance-entries' );

		for ( const params of [ ...listRequests(), ...totalsRequests() ] ) {
			expect( params.has( 'entry_id' ) ).toBe( false );
		}
		expect( listRequests().at( -1 ).get( 'page' ) ).toBe( '1' );
		expect(
			requestsTo( '/fair-finance/v1/financial-entries/totals-by-tag' )
		).toHaveLength( 1 );
	} );

	it( 'ignores a focused response that arrives after focus was cleared', async () => {
		openAt( '&entry_id=7' );
		let resolveFocused;
		apiFetch.mockImplementation( ( { path } ) => {
			const [ route, query = '' ] = path.split( '?' );
			const focused = new URLSearchParams( query ).has( 'entry_id' );
			if ( route === '/fair-finance/v1/financial-entries' ) {
				if ( focused ) {
					return new Promise( ( resolve ) => {
						resolveFocused = resolve;
					} );
				}
				return Promise.resolve( {
					entries: [ FULL_LIST_ENTRY ],
					total: 1,
					pages: 1,
				} );
			}
			if (
				route === '/fair-finance/v1/financial-entries/totals-by-tag'
			) {
				return Promise.resolve( {} );
			}
			if ( route === '/fair-finance/v1/financial-entries/totals' ) {
				return Promise.resolve( {
					total_cost: 0,
					total_income: 0,
					balance: 0,
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <EntriesApp /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Show all entries' } )
		);
		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();

		await act( async () => {
			resolveFocused( {
				entries: [ makeEntry() ],
				total: 1,
				pages: 1,
			} );
		} );

		expect( screen.getByText( 'Unrelated entry' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Venue deposit' ) ).not.toBeInTheDocument();
	} );

	it( 'explains a missing entry and offers the full list', async () => {
		openAt( '&entry_id=404' );
		mockApi( { entries: [] } );

		render( <EntriesApp /> );

		expect(
			await screen.findByText(
				'Entry #404 was not found. It may have been deleted.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Show all entries' } )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Unrelated entry' )
		).not.toBeInTheDocument();
	} );

	it.each( [ 'abc', '0', '-3', '1.5' ] )(
		'rejects the invalid entry id "%s" without loading the full list',
		async ( raw ) => {
			openAt( `&entry_id=${ encodeURIComponent( raw ) }` );
			mockApi();

			render( <EntriesApp /> );

			expect(
				await screen.findByText(
					'This entry link is not valid.',
					IN_NOTICE
				)
			).toBeInTheDocument();
			expect( listRequests() ).toHaveLength( 0 );
			expect( totalsRequests() ).toHaveLength( 0 );
			expect(
				screen.queryByText( 'Unrelated entry' )
			).not.toBeInTheDocument();

			fireEvent.click(
				screen.getByRole( 'button', { name: 'Show all entries' } )
			);
			expect(
				await screen.findByText( 'Unrelated entry' )
			).toBeVisible();
		}
	);

	it( 'loads the full list with no focus parameter', async () => {
		mockApi();

		render( <EntriesApp /> );

		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();
		expect(
			screen.queryByText( /Showing entry/, IN_NOTICE )
		).not.toBeInTheDocument();
		for ( const params of listRequests() ) {
			expect( params.has( 'entry_id' ) ).toBe( false );
		}
	} );
} );
