/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import FindingsPanel, { describeSource } from '../FindingsPanel.js';

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

describe( 'FindingsPanel', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	it( 'lists the migration’s open records and filters them', async () => {
		apiFetch.mockImplementation( () => respond( [ finding() ] ) );
		render(
			<FindingsPanel
				status={ { dry_run: {}, backfill: { status: 'verified' } } }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect(
			await screen.findByText( 'Payment without a purchase' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Payment #900, 15.00 EUR' )
		).toBeInTheDocument();
		expect( screen.getByText( '1 record' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Open Payment without a purchase — Payment #900, 15.00 EUR',
			} )
		).toHaveTextContent( 'Decide' );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toBe(
			'/fair-events/v1/payment-history/findings?mode=backfill&status=open&reason=&event_date_id=-1&transaction_expiry=all&payment_mode=all&page=1&per_page=20'
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

	it( 'shows dry run records as a preview that can’t be decided', async () => {
		apiFetch.mockImplementation( () =>
			respond( [ finding( { mode: 'dry_run' } ) ] )
		);
		render(
			<FindingsPanel
				status={ { dry_run: { status: 'complete' }, backfill: null } }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		expect(
			await screen.findAllByText(
				/Dry run records show what the migration would report/
			)
		).not.toHaveLength( 0 );
		expect(
			screen.getByRole( 'button', { name: /^Open / } )
		).toHaveTextContent( 'View' );
	} );

	function lastQuery() {
		return new URLSearchParams(
			apiFetch.mock.calls.at( -1 )[ 0 ].path.split( '?' )[ 1 ]
		);
	}

	it( 'filters by expired transaction and payment mode, from the first page', async () => {
		apiFetch.mockImplementation( () =>
			respond( [ finding() ], {}, 45, 3 )
		);
		render(
			<FindingsPanel
				status={ { dry_run: {}, backfill: { status: 'verified' } } }
				refreshKey={ 0 }
				onChanged={ jest.fn() }
			/>
		);

		const expiry = await screen.findByLabelText( 'Expired transaction' );
		const paymentMode = screen.getByLabelText( 'Payment mode' );
		expect( expiry ).toHaveValue( 'all' );
		expect( paymentMode ).toHaveValue( 'all' );
		expect(
			Array.from( expiry.options ).map( ( option ) => option.text )
		).toEqual( [ 'All', 'Expired only', 'Exclude expired' ] );
		expect(
			Array.from( paymentMode.options ).map( ( option ) => option.text )
		).toEqual( [ 'All', 'Test only', 'Live only' ] );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Next page' } )
		);
		await waitFor( () => expect( lastQuery().get( 'page' ) ).toBe( '2' ) );

		fireEvent.change( expiry, { target: { value: 'expired' } } );
		await waitFor( () => {
			expect( lastQuery().get( 'transaction_expiry' ) ).toBe( 'expired' );
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
			expect( query.get( 'transaction_expiry' ) ).toBe( 'expired' );
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
				status={ { dry_run: {}, backfill: { status: 'verified' } } }
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
