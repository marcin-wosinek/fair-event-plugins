/**
 * @jest-environment jsdom
 *
 * Component tests for the Budget select in the Create Fee and Edit Fee
 * dialogs (#1802): budgets come from Fair Finance each time a dialog opens,
 * the chosen budget is sent as an integer ID, and a load that is running,
 * empty or failed each looks different while a fee can still be created
 * without a budget. Editing changes or clears the budget only when the
 * administrator picks another one, and the budget controls are left out
 * while Fair Finance is not active.
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
import FeesList from '../FeesList.js';

jest.mock( '@wordpress/api-fetch' );

const FEES_PATH = '/fair-audience/v1/fees';
const GROUPS_PATH = '/fair-audience/v1/groups';
const BUDGETS_PATH = '/fair-finance/v1/budgets';
const STALE_BUDGETS_PATH = '/fair-payments-connector/v1/budgets';

const GROUPS = [ { id: 3, name: 'Members' } ];
const BUDGETS = [
	{ id: 11, name: 'Membership income' },
	{ id: 12, name: 'Events' },
];

const EMPTY_MESSAGE =
	'There are no budgets yet. Add one in Fair Finance to link fees to it.';
const FAILURE_MESSAGE = 'Budgets could not be loaded.';
const STILL_CREATABLE = 'You can still create this fee without a budget.';
const UNAVAILABLE_MESSAGE =
	'Budgets are unavailable because Fair Finance is not active.';
const BUDGET_HELP = 'Optionally link to a budget for financial tracking.';
const KEEPS_BUDGET =
	'The fee keeps its current budget unless you choose another.';
const MISSING_BUDGET_HELP =
	'The budget this fee is linked to is not in the list. The fee stays linked to it unless you choose another.';

const LINKED_FEE = {
	id: 7,
	name: 'Membership 2025',
	description: 'Yearly fee',
	group_name: 'Members',
	budget_id: 12,
	budget_name: 'Events',
	amount: '25.00',
	currency: 'EUR',
	due_date: '2025-12-31',
	status: 'active',
	member_count: 0,
	pending_count: 0,
	paid_count: 0,
};
const UNLINKED_FEE = { ...LINKED_FEE, budget_id: null, budget_name: null };

const NO_ROUTE = () =>
	Promise.reject( {
		code: 'rest_no_route',
		message: 'No route was found matching the URL.',
	} );

/** A promise the test settles by hand, to hold a request in flight. */
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
}

/**
 * Route apiFetch by path. `budgets` is called on every budget load, so a test
 * can change what the next load returns.
 */
function mockApi( {
	budgets = () => Promise.resolve( BUDGETS ),
	fees = [],
} = {} ) {
	const state = { budgets };
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === BUDGETS_PATH ) {
			return state.budgets();
		}
		if ( path === GROUPS_PATH ) {
			return Promise.resolve( GROUPS );
		}
		if ( path === FEES_PATH && method === 'POST' ) {
			return Promise.resolve( { id: 50 } );
		}
		if ( path.startsWith( `${ FEES_PATH }/` ) && method === 'PUT' ) {
			return Promise.resolve( { id: 7 } );
		}
		if ( path.startsWith( FEES_PATH ) ) {
			return Promise.resolve( {
				headers: { get: () => String( fees.length ) },
				json: () => Promise.resolve( fees ),
			} );
		}
		return Promise.reject( new Error( `Unexpected request: ${ path }` ) );
	} );
	return state;
}

const callsTo = ( path, method ) =>
	apiFetch.mock.calls.filter(
		( [ options ] ) =>
			options.path === path &&
			( method === undefined || options.method === method )
	);

async function openCreateDialog() {
	fireEvent.click( screen.getByRole( 'button', { name: 'Create Fee' } ) );
	return screen.findByRole( 'dialog', { name: 'Create Fee' } );
}

/** Open Edit Fee for the only listed fee, through its row actions. */
async function openEditDialog() {
	await screen.findByRole( 'link', { name: 'Membership 2025' } );
	const direct = screen.queryByRole( 'button', { name: 'Edit' } );
	if ( direct ) {
		fireEvent.click( direct );
	} else {
		fireEvent.click( screen.getByRole( 'button', { name: 'Actions' } ) );
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: 'Edit' } )
		);
	}
	return screen.findByRole( 'dialog', { name: 'Edit Fee' } );
}

