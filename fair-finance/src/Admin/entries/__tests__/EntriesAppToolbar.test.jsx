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

describe( 'No tag filter (#2385)', () => {
	const openMoreFilters = () =>
		fireEvent.click(
			screen.getByRole( 'button', { name: /^More filters/ } )
		);

	const tagOptionLabels = () =>
		within( screen.getByRole( 'combobox', { name: 'Tag' } ) )
			.getAllByRole( 'option' )
			.map( ( option ) => option.textContent );

	const chooseTag = ( value ) =>
		act( async () =>
			fireEvent.change( screen.getByRole( 'combobox', { name: 'Tag' } ), {
				target: { value },
			} )
		);

	it( 'offers No tag right after All Tags, before the named tags', async () => {
		render( <EntriesApp /> );
		await screen.findByText( 'Entry 101' );
		openMoreFilters();

		await waitFor( () =>
			expect( tagOptionLabels() ).toEqual( [
				'All Tags',
				'No tag',
				'Catering',
			] )
		);
	} );

	it( 'keeps the Tag filter when no named tags exist', async () => {
		const base = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( options ) =>
			options.path === '/fair-finance/v1/financial-entries/tags'
				? Promise.resolve( [] )
				: base( options )
		);
		render( <EntriesApp /> );
		await screen.findByText( 'Entry 101' );
		openMoreFilters();

		expect( tagOptionLabels() ).toEqual( [ 'All Tags', 'No tag' ] );
		await chooseTag( 'none' );
		await waitFor( () =>
			expect( listRequests().at( -1 ).get( 'tag' ) ).toBe( 'none' )
		);
	} );

	it( 'combines No tag with other filters, resets the page and clears to All Tags', async () => {
		render( <EntriesApp /> );
		await screen.findByText( 'Entry 101' );

		await act( async () =>
			fireEvent.change(
				screen.getByRole( 'combobox', { name: 'Budget' } ),
				{ target: { value: '2' } }
			)
		);
		const pages = screen.getByRole( 'navigation', {
			name: 'Entry pages',
		} );
		await act( async () =>
			fireEvent.click(
				within( pages ).getByRole( 'button', { name: 'Next page' } )
			)
		);
		await screen.findByText( 'Entry 201' );

		openMoreFilters();
		await chooseTag( 'none' );
		await screen.findByText( 'Entry 101' );

		expect( screen.getByText( 'Tag: No tag' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Budget: Festival' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'More filters (1 active)' } )
		).toBeInTheDocument();
		const request = listRequests().at( -1 );
		expect( request.get( 'tag' ) ).toBe( 'none' );
		expect( request.get( 'budget_id' ) ).toBe( '2' );
		expect( request.get( 'page' ) ).toBe( '1' );
		const totalsRequest = apiFetch.mock.calls
			.map( ( [ { path } ] ) => path )
			.filter( ( path ) => path.startsWith( `${ LIST }/totals?` ) )
			.at( -1 );
		expect(
			new URLSearchParams( totalsRequest.split( '?' )[ 1 ] ).get( 'tag' )
		).toBe( 'none' );

		await chooseTag( '' );
		expect( screen.queryByText( /^Tag:/ ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Budget: Festival' ) ).toBeInTheDocument();
		await waitFor( () =>
			expect( listRequests().at( -1 ).has( 'tag' ) ).toBe( false )
		);
		expect( listRequests().at( -1 ).get( 'budget_id' ) ).toBe( '2' );
	} );

	it( 'lists only the untagged allocation of a mixed split', async () => {
		const parent = {
			...entry( 7 ),
			amount: 100,
			description: 'Festival invoice',
			tag: null,
		};
		const venue = {
			...entry( 8 ),
			amount: 60,
			description: 'Venue share',
			tag: 'Venue',
			parent_entry_id: 7,
		};
		const untagged = {
			...entry( 9 ),
			amount: 40,
			description: 'Untagged share',
			tag: null,
			parent_entry_id: 7,
		};
		parent.children = [ venue, untagged ];
		apiFetch.mockImplementation( ( { path } ) => {
			const [ route, query = '' ] = path.split( '?' );
			const tag = new URLSearchParams( query ).get( 'tag' );
			if ( route === LIST ) {
				return Promise.resolve(
					tag === 'none'
						? {
								entries: [ { ...untagged, parent } ],
								total: 1,
								pages: 1,
							}
						: { entries: [ parent ], total: 1, pages: 1 }
				);
			}
			if ( route === `${ LIST }/totals` ) {
				const cost = tag === 'none' ? 40 : 100;
				return Promise.resolve( {
					total_cost: cost,
					total_income: 0,
					balance: -cost,
				} );
			}
			if ( route === '/fair-finance/v1/financial-entries/tags' ) {
				return Promise.resolve( [ 'Venue' ] );
			}
			if ( route.endsWith( '/unbudgeted-count' ) ) {
				return Promise.resolve( { count: 0 } );
			}
			return Promise.resolve( [] );
		} );

		render( <EntriesApp /> );
		await screen.findByText( 'Festival invoice' );
		openMoreFilters();
		await chooseTag( 'none' );
		await screen.findByText( 'Untagged share' );

		const table = screen.getByRole( 'table', {
			name: 'Financial entries',
		} );
		const rows = within( table ).getAllByRole( 'row' ).slice( 1 );
		expect( rows ).toHaveLength( 1 );
		expect( within( rows[ 0 ] ).getByText( '€40.00' ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'Festival invoice' )
		).not.toBeInTheDocument();
		expect( screen.queryByText( 'Venue share' ) ).not.toBeInTheDocument();
		expect( screen.getByText( '1 entry' ) ).toBeInTheDocument();
		const costs = screen.getByText( 'Total Costs' ).previousSibling;
		expect( costs ).toHaveTextContent( '€40.00' );
	} );
} );
