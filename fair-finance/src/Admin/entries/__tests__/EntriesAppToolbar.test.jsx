/**
 * Toolbar, applied filters, result count and pagination on the entries
 * screen (#2210).
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EntriesApp from '../EntriesApp.js';

jest.mock( '@wordpress/api-fetch' );

const LIST = '/fair-finance/v1/financial-entries';

const entry = ( id ) => ( {
	id,
	entry_date: '2026-09-01',
	entry_type: 'cost',
	amount: 10,
	description: `Entry ${ id }`,
	budget_id: null,
	event_url: null,
	parent_entry_id: null,
	transaction_ids: [],
	imported_at: null,
} );

const listRequests = () =>
	apiFetch.mock.calls
		.map( ( [ { path } ] ) => path )
		.filter( ( path ) => path.split( '?' )[ 0 ] === LIST )
		.map( ( path ) => new URLSearchParams( path.split( '?' )[ 1 ] ) );

beforeEach( () => {
	window.history.replaceState( {}, '', '/wp-admin/admin.php?page=x' );
	apiFetch.mockImplementation( ( { path } ) => {
		const [ route, query = '' ] = path.split( '?' );
		if ( route === LIST ) {
			const page = Number( new URLSearchParams( query ).get( 'page' ) );
			return Promise.resolve( {
				entries: [ entry( page * 100 + 1 ), entry( page * 100 + 2 ) ],
				total: 120,
				pages: 3,
			} );
		}
		if ( route === `${ LIST }/totals` ) {
			return Promise.resolve( {
				total_cost: 0,
				total_income: 0,
				balance: 0,
			} );
		}
		if ( route === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( [ { id: 2, name: 'Festival' } ] );
		}
		if ( route === '/fair-finance/v1/financial-entries/tags' ) {
			return Promise.resolve( [ 'Catering' ] );
		}
		if ( route.endsWith( '/unbudgeted-count' ) ) {
			return Promise.resolve( { count: 0 } );
		}
		return Promise.resolve( [] );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

it( 'puts the existing actions beside the title', async () => {
	render( <EntriesApp /> );
	await screen.findByText( 'Entry 101' );

	const header = screen
		.getByRole( 'heading', { name: 'Financial Entries' } )
		.closest( '.fair-admin-list-header' );
	[ 'Add Entry', 'Transfer', 'Import', 'Export CSV' ].forEach( ( name ) =>
		expect(
			within( header ).getByRole( 'button', { name } )
		).toBeInTheDocument()
	);
} );

it( 'counts server entries, and pages below the table keep focus', async () => {
	render( <EntriesApp /> );
	await screen.findByText( 'Entry 101' );

	expect( screen.getByText( '1–50 of 120 entries' ) ).toHaveAttribute(
		'role',
		'status'
	);
	const pages = screen.getByRole( 'navigation', { name: 'Entry pages' } );
	expect( within( pages ).getByText( 'Page 1 of 3' ) ).toBeInTheDocument();

	const next = within( pages ).getByRole( 'button', { name: 'Next page' } );
	next.focus();
	await act( async () => fireEvent.click( next ) );
	await screen.findByText( 'Entry 201' );
	await act( async () => fireEvent.click( next ) );
	await screen.findByText( 'Entry 301' );

	expect( screen.getByText( '101–120 of 120 entries' ) ).toBeInTheDocument();
	expect( next ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( next ).toHaveFocus();
	expect( listRequests().at( -1 ).get( 'page' ) ).toBe( '3' );
} );

it( 'keeps less-used filters under More filters and summarizes them', async () => {
	render( <EntriesApp /> );
	await screen.findByText( 'Entry 101' );

	// Frequent filters are visible.
	expect(
		screen.getByRole( 'combobox', { name: 'Budget' } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'combobox', { name: 'Type' } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'combobox', { name: 'Matching' } )
	).toBeInTheDocument();
	expect(
		screen.queryByRole( 'combobox', { name: 'Tag' } )
	).not.toBeInTheDocument();

	const toggle = screen.getByRole( 'button', { name: 'More filters' } );
	expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
	fireEvent.click( toggle );
	expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );

	await act( async () => {
		fireEvent.change( screen.getByRole( 'combobox', { name: 'Tag' } ), {
			target: { value: 'Catering' },
		} );
		fireEvent.change( screen.getByLabelText( 'From Date' ), {
			target: { value: '2026-01-01' },
		} );
	} );
	toggle.focus();
	fireEvent.click( toggle );

	// Collapsed, the active filters are still named.
	expect(
		screen.getByRole( 'button', { name: 'More filters (2 active)' } )
	).toHaveFocus();
	expect( screen.getByText( 'Tag: Catering' ) ).toBeInTheDocument();
	expect( screen.getByText( 'From 2026-01-01' ) ).toBeInTheDocument();
	await waitFor( () =>
		expect( listRequests().at( -1 ).get( 'tag' ) ).toBe( 'Catering' )
	);
	expect( listRequests().at( -1 ).get( 'page' ) ).toBe( '1' );

	await act( async () =>
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Clear filters' } )
		)
	);
	expect( screen.queryByText( 'Tag: Catering' ) ).not.toBeInTheDocument();
	// The Clear filters button is gone; focus stays in the toolbar.
	expect(
		screen.getByRole( 'button', { name: 'More filters' } )
	).toHaveFocus();
} );

it( 'names a budget deep link in the applied filters', async () => {
	window.history.replaceState(
		{},
		'',
		'/wp-admin/admin.php?page=x&budget_id=2'
	);
	render( <EntriesApp /> );
	await screen.findByText( 'Entry 101' );

	expect( await screen.findByText( 'Budget: Festival' ) ).toBeInTheDocument();
	expect( listRequests().at( -1 ).get( 'budget_id' ) ).toBe( '2' );
} );
