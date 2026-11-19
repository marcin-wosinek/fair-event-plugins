/**
 * Shared admin table on the entries screen (#2208): each entry kind shows
 * its contextual primary action and only eligible menu actions, grouped
 * rows keep their allocations, amounts keep their currency and precision,
 * and the list distinguishes loading, empty, no-results and failure states.
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

const ORDINARY = makeEntry( {
	id: 1,
	description: 'Flyers',
	amount: 1234.5,
	budget_id: 2,
	tag: 'Marketing',
} );
const MATCHED = makeEntry( {
	id: 2,
	entry_type: 'income',
	description: 'Ticket payout',
	amount: 25,
	transaction_ids: [ 8, 9 ],
} );
const SPLIT = makeEntry( {
	id: 3,
	description: 'Teacher fees',
	amount: 300,
	children: [
		makeEntry( {
			id: 31,
			parent_entry_id: 3,
			description: 'Teacher A',
			amount: 200,
			budget_id: 2,
		} ),
		makeEntry( {
			id: 32,
			parent_entry_id: 3,
			description: '',
			amount: 100,
		} ),
	],
} );
const TRANSFER = makeEntry( {
	id: 4,
	entry_type: 'transfer',
	description: 'Cash to venue',
	amount: 120,
	children: [
		makeEntry( {
			id: 41,
			parent_entry_id: 4,
			entry_type: 'cost',
			description: 'Cash to venue',
			amount: 120,
			budget_id: 5,
		} ),
		makeEntry( {
			id: 42,
			parent_entry_id: 4,
			entry_type: 'income',
			description: 'Cash to venue',
			amount: 120,
			budget_id: 2,
		} ),
	],
} );
const EVENT_CASH = makeEntry( {
	id: 5,
	entry_type: 'income',
	description: 'Door sales',
	amount: 80.5,
	payment_source: 'event_cash',
} );

const BUDGETS = [
	{ id: 2, name: 'Venue' },
	{ id: 5, name: 'Cash box' },
];

/**
 * Route apiFetch by path.
 *
 * @param {Object}   options
 * @param {Function} options.list List response for each request (may reject).
 */
const mockApi = ( {
	list = () =>
		Promise.resolve( {
			entries: [ ORDINARY, MATCHED, SPLIT, TRANSFER, EVENT_CASH ],
			total: 5,
			pages: 1,
		} ),
} = {} ) => {
	apiFetch.mockImplementation( ( { path } ) => {
		const [ route, query = '' ] = path.split( '?' );
		switch ( route ) {
			case '/fair-finance/v1/financial-entries':
				return list( new URLSearchParams( query ) );
			case '/fair-finance/v1/budgets':
				return Promise.resolve( BUDGETS );
			case '/fair-finance/v1/financial-entries/totals':
				return Promise.resolve( {
					total_cost: 1654.5,
					total_income: 105.5,
					balance: -1549,
				} );
			case '/fair-finance/v1/financial-entries/totals-by-tag':
				return Promise.resolve( {} );
			case '/fair-finance/v1/financial-entries/unbudgeted-count':
				return Promise.resolve( { count: 0 } );
			default:
				return Promise.resolve( [] );
		}
	} );
};

// Notices are also announced in an a11y live region; match the visible one.
const IN_NOTICE = { selector: '.components-notice__content' };

const rowOf = ( description ) =>
	screen
		.getAllByText( description, {
			selector: '.fair-admin-table__identity-name',
		} )[ 0 ]
		.closest( 'tr' );

/**
 * Labels of an entry's overflow menu items, closing the menu afterwards.
 *
 * @param {string} entry Entry description.
 * @return {Promise<string[]>} Menu item labels, including disabled reasons.
 */
