/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SavedSettlementReview from '../SavedSettlementReview.js';

jest.mock( '@wordpress/api-fetch' );
const base = {
	settlement: {
		id: 4,
		reference: 'REF.2605.01',
		amount: null,
		currency: 'EUR',
		completeness: 'unverified',
	},
	account: { id: 2, label: 'Example account' },
	revisions: { csv: { id: 6, published_at: '2026-05-02 10:00:00' } },
	fingerprint: 'abc',
	bank: { id: 8, amount: '38.55' },
	bank_rows: [],
	context: null,
	explanation: { net: '38.55' },
	difference: '0.00',
	movements: [],
	issues: [],
	bank_issues: [],
	can_partial: true,
	can_full: true,
	allocation: {
		supported: false,
		rows: [],
		reason: 'Existing allocations are preserved.',
	},
	decision: null,
	history: [],
};
let previews;
let submit;
beforeEach( () => {
	previews = 0;
	submit = jest
		.fn()
		.mockResolvedValue( { ...base, decision: { current_state: 'full' } } );
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path.endsWith( '/confirm' ) ) return submit();
		if ( path.endsWith( '/preview' ) ) {
			previews++;
			return Promise.resolve(
				previews === 1
					? {
							...base,
							can_full: false,
							can_partial: false,
							bank_issues: [ 'Confirm the bank context.' ],
						}
					: base
			);
		}
		if ( path.endsWith( '/candidates' ) )
			return Promise.resolve( [
				{
					id: 8,
					amount: '38.55',
					description: 'Example payout',
					reasons: [ 'The amount matches exactly.' ],
				},
			] );
		if ( path === '/fair-finance/v1/budgets' ) return Promise.resolve( [] );
		throw new Error( `Unexpected path ${ path } ${ method }` );
	} );
} );

const open = async () => {
	render( <SavedSettlementReview settlementId="4" /> );
	await screen.findByText( 'Reconcile settlement REF.2605.01' );
};
const selectAndPreview = async () => {
	fireEvent.change( screen.getByLabelText( 'Bank entry currency' ), {
		target: { value: 'EUR' },
	} );
	fireEvent.click( screen.getByLabelText( /I confirm this bank entry/ ) );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Refresh local preview' } )
	);
	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Confirm Fully reconciled' } )
		).toBeEnabled()
	);
};

test( 'requires reviewed explicit context and confirms the named bank and settlement', async () => {
	await open();
	expect(
		screen.getByRole( 'button', { name: 'Confirm Fully reconciled' } )
	).toBeDisabled();
	await selectAndPreview();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Confirm Fully reconciled' } )
	);
	const dialog = screen.getByRole( 'dialog' );
	expect( dialog ).toHaveTextContent( 'REF.2605.01 and bank entry #8' );
	fireEvent.click(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	);
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
	);
	expect( screen.getByText( 'Fully reconciled' ) ).toBeVisible();
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: '/fair-finance/v1/reconciliation/settlements/4/confirm',
			data: expect.objectContaining( {
				entry_id: 8,
				currency: 'EUR',
				account_id: 2,
				state: 'full',
				fingerprint: 'abc',
			} ),
		} )
	);
} );

test( 'keeps the dialog open with retryable errors and blocks dismissal while saving', async () => {
	await open();
	await selectAndPreview();
	let reject;
	submit.mockImplementationOnce(
		() =>
			new Promise( ( resolve, fail ) => {
				reject = fail;
			} )
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Save as Partial' } )
	);
	let dialog = screen.getByRole( 'dialog' );
	fireEvent.click(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	);
	expect(
		within( dialog ).getByRole( 'button', { name: 'Cancel' } )
	).toBeDisabled();
	expect(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	).toBeDisabled();
	reject( { message: 'Database unavailable.' } );
	await waitFor( () =>
		expect( dialog ).toHaveTextContent( 'Database unavailable.' )
	);
	dialog = screen.getByRole( 'dialog' );
	fireEvent.click(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	);
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
	);
} );

test( 'a stale proposal requires a new preview before retrying confirmation', async () => {
	await open();
	await selectAndPreview();
	submit.mockRejectedValueOnce( {
		code: 'reconciliation_stale',
		message: 'The reviewed data changed.',
	} );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Confirm Fully reconciled' } )
	);
	const dialog = screen.getByRole( 'dialog' );
	fireEvent.click(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	);
	await waitFor( () =>
		expect( dialog ).toHaveTextContent( 'Cancel and refresh the preview' )
	);
	expect(
		within( dialog ).getByRole( 'button', {
			name: 'Save reconciliation decision',
		} )
	).toBeDisabled();
} );
