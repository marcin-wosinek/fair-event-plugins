/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SplitRecalculation from '../SplitRecalculation.js';

jest.mock( '@wordpress/api-fetch' );

const change = ( extra ) => ( {
	action: 'update',
	kind: 'transaction',
	movement_key: null,
	current_amount: '500.00',
	proposed_amount: '490.00',
	description: 'Ticket A',
	new_description: null,
	tag: 'workshop',
	budget_id: 4,
	event_url: 'https://example.test/a',
	transferred_from: null,
	...extra,
} );
const review = {
	status: 'proposed',
	fingerprint: 'f'.repeat( 64 ),
	currency: 'EUR',
	entry_id: 8,
	explanation: 'Recorded payment fees are not deducted again.',
	reasons: [],
	warnings: [
		'Allocation #12 was changed from 325.00 to 320.00 after reconciliation.',
	],
	changes: [
		change( { id: 11 } ),
		change( {
			id: 12,
			current_amount: '320.00',
			proposed_amount: '319.65',
			description: 'Ticket B',
			tag: null,
			budget_id: null,
			event_url: null,
		} ),
		change( {
			id: 13,
			kind: 'settlement',
			current_amount: '-15.33',
			proposed_amount: '0.02',
			description: 'Mollie costs from the settlement report',
			new_description: 'Invoice compensation',
			tag: 'fees',
			budget_id: 5,
			event_url: null,
			transferred_from: 13,
		} ),
	],
};
let applied;
beforeEach( () => {
	applied = jest.fn().mockResolvedValue( {
		...review,
		status: 'unchanged',
		preview: { fresh: true },
	} );
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.endsWith( '/recalculate-preview' ) )
			return Promise.resolve( review );
		if ( path.endsWith( '/recalculate' ) ) return applied();
		throw new Error( `Unexpected path ${ path }` );
	} );
} );

const open = async ( onApplied = jest.fn() ) => {
	render(
		<SplitRecalculation
			settlementId={ 4 }
			name="REF.2605.01"
			budgets={ [ { id: 4, name: 'Workshops' } ] }
			onApplied={ onApplied }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Preview recalculation' } )
	);
	await screen.findByText( /Allocation #11/ );
	return onApplied;
};

test( 'previews amounts, retained tags including Untagged, and manual edits', async () => {
	await open();
	const rows = screen.getAllByRole( 'row' ).slice( 1 );
	expect( rows ).toHaveLength( 3 );
	expect( rows[ 0 ] ).toHaveTextContent( '500.00 EUR' );
	expect( rows[ 0 ] ).toHaveTextContent( '490.00 EUR' );
	expect( rows[ 0 ] ).toHaveTextContent( 'Tag: workshop' );
	expect( rows[ 0 ] ).toHaveTextContent( 'Budget: Workshops' );
	expect( rows[ 1 ] ).toHaveTextContent( 'Tag: Untagged' );
	expect( rows[ 1 ] ).toHaveTextContent( 'Budget: No budget' );
	expect( rows[ 2 ] ).toHaveTextContent(
		'Mollie costs from the settlement report → Invoice compensation'
	);
	expect( rows[ 2 ] ).toHaveTextContent( 'Tag: fees' );
	expect( rows[ 2 ] ).toHaveTextContent( 'keeping its categorization' );
	expect(
		screen.getByText( 'Manual edits affected by this recalculation:' )
	).toBeInTheDocument();
	expect(
		screen.getAllByText( /changed from 325.00/ ).length
	).toBeGreaterThan( 0 );
	// Previewing never applies.
	expect( apiFetch ).toHaveBeenCalledTimes( 1 );
} );

test( 'applies only after confirmation and reports the refreshed split', async () => {
	const onApplied = await open();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Apply recalculation' } )
	);
	const dialog = screen.getByRole( 'dialog' );
	expect( dialog ).toHaveTextContent(
		'Apply the previewed changes to 3 allocations of bank entry #8?'
	);
	expect( dialog ).toHaveTextContent( 'including untagged ones' );
	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Recalculate split',
			} )
		);
	} );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
	);
	expect( applied ).toHaveBeenCalledTimes( 1 );
	expect( apiFetch ).toHaveBeenLastCalledWith(
		expect.objectContaining( {
			method: 'POST',
			data: { fingerprint: review.fingerprint },
		} )
	);
	expect( onApplied ).toHaveBeenCalledWith( { fresh: true } );
	// Notices are also spoken through a live region.
	expect(
		screen.getAllByText( /The split was recalculated/ ).length
	).toBeGreaterThan( 0 );
} );

test( 'cancelling the confirmation changes nothing', async () => {
	await open();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Apply recalculation' } )
	);
	fireEvent.click(
		within( screen.getByRole( 'dialog' ) ).getByRole( 'button', {
			name: 'Cancel',
		} )
	);
	expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	expect( applied ).not.toHaveBeenCalled();
} );

test( 'a blocked recalculation explains why and cannot be applied', async () => {
	apiFetch.mockImplementation( () =>
		Promise.resolve( {
			...review,
			status: 'blocked',
			changes: [],
			warnings: [],
			reasons: [ 'Allocation #14 was added after reconciliation.' ],
		} )
	);
	render( <SplitRecalculation settlementId={ 4 } name="REF.2605.01" /> );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Preview recalculation' } )
	);
	await screen.findByText( 'Allocation #14 was added after reconciliation.' );
	expect(
		screen.queryByRole( 'button', { name: 'Apply recalculation' } )
	).not.toBeInTheDocument();
} );

test( 'a failed apply keeps the dialog open; a stale one requires a new preview', async () => {
	applied.mockRejectedValueOnce( {
		code: 'reconciliation_save_failed',
		message: 'The split could not be recalculated. Nothing was changed.',
	} );
	await open();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Apply recalculation' } )
	);
	await act( async () => {
		fireEvent.click(
			within( screen.getByRole( 'dialog' ) ).getByRole( 'button', {
				name: 'Recalculate split',
			} )
		);
	} );
	expect(
		await within( screen.getByRole( 'dialog' ) ).findByText(
			'The split could not be recalculated. Nothing was changed.'
		)
	).toBeInTheDocument();
	applied.mockRejectedValueOnce( {
		code: 'reconciliation_stale',
		message: 'The split or its evidence changed. Preview again.',
	} );
	await act( async () => {
		fireEvent.click(
			within( screen.getByRole( 'dialog' ) ).getByRole( 'button', {
				name: 'Recalculate split',
			} )
		);
	} );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
	);
	expect(
		screen.getAllByText(
			'The split or its evidence changed. Preview again.'
		).length
	).toBeGreaterThan( 0 );
	expect(
		screen.queryByRole( 'button', { name: 'Apply recalculation' } )
	).not.toBeInTheDocument();
} );