const menuLabels = async ( entry ) => {
	const toggle = screen.getByRole( 'button', {
		name: `More actions for “${ entry }”`,
	} );
	fireEvent.click( toggle );
	const menu = await screen.findByRole( 'menu', {
		name: `More actions for “${ entry }”`,
	} );
	const items = within( menu ).getAllByRole( 'menuitem' );
	const labels = items.map( ( item ) => item.textContent );
	await act( async () => {
		fireEvent.keyDown( menu, { key: 'Escape' } );
	} );
	return { labels, items };
};

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'EntriesApp — shared table (#2208)', () => {
	it( 'shows the contextual primary action and only eligible menu actions per entry kind', async () => {
		mockApi();
		render( <EntriesApp /> );
		await screen.findByText( 'Flyers' );

		// Ordinary entry: Edit, then Split, Match and Delete.
		expect(
			within( rowOf( 'Flyers' ) ).getByRole( 'button', {
				name: 'Edit “Flyers”',
			} )
		).toHaveTextContent( 'Edit' );
		expect( ( await menuLabels( 'Flyers' ) ).labels ).toEqual( [
			'Split',
			'Match',
			'Delete',
		] );

		// Matched entry offers Unmatch instead of Match.
		expect( ( await menuLabels( 'Ticket payout' ) ).labels ).toEqual( [
			'Split',
			'Unmatch',
			'Delete',
		] );

		// Split parent: Edit split, Match, and a Delete that says why not.
		expect(
			within( rowOf( 'Teacher fees' ) ).getByRole( 'button', {
				name: 'Edit split “Teacher fees”',
			} )
		).toHaveTextContent( 'Edit split' );
		const split = await menuLabels( 'Teacher fees' );
		expect( split.labels[ 0 ] ).toBe( 'Match' );
		expect( split.labels[ 1 ] ).toContain(
			'Unsplit this entry before deleting it.'
		);
		expect( split.items[ 1 ] ).toHaveAttribute( 'aria-disabled', 'true' );

		// Transfer: Edit opens the transfer editor; only Delete in the menu.
		expect( ( await menuLabels( 'Cash to venue' ) ).labels ).toEqual( [
			'Delete',
		] );
		await act( async () => {
			fireEvent.click(
				within( rowOf( 'Cash to venue' ) ).getByRole( 'button', {
					name: 'Edit “Cash to venue”',
				} )
			);
		} );
		expect(
			await screen.findByRole( 'dialog', { name: /transfer/i } )
		).toBeInTheDocument();
	} );

	it( 'keeps event cash entries to Edit and Delete', async () => {
		mockApi();
		render( <EntriesApp /> );
		await screen.findByText( 'Door sales' );

		expect( within( rowOf( 'Door sales' ) ).getByText( 'Event cash' ) );
		expect( ( await menuLabels( 'Door sales' ) ).labels ).toEqual( [
			'Delete',
		] );
	} );

	it( 'formats amounts with currency and precision, and fills missing values', async () => {
		mockApi();
		render( <EntriesApp /> );
		await screen.findByText( 'Flyers' );

		const row = rowOf( 'Flyers' );
		expect( within( row ).getByText( '€1,234.50' ) ).toBeInTheDocument();
		expect( within( row ).getByText( 'Tag: Marketing' ) ).toBeVisible();
		expect( within( row ).getByText( 'Venue' ) ).toBeInTheDocument();
		// Imported is empty: a dash, not a blank cell.
		expect( within( row ).getByText( '—' ) ).toBeInTheDocument();

		expect(
			within( rowOf( 'Ticket payout' ) ).getByText( 'Yes (2)' )
		).toBeInTheDocument();
		expect(
			within( rowOf( 'Flyers' ) ).getByText( 'No' )
		).toBeInTheDocument();
		expect(
			within( rowOf( 'Cash to venue' ) ).getByText( 'Cash box → Venue' )
		).toBeInTheDocument();
		expect(
			within( rowOf( 'Teacher fees' ) ).getByText(
				'Split into 2 allocations'
			)
		).toBeInTheDocument();
		expect( screen.getByText( '-€1,549.00' ) ).toBeInTheDocument();
	} );

	it( 'expands split and transfer allocations with their parent named', async () => {
		mockApi();
		render( <EntriesApp /> );
		await screen.findByText( 'Teacher fees' );

		expect( screen.queryByText( 'Teacher A' ) ).not.toBeInTheDocument();
		const toggles = screen.getAllByRole( 'button', {
			name: 'Show 2 allocations',
		} );
		expect( toggles ).toHaveLength( 2 );
		toggles.forEach( ( toggle ) => fireEvent.click( toggle ) );

		const childRow = screen.getByText( 'Teacher A' ).closest( 'tr' );
		expect(
			within( childRow ).getByText( 'Part of split entry “Teacher fees”' )
		).toBeInTheDocument();
		expect( within( childRow ).getByText( '€200.00' ) ).toBeInTheDocument();
		// Allocations are read-only.
		expect( within( childRow ).queryByRole( 'button' ) ).toBeNull();
		expect( screen.getByText( '(no description)' ) ).toBeInTheDocument();

		expect(
			screen.getAllByText( 'Part of transfer “Cash to venue”' )
		).toHaveLength( 2 );
	} );

	it( 'sorts from a header button and announces the order', async () => {
		mockApi();
		render( <EntriesApp /> );
		await screen.findByText( 'Flyers' );

		const dateHeader = screen.getByRole( 'columnheader', { name: /Date/ } );
		expect( dateHeader ).toHaveAttribute( 'aria-sort', 'descending' );

		const amount = screen.getByRole( 'button', { name: 'Amount' } );
		act( () => amount.focus() );
		await act( async () => {
			fireEvent.click( amount );
		} );

		const lastList = apiFetch.mock.calls
			.map( ( [ { path } ] ) => path )
			.filter( ( path ) =>
				path.startsWith( '/fair-finance/v1/financial-entries?' )
			)
			.pop();
		expect( lastList ).toContain( 'orderby=amount' );
		expect(
			screen.getByRole( 'columnheader', { name: /Amount/ } )
		).toHaveAttribute( 'aria-sort', 'descending' );
		// The rows and the header stay mounted, so focus stays put.
		expect( amount ).toHaveFocus();
	} );

	it( 'offers a retry when the first load fails', async () => {
		let fail = true;
		mockApi( {
			list: () =>
				fail
					? Promise.reject( { message: 'Server unavailable.' } )
					: Promise.resolve( {
							entries: [ ORDINARY ],
							total: 1,
							pages: 1,
						} ),
		} );
		render( <EntriesApp /> );

		expect(
			await screen.findByText( 'Server unavailable.', IN_NOTICE )
		).toBeInTheDocument();
		expect(
			screen.queryByText( /No entries found/ )
		).not.toBeInTheDocument();

		fail = false;
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );

		expect( await screen.findByText( 'Flyers' ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'Server unavailable.', IN_NOTICE )
		).not.toBeInTheDocument();
	} );

	it( 'tells an empty ledger apart from filters that match nothing', async () => {
		mockApi( {
			list: () => Promise.resolve( { entries: [], total: 0, pages: 0 } ),
		} );
		render( <EntriesApp /> );

		expect(
			await screen.findByText(
				'No entries found. Add your first entry to start tracking costs and income.'
			)
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.change( screen.getByLabelText( 'Type' ), {
				target: { value: 'income' },
			} );
		} );

		expect(
			await screen.findByText( 'No entries match the selected filters.' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Type: Income' ) ).toBeInTheDocument();
		// Offered both in the toolbar and in the no-results message.
		const clearButtons = screen.getAllByRole( 'button', {
			name: 'Clear filters',
		} );
		expect( clearButtons ).toHaveLength( 2 );
		await act( async () => {
			fireEvent.click( clearButtons[ 1 ] );
		} );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Type' ) ).toHaveValue( '' )
		);
		expect(
			await screen.findByText( /No entries found/ )
		).toBeInTheDocument();
		// An empty ledger offers its first steps instead of clearing.
		expect(
			screen.getByRole( 'button', { name: 'Add your first entry' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Import entries' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Clear filters' } )
		).not.toBeInTheDocument();
	} );
} );

