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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const budgetA = { id: 3, name: 'Summer camp' };
const budgetB = { id: 7, name: 'General fund' };

function mockApiFetchByPath( {
	totals = { total_income: 0, total_cost: 0, balance: 0 },
	costEntries = [],
	paidTransactions = [],
	budgets = [],
	eventBudgetId = null,
} = {} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path.startsWith( '/fair-finance/v1/financial-entries/totals' ) ) {
			return Promise.resolve( totals );
		}
		if ( path.startsWith( '/fair-finance/v1/financial-entries' ) ) {
			return Promise.resolve( { entries: costEntries } );
		}
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( budgets );
		}
		if ( /\/fair-events\/v1\/event-dates\/\d+\/budget$/.test( path ) ) {
			if ( 'PUT' === method ) {
				return Promise.resolve( { budget_id: data.budget_id } );
			}
			return Promise.resolve( { budget_id: eventBudgetId } );
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

describe( 'EventFinance — event budget link (#1608)', () => {
	it( 'lists "No budget" plus every available budget, with no budget selected by default', async () => {
		mockApiFetchByPath( { budgets: [ budgetA, budgetB ] } );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await screen.findByText( 'General fund' );

		const select = screen.getByLabelText( 'Budget' );
		const optionLabels = Array.from( select.options ).map(
			( option ) => option.text
		);
		expect( optionLabels ).toEqual( [
			'No budget',
			'Summer camp',
			'General fund',
		] );
		expect( select.value ).toBe( '' );
	} );

	it( 'shows the event’s stored budget as the selected option', async () => {
		mockApiFetchByPath( {
			budgets: [ budgetA, budgetB ],
			eventBudgetId: budgetB.id,
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ) ).toHaveValue(
				String( budgetB.id )
			)
		);
	} );

	it( 'saves the selected budget to the event-budget endpoint', async () => {
		mockApiFetchByPath( { budgets: [ budgetA, budgetB ] } );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await screen.findByText( 'Summer camp' );

		fireEvent.change( screen.getByLabelText( 'Budget' ), {
			target: { value: String( budgetA.id ) },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save budget' } )
		);

		await waitFor( () =>
			expect(
				screen.getByText( 'Budget updated.', {
					selector: '.components-notice__content',
				} )
			).toBeInTheDocument()
		);

		const putCall = apiFetch.mock.calls.find(
			( call ) => 'PUT' === call[ 0 ].method
		);
		expect( putCall[ 0 ] ).toMatchObject( {
			path: '/fair-events/v1/event-dates/42/budget',
			data: { budget_id: budgetA.id },
		} );
	} );

	it( 'clears the budget by saving "No budget" as null', async () => {
		mockApiFetchByPath( {
			budgets: [ budgetA ],
			eventBudgetId: budgetA.id,
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ) ).toHaveValue(
				String( budgetA.id )
			)
		);

		fireEvent.change( screen.getByLabelText( 'Budget' ), {
			target: { value: '' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save budget' } )
		);

		await waitFor( () => {
			const putCall = apiFetch.mock.calls.find(
				( call ) => 'PUT' === call[ 0 ].method
			);
			expect( putCall[ 0 ].data ).toEqual( { budget_id: null } );
		} );
	} );

	it( 'disables Save budget until the selection changes', async () => {
		mockApiFetchByPath( {
			budgets: [ budgetA ],
			eventBudgetId: budgetA.id,
		} );

		render( <EventFinance eventDateId={ 42 } entriesUrl="admin.php" /> );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save budget' } )
			).toBeDisabled()
		);

		fireEvent.change( screen.getByLabelText( 'Budget' ), {
			target: { value: '' },
		} );

		expect(
			screen.getByRole( 'button', { name: 'Save budget' } )
		).toBeEnabled();
	} );
} );
