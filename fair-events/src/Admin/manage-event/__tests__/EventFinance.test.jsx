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

const failedTransaction = {
	id: 3,
	amount: 20,
	status: 'failed',
	created_at: '2026-07-22 10:00:00',
};

const budgetA = { id: 3, name: 'Summer camp' };
const budgetB = { id: 7, name: 'General fund' };

function mockApiFetchByPath( {
	totals = { total_income: 0, total_cost: 0, balance: 0 },
	costEntries = [],
	paidTransactions = [],
	failedTransactions = [],
	budgets = [],
	eventBudgetId = null,
	failing = null,
} = {} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( failing && path.startsWith( failing ) ) {
			return Promise.reject( new Error( 'Server exploded.' ) );
		}
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
		if ( path.includes( 'status=failed' ) ) {
			return Promise.resolve( { transactions: failedTransactions } );
		}
		return Promise.resolve( { transactions: [] } );
	} );
}

const bothActive = { connectorActive: true, financeActive: true };

afterEach( () => {
	jest.clearAllMocks();
} );

function calledPaths() {
	return apiFetch.mock.calls.map( ( call ) => call[ 0 ].path );
}

function statValue( label ) {
	return screen.getByText( label ).previousSibling.textContent;
}

describe( 'EventFinance — transaction table is the income source of truth (#1337)', () => {
	it( 'reports Total Income as the transaction gross sum, ignoring entries entirely', async () => {
		mockApiFetchByPath( {
			totals: { total_income: 999, total_cost: 0, balance: 999 },
			paidTransactions: [ paidTransactionWithEntry ],
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		await waitFor( () =>
			expect( screen.getByText( 'Total Income' ) ).toBeInTheDocument()
		);

		expect( statValue( 'Total Income' ) ).toBe( '€45.00' );
	} );

	it( 'links the entry id in the Budget entry column to the focused entry view', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByRole( 'link', { name: '#5' } )
		).toHaveAttribute( 'href', 'admin.php&entry_id=5' );
	} );

	it( 'shows a dash in the Budget entry column when the transaction has no linked entry', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithoutEntry ],
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		await waitFor( () =>
			expect( screen.getByText( 'Venue rental' ) ).toBeInTheDocument()
		);

		expect( statValue( 'Total Costs' ) ).toBe( '€12.00' );
	} );

	it( 'requests only cost-type entries', async () => {
		mockApiFetchByPath( {} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ) ).toHaveValue(
				String( budgetB.id )
			)
		);
	} );

	it( 'saves the selected budget to the event-budget endpoint', async () => {
		mockApiFetchByPath( { budgets: [ budgetA, budgetB ] } );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

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

describe( 'EventFinance — links to the focused entry view (#1914)', () => {
	it( 'links each of several entry ids on one transaction separately', async () => {
		mockApiFetchByPath( {
			paidTransactions: [
				{ ...paidTransactionWithEntry, entry_ids: [ 5, 6 ] },
			],
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByRole( 'link', { name: '#5' } )
		).toHaveAttribute( 'href', 'admin.php&entry_id=5' );
		expect( screen.getByRole( 'link', { name: '#6' } ) ).toHaveAttribute(
			'href',
			'admin.php&entry_id=6'
		);
		expect(
			screen.getByRole( 'link', { name: '#5' } ).closest( 'td' )
		).toHaveTextContent( '#5, #6' );
	} );

	it( 'links the cost entry date to the focused entry view', async () => {
		mockApiFetchByPath( { costEntries: [ costEntry ] } );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		const link = await screen.findByRole( 'link', {
			name: 'Entry #9, 2026-07-19',
		} );
		expect( link ).toHaveAttribute( 'href', 'admin.php&entry_id=9' );
		expect( link ).toHaveTextContent( '2026-07-19' );
	} );

	it( 'renders plain-text references when the entries screen is unavailable', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
			costEntries: [ costEntry ],
		} );

		render(
			<EventFinance { ...bothActive } eventDateId={ 42 } entriesUrl="" />
		);

		await screen.findByText( 'Venue rental' );
		expect( screen.getByText( '#5' ) ).toBeInTheDocument();
		expect( screen.getByText( '2026-07-19' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: '#5' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: /^Entry #/ } )
		).not.toBeInTheDocument();
		screen.getAllByRole( 'link' ).forEach( ( link ) => {
			expect( link.getAttribute( 'href' ) ).not.toContain( 'entry_id=' );
		} );
	} );
} );

describe( 'EventFinance — plugin availability (#2110)', () => {
	it( 'payments only: shows payment figures and tables without any Fair Finance request', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
			failedTransactions: [ failedTransaction ],
		} );

		render(
			<EventFinance
				connectorActive
				financeActive={ false }
				eventDateId={ 42 }
				entriesUrl=""
			/>
		);

		await screen.findByText( 'Payments' );
		expect( statValue( 'Total Income' ) ).toBe( '€45.00' );
		expect( statValue( 'Total Net' ) ).toBe( '€44.21' );
		expect( screen.getByText( 'Failed Payments' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: '€45.00' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=1'
		);

		expect( screen.queryByText( 'Total Costs' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Balance' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Budget entry' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( '#5' ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Budget' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: 'View All Entries' } )
		).not.toBeInTheDocument();

		const paths = calledPaths();
		expect(
			paths.filter( ( path ) =>
				path.startsWith( '/fair-payments-connector/v1/transactions' )
			)
		).toHaveLength( 4 );
		expect(
			paths.some(
				( path ) =>
					path.startsWith( '/fair-finance/' ) ||
					path.endsWith( '/budget' )
			)
		).toBe( false );
	} );

	it( 'payments only: shows a payment-specific empty state', async () => {
		mockApiFetchByPath( {} );

		render(
			<EventFinance
				connectorActive
				financeActive={ false }
				eventDateId={ 42 }
				entriesUrl=""
			/>
		);

		expect(
			await screen.findByText( 'No payments for this event yet.' )
		).toBeInTheDocument();
		expect( statValue( 'Total Income' ) ).toBe( '€0.00' );
	} );

	it( 'Fair Finance only: shows costs and budgets without income, net, balance or payment requests', async () => {
		mockApiFetchByPath( {
			totals: { total_cost: 12 },
			costEntries: [ costEntry ],
			budgets: [ budgetA ],
		} );

		render(
			<EventFinance
				connectorActive={ false }
				financeActive
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		await screen.findByText( 'Venue rental' );
		await screen.findByText( 'Summer camp' );
		expect( statValue( 'Total Costs' ) ).toBe( '€12.00' );
		expect( screen.queryByText( 'Total Income' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Total Net' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Balance' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Payments' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'View All Entries' } )
		).toHaveAttribute( 'href', 'admin.php&event_date_id=42' );
		expect(
			calledPaths().some( ( path ) =>
				path.startsWith( '/fair-payments-connector/' )
			)
		).toBe( false );
	} );

	it( 'Fair Finance only: shows a cost-specific empty state', async () => {
		mockApiFetchByPath( {} );

		render(
			<EventFinance
				connectorActive={ false }
				financeActive
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByText( 'No costs for this event yet.' )
		).toBeInTheDocument();
	} );

	it( 'both active: keeps the combined summary, balance and empty state', async () => {
		mockApiFetchByPath( {} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByText(
				'No financial entries for this event yet.'
			)
		).toBeInTheDocument();
		expect( statValue( 'Balance' ) ).toBe( '€0.00' );
		expect( screen.getByLabelText( 'Budget' ) ).toBeInTheDocument();
	} );

	it( 'keeps payments visible when the Fair Finance requests fail', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
			failing: '/fair-finance/v1/financial-entries',
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByText(
				'Costs could not be loaded. Server exploded.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
		expect( statValue( 'Total Income' ) ).toBe( '€45.00' );
		expect( screen.getByText( 'Payments' ) ).toBeInTheDocument();
		// A failed source is never shown as a zero total.
		expect( screen.queryByText( 'Total Costs' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Balance' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'No financial entries for this event yet.' )
		).not.toBeInTheDocument();
	} );

	it( 'keeps costs visible when the payment requests fail', async () => {
		mockApiFetchByPath( {
			totals: { total_cost: 12 },
			costEntries: [ costEntry ],
			failing: '/fair-payments-connector/v1/transactions',
		} );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByText(
				'Payments could not be loaded. Server exploded.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Venue rental' ) ).toBeInTheDocument();
		expect( statValue( 'Total Costs' ) ).toBe( '€12.00' );
		expect( screen.queryByText( 'Total Income' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Balance' ) ).not.toBeInTheDocument();
	} );

	it( 'disables the budget controls when budgets fail to load', async () => {
		mockApiFetchByPath( { failing: '/fair-finance/v1/budgets' } );

		render(
			<EventFinance
				{ ...bothActive }
				eventDateId={ 42 }
				entriesUrl="admin.php"
			/>
		);

		expect(
			await screen.findByText(
				'Budgets could not be loaded. Server exploded.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Budget' ) ).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Save budget' } )
		).toBeDisabled();
	} );
} );
