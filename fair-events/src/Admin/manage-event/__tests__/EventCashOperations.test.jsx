/**
 * @jest-environment jsdom
 *
 * Expenses and cash sales on the Finance tab (#2272, #2398).
 *
 * Every expense of the event is listed once, with how and by whom it was
 * paid; cash sales are the income recorded as event cash. Both lists are
 * collapsed on arrival, and their totals come from the finance summary.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
	act,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventFinance from '../EventFinance.js';
import CashOperationForm, { validateOperation } from '../CashOperationForm.js';

jest.mock( '@wordpress/api-fetch' );

const SUMMARY = {
	currency: 'EUR',
	state: 'incomplete',
	issues: [ 'online_unavailable' ],
	sales: { total: 115, online: null, cash: 115 },
	costs: {
		total: 50,
		expenses: {
			total: 50,
			event_cash: 20,
			personal: 30,
			bank: 0,
			unclassified: 0,
			personal_by_payer: [ { payer_name: 'Anna', amount: 30 } ],
		},
		payment_fees: null,
	},
	net_result: 65,
	payout: null,
};

const INCOME = {
	id: 11,
	entry_type: 'income',
	amount: 115,
	entry_date: '2026-11-13',
	description: 'Gate sales Friday',
	event_date_id: 42,
	payment_source: 'event_cash',
	payer_name: null,
	budget_id: 3,
	event_url: null,
	tag: 'gate',
};

const PERSONAL = {
	id: 12,
	entry_type: 'cost',
	amount: 30,
	entry_date: '2026-11-13',
	description: 'Decorations',
	event_date_id: 42,
	payment_source: 'personal_funds',
	payer_name: 'Anna',
};

function mockApi( {
	summary = SUMMARY,
	costs = [ PERSONAL ],
	incomes = [ INCOME ],
	pages = 1,
	failing = null,
	onWrite = () => Promise.resolve( {} ),
} = {} ) {
	apiFetch.mockImplementation( ( options ) => {
		const { path, method } = options;
		if ( failing && path.startsWith( failing ) && ! method ) {
			return Promise.reject( { message: 'Server exploded.' } );
		}
		if ( method && 'GET' !== method ) {
			return onWrite( options );
		}
		if ( /\/finance-summary$/.test( path ) ) {
			return Promise.resolve( summary );
		}
		if ( path.startsWith( '/fair-finance/v1/financial-entries' ) ) {
			const entries = path.includes( 'entry_type=cost' )
				? costs
				: incomes;
			return Promise.resolve( {
				entries,
				total: entries.length,
				pages,
			} );
		}
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( [] );
		}
		if ( /\/budget$/.test( path ) ) {
			return Promise.resolve( { budget_id: null } );
		}
		return Promise.resolve( { transactions: [] } );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

function renderTab( props = {} ) {
	return render(
		<EventFinance
			eventDateId={ 42 }
			connectorActive={ false }
			financeActive
			financeManageable
			entriesUrl="admin.php?page=fair-finance-entries"
			defaultEntryDate="2026-11-13"
			{ ...props }
		/>
	);
}

const summaryCalls = () =>
	apiFetch.mock.calls.filter( ( [ { path } ] ) =>
		path.includes( 'finance-summary' )
	).length;

async function openList( name ) {
	const toggle = await screen.findByRole( 'button', { name } );
	// Opening loads the list: let that load settle inside act.
	await act( async () => {
		fireEvent.click( toggle );
	} );
}

describe( 'Expenses and cash sales section', () => {
	it( 'names each list with its total and keeps both closed', async () => {
		mockApi();
		renderTab();

		expect(
			await screen.findByRole( 'button', { name: 'Expenses (€50.00)' } )
		).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen.getByRole( 'button', { name: 'Cash sales (€115.00)' } )
		).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			apiFetch.mock.calls.some( ( [ { path } ] ) =>
				path.startsWith( '/fair-finance/v1/financial-entries' )
			)
		).toBe( false );
	} );

	it( 'states the net event cash movement', async () => {
		mockApi();
		renderTab();

		expect(
			await screen.findByTestId( 'event-cash-movement' )
		).toHaveTextContent(
			'Event cash: €115.00 received, €20.00 paid out, €95.00 net cash movement.'
		);
	} );

	it( 'is hidden from users who cannot manage finance entries', async () => {
		mockApi();
		renderTab( { financeManageable: false } );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect( screen.queryByText( 'Expenses and cash sales' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Add expense' } )
		).toBeNull();
	} );
} );

describe( 'Operation lists', () => {
	it( 'lists every expense with source, payer, note and amount', async () => {
		mockApi();
		renderTab();
		await openList( 'Expenses (€50.00)' );

		const table = await screen.findByRole( 'table', { name: 'Expenses' } );
		const rows = within( table ).getAllByRole( 'row' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Expense, personal funds' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Decorations' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Personal funds' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Anna' );
		expect( rows[ 1 ] ).toHaveTextContent( '−€30.00' );
		const path = apiFetch.mock.calls
			.map( ( [ options ] ) => options.path )
			.find( ( p ) => p.includes( 'entry_type=cost' ) );
		// Every expense, not only those recorded on this tab.
		expect( path ).not.toContain( 'classified' );
	} );

	it( 'lists cash sales recorded as event cash', async () => {
		mockApi();
		renderTab();
		await openList( 'Cash sales (€115.00)' );

		const table = await screen.findByRole( 'table', {
			name: 'Cash sales',
		} );
		expect( table ).toHaveTextContent( 'Gate sales Friday' );
		expect( table ).toHaveTextContent( '€115.00' );
		expect(
			apiFetch.mock.calls.some( ( [ { path } ] ) =>
				path.includes( 'entry_type=income&classified=1' )
			)
		).toBe( true );
	} );

	it( 'shows pagination when there are several pages', async () => {
		mockApi( { pages: 3 } );
		renderTab();
		await openList( 'Expenses (€50.00)' );

		expect(
			await screen.findByRole( 'navigation', {
				name: 'Expenses pages',
			} )
		).toHaveTextContent( 'Page 1 of 3' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Next page' } ) );
		await waitFor( () =>
			expect(
				apiFetch.mock.calls.some(
					( [ { path } ] ) =>
						path.includes( 'entry_type=cost' ) &&
						path.includes( 'page=2' )
				)
			).toBe( true )
		);
	} );

	it( 'deletes an operation after confirmation and refreshes the event result', async () => {
		const onWrite = jest.fn( () => Promise.resolve( { deleted: true } ) );
		mockApi( { onWrite } );
		renderTab();
		await openList( 'Expenses (€50.00)' );

		await screen.findByRole( 'table', { name: 'Expenses' } );
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'More actions for “Expense, personal funds of €30.00 on 2026-11-13”',
			} )
		);
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: 'Delete' } )
		);

		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete expense',
		} );
		expect( dialog ).toHaveTextContent( 'Paid by Anna.' );
		const before = summaryCalls();

		await act( async () => {
			fireEvent.click(
				within( dialog ).getByRole( 'button', {
					name: 'Delete expense',
				} )
			);
		} );

		expect( onWrite ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-finance/v1/financial-entries/12',
				method: 'DELETE',
			} )
		);
		expect(
			await screen.findByText( 'Expense deleted.', {
				selector: '.components-notice__content',
			} )
		).toBeVisible();
		await waitFor( () => expect( summaryCalls() ).toBe( before + 1 ) );
	} );

	it( 'keeps the confirmation open with the error when deleting fails', async () => {
		mockApi( {
			onWrite: () => Promise.reject( { message: 'Database is gone.' } ),
		} );
		renderTab();
		await openList( 'Cash sales (€115.00)' );

		await screen.findByRole( 'table', { name: 'Cash sales' } );
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'More actions for “Cash income of €115.00 on 2026-11-13”',
			} )
		);
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: 'Delete' } )
		);
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete income',
		} );
		await act( async () => {
			fireEvent.click(
				within( dialog ).getByRole( 'button', {
					name: 'Delete income',
				} )
			);
		} );
		expect(
			within( dialog ).getByText( 'Database is gone.' )
		).toBeVisible();
	} );
} );

describe( 'CashOperationForm', () => {
	const typeInto = ( label, value ) =>
		fireEvent.change( screen.getByLabelText( label ), {
			target: { value },
		} );

	it( 'records €115 cash income for the event date by default', async () => {
		const onSaved = jest.fn();
		apiFetch.mockResolvedValue( { ...INCOME } );
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entryType="income"
				defaultDate="2026-11-13"
				onSaved={ onSaved }
				onCancel={ jest.fn() }
			/>
		);

		expect( screen.getByLabelText( 'Date' ) ).toHaveValue( '2026-11-13' );
		typeInto( 'Amount (EUR)', '115' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save income' } )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/financial-entries',
			method: 'POST',
			data: {
				amount: 115,
				entry_type: 'income',
				entry_date: '2026-11-13',
				description: '',
				event_date_id: 42,
				payment_source: 'event_cash',
				payer_name: null,
			},
		} );
		expect( onSaved ).toHaveBeenCalled();
	} );

	it( 'requires a date when the event has none', () => {
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entryType="income"
				defaultDate=""
				onSaved={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);
		typeInto( 'Amount (EUR)', '10' );
		expect( screen.getByLabelText( 'Date' ) ).toHaveValue( '' );
		expect(
			screen.getByText(
				'This event has no date yet, so choose the operation’s date.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save income' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Choose the date of the operation.' )
		).toBeInTheDocument();
	} );

	it( 'requires a note for expenses and a payer for personal funds', () => {
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entryType="cost"
				defaultDate="2026-11-13"
				onSaved={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);
		typeInto( 'Amount (EUR)', '30' );
		expect( screen.queryByLabelText( 'Paid by' ) ).toBeNull();
		expect(
			screen.getByText( 'Enter a note explaining the expense.' )
		).toBeInTheDocument();

		typeInto( 'Note', 'Decorations' );
		fireEvent.click( screen.getByLabelText( 'Personal funds' ) );
		expect( screen.getByLabelText( 'Paid by' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Enter the name of the person who paid.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save expense' } )
		).toHaveAttribute( 'aria-disabled', 'true' );

		typeInto( 'Paid by', 'Anna' );
		expect(
			screen.getByRole( 'button', { name: 'Save expense' } )
		).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'rejects invalid amounts with an actionable message', () => {
		expect(
			validateOperation( {
				entry_type: 'income',
				amount: '12.345',
				entry_date: '2026-11-13',
			} ).amount
		).toMatch( /at most two decimals/ );
		expect(
			validateOperation( {
				entry_type: 'income',
				amount: '0',
				entry_date: '2026-11-13',
			} ).amount
		).toMatch( /greater than zero/ );
		expect(
			validateOperation( {
				entry_type: 'income',
				amount: 'abc',
				entry_date: '2026-11-13',
			} ).amount
		).toMatch( /as a number/ );
		expect(
			validateOperation( {
				entry_type: 'income',
				amount: '12,50',
				entry_date: '2026-11-13',
			} )
		).toEqual( {} );
	} );

	it( 'keeps every value and shows the server message when saving fails', async () => {
		apiFetch.mockRejectedValue( {
			message: 'Enter the name of the person who paid.',
		} );
		const onSaved = jest.fn();
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entryType="cost"
				defaultDate="2026-11-13"
				onSaved={ onSaved }
				onCancel={ jest.fn() }
			/>
		);
		typeInto( 'Amount (EUR)', '30' );
		typeInto( 'Note', 'Decorations' );
		fireEvent.click( screen.getByLabelText( 'Personal funds' ) );
		typeInto( 'Paid by', 'Anna' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save expense' } )
			);
		} );

		expect(
			await screen.findByText( 'Enter the name of the person who paid.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( onSaved ).not.toHaveBeenCalled();
		expect( screen.getByLabelText( 'Amount (EUR)' ) ).toHaveValue( '30' );
		expect( screen.getByLabelText( 'Note' ) ).toHaveValue( 'Decorations' );
		expect( screen.getByLabelText( 'Paid by' ) ).toHaveValue( 'Anna' );
		expect( screen.getByLabelText( 'Personal funds' ) ).toBeChecked();
	} );

	it( 'edits an entry with PUT, keeping its budget, link and tag', async () => {
		apiFetch.mockResolvedValue( { ...INCOME, amount: 120 } );
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entry={ INCOME }
				defaultDate="2026-11-13"
				onSaved={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);
		expect(
			screen.getByRole( 'dialog', { name: 'Edit income' } )
		).toBeInTheDocument();
		typeInto( 'Amount (EUR)', '120' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save income' } )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-finance/v1/financial-entries/11',
				method: 'PUT',
				data: expect.objectContaining( {
					amount: 120,
					event_date_id: 42,
					payment_source: 'event_cash',
					budget_id: 3,
					tag: 'gate',
				} ),
			} )
		);
	} );

	it( 'submits only once on a double click', async () => {
		let resolve;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( r ) => {
					resolve = r;
				} )
		);
		render(
			<CashOperationForm
				eventDateId={ 42 }
				entryType="income"
				defaultDate="2026-11-13"
				onSaved={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);
		typeInto( 'Amount (EUR)', '115' );
		const button = screen.getByRole( 'button', { name: 'Save income' } );
		fireEvent.click( button );
		fireEvent.click( button );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		await act( async () => resolve( INCOME ) );
	} );
} );