describe( 'EntriesApp — entity-encoded descriptions (#2412)', () => {
	const NBSP = ' ';
	const REPORTED =
		'Entrada para Minifesti "La&nbsp;Mutable", 22 de noviembre';
	const REPORTED_TEXT = `Entrada para Minifesti "La${ NBSP }Mutable", 22 de noviembre`;
	const ENCODED = makeEntry( {
		id: 61,
		description: 'Rock &amp; Roll &#8220;Live&#8221; &#x2013; Bar',
	} );
	const HTML_LIKE = makeEntry( {
		id: 62,
		description: '&lt;img src=x onerror=alert(1)&gt; <b>bold</b>',
	} );
	const DOUBLE = makeEntry( {
		id: 63,
		description: 'Tickets &amp;lt;VIP&amp;gt;',
	} );
	const SPLIT_ENCODED = makeEntry( {
		id: 64,
		description: REPORTED,
		amount: 30,
		children: [
			makeEntry( {
				id: 641,
				parent_entry_id: 64,
				description: 'Caf&eacute; &amp; drinks',
				amount: 20,
			} ),
			makeEntry( {
				id: 642,
				parent_entry_id: 64,
				description: '',
				amount: 10,
			} ),
		],
	} );
	const TRANSFER_ENCODED = makeEntry( {
		id: 65,
		entry_type: 'transfer',
		description: 'Cash &rarr; bank',
		amount: 50,
		children: [
			makeEntry( {
				id: 651,
				parent_entry_id: 65,
				entry_type: 'cost',
				description: 'Cash &rarr; bank',
				amount: 50,
				budget_id: 5,
			} ),
			makeEntry( {
				id: 652,
				parent_entry_id: 65,
				entry_type: 'income',
				description: 'Cash &rarr; bank',
				amount: 50,
				budget_id: 2,
			} ),
		],
	} );
	// Listed on its own (e.g. by a budget filter), with its parent attached.
	const LONE_CHILD = makeEntry( {
		id: 71,
		parent_entry_id: 70,
		description: 'Door &amp; bar',
		amount: 15,
		parent: makeEntry( {
			id: 70,
			description: 'Night &#8211; split',
			amount: 40,
		} ),
	} );

	const identityNames = () =>
		Array.from(
			document.querySelectorAll( '.fair-admin-table__identity-name' )
		).map( ( node ) => node.textContent );

	const metaTexts = () =>
		Array.from(
			document.querySelectorAll( '.fair-admin-table__identity-meta' )
		).map( ( node ) => node.textContent );

	beforeEach( () => {
		mockApi( {
			list: () =>
				Promise.resolve( {
					entries: [
						makeEntry( { id: 60, description: REPORTED } ),
						ENCODED,
						HTML_LIKE,
						DOUBLE,
						SPLIT_ENCODED,
						TRANSFER_ENCODED,
						LONE_CHILD,
					],
					total: 7,
					pages: 1,
				} ),
		} );
	} );

	it( 'decodes ordinary entry descriptions once, keeping markup as text', async () => {
		const { container } = render( <EntriesApp /> );
		await screen.findByText( /Rock & Roll/ );

		const names = identityNames();
		// The reported description: a real U+00A0, not a literal `&nbsp;`.
		expect( names ).toContain( REPORTED_TEXT );
		expect( names ).toContain( 'Rock & Roll “Live” – Bar' );
		expect( names ).toContain( '<img src=x onerror=alert(1)> <b>bold</b>' );
		// Intentionally encoded entity text stays literal after one decode.
		expect( names ).toContain( 'Tickets &lt;VIP&gt;' );
		expect( names.join( '' ) ).not.toContain( '&nbsp;' );
		expect( names.join( '' ) ).not.toContain( '&amp;' );

		// HTML-like text creates no elements.
		expect( container.querySelector( 'tbody img' ) ).toBeNull();
		expect( container.querySelector( 'tbody b' ) ).toBeNull();
	} );

	it( 'decodes split allocations, transfers and their parent context', async () => {
		render( <EntriesApp /> );
		await screen.findByText( /Rock & Roll/ );

		screen
			.getAllByRole( 'button', { name: 'Show 2 allocations' } )
			.forEach( ( toggle ) => fireEvent.click( toggle ) );

		const names = identityNames();
		expect( names ).toContain( 'Café & drinks' );
		expect( names ).toContain( 'Cash → bank' );
		expect( names ).toContain( 'Door & bar' );
		// An empty allocation keeps its fallback.
		expect( names ).toContain( '(no description)' );

		const meta = metaTexts();
		expect( meta ).toContain( `Part of split entry “${ REPORTED_TEXT }”` );
		expect(
			meta.filter( ( text ) => text === 'Part of transfer “Cash → bank”' )
		).toHaveLength( 2 );
		// An independently listed allocation names its parent decoded.
		expect( meta ).toContain( 'Part of split entry “Night – split”' );
		expect( meta.join( '' ) ).not.toMatch( /&[a-z#0-9]+;/i );
	} );

	it( 'names entries decoded in their action labels', async () => {
		render( <EntriesApp /> );
		await screen.findByText( /Rock & Roll/ );

		expect(
			screen.getByRole( 'button', {
				name: 'Edit “Rock & Roll “Live” – Bar”',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'More actions for “Tickets &lt;VIP&gt;”',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Edit split “Night – split”' } )
		).toBeInTheDocument();
		// Accessible names keep the exact U+00A0.
		const edits = screen
			.getAllByRole( 'button', { name: /^Edit split/ } )
			.map( ( button ) => button.getAttribute( 'aria-label' ) );
		expect( edits ).toContain( `Edit split “${ REPORTED_TEXT }”` );
	} );
} );
