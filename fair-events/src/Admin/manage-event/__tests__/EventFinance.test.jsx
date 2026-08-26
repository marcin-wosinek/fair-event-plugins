/**
 * @jest-environment jsdom
 *
 * Component tests for the redesigned Finance tab (#1337).
 *
 * The transaction table is the single source of truth for income — entries
 * never contribute to Total Income, which removes the double-count bug class
 * from the earlier `unmatched=true` approach (a matched-but-unlinked entry
 * could still be summed on top of its transaction). fair-finance entries are
 * reduced to a cost-only annotation table.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventFinance from '../EventFinance.js';

jest.mock( '@wordpress/api-fetch' );

const paidTransactionWithEntry = {
	id: 1,
	amount: 45,
	mollie_fee: 0.79,
	application_fee: 0,
	status: 'paid',
	created_at: '2026-07-20 10:00:00',
	entry_ids: [ 5 ],
};

const paidTransactionWithoutEntry = {
	id: 2,
	amount: 50,
	mollie_fee: 0.88,
	application_fee: 0,
	status: 'paid',
	created_at: '2026-07-21 10:00:00',
	entry_ids: [],
};

const costEntry = {
	id: 9,
	entry_type: 'cost',
	entry_date: '2026-07-19',
	amount: 12,
	description: 'Venue rental',
};

function mockApiFetchByPath( {
	totals = { total_income: 0, total_cost: 0, balance: 0 },
	costEntries = [],
	paidTransactions = [],
} = {} ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.startsWith( '/fair-finance/v1/financial-entries/totals' ) ) {
			return Promise.resolve( totals );
		}
		if ( path.startsWith( '/fair-finance/v1/financial-entries' ) ) {
			return Promise.resolve( { entries: costEntries } );
		}
		if ( path.includes( 'status=paid' ) ) {
			return Promise.resolve( { transactions: paidTransactions } );
		}
		return Promise.resolve( { transactions: [] } );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

function statValue( label ) {
	return screen.getByText( label ).previousSibling.textContent;
}

describe( 'EventFinance — transaction table is the income source of truth (#1337)', () => {
	it( 'reports Total Income as the transaction gross sum, ignoring entries entirely', async () => {
		mockApiFetchByPath( {
			totals: { total_income: 999, total_cost: 0, balance: 999 },
			paidTransactions: [ paidTransactionWithEntry ],
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByText( 'Total Income' ) ).toBeInTheDocument()
		);

		expect( statValue( 'Total Income' ) ).toBe( '€45.00' );
	} );

	it( 'shows the linked entry id in the Budget entry column', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByText( '#5' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows a dash in the Budget entry column when the transaction has no linked entry', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithoutEntry ],
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByText( 'Payments' ) ).toBeInTheDocument()
		);

		const row = screen
			.getByRole( 'link', { name: '€50.00' } )
			.closest( 'tr' );
		expect( row ).toHaveTextContent( '-' );
	} );

	it( 'lists a cost entry in the Costs table and includes it in Total Costs', async () => {
		mockApiFetchByPath( {
			totals: { total_income: 0, total_cost: 12, balance: -12 },
			costEntries: [ costEntry ],
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByText( 'Venue rental' ) ).toBeInTheDocument()
		);

		expect( statValue( 'Total Costs' ) ).toBe( '€12.00' );
	} );

	it( 'requests only cost-type entries', async () => {
		mockApiFetchByPath( {} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );

		const calledPaths = apiFetch.mock.calls.map(
			( call ) => call[ 0 ].path
		);
		const entriesCall = calledPaths.find(
			( p ) =>
				p.startsWith( '/fair-finance/v1/financial-entries?' ) &&
				! p.includes( '/totals' )
		);
		expect( entriesCall ).toContain( 'entry_type=cost' );
	} );

	it( 'still computes Total Net from paid-transaction fee data', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByText( 'Total Net' ) ).toBeInTheDocument()
		);

		// 45 - 0.79 mollie fee - 0 application fee = 44.21
		expect( statValue( 'Total Net' ) ).toBe( '€44.21' );
	} );
} );
