/**
 * Component test for the transactions list "Entry" column (#1290).
 *
 * The `entry_id` deep link into the entries screen never worked (no reader,
 * no filter, no model support), so instead of repairing it the link is
 * dropped: entry ids render as plain, comma-separated text and no anchor
 * points at the retired `fair-payments-connector-entries` slug.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TransactionsApp from '../TransactionsApp.js';

jest.mock( '@wordpress/api-fetch' );

const TRANSACTION = {
	id: 42,
	amount: 12.5,
	currency: 'EUR',
	mollie_fee: null,
	application_fee: null,
	status: 'paid',
	testmode: false,
	description: 'Ticket purchase',
	participant: null,
	user_name: 'Jane Doe',
	entry_ids: [ 12, 34 ],
	created_at: '2026-07-01',
};

beforeEach( () => {
	apiFetch.mockImplementation( () =>
		Promise.resolve( {
			transactions: [ TRANSACTION ],
			total: 1,
			pages: 1,
		} )
	);
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'TransactionsApp — entry column', () => {
	it( 'renders entry ids as plain text, not a link to the retired entries slug', async () => {
		render( <TransactionsApp /> );

		expect( await screen.findByText( '#12, #34' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: /#12|#34/ } )
		).not.toBeInTheDocument();

		const staleLink = screen
			.queryAllByRole( 'link' )
			.find( ( l ) =>
				( l.getAttribute( 'href' ) || '' ).includes(
					'fair-payments-connector-entries'
				)
			);
		expect( staleLink ).toBeUndefined();
	} );
} );

describe( 'TransactionsApp — batch Mollie fee sync (#1555)', () => {
	it( 'chunks ids into batches, tallies cumulative progress, continues past a fully failed batch, and refreshes once at the end', async () => {
		const ids = Array.from( { length: 25 }, ( _, i ) => i + 1 );
		const batchRequests = [];
		const deferredBatches = [];

		apiFetch.mockImplementation( ( options ) => {
			if (
				options.path.startsWith(
					'/fair-payments-connector/v1/transactions/missing-mollie-fee'
				)
			) {
				return Promise.resolve( { ids } );
			}
			if (
				options.path ===
				'/fair-payments-connector/v1/transactions/sync-mollie-batch'
			) {
				batchRequests.push( options.data.ids );
				let resolve, reject;
				const promise = new Promise( ( res, rej ) => {
					resolve = res;
					reject = rej;
				} );
				deferredBatches.push( { resolve, reject } );
				return promise;
			}
			return Promise.resolve( {
				transactions: [ TRANSACTION ],
				total: 1,
				pages: 1,
			} );
		} );

		render( <TransactionsApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Load Missing Mollie Fees',
			} )
		);

		// The accessibility live region echoes notice text alongside the
		// visible Notice, so scope matches to the rendered notice itself.
		const noticeText = ( text ) =>
			screen.getByText(
				( content, element ) =>
					content === text &&
					element?.className === 'components-notice__content'
			);

		// First batch: 10 ids, 9 updated / 1 failed.
		await waitFor( () => expect( deferredBatches ).toHaveLength( 1 ) );
		expect( batchRequests[ 0 ] ).toHaveLength( 10 );
		deferredBatches[ 0 ].resolve( {
			processed: 10,
			updated: 9,
			failed: 1,
		} );
		await waitFor( () =>
			expect(
				noticeText(
					'Syncing Mollie fees: 10 / 25 (updated: 9, failed: 1)'
				)
			).toBeInTheDocument()
		);

		// Second batch: 10 ids, the request itself fails — every id in it
		// counts as failed, and the loop still moves on to the third batch.
		await waitFor( () => expect( deferredBatches ).toHaveLength( 2 ) );
		expect( batchRequests[ 1 ] ).toHaveLength( 10 );
		deferredBatches[ 1 ].reject( new Error( 'network error' ) );
		await waitFor( () =>
			expect(
				noticeText(
					'Syncing Mollie fees: 20 / 25 (updated: 9, failed: 11)'
				)
			).toBeInTheDocument()
		);

		// Third batch: the remaining 5 ids, 4 updated / 1 failed.
		await waitFor( () => expect( deferredBatches ).toHaveLength( 3 ) );
		expect( batchRequests[ 2 ] ).toHaveLength( 5 );
		deferredBatches[ 2 ].resolve( { processed: 5, updated: 4, failed: 1 } );

		await waitFor( () =>
			expect(
				noticeText(
					'Mollie fee sync complete: 13 updated, 12 failed (out of 25).'
				)
			).toBeInTheDocument()
		);

		const listCalls = apiFetch.mock.calls.filter( ( [ options ] ) =>
			options.path.startsWith(
				'/fair-payments-connector/v1/transactions?'
			)
		);
		// Initial mount load, plus exactly one refresh once every batch settled.
		expect( listCalls ).toHaveLength( 2 );
	} );
} );

describe( 'TransactionsApp — post-deletion success notice (#1618)', () => {
	afterEach( () => {
		window.history.pushState( {}, '', '/' );
	} );

	// The accessibility live region echoes notice text alongside the visible
	// Notice, so scope matches to the rendered notice content itself.
	const successNoticeContent = () =>
		screen.queryByText(
			( content, element ) =>
				content ===
					'Transaction deleted. The payment in Mollie or any other external service was not changed.' &&
				element?.className === 'components-notice__content'
		);

	it( 'shows a success notice for the one-use marker and strips it from the URL', async () => {
		window.history.pushState(
			{},
			'',
			'/?page=fair-payments-connector-transactions&transaction_deleted=1'
		);

		render( <TransactionsApp /> );

		await waitFor( () =>
			expect( successNoticeContent() ).toBeInTheDocument()
		);

		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-transactions'
		);
	} );

	it( 'shows no success notice when the marker is absent', async () => {
		window.history.pushState(
			{},
			'',
			'/?page=fair-payments-connector-transactions'
		);

		render( <TransactionsApp /> );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect( successNoticeContent() ).not.toBeInTheDocument();
	} );
} );
