/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import FindingsPanel, {
	describeSource,
	SourceDescription,
} from '../FindingsPanel.js';

jest.mock( '@wordpress/api-fetch' );

const eventDate = {
	id: 5,
	title: 'Salsa night',
	start_date: '2036-01-10',
	start_time: null,
	all_day: true,
};

function finding( overrides = {} ) {
	return {
		id: 42,
		mode: 'backfill',
		reason: 'no_evidence',
		informational: false,
		source_type: 'transaction',
		source_id: 900,
		event_date_id: 5,
		event_date: eventDate,
		status: 'open',
		detail: { amount: 15, currency: 'EUR' },
		first_seen_at: '2036-01-01 10:00:00',
		last_seen_at: '2036-01-01 10:00:00',
		...overrides,
	};
}

// The page's status: ongoing management, no migration run.
const STATUS = {
	reconciliation_available: true,
	payment_information: 'available',
	finding_statuses: { open: 1 },
};

function respond( items, extra = {}, total = items.length, totalPages = 1 ) {
	return Promise.resolve( {
		json: () =>
			Promise.resolve( {
				items,
				event_dates: [
					{ id: 5, count: items.length, event_date: eventDate },
				],
				reasons: { no_evidence: items.length },
				...extra,
			} ),
		headers: {
			get: ( name ) =>
				( {
					'X-WP-Total': String( total ),
					'X-WP-TotalPages': String( totalPages ),
				} )[ name ],
		},
	} );
}

describe( 'describeSource', () => {
	it( 'names what each kind of record is about', () => {
		expect( describeSource( finding() ) ).toBe( 'Payment #900, 15.00 EUR' );
		expect(
			describeSource(
				finding( {
					source_type: 'relationship',
					source_id: 7,
					detail: {},
				} )
			)
		).toBe( 'Registration #7' );
		expect(
			describeSource(
				finding( {
					source_type: 'ledger_row',
					source_id: 3,
					detail: { transaction_id: 901 },
				} )
			)
		).toBe( 'Payment record #3 (payment #901)' );
		expect(
			describeSource(
				finding( { source_type: 'signup', source_id: 11 } )
			)
		).toBe( 'Purchase #11' );
	} );
} );