/** Press Update and return the body of the fee update. */
async function update( dialog ) {
	fireEvent.click(
		within( dialog ).getByRole( 'button', { name: 'Update' } )
	);
	const path = `${ FEES_PATH }/${ LINKED_FEE.id }`;
	await waitFor( () => expect( callsTo( path, 'PUT' ) ).toHaveLength( 1 ) );
	return callsTo( path, 'PUT' )[ 0 ][ 0 ].data;
}

const budgetSelect = ( dialog ) =>
	within( dialog ).getByRole( 'combobox', { name: 'Budget' } );

const expectNoBudgetControls = ( dialog ) => {
	expect(
		within( dialog ).queryByRole( 'combobox', { name: 'Budget' } )
	).not.toBeInTheDocument();
	for ( const text of [
		BUDGET_HELP,
		UNAVAILABLE_MESSAGE,
		FAILURE_MESSAGE,
		EMPTY_MESSAGE,
		STILL_CREATABLE,
		KEEPS_BUDGET,
		'Loading budgets…',
	] ) {
		expect( within( dialog ).queryByText( text ) ).not.toBeInTheDocument();
	}
	expect(
		within( dialog ).queryByRole( 'button', { name: 'Retry' } )
	).not.toBeInTheDocument();
};

const optionLabels = ( select ) =>
	within( select )
		.getAllByRole( 'option' )
		.map( ( option ) => option.textContent );

/** Fill the required fields, leaving the budget alone. */
async function fillRequiredFields( dialog ) {
	fireEvent.change(
		within( dialog ).getByRole( 'textbox', { name: 'Name' } ),
		{
			target: { value: 'Membership 2026' },
		}
	);
	await within( dialog ).findByRole( 'option', { name: 'Members' } );
	fireEvent.change(
		within( dialog ).getByRole( 'combobox', { name: 'Group' } ),
		{
			target: { value: '3' },
		}
	);
	fireEvent.change(
		within( dialog ).getByRole( 'spinbutton', { name: 'Amount' } ),
		{ target: { value: '25' } }
	);
}

async function submit( dialog ) {
	fireEvent.click(
		within( dialog ).getByRole( 'button', { name: 'Create' } )
	);
	await waitFor( () =>
		expect( callsTo( FEES_PATH, 'POST' ) ).toHaveLength( 1 )
	);
	return callsTo( FEES_PATH, 'POST' )[ 0 ][ 0 ].data;
}

beforeEach( () => {
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	// jsdom has no CSS.supports, which the row actions menu asks for.
	window.CSS = { ...window.CSS, supports: () => false };
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'FeesList — loading budgets for a new fee', () => {
	it( 'asks Fair Finance for budgets when the dialog opens and lists them by name', async () => {
		mockApi();
		render( <FeesList /> );

		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 0 );
		const dialog = await openCreateDialog();

		await within( dialog ).findByRole( 'option', {
			name: 'Membership income',
		} );
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
			'Membership income',
			'Events',
		] );
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 1 );
		expect( callsTo( STALE_BUDGETS_PATH ) ).toHaveLength( 0 );
		expect(
			within( dialog ).queryByText( EMPTY_MESSAGE )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
	} );

	it( 'shows that budgets are loading and holds the select until they arrive', async () => {
		const pending = deferred();
		mockApi( { budgets: () => pending.promise } );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		expect(
			within( dialog ).getByText( 'Loading budgets…' )
		).toBeInTheDocument();
		expect( budgetSelect( dialog ) ).toBeDisabled();

		await act( async () => {
			pending.resolve( BUDGETS );
		} );

		expect(
			within( dialog ).queryByText( 'Loading budgets…' )
		).not.toBeInTheDocument();
		expect( budgetSelect( dialog ) ).toBeEnabled();
		expect( optionLabels( budgetSelect( dialog ) ) ).toContain( 'Events' );
	} );

	it( 'loads budgets again each time the dialog opens', async () => {
		const api = mockApi( { budgets: () => Promise.resolve( [] ) } );
		render( <FeesList /> );

		let dialog = await openCreateDialog();
		await within( dialog ).findByText( EMPTY_MESSAGE );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		// A budget added in the meantime is offered without a page reload.
		api.budgets = () => Promise.resolve( BUDGETS );
		dialog = await openCreateDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 2 );
	} );
} );

