/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { Profiler } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TransferModal from '../TransferModal.js';

jest.mock( '@wordpress/api-fetch' );
// Its mount-time state updates would run outside act() after an in-commit
// event; the race under test is about the transfer fields.
jest.mock( '../ParticipantField.js', () => () => null );

const BUDGETS = [
	{ id: 1, name: 'Venue' },
	{ id: 2, name: 'Catering' },
	{ id: 3, name: 'Reserve' },
];

const TRANSFER = {
	id: 9,
	amount: 80,
	entry_date: '2026-05-20',
	description: 'Move to catering',
	participant_id: null,
	children: [
		{
			entry_type: 'cost',
			budget_id: 1,
			event_url: '',
			event_date_id: null,
		},
		{ entry_type: 'income', budget_id: 2 },
	],
};

describe( 'TransferModal', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( {} );
	} );

	it( 'keeps the loaded values when a field changes as the dialog opens', async () => {
		const onSave = jest.fn();
		let committed = false;
		render(
			<Profiler
				id="transfer"
				onRender={ ( id, phase ) => {
					if ( 'mount' === phase && ! committed ) {
						committed = true;
						fireEvent.change(
							screen.getByLabelText( 'To Budget (Target)' ),
							{ target: { value: '3' } }
						);
					}
				} }
			>
				<TransferModal
					entry={ TRANSFER }
					budgets={ BUDGETS }
					eventsEnabled={ false }
					onSave={ onSave }
					onCancel={ jest.fn() }
				/>
			</Profiler>
		);

		expect( screen.getByLabelText( 'Amount' ) ).toHaveValue( 80 );
		expect( screen.getByLabelText( 'Date' ) ).toHaveValue( '2026-05-20' );
		expect( screen.getByLabelText( 'Description' ) ).toHaveValue(
			'Move to catering'
		);
		expect( screen.getByLabelText( 'From Budget (Source)' ) ).toHaveValue(
			'1'
		);
		expect( screen.getByLabelText( 'To Budget (Target)' ) ).toHaveValue(
			'3'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Update Transfer' } )
		);
		await waitFor( () => expect( onSave ).toHaveBeenCalled() );
		expect( apiFetch.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			path: '/fair-finance/v1/financial-entries/transfer/9',
			method: 'PUT',
			data: {
				amount: 80,
				entry_date: '2026-05-20',
				description: 'Move to catering',
				source_budget_id: 1,
				target_budget_id: 3,
			},
		} );
	} );
} );
