/**
 * @jest-environment jsdom
 *
 * Component tests for the Budget select in the Create Fee dialog (#1802):
 * budgets come from Fair Finance each time the dialog opens, the chosen
 * budget is sent as an integer ID, and a load that is running, empty or
 * failed each looks different while a fee can still be created without a
 * budget.
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
function mockApi( { budgets = () => Promise.resolve( BUDGETS ) } = {} ) {
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
		if ( path.startsWith( FEES_PATH ) ) {
			return Promise.resolve( {
				headers: { get: () => '0' },
				json: () => Promise.resolve( [] ),
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

const budgetSelect = ( dialog ) =>
	within( dialog ).getByRole( 'combobox', { name: 'Budget' } );

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

	it( 'says Fair Finance is not active when the budgets route is missing', async () => {
		mockApi( {
			budgets: () =>
				Promise.reject( {
					code: 'rest_no_route',
					message: 'No route was found matching the URL.',
				} ),
		} );
		render( <FeesList /> );

		const dialog = await openCreateDialog();
		expect(
			await within( dialog ).findByText(
				'Budgets are unavailable because Fair Finance is not active.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( STILL_CREATABLE )
		).toBeInTheDocument();
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
