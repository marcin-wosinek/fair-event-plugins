/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { Profiler } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
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
		{ id: 21, budget_id: 1, amount: 60, description: 'Room', tag: 'venue' },
		{ id: 22, budget_id: 2, amount: 40, description: 'Snacks', tag: null },
	],
};

const TAGS = [ 'catering', 'travel', 'venue' ];

const TAGGED_ENTRY = {
	id: 8,
	amount: 100,
	entry_type: 'cost',
	entry_date: '2026-06-01',
	description: 'Shared invoice',
	tag: 'venue',
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

	describe( 'allocation tags', () => {
		afterEach( () => jest.clearAllMocks() );

		const renderTagged = ( entry, props = {} ) =>
			render(
				<SplitModal
					entry={ entry }
					budgets={ BUDGETS }
					tags={ TAGS }
					eventsEnabled={ false }
					onSplit={ jest.fn() }
					onCancel={ jest.fn() }
					onUnsplit={ jest.fn() }
					{ ...props }
				/>
			);

		const tagInputs = () =>
			screen.getAllByRole( 'textbox', { name: 'Tag' } );
		const tagValues = () => tagInputs().map( ( el ) => el.value );
		const setAmounts = ( ...values ) =>
			screen
				.getAllByLabelText( 'Amount' )
				.forEach( ( el, i ) =>
					fireEvent.change( el, { target: { value: values[ i ] } } )
				);
		const sentTags = ( call = 0 ) =>
			apiFetch.mock.calls[ call ][ 0 ].data.allocations.map(
				( a ) => a.tag
			);
		const submit = ( name ) =>
			act( async () => {
				fireEvent.click( screen.getByRole( 'button', { name } ) );
			} );

		it( 'starts every new allocation, including added rows, with the entry tag', () => {
			renderTagged( TAGGED_ENTRY );

			expect( tagValues() ).toEqual( [ 'venue', 'venue' ] );

			fireEvent.click(
				screen.getByRole( 'button', { name: '+ Add Row' } )
			);

			expect( tagValues() ).toEqual( [ 'venue', 'venue', 'venue' ] );
		} );

		it( 'leaves allocations of an untagged entry untagged', async () => {
			apiFetch.mockResolvedValue( {} );
			renderTagged( { ...TAGGED_ENTRY, tag: null } );

			expect( tagValues() ).toEqual( [ '', '' ] );

			setAmounts( '60', '40' );
			await submit( 'Split Entry' );

			expect( sentTags() ).toEqual( [ null, null ] );
		} );

		it( 'saves a changed, a cleared and a suggested tag independently', async () => {
			apiFetch.mockResolvedValue( {} );
			const onSplit = jest.fn();
			renderTagged( TAGGED_ENTRY, { onSplit } );
			fireEvent.click(
				screen.getByRole( 'button', { name: '+ Add Row' } )
			);

			// Clear the first, type a new tag into the second, and pick an
			// existing tag from the suggestions for the third.
			fireEvent.change( tagInputs()[ 0 ], { target: { value: '' } } );
			fireEvent.change( tagInputs()[ 1 ], {
				target: { value: 'sound hire' },
			} );
			fireEvent.focus( tagInputs()[ 2 ] );
			fireEvent.change( tagInputs()[ 2 ], { target: { value: 'cat' } } );
			fireEvent.mouseDown(
				screen.getByRole( 'button', { name: 'catering' } )
			);

			expect( tagValues() ).toEqual( [ '', 'sound hire', 'catering' ] );

			setAmounts( '50', '30', '20' );
			await submit( 'Split Entry' );

			expect( apiFetch ).toHaveBeenCalledTimes( 1 );
			expect( apiFetch.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
				path: '/fair-finance/v1/financial-entries/8/split',
				method: 'POST',
			} );
			expect( sentTags() ).toEqual( [ null, 'sound hire', 'catering' ] );
			expect( onSplit ).toHaveBeenCalled();
		} );

		it( 'shows saved allocation tags and keeps them when other fields change', async () => {
			apiFetch.mockResolvedValue( {} );
			renderTagged( {
				...SPLIT_ENTRY,
				children: [
					{
						budget_id: 1,
						amount: 60,
						description: 'Room',
						tag: 'venue',
					},
					{
						budget_id: 2,
						amount: 40,
						description: 'Snacks',
						tag: null,
					},
				],
			} );

			expect( tagValues() ).toEqual( [ 'venue', '' ] );

			setAmounts( '70', '30' );
			fireEvent.change( screen.getAllByLabelText( 'Description' )[ 1 ], {
				target: { value: 'Coffee' },
			} );
			await submit( 'Update Split' );

			expect( apiFetch.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
				path: '/fair-finance/v1/financial-entries/5/split',
				method: 'PUT',
			} );
			expect( sentTags() ).toEqual( [ 'venue', null ] );
		} );

		it( 'changes and clears saved tags when editing a split', async () => {
			apiFetch.mockResolvedValue( {} );
			renderTagged( {
				...SPLIT_ENTRY,
				children: [
					{
						budget_id: 1,
						amount: 60,
						description: 'Room',
						tag: 'venue',
					},
					{
						budget_id: 2,
						amount: 40,
						description: 'Snacks',
						tag: 'food',
					},
				],
			} );

			fireEvent.change( tagInputs()[ 0 ], {
				target: { value: 'travel' },
			} );
			fireEvent.change( tagInputs()[ 1 ], { target: { value: '  ' } } );
			await submit( 'Update Split' );

			expect( sentTags() ).toEqual( [ 'travel', null ] );
		} );

		it( 'sends nothing when cancelled', () => {
			const onCancel = jest.fn();
			renderTagged( TAGGED_ENTRY, { onCancel } );

			fireEvent.change( tagInputs()[ 0 ], {
				target: { value: 'travel' },
			} );
			fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

			expect( onCancel ).toHaveBeenCalled();
			expect( apiFetch ).not.toHaveBeenCalled();
		} );

		it( 'keeps the entered tags after a failed save and sends them on retry', async () => {
			apiFetch
				.mockRejectedValueOnce( { message: 'Database unavailable.' } )
				.mockResolvedValueOnce( {} );
			const onSplit = jest.fn();
			renderTagged( TAGGED_ENTRY, { onSplit } );

			fireEvent.change( tagInputs()[ 1 ], {
				target: { value: 'travel' },
			} );
			setAmounts( '60', '40' );
			await submit( 'Split Entry' );

			expect(
				screen.getByText( 'Database unavailable.' )
			).toBeInTheDocument();
			expect( onSplit ).not.toHaveBeenCalled();
			expect( tagValues() ).toEqual( [ 'venue', 'travel' ] );

			await submit( 'Split Entry' );

			expect( sentTags( 1 ) ).toEqual( [ 'venue', 'travel' ] );
			expect( onSplit ).toHaveBeenCalled();
		} );
	} );

	it( 'updates existing allocations by ID and adds new rows without one', async () => {
		apiFetch.mockResolvedValue( {} );
		const onSplit = jest.fn();
		render(
			<SplitModal
				entry={ SPLIT_ENTRY }
				budgets={ BUDGETS }
				eventsEnabled={ false }
				onSplit={ onSplit }
				onCancel={ jest.fn() }
				onUnsplit={ jest.fn() }
			/>
		);
		fireEvent.change( screen.getAllByLabelText( 'Amount' )[ 1 ], {
			target: { value: '30' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: '+ Add Row' } ) );
		fireEvent.change( screen.getAllByLabelText( 'Amount' )[ 2 ], {
			target: { value: '10' },
		} );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Update Split' } )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-finance/v1/financial-entries/5/split',
				method: 'PUT',
			} )
		);
		const sent = apiFetch.mock.calls[ 0 ][ 0 ].data.allocations;
		expect( sent.map( ( a ) => [ a.id, a.amount ] ) ).toEqual( [
			[ 21, 60 ],
			[ 22, 30 ],
			[ undefined, 10 ],
		] );
		// Saved tags go back unchanged; the new row of an untagged entry
		// stays untagged.
		expect( sent.map( ( a ) => a.tag ) ).toEqual( [ 'venue', null, null ] );
		expect( onSplit ).toHaveBeenCalled();
	} );
} );

