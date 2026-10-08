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
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Apply filters' } )
		);
		await waitFor( () => expect( listCalls() ).toHaveLength( 2 ) );
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
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Apply filters' } )
		);
		await waitFor( () => expect( listCalls() ).toHaveLength( 2 ) );
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

describe( 'TransactionsApp — search and filters (#1753)', () => {
	const LIST = '/fair-payments-connector/v1/transactions?';

	const row = ( id, overrides = {} ) => ( {
		...TRANSACTION,
		id,
		mollie_payment_id: `tr_row${ id }`,
		description: `Row ${ id }`,
		entry_ids: [],
		...overrides,
	} );

	const listCalls = () =>
		apiFetch.mock.calls
			.map( ( [ options ] ) => options.path )
			.filter( ( path ) => path.startsWith( LIST ) );

	const lastParams = () =>
		Object.fromEntries(
			new URLSearchParams( listCalls().at( -1 ).slice( LIST.length ) )
		);

	const respond = ( transactions, total = transactions.length, pages = 1 ) =>
		Promise.resolve( { transactions, total, pages } );

	const type = ( label, value ) =>
		fireEvent.change( screen.getByLabelText( label ), {
			target: { value },
		} );

	const applyButton = () =>
		screen.getByRole( 'button', { name: 'Apply filters' } );

	const rowCheckbox = ( id ) =>
		screen
			.getByRole( 'link', { name: String( id ) } )
			.closest( 'tr' )
			.querySelector( 'input[type="checkbox"]' );

	it( 'loads the Paid / Live defaults and shows them as applied filters with a count', async () => {
		apiFetch.mockImplementation( () => respond( [ row( 1 ) ], 73, 2 ) );
		render( <TransactionsApp /> );

		expect(
			await screen.findByText( '73 transactions found.' )
		).toBeInTheDocument();
		expect( lastParams() ).toEqual( {
			page: '1',
			per_page: '50',
			status: 'paid',
			mode: 'live',
			orderby: 'created_at',
			order: 'desc',
		} );
		expect( screen.getByText( 'Status: Paid' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Mode: Live' ) ).toBeInTheDocument();
	} );

	it( 'keeps drafts out of the list until Apply, then sends every criterion, returns to page 1 and keeps the sort', async () => {
		apiFetch.mockImplementation( () => respond( [ row( 1 ) ], 120, 3 ) );
		render( <TransactionsApp /> );
		await screen.findByText( '120 transactions found.' );

		fireEvent.click( screen.getByText( /^Amount/, { selector: 'th' } ) );
		await waitFor( () => expect( listCalls() ).toHaveLength( 2 ) );
		await screen.findByText( '120 transactions found.' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
		await waitFor( () => expect( lastParams().page ).toBe( '2' ) );
		await screen.findByText( '120 transactions found.' );
		const before = listCalls().length;

		type( 'Search', '  jane@example.com ' );
		type( 'Status', '' );
		type( 'Mode', 'test' );
		type( 'From date', '2026-03-01' );
		type( 'To date', '2026-03-31' );
		type( 'Minimum amount', '0' );
		type( 'Maximum amount', '25.50' );

		expect( listCalls() ).toHaveLength( before );
		expect(
			screen.getByText(
				'Filters changed. Select “Apply filters” to update the list.'
			)
		).toBeInTheDocument();

		fireEvent.click( applyButton() );

		await waitFor( () => expect( listCalls() ).toHaveLength( before + 1 ) );
		expect( lastParams() ).toEqual( {
			page: '1',
			per_page: '50',
			mode: 'test',
			search: 'jane@example.com',
			date_from: '2026-03-01',
			date_to: '2026-03-31',
			amount_min: '0',
			amount_max: '25.50',
			orderby: 'amount',
			order: 'desc',
		} );
		for ( const label of [
			'Status: All statuses',
			'Mode: Test',
			'Search: jane@example.com',
			'From 2026-03-01',
			'Until 2026-03-31',
			'Amount at least 0',
			'Amount at most 25.50',
		] ) {
			expect( screen.getByText( label ) ).toBeInTheDocument();
		}
	} );

	it( 'applies the filters when Enter submits the form', async () => {
		render( <TransactionsApp /> );
		await screen.findByText( '1 transaction found.' );

		type( 'Search', 'tr_abc' );
		fireEvent.submit(
			screen.getByRole( 'form', { name: 'Filter transactions' } )
		);

		await waitFor( () => expect( lastParams().search ).toBe( 'tr_abc' ) );
	} );

	it( 'resets to the Paid / Live defaults on page 1 and keeps the sort', async () => {
		apiFetch.mockImplementation( () => respond( [ row( 1 ) ], 120, 3 ) );
		render( <TransactionsApp /> );
		await screen.findByText( '120 transactions found.' );

		fireEvent.click( screen.getByText( /^ID/, { selector: 'th' } ) );
		type( 'Search', 'workshop' );
		type( 'Mode', '' );
		fireEvent.click( applyButton() );
		await waitFor( () => expect( lastParams().search ).toBe( 'workshop' ) );
		await screen.findByText( '120 transactions found.' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
		await waitFor( () => expect( lastParams().page ).toBe( '2' ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Reset filters' } )
		);

		await waitFor( () =>
			expect( lastParams() ).toEqual( {
				page: '1',
				per_page: '50',
				status: 'paid',
				mode: 'live',
				orderby: 'id',
				order: 'desc',
			} )
		);
		expect( screen.getByLabelText( 'Search' ) ).toHaveValue( '' );
		expect( screen.getByLabelText( 'Mode' ) ).toHaveValue( 'live' );
	} );

	it( 'explains invalid ranges inline and does not request them', async () => {
		render( <TransactionsApp /> );
		await screen.findByText( '1 transaction found.' );
		const before = listCalls().length;

		type( 'From date', '2026-04-02' );
		type( 'To date', '2026-04-01' );
		expect(
			screen.getByText(
				'The end date must be on or after the start date.'
			)
		).toBeInTheDocument();
		expect( applyButton() ).toBeDisabled();

		type( 'To date', '2026-04-02' );
		type( 'Minimum amount', '10' );
		type( 'Maximum amount', '9.99' );
		expect(
			screen.getByText(
				'The maximum amount must not be less than the minimum amount.'
			)
		).toBeInTheDocument();

		type( 'Maximum amount', '10.123' );
		expect(
			screen.getByText(
				'Enter an amount of zero or more with at most two decimal places.'
			)
		).toBeInTheDocument();
		expect( applyButton() ).toBeDisabled();

		fireEvent.submit(
			screen.getByRole( 'form', { name: 'Filter transactions' } )
		);
		expect( listCalls() ).toHaveLength( before );

		type( 'Maximum amount', '10' );
		expect( applyButton() ).toBeEnabled();
	} );

	it( 'tells a valid query with no matches apart from a failed request', async () => {
		apiFetch.mockImplementation( () => respond( [] ) );
		render( <TransactionsApp /> );
		await screen.findByText( 'No transactions found.' );

		type( 'Search', 'nobody' );
		fireEvent.click( applyButton() );
		expect(
			await screen.findByText(
				'No transactions match these filters. Change them or select “Reset filters”.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( '0 transactions found.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Reset filters' } )
		).toBeEnabled();

		apiFetch.mockImplementation( () =>
			Promise.reject( new Error( 'Server unavailable.' ) )
		);
		fireEvent.click( applyButton() );

		await waitFor( () =>
			expect(
				screen.getAllByText( 'Server unavailable.' ).length
			).toBeGreaterThan( 0 )
		);
		expect(
			screen.queryByText( /No transactions (found|match)/ )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( /transactions? found\./ )
		).not.toBeInTheDocument();

		apiFetch.mockImplementation( () => respond( [ row( 7 ) ] ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect(
			await screen.findByText( '1 transaction found.' )
		).toBeInTheDocument();
	} );

	it( 'ignores an older response that arrives after a newer one', async () => {
		const pending = [];
		apiFetch.mockImplementation(
			() => new Promise( ( resolve ) => pending.push( resolve ) )
		);
		render( <TransactionsApp /> );
		await waitFor( () => expect( pending ).toHaveLength( 1 ) );

		type( 'Search', 'newer' );
		fireEvent.click( applyButton() );
		await waitFor( () => expect( pending ).toHaveLength( 2 ) );

		pending[ 1 ]( {
			transactions: [ row( 2, { description: 'Newer result' } ) ],
			total: 1,
			pages: 1,
		} );
		expect( await screen.findByText( 'Newer result' ) ).toBeInTheDocument();

		pending[ 0 ]( {
			transactions: [ row( 1, { description: 'Older result' } ) ],
			total: 50,
			pages: 1,
		} );
		await Promise.resolve();

		expect( screen.queryByText( 'Older result' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Newer result' ) ).toBeInTheDocument();
		expect(
			screen.getByText( '1 transaction found.' )
		).toBeInTheDocument();
	} );

	describe( 'selection and export', () => {
		let exported;
		let click;

		beforeEach( () => {
			exported = null;
			global.Blob = class {
				constructor( parts ) {
					exported = JSON.parse( parts.join( '' ) );
				}
			};
			URL.createObjectURL = jest.fn( () => 'blob:transactions' );
			URL.revokeObjectURL = jest.fn();
			click = jest
				.spyOn( HTMLAnchorElement.prototype, 'click' )
				.mockImplementation( () => {} );
		} );

		afterEach( () => {
			click.mockRestore();
		} );

		const exportButton = () =>
			screen.queryByRole( 'button', { name: 'Export Selected' } );

		it( 'clears the selection when criteria, page or sorting change', async () => {
			apiFetch.mockImplementation( () =>
				respond( [ row( 1 ), row( 2 ) ], 120, 3 )
			);
			render( <TransactionsApp /> );
			await screen.findByText( 'Row 1' );

			for ( const change of [
				() => {
					type( 'Search', 'row' );
					fireEvent.click( applyButton() );
				},
				() =>
					fireEvent.click(
						screen.getByRole( 'button', { name: 'Next' } )
					),
				() =>
					fireEvent.click(
						screen.getByText( /^Amount/, { selector: 'th' } )
					),
				() =>
					fireEvent.click(
						screen.getByRole( 'button', { name: 'Reset filters' } )
					),
			] ) {
				fireEvent.click( rowCheckbox( 1 ) );
				expect( exportButton() ).toBeInTheDocument();
				const calls = listCalls().length;

				change();

				expect( exportButton() ).not.toBeInTheDocument();
				await waitFor( () =>
					expect( listCalls() ).toHaveLength( calls + 1 )
				);
				await screen.findByText( 'Row 1' );
				expect( rowCheckbox( 1 ) ).not.toBeChecked();
			}
		} );

		it( 'drops the selection when filters are applied again and exports only rows selected afterwards', async () => {
			let rows = [ row( 1 ), row( 2 ), row( 3 ) ];
			let release;
			apiFetch.mockImplementation( () => respond( rows ) );
			render( <TransactionsApp /> );
			await screen.findByText( 'Row 1' );

			fireEvent.click( rowCheckbox( 1 ) );
			fireEvent.click( rowCheckbox( 2 ) );

			// Row 2 is gone by the time the same criteria are applied again.
			rows = [ row( 1 ), row( 3 ) ];
			apiFetch.mockImplementation(
				() =>
					new Promise( ( resolve ) => {
						release = () =>
							resolve( {
								transactions: rows,
								total: rows.length,
								pages: 1,
							} );
					} )
			);
			fireEvent.submit(
				screen.getByRole( 'form', { name: 'Filter transactions' } )
			);
			await waitFor( () => expect( release ).toBeDefined() );
			release();
			await screen.findByText( '2 transactions found.' );

			expect( rowCheckbox( 1 ) ).not.toBeChecked();
			expect( exportButton() ).not.toBeInTheDocument();

			fireEvent.click( rowCheckbox( 3 ) );
			fireEvent.click( exportButton() );

			expect( exported.map( ( t ) => t.mollie_payment_id ) ).toEqual( [
				'tr_row3',
			] );
		} );

		it( 'intersects the selection with the rows a fee-load refresh returns and disables export while loading', async () => {
			const RUNS = '/fair-payments-connector/v1/external-updates/runs';
			let rows = [ row( 1 ), row( 2 ) ];
			let releaseList;
			let hold = false;
			apiFetch.mockImplementation( ( options ) => {
				if ( options.path === RUNS ) {
					return Promise.resolve( {
						run: { id: 9, status: 'succeeded' },
						ids: [],
					} );
				}
				if ( ! hold ) {
					return respond( rows );
				}
				return new Promise( ( resolve ) => {
					releaseList = () =>
						resolve( {
							transactions: rows,
							total: rows.length,
							pages: 1,
						} );
				} );
			} );
			render( <TransactionsApp /> );
			await screen.findByText( 'Row 1' );

			fireEvent.click( rowCheckbox( 1 ) );
			fireEvent.click( rowCheckbox( 2 ) );

			rows = [ row( 2 ) ];
			hold = true;
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Load missing Mollie fees',
				} )
			);
			await waitFor( () => expect( releaseList ).toBeDefined() );
			expect( exportButton() ).toBeDisabled();

			releaseList();
			await screen.findByText( '1 transaction found.' );
			expect( rowCheckbox( 2 ) ).toBeChecked();

			fireEvent.click( exportButton() );
			expect( exported.map( ( t ) => t.mollie_payment_id ) ).toEqual( [
				'tr_row2',
			] );
		} );
	} );
} );