describe( 'FeesList — creating a fee with or without a budget', () => {
	it( 'sends the selected budget as an integer ID', async () => {
		mockApi();
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		await fillRequiredFields( dialog );
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		fireEvent.change( budgetSelect( dialog ), { target: { value: '12' } } );
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );

		const data = await submit( dialog );
		expect( data.budget_id ).toBe( 12 );
		expect( data ).toMatchObject( {
			name: 'Membership 2026',
			group_id: 3,
			amount: 25,
		} );
	} );

	it( 'sends no budget when "No Budget" stays selected', async () => {
		mockApi();
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		await fillRequiredFields( dialog );
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		expect( budgetSelect( dialog ) ).toHaveValue( '' );

		expect( ( await submit( dialog ) ).budget_id ).toBeNull();
	} );

	it( 'does not carry a budget chosen in an earlier dialog into the next one', async () => {
		mockApi();
		render( <FeesList /> );

		let dialog = await openCreateDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		fireEvent.change( budgetSelect( dialog ), { target: { value: '12' } } );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		dialog = await openCreateDialog();
		await fillRequiredFields( dialog );
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		expect( budgetSelect( dialog ) ).toHaveValue( '' );
		expect( ( await submit( dialog ) ).budget_id ).toBeNull();
	} );
} );

describe( 'FeesList — when there are no budgets or they cannot be loaded', () => {
	it( 'says there are no budgets yet when the list is empty', async () => {
		mockApi( { budgets: () => Promise.resolve( [] ) } );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		expect(
			await within( dialog ).findByText( EMPTY_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Retry' } )
		).not.toBeInTheDocument();
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
		] );
	} );

	it( 'reports a failed load, unlike an empty list, and offers Retry', async () => {
		mockApi( {
			budgets: () => Promise.reject( new Error( 'Network error' ) ),
		} );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		expect(
			await within( dialog ).findByText( FAILURE_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( STILL_CREATABLE )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( EMPTY_MESSAGE )
		).not.toBeInTheDocument();
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
		] );
	} );

	it( 'loads the budgets when Retry succeeds', async () => {
		const api = mockApi( {
			budgets: () => Promise.reject( new Error( 'Network error' ) ),
		} );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		await within( dialog ).findByText( FAILURE_MESSAGE );

		api.budgets = () => Promise.resolve( BUDGETS );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		);

		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 2 );
	} );

	it( 'still creates an unlinked fee after budgets fail to load', async () => {
		mockApi( {
			budgets: () => Promise.reject( new Error( 'Network error' ) ),
		} );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		await within( dialog ).findByText( FAILURE_MESSAGE );
		await fillRequiredFields( dialog );

		expect( ( await submit( dialog ) ).budget_id ).toBeNull();
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );
} );

