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

	it( 'picks an existing tag from the keyboard and saves it', async () => {
		const onSave = jest.fn();
		renderForm( { onSave } );
		const tag = field( 'Tag' );

		fireEvent.focus( tag );
		fireEvent.change( tag, { target: { value: 'cat' } } );
		const suggestion = screen.getByRole( 'button', { name: 'catering' } );
		// Tabbing to the suggestion must not close the list under it.
		fireEvent.blur( tag, { relatedTarget: suggestion } );
		suggestion.focus();
		fireEvent.keyDown( suggestion, { key: 'Enter' } );

		expect( tag ).toHaveValue( 'catering' );
		expect( tag ).toHaveFocus();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Update Entry' } )
		);

		await waitFor( () => expect( onSave ).toHaveBeenCalled() );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].data.tag ).toBe( 'catering' );
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

	describe( 'bank imports', () => {
		const IMPORTED = {
			...OTHER_ENTRY,
			id: 77,
			external_reference: 'import_2026-04-02_7_-30',
			imported_at: '2026-04-03 10:00:00',
			bank_account_id: 4,
			bank_origin: { account: { id: 4, name: 'Main account' } },
		};

		const renderImported = ( entry, onSave = jest.fn() ) =>
			renderForm( { entry, onSave, eventsEnabled: false } );

		it( 'shows the bank origin read-only instead of the payment source', () => {
			renderImported( IMPORTED );

			expect(
				screen.getByText( 'Bank import — Main account' )
			).toBeInTheDocument();
			expect( screen.queryByLabelText( 'Paid from' ) ).toBeNull();
			expect( screen.queryByLabelText( 'Paid by' ) ).toBeNull();
			expect(
				screen.queryByRole( 'option', { name: 'Event cash' } )
			).toBeNull();
			expect(
				screen.queryByRole( 'option', { name: 'Personal funds' } )
			).toBeNull();
		} );

		it( 'says the account is unknown when the import has none', () => {
			renderImported( {
				...IMPORTED,
				bank_account_id: null,
				bank_origin: { account: null },
			} );

			expect(
				screen.getByText( 'Bank import — account unknown' )
			).toBeInTheDocument();
		} );

		it( 'saves accounting edits without sending a payment source', async () => {
			const onSave = jest.fn();
			renderImported( IMPORTED, onSave );

			fireEvent.change( field( 'Description' ), {
				target: { value: 'Room hire' },
			} );
			fireEvent.change( field( 'Budget Category' ), {
				target: { value: '1' },
			} );
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Update Entry' } )
			);

			await waitFor( () => expect( onSave ).toHaveBeenCalled() );
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-finance/v1/financial-entries/77',
				method: 'PUT',
				data: {
					amount: 30,
					entry_type: 'cost',
					entry_date: '2026-04-02',
					description: 'Room hire',
					budget_id: 1,
					event_url: null,
					event_date_id: null,
					tag: 'catering',
				},
			} );
		} );

		it( 'explains a classification recorded before protection', () => {
			renderImported( {
				...IMPORTED,
				payment_source: 'personal_funds',
				payer_name: 'Ana',
			} );

			expect(
				document.querySelector( '.components-notice' )
			).toHaveTextContent(
				'This bank import was recorded as paid from personal funds by Ana before bank imports were protected. That record is kept as it is and cannot be changed here.'
			);
			expect( screen.queryByLabelText( 'Paid from' ) ).toBeNull();
		} );

		it( 'keeps the payment-source selector for manual entries', () => {
			renderForm( { entry: OTHER_ENTRY, eventsEnabled: false } );

			expect( field( 'Paid from' ) ).toHaveValue( '' );
			expect(
				screen.queryByText( /^Bank import —/ )
			).not.toBeInTheDocument();
		} );
	} );
} );
