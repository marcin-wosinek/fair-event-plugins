/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SplitModal from '../SplitModal.js';

jest.mock( '@wordpress/api-fetch' );

const BUDGETS = [
	{ id: 1, name: 'Venue' },
	{ id: 2, name: 'Catering' },
];

const SPLIT_ENTRY = {
	id: 5,
	amount: 100,
	entry_type: 'cost',
	entry_date: '2026-06-01',
	description: 'Shared invoice',
	children: [
		{ budget_id: 1, amount: 60, description: 'Room' },
		{ budget_id: 2, amount: 40, description: 'Snacks' },
	],
};

describe( 'SplitModal', () => {
	it( 'keeps the loaded allocations when one changes as the dialog opens', () => {
		let committed = false;
		render(
			<Profiler
				id="split"
				onRender={ ( id, phase ) => {
					if ( 'mount' === phase && ! committed ) {
						committed = true;
						fireEvent.change(
							screen.getAllByLabelText( 'Budget' )[ 0 ],
							{ target: { value: '2' } }
						);
					}
				} }
			>
				<SplitModal
					entry={ SPLIT_ENTRY }
					budgets={ BUDGETS }
					eventsEnabled={ false }
					onSplit={ jest.fn() }
					onCancel={ jest.fn() }
					onUnsplit={ jest.fn() }
				/>
			</Profiler>
		);

		const budgets = screen.getAllByLabelText( 'Budget' );
		const amounts = screen.getAllByLabelText( 'Amount' );
		const descriptions = screen.getAllByLabelText( 'Description' );
		expect( budgets.map( ( el ) => el.value ) ).toEqual( [ '2', '2' ] );
		expect( amounts.map( ( el ) => el.value ) ).toEqual( [ '60', '40' ] );
		expect( descriptions.map( ( el ) => el.value ) ).toEqual( [
			'Room',
			'Snacks',
		] );
	} );

	const renderSplit = ( entry ) =>
		render(
			<SplitModal
				entry={ entry }
				budgets={ BUDGETS }
				eventsEnabled={ false }
				onSplit={ jest.fn() }
				onCancel={ jest.fn() }
				onUnsplit={ jest.fn() }
			/>
		);

	it( 'shows the bank origin every allocation inherits', () => {
		renderSplit( {
			...SPLIT_ENTRY,
			bank_origin: { account: { id: 4, name: 'Main account' } },
		} );

		expect(
			screen.getByText( /Bank import — Main account/ )
		).toHaveTextContent(
			'Paid from: Bank import — Main account Every allocation keeps this bank origin.'
		);
	} );

	it( 'shows an unknown account for an import without one', () => {
		renderSplit( { ...SPLIT_ENTRY, bank_origin: { account: null } } );

		expect(
			screen.getByText( /Bank import — account unknown/ )
		).toBeInTheDocument();
	} );

	it( 'shows no bank origin for a manual entry', () => {
		renderSplit( SPLIT_ENTRY );

		expect( screen.queryByText( /Bank import/ ) ).not.toBeInTheDocument();
	} );
} );
