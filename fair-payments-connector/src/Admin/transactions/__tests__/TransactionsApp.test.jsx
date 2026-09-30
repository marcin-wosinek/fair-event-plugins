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

describe( 'TransactionsApp — load missing Mollie fees (#1695)', () => {
	const LIST = '/fair-payments-connector/v1/transactions?';
	const RUNS = '/fair-payments-connector/v1/external-updates/runs';
	const BATCH = '/fair-payments-connector/v1/transactions/sync-mollie-batch';

	const noticeText = ( text ) =>
		screen.queryByText(
			( content, element ) =>
				content === text &&
				element?.className === 'components-notice__content'
		);

	const listCalls = () =>
		apiFetch.mock.calls.filter( ( [ options ] ) =>
			options.path.startsWith( LIST )
		);

	/**
	 * Route the list, run, batch, and finish requests; the run start and
	 * batches can be deferred to observe the running state.
	 *
	 * @param {Object} overrides Per-path responders.
	 */
	const mockRoutes = ( overrides = {} ) => {
		apiFetch.mockImplementation( ( options ) => {
			if ( options.path.startsWith( LIST ) ) {
				return Promise.resolve( {
					transactions: overrides.transactions ?? [ TRANSACTION ],
					total: 1,
					pages: 1,
				} );
			}
			if ( options.path === RUNS ) {
				return overrides.start( options );
			}
			if ( options.path === BATCH ) {
				return overrides.batch( options );
			}
			if ( options.path.startsWith( `${ RUNS }/` ) ) {
				return overrides.finish( options );
			}
			return Promise.reject( new Error( options.path ) );
		} );
	};

	const feeButton = () =>
		screen.getByRole( 'button', {
			name: /Load missing Mollie fees|Loading fees…/,
		} );

	it( 'sits beside Import in the toolbar, even when the list is empty', async () => {
		mockRoutes( { transactions: [] } );
		render( <TransactionsApp /> );

		expect(
			await screen.findByText( 'No transactions found.' )
		).toBeInTheDocument();
		const button = screen.getByRole( 'button', {
			name: 'Load missing Mollie fees',
		} );
		const importButton = screen.getByRole( 'button', {
			name: 'Import',
		} );
		expect( button.parentElement ).toBe( importButton.parentElement );
	} );

	it( 'starts a logged run scoped by the Mode filter, blocks repeat clicks, shows progress, and refreshes the list', async () => {
		let resolveStart;
		const deferred = [];
		mockRoutes( {
			start: () =>
				new Promise( ( resolve ) => ( resolveStart = resolve ) ),
			batch: () => new Promise( ( resolve ) => deferred.push( resolve ) ),
			finish: () =>
				Promise.resolve( {
					run: {
						id: 5,
						status: 'succeeded',
						counts: { updated: 12 },
					},
				} ),
		} );

		render( <TransactionsApp /> );
		await screen.findByText( '#12, #34' );

		fireEvent.change( screen.getByLabelText( 'Mode' ), {
			target: { value: 'test' },
		} );
		await screen.findByText( '#12, #34' );
		const listsBefore = listCalls().length;

		fireEvent.click( feeButton() );
		fireEvent.click( feeButton() );

		expect(
			apiFetch.mock.calls.filter(
				( [ options ] ) => options.path === RUNS
			)
		).toHaveLength( 1 );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: RUNS,
				method: 'POST',
				data: {
					action: 'load_missing_mollie_fees',
					source_id: 'test',
				},
			} )
		);
		await waitFor( () => expect( feeButton() ).toBeDisabled() );
		expect( feeButton() ).toHaveTextContent( 'Loading fees…' );

		resolveStart( {
			run: { id: 5, status: 'running' },
			ids: Array.from( { length: 12 }, ( _, i ) => i + 1 ),
		} );

		await waitFor( () => expect( deferred ).toHaveLength( 1 ) );
		expect(
			apiFetch.mock.calls.find(
				( [ options ] ) => options.path === BATCH
			)[ 0 ].data
		).toEqual( {
			ids: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ],
			run_id: 5,
		} );
		deferred[ 0 ]( { updated: 10, failed: 0 } );
		await waitFor( () =>
			expect(
				noticeText(
					'Loading Mollie fees: 10 of 12 (updated: 10, failed: 0)'
				)
			).toBeInTheDocument()
		);

		await waitFor( () => expect( deferred ).toHaveLength( 2 ) );
		deferred[ 1 ]( { updated: 2, failed: 0 } );

		await waitFor( () =>
			expect( noticeText( 'Finished: 12 updated.' ) ).toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: `${ RUNS }/5/finish`,
				method: 'POST',
			} )
		);
		expect( listCalls().length ).toBeGreaterThan( listsBefore );
		expect(
			screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
		).toBeEnabled();
	} );

	it( 'uses "all" as the run source when Mode is All modes', async () => {
		mockRoutes( {
			start: () =>
				Promise.resolve( {
					run: { id: 6, status: 'succeeded' },
					ids: [],
				} ),
		} );
		render( <TransactionsApp /> );
		await screen.findByText( '#12, #34' );

		fireEvent.change( screen.getByLabelText( 'Mode' ), {
			target: { value: '' },
		} );
		await screen.findByText( '#12, #34' );
		fireEvent.click( feeButton() );

		await waitFor( () =>
			expect(
				noticeText(
					'No paid transactions are missing Mollie fee data.'
				)
			).toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: {
					action: 'load_missing_mollie_fees',
					source_id: 'all',
				},
			} )
		);
	} );

	it( 'reports a partial run as a warning', async () => {
		mockRoutes( {
			start: () =>
				Promise.resolve( {
					run: { id: 7, status: 'running' },
					ids: [ 1, 2 ],
				} ),
			batch: () => Promise.reject( new Error( 'network error' ) ),
			finish: () =>
				Promise.resolve( {
					run: {
						id: 7,
						status: 'partial',
						counts: { updated: 0, failed: 2 },
						error_message: 'Some requests did not complete.',
					},
				} ),
		} );
		const { container } = render( <TransactionsApp /> );
		await screen.findByText( '#12, #34' );
		fireEvent.click( feeButton() );

		await waitFor( () =>
			expect(
				noticeText(
					'Partly completed: 2 failed. Some requests did not complete.'
				)
			).toBeInTheDocument()
		);
		expect(
			container.querySelector( '.components-notice.is-warning' )
		).toBeInTheDocument();
	} );

	it( 'shows the server refusal as an error and lets the action run again', async () => {
		mockRoutes( {
			start: () =>
				Promise.reject( {
					code: 'external_update_in_progress',
					message:
						'Another external update is still running. Wait for it to finish, then try again.',
					data: { status: 409 },
				} ),
		} );
		const { container } = render( <TransactionsApp /> );
		await screen.findByText( '#12, #34' );
		fireEvent.click( feeButton() );

		await waitFor( () =>
			expect(
				noticeText(
					'Another external update is still running. Wait for it to finish, then try again.'
				)
			).toBeInTheDocument()
		);
		expect(
			container.querySelector( '.components-notice.is-error' )
		).toBeInTheDocument();
		await waitFor( () => expect( feeButton() ).toBeEnabled() );
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
