/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { Profiler } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EntryForm from '../EntryForm.js';

jest.mock( '@wordpress/api-fetch' );

const BUDGETS = [
	{ id: 1, name: 'Venue' },
	{ id: 2, name: 'Catering' },
];

const ENTRY = {
	id: 42,
	amount: 125.5,
	entry_type: 'income',
	entry_date: '2026-03-14',
	description: 'Workshop fees',
	budget_id: 1,
	event_url: 'https://example.com/events/workshop',
	event_date_id: 7,
	tag: 'workshops',
	payment_source: 'event_cash',
	payer_name: '',
};

const OTHER_ENTRY = {
	id: 43,
	amount: 30,
	entry_type: 'cost',
	entry_date: '2026-04-02',
	description: 'Coffee',
	budget_id: 2,
	event_url: '',
	event_date_id: null,
	tag: 'catering',
	payment_source: '',
	payer_name: '',
};

const today = () => new Date().toISOString().split( 'T' )[ 0 ];

const renderForm = ( props = {} ) =>
	render(
		<EntryForm
			entry={ ENTRY }
			budgets={ BUDGETS }
			eventsEnabled
			tags={ [ 'workshops', 'catering' ] }
			onSave={ jest.fn() }
			onCancel={ jest.fn() }
			{ ...props }
		/>
	);

// Testing Library flushes effects before returning, so the first committed
// render is only observable from inside the commit. A Profiler's onRender
// runs there, before passive effects (where the old form loaded the entry).
const renderWithFirstCommit = ( element, onFirstCommit ) => {
	let committed = false;
	return render(
		<Profiler
			id="entry-form"
			onRender={ ( id, phase ) => {
				if ( 'mount' === phase && ! committed ) {
					committed = true;
					onFirstCommit();
				}
			} }
		>
			{ element }
		</Profiler>
	);
};

const field = ( name ) => screen.getByLabelText( name );

const expectEntryValues = ( entry ) => {
	expect( field( 'Type' ) ).toHaveValue( entry.entry_type );
	expect( field( 'Amount' ) ).toHaveValue( entry.amount );
	expect( field( 'Date' ) ).toHaveValue( entry.entry_date );
	expect( field( 'Description' ) ).toHaveValue( entry.description );
	expect( field( 'Tag' ) ).toHaveValue( entry.tag );
};

describe( 'EntryForm', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( {} );
	} );

	it( 'shows the entry values in its first committed render', () => {
		const firstRender = {};
		renderWithFirstCommit(
			<EntryForm
				entry={ ENTRY }
				budgets={ BUDGETS }
				eventsEnabled
				tags={ [] }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
			/>,
			() => {
				firstRender.amount = field( 'Amount' ).value;
				firstRender.description = field( 'Description' ).value;
				firstRender.budget = field( 'Budget Category' ).value;
			}
		);

		expect( firstRender ).toEqual( {
			amount: '125.5',
			description: 'Workshop fees',
			budget: '1',
		} );
	} );

	it( 'keeps the loaded values when a field changes as the dialog opens', async () => {
		const onSave = jest.fn();
		renderWithFirstCommit(
			// The link field's mount-time search reset would run outside
			// act() after an in-commit event; the race is not about it.
			<EntryForm
				entry={ ENTRY }
				budgets={ BUDGETS }
				eventsEnabled={ false }
				tags={ [] }
				onSave={ onSave }
				onCancel={ jest.fn() }
			/>,
			() => {
				fireEvent.change( field( 'Budget Category' ), {
					target: { value: '2' },
				} );
			}
		);

		expect( field( 'Budget Category' ) ).toHaveValue( '2' );
		expectEntryValues( ENTRY );

		const update = screen.getByRole( 'button', { name: 'Update Entry' } );
		expect( update ).toBeEnabled();
		fireEvent.click( update );

		await waitFor( () => expect( onSave ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/financial-entries/42',
			method: 'PUT',
			data: {
				amount: 125.5,
				entry_type: 'income',
				entry_date: '2026-03-14',
				description: 'Workshop fees',
				budget_id: 2,
				event_url: 'https://example.com/events/workshop',
				event_date_id: 7,
				tag: 'workshops',
				payment_source: 'event_cash',
				payer_name: null,
			},
		} );
	} );

	it( 'starts a new entry from the defaults and creates it', async () => {
		const onSave = jest.fn();
		renderForm( { entry: null, onSave } );

		expect( field( 'Type' ) ).toHaveValue( 'cost' );
		expect( field( 'Amount' ) ).toHaveValue( null );
		expect( field( 'Date' ) ).toHaveValue( today() );
		expect( field( 'Description' ) ).toHaveValue( '' );
		expect( field( 'Budget Category' ) ).toHaveValue( '' );

		const create = screen.getByRole( 'button', { name: 'Create Entry' } );
		expect( create ).toBeDisabled();

		fireEvent.change( field( 'Amount' ), { target: { value: '12' } } );
		fireEvent.change( field( 'Description' ), {
			target: { value: 'Printer paper' },
		} );
		fireEvent.click( create );

		await waitFor( () => expect( onSave ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/financial-entries',
			method: 'POST',
			data: {
				amount: 12,
				entry_type: 'cost',
				entry_date: today(),
				description: 'Printer paper',
				budget_id: null,
				event_url: null,
				event_date_id: null,
				tag: null,
				payment_source: null,
				payer_name: null,
			},
		} );
	} );

	it( 'shows the next entry when reopened for a different entry', () => {
		const { unmount } = renderForm();
		expectEntryValues( ENTRY );
		unmount();

		renderForm( { entry: OTHER_ENTRY } );
		expectEntryValues( OTHER_ENTRY );
		expect( field( 'Budget Category' ) ).toHaveValue( '2' );
	} );

	it( 'keeps the link and its event date together', async () => {
		const onSave = jest.fn();
		renderForm( { onSave } );

		fireEvent.change( field( 'Description' ), {
			target: { value: 'Workshop fees, March' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Update Entry' } )
		);

		await waitFor( () => expect( onSave ).toHaveBeenCalled() );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].data ).toMatchObject( {
			description: 'Workshop fees, March',
			event_url: null,
			event_date_id: null,
			amount: 125.5,
			budget_id: 1,
		} );
	} );
} );
