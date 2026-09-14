/**
 * @jest-environment jsdom
 *
 * Component tests for the Signups tab (#1568 replaces the fixed-column CSV
 * download with the "Export" popup — see SignupExportModal.test.jsx for its
 * own coverage).
 *
 * Exercises:
 *   - The list renders and the Export button opens the popup.
 *   - Mailing opt-ins filter narrows the table rows (and, transitively, what
 *     the export popup receives).
 *   - Empty state (no signups, or a filter matching nothing) disables the
 *     Export button instead of opening an empty popup.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventSignups from '../EventSignups.js';

jest.mock( '@wordpress/api-fetch' );

const signups = [
	{
		id: 1,
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		ticket_type_id: 3,
		ticket_type_name: 'General',
		quantity: 1,
		amount: '20.00',
		status: 'paid',
		transaction_id: 501,
		mailing_opt_in: true,
		created_at: '2026-07-20 10:00:00',
	},
	{
		id: 2,
		name: 'Bob, Jr.',
		email: 'bob@example.com',
		ticket_type_id: 3,
		ticket_type_name: 'General',
		quantity: 2,
		amount: '40.00',
		status: 'paid',
		transaction_id: 502,
		mailing_opt_in: false,
		created_at: '2026-07-21 10:00:00',
	},
];

const signupWithMissingTicketType = {
	id: 3,
	name: 'Carol Danvers',
	email: 'carol@example.com',
	ticket_type_id: 99,
	ticket_type_name: null,
	quantity: 1,
	amount: '0.00',
	status: 'confirmed',
	transaction_id: null,
	mailing_opt_in: false,
	created_at: '2026-07-22 10:00:00',
};

async function renderSignups( data = signups ) {
	apiFetch.mockResolvedValue( data );
	render( <EventSignups eventDateId={ 42 } /> );
	if ( data.length > 0 ) {
		await waitFor( () =>
			expect( screen.getByText( data[ 0 ].name ) ).toBeInTheDocument()
		);
	} else {
		await waitFor( () =>
			expect( screen.getByText( 'No signups yet.' ) ).toBeInTheDocument()
		);
	}
}

afterEach( () => {
	jest.clearAllMocks();
	delete window.fairPaymentsConnector;
} );

describe( 'EventSignups — list and Export button (#1568)', () => {
	it( 'renders the List section heading', async () => {
		await renderSignups();
		expect(
			screen.getByRole( 'heading', { name: 'List' } )
		).toBeInTheDocument();
	} );

	it( 'renders an Export button in place of Download CSV', async () => {
		await renderSignups();
		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeInTheDocument();
	} );

	it( 'opens the export popup, scoped to the currently visible signups', async () => {
		await renderSignups();
		// Second apiFetch call is SignupExportModal's include_answers fetch.
		apiFetch.mockResolvedValueOnce(
			signups.map( ( s ) => ( { ...s, answers: [] } ) )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );

		expect(
			await screen.findByRole( 'dialog', { name: 'Export' } )
		).toBeInTheDocument();
	} );

	it( 'distinguishes expired and confirmed over-capacity signups', async () => {
		await renderSignups( [
			{ ...signups[ 0 ], status: 'expired' },
			{ ...signups[ 1 ], status: 'confirmed', over_capacity: 1 },
		] );
		expect( screen.getByText( 'Expired' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Confirmed — over capacity' )
		).toBeInTheDocument();
	} );

	it.each( [ false, 0, '0' ] )(
		'displays Confirmed for a cleared over-capacity flag (%p)',
		async ( overCapacity ) => {
			await renderSignups( [
				{
					...signups[ 0 ],
					status: 'confirmed',
					over_capacity: overCapacity,
				},
			] );

			expect( screen.getByText( 'Confirmed' ) ).toBeInTheDocument();
			expect(
				screen.queryByText( 'Confirmed — over capacity' )
			).not.toBeInTheDocument();
		}
	);

	it.each( [ true, 1, '1' ] )(
		'displays the warning for an enabled over-capacity flag (%p)',
		async ( overCapacity ) => {
			await renderSignups( [
				{
					...signups[ 0 ],
					status: 'confirmed',
					over_capacity: overCapacity,
				},
			] );

			expect(
				screen.getByText( 'Confirmed — over capacity' )
			).toBeInTheDocument();
		}
	);

	it( 'links transaction references only when the connector is active', async () => {
		window.fairPaymentsConnector = { connectorActive: true };
		await renderSignups( [ signups[ 0 ] ] );
		expect( screen.getByRole( 'link', { name: '501' } ) ).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=501'
		);
	} );

	it( 'narrows the table to mailing opt-ins when the filter is on', async () => {
		await renderSignups();

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Bob, Jr.' ) ).not.toBeInTheDocument();
	} );

	it( 'disables the button and explains why when there are no signups at all', async () => {
		await renderSignups( [] );

		const button = screen.getByRole( 'button', { name: 'Export' } );
		expect( button ).toBeDisabled();
		expect( screen.getByText( 'No signups yet.' ) ).toBeInTheDocument();
	} );

	it( 'shows the ticket type name, not its id, in the table', async () => {
		await renderSignups();
		expect( screen.getAllByText( 'General' ) ).toHaveLength( 2 );
		expect( screen.queryByText( '3' ) ).not.toBeInTheDocument();
	} );

	it( 'falls back to an em dash when the ticket type is missing or deleted', async () => {
		await renderSignups( [ signupWithMissingTicketType ] );
		expect( screen.getAllByText( '—' ) ).not.toHaveLength( 0 );
	} );

	it( 'disables the button when the mailing filter matches nothing', async () => {
		await renderSignups( [ signups[ 1 ] ] );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		const button = screen.getByRole( 'button', { name: 'Export' } );
		expect( button ).toBeDisabled();
		expect(
			screen.getByText(
				'Nothing to export — no signups match the current filter.'
			)
		).toBeInTheDocument();
	} );
} );

describe( 'EventSignups — mailing consent normalization (#1492)', () => {
	const consentCases = [
		{ value: false, label: 'boolean false', optedIn: false },
		{ value: 0, label: 'numeric zero', optedIn: false },
		{ value: '0', label: 'database zero', optedIn: false },
		{ value: true, label: 'boolean true', optedIn: true },
		{ value: 1, label: 'numeric one', optedIn: true },
		{ value: '1', label: 'database one', optedIn: true },
	];

	it.each( consentCases )(
		'displays $label explicitly',
		async ( { value, optedIn } ) => {
			const signup = {
				...signups[ 0 ],
				mailing_opt_in: value,
			};
			await renderSignups( [ signup ] );
			expect(
				screen.getByText( optedIn ? 'Yes' : 'No' )
			).toBeInTheDocument();
		}
	);

	it( 'filters explicit opt-ins independently of payment status', async () => {
		const rows = consentCases.map( ( consent, index ) => ( {
			...signups[ index % signups.length ],
			id: index + 10,
			name: `${ consent.optedIn ? 'Opted in' : 'Opted out' } ${ index }`,
			email: `consent-${ index }@example.com`,
			status: [ 'confirmed', 'pending_payment', 'failed', 'expired' ][
				index % 4
			],
			mailing_opt_in: consent.value,
		} ) );
		await renderSignups( rows );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		consentCases.forEach( ( consent, index ) => {
			const name = `${
				consent.optedIn ? 'Opted in' : 'Opted out'
			} ${ index }`;
			if ( consent.optedIn ) {
				expect( screen.getByText( name ) ).toBeInTheDocument();
			} else {
				expect( screen.queryByText( name ) ).not.toBeInTheDocument();
			}
		} );
	} );
} );

describe( 'EventSignups — delete signup (#1464)', () => {
	it( 'opens the confirmation dialog for the selected row with its full scope', async () => {
		await renderSignups();

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 1 ]
		);

		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'Bob, Jr.' );
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'bob@example.com'
		);
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'paid' );
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'This deletion is permanent.'
		);
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'does not refund or cancel any payment-provider transaction'
		);
	} );

	it( 'cancels without deleting or changing the list', async () => {
		await renderSignups();
		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'deletes the exact signup and removes only its row after success', async () => {
		apiFetch
			.mockResolvedValueOnce( signups )
			.mockResolvedValueOnce( { deleted: true, signup: signups[ 0 ] } );
		render( <EventSignups eventDateId={ 42 } /> );
		await screen.findByText( 'Ada Lovelace' );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete signup' } )
		);

		await waitFor( () =>
			expect(
				screen.queryByText( 'Ada Lovelace' )
			).not.toBeInTheDocument()
		);
		expect( screen.getByText( 'Bob, Jr.' ) ).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/get-tickets/1',
			method: 'DELETE',
		} );
	} );

	it( 'preserves the row and shows a persistent error when deletion fails', async () => {
		apiFetch
			.mockResolvedValueOnce( signups )
			.mockRejectedValueOnce( { message: 'Database refused deletion.' } );
		render( <EventSignups eventDateId={ 42 } /> );
		await screen.findByText( 'Ada Lovelace' );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete signup' } )
		);

		await waitFor( () =>
			expect(
				document.querySelector( '.components-notice__content' )
			).toHaveTextContent( 'Database refused deletion.' )
		);
		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			document.querySelector( '.components-notice' )
		).not.toHaveClass( 'is-dismissible' );
	} );
} );