describe( 'SourceDescription', () => {
	const url = ( id ) =>
		`admin.php?page=fair-payments-connector-transaction&transaction_id=${ id }`;

	it( 'links the payment number to the payment’s page', () => {
		const { rerender } = render(
			<SourceDescription finding={ finding() } linkable />
		);
		const link = screen.getByRole( 'link', { name: 'Payment #900' } );
		expect( link ).toHaveAttribute( 'href', url( 900 ) );
		expect( link.parentElement ).toHaveTextContent(
			'Payment #900, 15.00 EUR'
		);

		rerender(
			<SourceDescription
				finding={ finding( {
					source_type: 'ledger_row',
					source_id: 3,
					detail: { transaction_id: 901 },
				} ) }
				linkable
			/>
		);
		expect(
			screen.getByRole( 'link', { name: 'payment #901' } )
		).toHaveAttribute( 'href', url( 901 ) );
	} );

	it( 'stays plain text when the payment can’t be opened', () => {
		const { rerender, container } = render(
			<SourceDescription finding={ finding() } linkable={ false } />
		);
		expect( container ).toHaveTextContent( 'Payment #900, 15.00 EUR' );
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();

		// The payment no longer exists.
		rerender(
			<SourceDescription
				finding={ finding( {
					reason: 'missing_transaction',
					source_type: 'ledger_row',
					source_id: 3,
					detail: { transaction_id: 901 },
				} ) }
				linkable
			/>
		);
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();

		// No payment named.
		rerender(
			<SourceDescription
				finding={ finding( {
					source_type: 'signup',
					source_id: 11,
					detail: {},
				} ) }
				linkable
			/>
		);
		expect( container ).toHaveTextContent( 'Purchase #11' );
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'FindingsPanel', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	it( 'lists the open records and filters them', async () => {
		apiFetch.mockImplementation( () => respond( [ finding() ] ) );
		render(
			<FindingsPanel
				status={ STATUS }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect(
			await screen.findByText( 'Payment without a purchase' )
		).toBeInTheDocument();
		// Payment information is available: the number opens the payment.
		expect(
			screen.getByRole( 'link', { name: 'Payment #900' } )
		).toBeInTheDocument();
		expect( screen.getByText( '1 record' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Open Payment without a purchase — Payment #900, 15.00 EUR',
			} )
		).toHaveTextContent( 'Decide' );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toBe(
			'/fair-events/v1/payment-history/findings?mode=backfill&status=open&reason=&event_date_id=-1&transaction_status=&payment_mode=all&page=1&per_page=20'
		);

		fireEvent.change( screen.getByLabelText( 'Reason' ), {
			target: { value: 'no_evidence' },
		} );
		await waitFor( () =>
			expect( apiFetch.mock.calls.at( -1 )[ 0 ].path ).toContain(
				'reason=no_evidence'
			)
		);
	} );

	it( 'lists records without a migration run or a run selector', async () => {
		apiFetch.mockImplementation( () => respond( [ finding() ] ) );
		render(
			<FindingsPanel
				status={ STATUS }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect( await screen.findByText( '1 record' ) ).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Run' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /Dry run/ ) ).not.toBeInTheDocument();
		// Always the records an administrator decides on.
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toContain(
			'mode=backfill'
		);
	} );

	it( 'says there is nothing to decide on a fresh site', async () => {
		apiFetch.mockImplementation( () => respond( [] ) );
		render(
			<FindingsPanel
				status={ { ...STATUS, finding_statuses: {} } }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect(
			await screen.findByText(
				'Nothing needs a decision. Payments are linked to their purchases as they come in.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( '0 records' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Clear filters' } )
		).not.toBeInTheDocument();
	} );

	function lastQuery() {
		return new URLSearchParams(
			apiFetch.mock.calls.at( -1 )[ 0 ].path.split( '?' )[ 1 ]
		);
	}

	it( 'filters by payment status and mode, from the first page', async () => {
		apiFetch.mockImplementation( () =>
			respond( [ finding() ], {}, 45, 3 )
		);
		render(
			<FindingsPanel
				status={ STATUS }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		const paymentStatus = await screen.findByLabelText( 'Payment status' );
		const paymentMode = screen.getByLabelText( 'Payment mode' );
		expect( paymentStatus ).toHaveValue( '' );
		expect( paymentMode ).toHaveValue( 'all' );
		expect(
			Array.from( paymentStatus.options ).map( ( option ) => [
				option.value,
				option.text,
			] )
		).toEqual( [
			[ '', 'All statuses' ],
			[ 'draft', 'Not started' ],
			[ 'pending_payment,open', 'Awaiting payment' ],
			[ 'pending', 'Pending' ],
			[ 'authorized', 'Authorized' ],
			[ 'paid', 'Paid' ],
			[ 'failed', 'Failed' ],
			[ 'canceled', 'Canceled' ],
			[ 'expired', 'Expired' ],
			[ 'refunded', 'Refunded' ],
			[ 'charged_back', 'Charged back' ],
		] );
		expect(
			Array.from( paymentMode.options ).map( ( option ) => option.text )
		).toEqual( [ 'All', 'Test only', 'Live only' ] );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Next page' } )
		);
		await waitFor( () => expect( lastQuery().get( 'page' ) ).toBe( '2' ) );

		fireEvent.change( paymentStatus, { target: { value: 'canceled' } } );
		await waitFor( () => {
			expect( lastQuery().get( 'transaction_status' ) ).toBe(
				'canceled'
			);
			expect( lastQuery().get( 'page' ) ).toBe( '1' );
		} );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Next page' } )
		);
		await waitFor( () => expect( lastQuery().get( 'page' ) ).toBe( '2' ) );

		fireEvent.change( paymentMode, { target: { value: 'live' } } );
		await waitFor( () => {
			const query = lastQuery();
			expect( query.get( 'payment_mode' ) ).toBe( 'live' );
			// Combined with the other filters, and with the run's mode kept apart.
			expect( query.get( 'transaction_status' ) ).toBe( 'canceled' );
			expect( query.get( 'mode' ) ).toBe( 'backfill' );
			expect( query.get( 'status' ) ).toBe( 'open' );
			expect( query.get( 'page' ) ).toBe( '1' );
		} );
		expect( await screen.findByText( 'Page 1 of 3' ) ).toBeInTheDocument();
	} );

	it( 'says when nothing matches, and clearing the filters restores the records', async () => {
		apiFetch.mockImplementation( ( { path } ) =>
			respond( path.includes( 'payment_mode=test' ) ? [] : [ finding() ] )
		);
		render(
			<FindingsPanel
				status={ STATUS }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect( await screen.findByText( '1 record' ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'No records match these filters.' )
		).not.toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Payment mode' ), {
			target: { value: 'test' },
		} );
		expect(
			await screen.findByText( 'No records match these filters.' )
		).toBeInTheDocument();
		expect( screen.getByText( '0 records' ) ).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Clear filters' } )
		);
		expect( await screen.findByText( '1 record' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Payment mode' ) ).toHaveValue( 'all' );
		expect( lastQuery().get( 'payment_mode' ) ).toBe( 'all' );
		expect(
			screen.queryByText( 'No records match these filters.' )
		).not.toBeInTheDocument();
	} );
} );