describe( 'FeesList — while Fair Finance is not active', () => {
	it( 'leaves the budget controls out of Create Fee and creates an unlinked fee', async () => {
		mockApi( { budgets: NO_ROUTE } );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		await waitFor( () => expectNoBudgetControls( dialog ) );
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 1 );

		await fillRequiredFields( dialog );
		expect( ( await submit( dialog ) ).budget_id ).toBeNull();
	} );

	it( 'leaves the budget controls out of Edit Fee and keeps the fee linked', async () => {
		mockApi( { budgets: NO_ROUTE, fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await waitFor( () => expectNoBudgetControls( dialog ) );

		const data = await update( dialog );
		expect( data ).not.toHaveProperty( 'budget_id' );
		expect( data.name ).toBe( 'Membership 2025' );
	} );

	it( 'still reports a permission failure, with Retry', async () => {
		mockApi( {
			budgets: () =>
				Promise.reject( {
					code: 'rest_forbidden',
					message: 'Sorry, you are not allowed to do that.',
				} ),
		} );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		expect(
			await within( dialog ).findByText( FAILURE_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		).toBeInTheDocument();
		expect( budgetSelect( dialog ) ).toBeInTheDocument();
	} );
} );

describe( 'FeesList — the budget of a fee being edited', () => {
	it( 'loads budgets when the dialog opens and starts on the saved budget', async () => {
		mockApi( { fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 0 );
		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', {
			name: 'Membership income',
		} );

		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 1 );
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
			'Membership income',
			'Events',
		] );
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );
	} );

	it( 'starts on "No Budget" for an unlinked fee and can link it', async () => {
		mockApi( { fees: [ UNLINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		expect( budgetSelect( dialog ) ).toHaveValue( '' );

		fireEvent.change( budgetSelect( dialog ), { target: { value: '11' } } );
		expect( ( await update( dialog ) ).budget_id ).toBe( 11 );
	} );

	it( 'sends another budget as an integer ID', async () => {
		mockApi( { fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		fireEvent.change( budgetSelect( dialog ), { target: { value: '11' } } );

		expect( ( await update( dialog ) ).budget_id ).toBe( 11 );
	} );

	it( 'sends null when "No Budget" is chosen', async () => {
		mockApi( { fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		fireEvent.change( budgetSelect( dialog ), { target: { value: '' } } );

		const data = await update( dialog );
		expect( data ).toHaveProperty( 'budget_id', null );
	} );

	it( 'leaves the budget out of the update when it was not changed', async () => {
		mockApi( { fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', { name: 'Events' } );
		fireEvent.change(
			within( dialog ).getByRole( 'textbox', { name: 'Name' } ),
			{ target: { value: 'Membership 2025 renamed' } }
		);

		const data = await update( dialog );
		expect( data ).not.toHaveProperty( 'budget_id' );
		expect( data.name ).toBe( 'Membership 2025 renamed' );
	} );

	it( 'holds the select on the saved budget while budgets load', async () => {
		const pending = deferred();
		mockApi( { budgets: () => pending.promise, fees: [ LINKED_FEE ] } );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		expect(
			within( dialog ).getByText( 'Loading budgets…' )
		).toBeInTheDocument();
		expect( budgetSelect( dialog ) ).toBeDisabled();
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );

		await act( async () => {
			pending.resolve( BUDGETS );
		} );
		expect( budgetSelect( dialog ) ).toBeEnabled();
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );
	} );

	it( 'keeps the saved budget after a failed load, with Retry', async () => {
		const api = mockApi( {
			budgets: () => Promise.reject( new Error( 'Network error' ) ),
			fees: [ LINKED_FEE ],
		} );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		expect(
			await within( dialog ).findByText( FAILURE_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( KEEPS_BUDGET )
		).toBeInTheDocument();
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
			'Events',
		] );
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );

		api.budgets = () => Promise.resolve( BUDGETS );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		);
		await within( dialog ).findByRole( 'option', {
			name: 'Membership income',
		} );
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );
	} );

	it( 'does not touch the budget when saving after a failed load', async () => {
		mockApi( {
			budgets: () => Promise.reject( new Error( 'Network error' ) ),
			fees: [ LINKED_FEE ],
		} );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByText( FAILURE_MESSAGE );

		expect( await update( dialog ) ).not.toHaveProperty( 'budget_id' );
	} );

	it( 'says there are no budgets yet and keeps the saved one selected', async () => {
		mockApi( {
			budgets: () => Promise.resolve( [] ),
			fees: [ LINKED_FEE ],
		} );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		expect(
			await within( dialog ).findByText( EMPTY_MESSAGE )
		).toBeInTheDocument();
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );
		expect( await update( dialog ) ).not.toHaveProperty( 'budget_id' );
	} );

	it( 'shows a saved budget that is missing from the list instead of clearing it', async () => {
		mockApi( {
			budgets: () => Promise.resolve( [ BUDGETS[ 0 ] ] ),
			fees: [ { ...LINKED_FEE, budget_name: null } ],
		} );
		render( <FeesList /> );

		const dialog = await openEditDialog();
		await within( dialog ).findByRole( 'option', {
			name: 'Membership income',
		} );
		expect( optionLabels( budgetSelect( dialog ) ) ).toEqual( [
			'-- No Budget --',
			'Membership income',
			'Budget #12',
		] );
		expect( budgetSelect( dialog ) ).toHaveValue( '12' );
		expect(
			within( dialog ).getByText( MISSING_BUDGET_HELP )
		).toBeInTheDocument();

		expect( await update( dialog ) ).not.toHaveProperty( 'budget_id' );
	} );
} );
