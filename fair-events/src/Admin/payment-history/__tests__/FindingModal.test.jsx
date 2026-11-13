/**
 * @jest-environment jsdom
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
import FindingModal, {
	describeLedgerRow,
	allocationProblem,
	initialRows,
} from '../FindingModal.js';

jest.mock( '@wordpress/api-fetch' );

// ComboboxControl scrolls the highlighted option into view; jsdom has no layout.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const eventDate = {
	id: 5,
	title: 'Salsa night',
	start_date: '2036-01-10',
	start_time: '20:00:00',
	all_day: false,
};

function purchase( id, name, amount = 12 ) {
	return {
		id,
		name,
		email: `${ name.toLowerCase() }@example.test`,
		quantity: 1,
		amount,
		status: 'confirmed',
		participant_id: null,
		backfilled: true,
		event_date_id: 5,
		event_date: eventDate,
		created_at: '2036-01-01 10:00:00',
	};
}

function context( overrides = {} ) {
	return {
		finding: {
			id: 42,
			mode: 'backfill',
			reason: 'allocation_mismatch',
			informational: false,
			source_type: 'transaction',
			source_id: 900,
			event_date_id: 5,
			event_date: eventDate,
			status: 'open',
			detail: { amount: 24, currency: 'EUR' },
			first_seen_at: '2036-01-01 10:00:00',
			last_seen_at: '2036-01-01 10:00:00',
		},
		payment_information: 'available',
		transaction: {
			id: 900,
			missing: false,
			amount: 24,
			currency: 'EUR',
			status: 'paid',
			created_at: '2036-01-01 09:00:00',
			source: 'fair-audience-signup',
			description: '',
			line_items: [
				{ name: 'Two sessions', quantity: 1, total_amount: 24 },
			],
			hints: {
				event_date_id: 5,
				participant_id: null,
				signup_ids: [],
				event_participant_ids: [ 7, 8 ],
				retry_of: null,
			},
		},
		transaction_id: 900,
		links: [],
		allocated: 0,
		remaining: 24,
		can_link: true,
		link_refusal: null,
		can_review: true,
		candidates: [ purchase( 11, 'Ana' ), purchase( 12, 'Ben' ) ],
		audit: [],
		...overrides,
	};
}

describe( 'allocationProblem', () => {
	const row = ( signupId, amount, role = 'charge' ) => ( {
		key: signupId,
		signupId: String( signupId ),
		role,
		amount: String( amount ),
	} );

	it( 'accepts a split that fits the remaining amount', () => {
		expect(
			allocationProblem( [ row( 1, 12 ), row( 2, 12 ) ], 24, 'EUR' )
		).toBeNull();
	} );

	it( 'names both sums when the split exceeds what is left', () => {
		expect(
			allocationProblem( [ row( 1, 12 ), row( 2, 12.01 ) ], 24, 'EUR' )
		).toBe(
			'The amounts add up to 24.01 EUR, more than the 24.00 EUR left on this payment.'
		);
	} );

	it( 'asks for a purchase, an amount and no duplicates', () => {
		expect(
			allocationProblem( [ { ...row( 1, 5 ), signupId: '' } ], 24, 'EUR' )
		).toBe( 'Choose a purchase in every row.' );
		expect( allocationProblem( [ row( 1, '' ) ], 24, 'EUR' ) ).toBe(
			'Enter an amount of zero or more in every row.'
		);
		expect( allocationProblem( [ row( 1, -1 ) ], 24, 'EUR' ) ).toBe(
			'Enter an amount of zero or more in every row.'
		);
		expect(
			allocationProblem( [ row( 1, 5 ), row( 1, 5 ) ], 24, 'EUR' )
		).toBe( 'The same purchase is listed twice with the same role.' );
	} );
} );

describe( 'initialRows', () => {
	it( 'starts from the purchases the evidence proposed', () => {
		const rows = initialRows(
			context( {
				finding: {
					...context().finding,
					reason: 'existing_link_conflict',
					detail: {
						proposed: [
							{
								signup_id: 11,
								role: 'charge',
								allocated_amount: 10,
							},
						],
					},
				},
			} )
		);
		expect( rows ).toEqual( [
			expect.objectContaining( {
				signupId: '11',
				role: 'charge',
				amount: '10',
			} ),
		] );
	} );

	it( 'offers the remaining amount with the role the reason implies', () => {
		const rows = initialRows(
			context( {
				finding: {
					...context().finding,
					reason: 'ambiguous_activity_charge',
				},
				remaining: 8,
			} )
		);
		expect( rows ).toEqual( [
			expect.objectContaining( {
				signupId: '',
				role: 'additional_charge',
				amount: '8.00',
			} ),
		] );
	} );
} );

describe( 'FindingModal', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	async function renderModal( data = context(), props = {} ) {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path.includes( '/purchases' ) ) {
				return Promise.resolve( [] );
			}
			if ( ! method ) {
				return Promise.resolve( data );
			}
			return Promise.reject( new Error( `Unexpected ${ path }` ) );
		} );
		const handlers = { onClose: jest.fn(), onDecided: jest.fn() };
		render(
			<FindingModal findingId={ 42 } { ...handlers } { ...props } />
		);
		await screen.findByLabelText( 'Note for the audit log (required)' );
		return handlers;
	}

	it( 'shows the payment, what is linked and what is left', async () => {
		await renderModal();

		expect(
			screen.getByRole( 'dialog', {
				name: 'Review record — Shared payment doesn’t add up',
			} )
		).toBeInTheDocument();
		const payment = screen.getByRole( 'link', { name: '#900' } );
		expect( payment ).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=900'
		);
		expect( payment.parentElement ).toHaveTextContent(
			'#900 — 24.00 EUR, Paid'
		);
		expect(
			screen.getByText(
				'Linked: 0.00 EUR of 24.00 EUR. Left: 24.00 EUR.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( 'registrations #7, #8' )
		).toBeInTheDocument();
	} );

	it( 'needs a note and a purchase before linking, and links once', async () => {
		const { onDecided } = await renderModal();
		const linkButton = screen.getByRole( 'button', {
			name: 'Link payment',
		} );
		expect( linkButton ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Choose a purchase in every row.' )
		).toBeInTheDocument();

		const combobox = screen.getByRole( 'combobox', { name: 'Purchase 1' } );
		fireEvent.focus( combobox );
		fireEvent.click( combobox );
		fireEvent.change( combobox, { target: { value: 'Ana' } } );
		fireEvent.click(
			await screen.findByRole( 'option', { name: /Purchase #11 — Ana/ } )
		);
		fireEvent.change( screen.getByLabelText( 'Amount (EUR)' ), {
			target: { value: '12' },
		} );
		expect(
			screen.getByText( 'Enter a note to record your decision.' )
		).toBeInTheDocument();
		fireEvent.change(
			screen.getByLabelText( 'Note for the audit log (required)' ),
			{ target: { value: 'Half of the shared payment' } }
		);

		let resolve;
		apiFetch.mockClear();
		apiFetch.mockImplementation(
			() => new Promise( ( r ) => ( resolve = r ) )
		);
		expect( linkButton ).not.toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( linkButton );
		fireEvent.click( linkButton );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/payment-history/findings/42/links',
			method: 'POST',
			data: {
				note: 'Half of the shared payment',
				expected_link_ids: [],
				links: [
					{ signup_id: 11, role: 'charge', allocated_amount: 12 },
				],
			},
		} );

		await act( async () => resolve( { audit_id: 1, context: null } ) );
		expect( onDecided ).toHaveBeenCalledWith( 'Payment #900 was linked.' );
	} );

	it( 'keeps the inputs and offers a reload when the decision is stale', async () => {
		await renderModal(
			context( {
				candidates: [ purchase( 11, 'Ana' ) ],
				finding: {
					...context().finding,
					detail: {
						proposed: [
							{
								signup_id: 11,
								role: 'charge',
								allocated_amount: 24,
							},
						],
					},
				},
			} )
		);
		fireEvent.change(
			screen.getByLabelText( 'Note for the audit log (required)' ),
			{ target: { value: 'All for Ana' } }
		);
		apiFetch.mockRejectedValueOnce( {
			code: 'reconciliation_stale',
			message:
				'Someone changed this payment while you were reviewing it. Reload it and decide again.',
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Link payment' } )
		);

		expect(
			await screen.findByText(
				'Someone changed this payment while you were reviewing it. Reload it and decide again.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByLabelText( 'Note for the audit log (required)' )
		).toHaveValue( 'All for Ana' );
		expect(
			screen.getByRole( 'button', { name: 'Reload this record' } )
		).toBeInTheDocument();
	} );

	it( 'marks a record as reviewed with its note', async () => {
		const { onDecided } = await renderModal(
			context( { can_link: false, link_refusal: 'finding_not_linkable' } )
		);
		expect(
			screen.queryByRole( 'button', { name: 'Link payment' } )
		).not.toBeInTheDocument();

		fireEvent.change(
			screen.getByLabelText( 'Note for the audit log (required)' ),
			{ target: { value: 'Checked with the organizer' } }
		);
		apiFetch.mockResolvedValueOnce( { audit_id: 2, context: null } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Mark as reviewed, no link' } )
		);

		await waitFor( () => expect( onDecided ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/payment-history/findings/42/review',
			method: 'POST',
			data: { note: 'Checked with the organizer' },
		} );
	} );

	it( 'removes a reconciled link after naming it, and reloads', async () => {
		const linked = context( {
			links: [
				{
					id: 301,
					signup_id: 11,
					transaction_id: 900,
					role: 'charge',
					allocated_amount: 12,
					currency: 'EUR',
					attribution: 'reconciled',
					removable: true,
					created_at: '2036-01-01 09:00:00',
					purchase: purchase( 11, 'Ana' ),
				},
				{
					id: 302,
					signup_id: 12,
					transaction_id: 900,
					role: 'charge',
					allocated_amount: 12,
					currency: 'EUR',
					attribution: 'backfill',
					removable: false,
					created_at: '2036-01-01 09:00:00',
					purchase: purchase( 12, 'Ben' ),
				},
			],
			allocated: 24,
			remaining: 0,
		} );
		const { onDecided } = await renderModal( linked );

		// Only the link added during reconciliation can be removed.
		const removeButtons = screen.getAllByRole( 'button', {
			name: 'Remove link',
		} );
		expect( removeButtons ).toHaveLength( 1 );
		fireEvent.click( removeButtons[ 0 ] );

		expect(
			screen.getByRole( 'heading', {
				name: 'Remove the link to Purchase #11 — Ana (ana@example.test)?',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/12\.00 EUR of payment #900 will no longer count/
			)
		).toBeInTheDocument();

		const confirm = screen
			.getAllByRole( 'button', { name: 'Remove link' } )
			.pop();
		expect( confirm ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.change(
			screen.getByLabelText( 'Why are you removing it? (required)' ),
			{ target: { value: 'Wrong purchase' } }
		);

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path.includes( '/purchases' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( method ? { audit_id: 3 } : context() );
		} );
		fireEvent.click( confirm );

		expect(
			await within( screen.getByRole( 'dialog' ) ).findByText(
				'The link to Purchase #11 — Ana (ana@example.test) for 12.00 EUR was removed.'
			)
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/payment-history/links/301',
			method: 'DELETE',
			data: { note: 'Wrong purchase', expected_link_ids: [ 301, 302 ] },
		} );
		expect( onDecided ).toHaveBeenCalledWith( null );
	} );
} );

describe( 'describeLedgerRow', () => {
	it( 'describes the copied Fair Audience record, or its absence', () => {
		expect(
			describeLedgerRow( {
				id: 16,
				event_participant_id: 4,
				transaction_id: 11,
				kind: 'charge',
				created_at: '2024-03-01 11:00:00',
			} )
		).toBe(
			'Charge for registration #4, payment #11. Kept here after the old records were removed.'
		);
		expect(
			describeLedgerRow( {
				event_participant_id: 4,
				transaction_id: 12,
				kind: 'refund',
			} )
		).toMatch( /^Refund for registration #4, payment #12\./ );
		expect( describeLedgerRow( null ) ).toBe(
			'The record no longer existed when the old records were removed.'
		);
	} );
} );