describe( 'SplitModal — entity-encoded descriptions (#2412)', () => {
	const ENCODED_SPLIT = {
		...SPLIT_ENTRY,
		description:
			'Entrada "La&nbsp;Mutable" &lt;b&gt;VIP&lt;/b&gt; &amp;amp;',
		children: [
			{
				id: 21,
				budget_id: 1,
				amount: 60,
				description: 'Caf&eacute; &amp; bar',
				tag: null,
			},
			{ id: 22, budget_id: 2, amount: 40, description: '', tag: null },
		],
	};

	// Earlier suites leave their calls recorded.
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'shows the parent decoded once while allocation inputs keep their source', async () => {
		apiFetch.mockResolvedValue( {} );
		const { container } = render(
			<SplitModal
				entry={ ENCODED_SPLIT }
				budgets={ BUDGETS }
				eventsEnabled={ false }
				onSplit={ jest.fn() }
				onCancel={ jest.fn() }
				onUnsplit={ jest.fn() }
			/>
		);

		const summary = screen.getByText( 'Description:' ).parentElement;
		expect( summary.textContent ).toBe(
			'Description: Entrada "La Mutable" <b>VIP</b> &amp;'
		);
		// HTML-like text stays text.
		expect( summary.querySelector( 'b' ) ).toBeNull();
		expect( container.ownerDocument.querySelector( 'b' ) ).toBeNull();

		expect(
			screen.getAllByLabelText( 'Description' ).map( ( el ) => el.value )
		).toEqual( [ 'Caf&eacute; &amp; bar', '' ] );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Update Split' } )
			);
		} );

		expect(
			apiFetch.mock.calls[ 0 ][ 0 ].data.allocations.map(
				( a ) => a.description
			)
		).toEqual( [ 'Caf&eacute; &amp; bar', '' ] );
	} );
} );
