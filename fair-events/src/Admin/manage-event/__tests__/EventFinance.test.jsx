/**
 * @jest-environment jsdom
 *
 * Component tests for the Finance tab (#2398): the event result first,
 * from one finance-summary request; payments, expenses, cash sales and
 * purchase attempts collapsed on arrival; budget settings last.
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
import EventFinance from '../EventFinance.js';

jest.mock( '@wordpress/api-fetch' );

// The Valencia example of #2398.
const VALENCIA = {
	currency: 'EUR',
	state: 'complete',
	issues: [],
	sales: {
		total: 3950,
		online: {
			gross: 3615,
			mollie_fees: 62.81,
			application_fees: 0,
			fees: 62.81,
			net: 3552.19,
			fees_complete: true,
			payment_count: 80,
			unallocated: 0,
		},
		cash: 335,
	},
	costs: {
		total: 340.78,
		expenses: {
			total: 277.97,
			event_cash: 0,
			personal: 277.97,
			bank: 0,
			unclassified: 0,
			personal_by_payer: [
				{ payer_name: 'Ana', amount: 262.97 },
				{ payer_name: 'Sayli', amount: 15 },
			],
		},
		payment_fees: 62.81,
	},
	net_result: 3609.22,
	payout: {
		awaiting_payout: 0,
		paid_out: 0,
		received_in_bank: 0,
		unknown: 3552.19,
		unpriced_count: 0,
	},
};

const paidTransactionWithEntry = {
	id: 1,
	amount: 45,
	mollie_fee: 0.79,
	application_fee: 0,
	status: 'paid',
	created_at: '2026-07-20 10:00:00',
	entry_ids: [ 5 ],
};

const failedTransaction = {
	id: 3,
	amount: 20,
	status: 'failed',
	description: 'Failed attempt',
	created_at: '2026-07-22 10:00:00',
};

const dinner = {
	id: 9,
	entry_type: 'cost',
	entry_date: '2026-07-19',
	amount: 15,
	description: 'Dinner',
	payment_source: 'personal_funds',
	payer_name: 'Sayli',
};

const bankCost = {
	id: 10,
	entry_type: 'cost',
	entry_date: '2026-07-18',
	amount: 40,
	description: 'Venue',
	payment_source: null,
	bank_origin: { account: { id: 1, name: 'Main account' } },
};

const budgetA = { id: 3, name: 'Summer camp' };
const budgetB = { id: 7, name: 'General fund' };

function mockApiFetchByPath( {
	summary = VALENCIA,
	costEntries = [],
	incomeEntries = [],
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
		if ( /\/finance-summary$/.test( path ) ) {
			return Promise.resolve( summary );
		}
		if ( path.startsWith( '/fair-finance/v1/financial-entries' ) ) {
			const entries = path.includes( 'entry_type=cost' )
				? costEntries
				: incomeEntries;
			return Promise.resolve( {
				entries,
				total: entries.length,
				pages: 1,
			} );
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
		if ( path.startsWith( '/fair-events/v1/get-tickets' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.includes( 'status=paid' ) ) {
			return Promise.resolve( {
				transactions: paidTransactions,
				total: paidTransactions.length,
			} );
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

function headline( label ) {
	const box = within( screen.getByTestId( 'finance-headline' ) );
	return box.getByText( label ).nextSibling.textContent;
}

function row( list, label ) {
	return within( screen.getByRole( 'list', { name: list } ) )
		.getAllByText( label )[ 0 ]
		.closest( 'div' ).lastChild.textContent;
}

function renderTab( props = {} ) {
	return render(
		<EventFinance
			{ ...bothActive }
			eventDateId={ 42 }
			entriesUrl="admin.php?page=fair-finance-entries"
			financeManageable
			purchasePaymentsAvailable
			{ ...props }
		/>
	);
}

describe( 'EventFinance — event result first (#2398)', () => {
	it( 'shows the Valencia headline figures that reconcile', async () => {
		mockApiFetchByPath();
		renderTab();

		await screen.findByTestId( 'finance-headline' );
		expect( headline( 'Total sales' ) ).toBe( '€3,950.00' );
		expect( headline( 'Total costs, including fees' ) ).toBe( '€340.78' );
		expect( headline( 'Net event result' ) ).toBe( '€3,609.22' );
		expect(
			screen.queryByText( 'Incomplete: the net result isn’t final.' )
		).not.toBeInTheDocument();
	} );

	it( 'breaks sales and costs down without opening any table', async () => {
		mockApiFetchByPath();
		renderTab();

		await screen.findByTestId( 'finance-headline' );
		expect( row( 'Sales breakdown', 'Online payments' ) ).toBe(
			'€3,615.00'
		);
		expect( row( 'Sales breakdown', 'Cash sales' ) ).toBe( '€335.00' );
		expect( row( 'Sales breakdown', 'Mollie fees' ) ).toBe( '€62.81' );
		expect( row( 'Sales breakdown', 'Fair Events fees' ) ).toBe( '€0.00' );
		expect( row( 'Sales breakdown', 'After fees' ) ).toBe( '€3,552.19' );
		expect( row( 'Costs breakdown', 'Recorded expenses' ) ).toBe(
			'€277.97'
		);
		expect( row( 'Costs breakdown', 'Payment fees' ) ).toBe( '€62.81' );
		expect( row( 'Costs breakdown', 'Paid personally' ) ).toBe( '€277.97' );
		expect( row( 'Costs breakdown', 'Paid from event cash' ) ).toBe(
			'€0.00'
		);
		expect( row( 'Personally paid by payer', 'Sayli' ) ).toBe( '€15.00' );

		// The summary needs no transaction or entry list.
		expect(
			calledPaths().some(
				( path ) =>
					path.startsWith( '/fair-payments-connector/' ) ||
					path.startsWith( '/fair-finance/v1/financial-entries' ) ||
					path.startsWith( '/fair-events/v1/get-tickets' )
			)
		).toBe( false );
	} );

	it( 'shows the bank payout status, never an unconfirmed bank receipt', async () => {
		mockApiFetchByPath( {
			summary: {
				...VALENCIA,
				payout: {
					awaiting_payout: 100,
					paid_out: 3000,
					received_in_bank: 0,
					unknown: 452.19,
					unpriced_count: 0,
				},
			},
		} );
		renderTab();

		const payout = within( await screen.findByTestId( 'payout-status' ) );
		expect( payout.getByText( 'Awaiting payout' ) ).toBeInTheDocument();
		expect( payout.getByText( 'Paid out by Mollie' ) ).toBeInTheDocument();
		expect(
			payout.getByText( 'Payout status unknown' )
		).toBeInTheDocument();
		expect(
			payout.queryByText( 'Received in bank' )
		).not.toBeInTheDocument();
	} );

	it( 'marks an incomplete summary and says why', async () => {
		mockApiFetchByPath( {
			summary: {
				...VALENCIA,
				state: 'incomplete',
				issues: [ 'fees_missing', 'online_unallocated' ],
				sales: {
					...VALENCIA.sales,
					online: { ...VALENCIA.sales.online, unallocated: 2 },
				},
			},
		} );
		renderTab();

		expect(
			await screen.findByText( 'Incomplete: the net result isn’t final.' )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Payment fees aren’t recorded yet for some online payments, so costs leave them out and the net result may be too high.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'2 paid payments for this event aren’t fully assigned to their purchases yet, so part of them may be missing from sales.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows a source that can’t be read as not available, not zero', async () => {
		mockApiFetchByPath( {
			summary: {
				...VALENCIA,
				state: 'incomplete',
				issues: [ 'finance_inactive' ],
				sales: { ...VALENCIA.sales, total: 3615, cash: null },
				costs: {
					total: 62.81,
					expenses: null,
					payment_fees: 62.81,
				},
				net_result: 3552.19,
			},
		} );
		renderTab( { financeActive: false } );

		await screen.findByTestId( 'finance-headline' );
		expect( row( 'Costs breakdown', 'Recorded expenses' ) ).toBe(
			'Not available'
		);
		expect( row( 'Sales breakdown', 'Cash sales' ) ).toBe(
			'Not available'
		);
		expect(
			screen.getByText(
				'Expenses and cash sales are left out because Fair Finance is inactive.'
			)
		).toBeInTheDocument();
	} );

	it( 'reports a failed summary as an error with a retry', async () => {
		mockApiFetchByPath( {
			failing: '/fair-events/v1/event-dates/42/finance',
		} );
		renderTab();

		expect(
			await screen.findByText(
				'The event result could not be loaded. Server exploded.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByTestId( 'finance-headline' )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Try again' } )
		).toBeInTheDocument();
	} );
} );

describe( 'EventFinance — details collapsed on arrival (#2398)', () => {
	it( 'keeps every detail list closed until opened', async () => {
		mockApiFetchByPath();
		renderTab();

		await screen.findByTestId( 'finance-headline' );
		for ( const name of [
			'Online payments',
			/^Expenses/,
			/^Cash sales/,
			'Purchase attempt history',
		] ) {
			expect( screen.getByRole( 'button', { name } ) ).toHaveAttribute(
				'aria-expanded',
				'false'
			);
		}
	} );

	it( 'opens online payments with successful ones first and unsuccessful attempts still collapsed', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
			failedTransactions: [ failedTransaction ],
		} );
		renderTab();

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Online payments' } )
		);

		expect(
			await screen.findByRole( 'link', { name: '€45.00' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=1'
		);
		expect( screen.getByRole( 'link', { name: '#5' } ) ).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-entries&entry_id=5'
		);

		const failed = screen.getByRole( 'button', {
			name: 'Failed, expired or canceled attempt (1)',
		} );
		expect( failed ).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen.queryByText( 'Failed attempt' )
		).not.toBeInTheDocument();

		fireEvent.click( failed );
		expect(
			await screen.findByText( 'Failed attempt' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Failed' ) ).toBeInTheDocument();
	} );

	it( 'opens expenses with date, amount, how and by whom each was paid', async () => {
		mockApiFetchByPath( { costEntries: [ dinner, bankCost ] } );
		renderTab();

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Expenses (€277.97)',
			} )
		);

		const table = within(
			await screen.findByRole( 'table', { name: 'Expenses' } )
		);
		const dinnerRow = table.getByText( 'Dinner' ).closest( 'tr' );
		expect( dinnerRow ).toHaveTextContent( '2026-07-19' );
		expect( dinnerRow ).toHaveTextContent( '−€15.00' );
		expect( dinnerRow ).toHaveTextContent( 'Personal funds' );
		expect( dinnerRow ).toHaveTextContent( 'Sayli' );

		const bankRow = table.getByText( 'Venue' ).closest( 'tr' );
		expect( bankRow ).toHaveTextContent( 'Bank (Main account)' );
		expect(
			within( bankRow ).getByRole( 'link', {
				name: 'Open in Fair Finance',
			} )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-entries&entry_id=10'
		);
		expect(
			within( bankRow ).queryByRole( 'button', { name: 'Edit' } )
		).not.toBeInTheDocument();

		expect(
			calledPaths().filter( ( path ) =>
				path.includes( 'entry_type=cost' )
			)
		).toHaveLength( 1 );
	} );
} );

describe( 'EventFinance — plugin availability (#2110)', () => {
	it( 'payments only: no Fair Finance request, section or link', async () => {
		mockApiFetchByPath( {
			paidTransactions: [ paidTransactionWithEntry ],
		} );
		renderTab( { financeActive: false, financeManageable: false } );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Online payments' } )
		);
		await screen.findByRole( 'link', { name: '€45.00' } );

		expect( screen.queryByText( 'Budget entry' ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Budget' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /^Expenses/ } )
		).not.toBeInTheDocument();
		expect(
			calledPaths().some(
				( path ) =>
					path.startsWith( '/fair-finance/' ) ||
					path.endsWith( '/budget' )
			)
		).toBe( false );
	} );

	it( 'Fair Finance only: no payment request or payments section', async () => {
		mockApiFetchByPath( { budgets: [ budgetA ] } );
		renderTab( { connectorActive: false } );

		await screen.findByText( 'Summer camp' );
		expect(
			screen.queryByRole( 'button', { name: 'Online payments' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'View All Entries' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-entries&event_date_id=42'
		);
		expect(
			calledPaths().some( ( path ) =>
				path.startsWith( '/fair-payments-connector/' )
			)
		).toBe( false );
	} );

	it( 'disables the budget controls when budgets fail to load', async () => {
		mockApiFetchByPath( { failing: '/fair-finance/v1/budgets' } );
		renderTab();

		expect(
			await screen.findByText(
				'Budgets could not be loaded. Server exploded.'
			)
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Budget' ) ).toBeDisabled();
		// The event result still shows.
		expect( headline( 'Net event result' ) ).toBe( '€3,609.22' );
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
