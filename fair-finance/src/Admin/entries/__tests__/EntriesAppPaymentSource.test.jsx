/**
 * Event cash and personally paid entries in Fair Finance accounting (#2272).
 *
 * Classified entries stay identifiable in the general list and editor, the
 * editor keeps their source and payer, and splitting or matching — which
 * would change what the entry means — is not offered for them.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EntryForm from '../components/EntryForm.js';

jest.mock( '@wordpress/api-fetch' );

const PERSONAL = {
	id: 21,
	entry_date: '2026-11-13',
	entry_type: 'cost',
	amount: 30,
	description: 'Decorations',
	budget_id: 4,
	event_url: null,
	event_date_id: 42,
	tag: null,
	parent_entry_id: null,
	transaction_ids: [],
	payment_source: 'personal_funds',
	payer_name: 'Anna',
	imported_at: null,
};

const LEGACY = {
	...PERSONAL,
	id: 22,
	description: 'Old cost',
	payment_source: null,
	payer_name: null,
};

let EntriesApp;

beforeAll( () => {
	EntriesApp = require( '../EntriesApp.js' ).default;
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const mockList = ( entries ) =>
	apiFetch.mockImplementation( ( { path } ) => {
		const route = path.split( '?' )[ 0 ];
		switch ( route ) {
			case '/fair-finance/v1/financial-entries':
				return Promise.resolve( {
					entries,
					total: entries.length,
					pages: 1,
				} );
			case '/fair-finance/v1/financial-entries/totals':
				return Promise.resolve( {
					total_cost: 0,
					total_income: 0,
					balance: 0,
				} );
			case '/fair-finance/v1/financial-entries/totals-by-tag':
				return Promise.resolve( {} );
			case '/fair-finance/v1/financial-entries/unbudgeted-count':
				return Promise.resolve( { count: 0 } );
			default:
				return Promise.resolve( [] );
		}
	} );

describe( 'EntriesApp — payment source', () => {
	it( 'labels a personally paid entry and offers no split or match', async () => {
		mockList( [ PERSONAL, LEGACY ] );
		render( <EntriesApp /> );

		const note = await screen.findByText( 'Personal funds, paid by Anna' );
		const row = note.closest( 'tr' );
		expect(
			within( row ).getByRole( 'button', { name: 'Edit “Decorations”' } )
		).toBeInTheDocument();

		const menuItems = async ( entry ) => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: `More actions for “${ entry }”`,
				} )
			);
			const menu = await screen.findByRole( 'menu', {
				name: `More actions for “${ entry }”`,
			} );
			const labels = within( menu )
				.getAllByRole( 'menuitem' )
				.map( ( item ) => item.textContent );
			await act( async () => {
				fireEvent.keyDown( menu, { key: 'Escape' } );
			} );
			return labels;
		};

		// Event cash and personally paid entries are neither split nor matched.
		expect( await menuItems( 'Decorations' ) ).toEqual( [ 'Delete' ] );

		const legacyRow = screen.getByText( 'Old cost' ).closest( 'tr' );
		expect( legacyRow ).not.toHaveTextContent( 'Event cash' );
		expect( legacyRow ).not.toHaveTextContent( 'Personal funds' );
		expect( await menuItems( 'Old cost' ) ).toEqual( [
			'Split',
			'Match',
			'Delete',
		] );
	} );
} );

describe( 'EntryForm — payment source', () => {
	const renderForm = ( entry ) =>
		render(
			<EntryForm
				entry={ entry }
				budgets={ [ { id: 4, name: 'Party' } ] }
				eventsEnabled={ false }
				tags={ [] }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);

	const submit = async () => {
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Update Entry' } )
			);
		} );
	};

	it( 'keeps the source and payer when other fields are edited', async () => {
		apiFetch.mockResolvedValue( {} );
		renderForm( PERSONAL );

		expect( screen.getByLabelText( 'Paid from' ) ).toHaveValue(
			'personal_funds'
		);
		expect( screen.getByLabelText( 'Paid by' ) ).toHaveValue( 'Anna' );
		fireEvent.change( screen.getByLabelText( 'Amount' ), {
			target: { value: '35' },
		} );
		await submit();

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				method: 'PUT',
				path: '/fair-finance/v1/financial-entries/21',
				data: expect.objectContaining( {
					amount: 35,
					payment_source: 'personal_funds',
					payer_name: 'Anna',
					event_date_id: 42,
				} ),
			} )
		);
	} );

	it( 'leaves a legacy entry unspecified', async () => {
		apiFetch.mockResolvedValue( {} );
		renderForm( LEGACY );

		expect( screen.getByLabelText( 'Paid from' ) ).toHaveValue( '' );
		expect( screen.queryByLabelText( 'Paid by' ) ).toBeNull();
		await submit();

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: expect.objectContaining( {
					payment_source: null,
					payer_name: null,
				} ),
			} )
		);
	} );

	it( 'offers no personal funds option for income', () => {
		renderForm( { ...LEGACY, entry_type: 'income' } );
		const options = within( screen.getByLabelText( 'Paid from' ) )
			.getAllByRole( 'option' )
			.map( ( option ) => option.textContent );
		expect( options ).toEqual( [ 'Unspecified', 'Event cash' ] );
	} );
} );
