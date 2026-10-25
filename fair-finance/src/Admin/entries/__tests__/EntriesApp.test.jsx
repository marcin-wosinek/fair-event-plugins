/**
 * Component test for the focused single-entry view of the entries screen
 * (#1291). The transactions list links to `?page=fair-finance-entries&entry_id=N`;
 * the screen must narrow every request to that entry from the first load,
 * say it is narrowed, and clear back to the full list.
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
import EntriesApp from '../EntriesApp.js';
import { downloadCsv } from '../exportEntriesCsv.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../exportEntriesCsv.js', () => ( {
	...jest.requireActual( '../exportEntriesCsv.js' ),
	downloadCsv: jest.fn(),
} ) );

const BASE_PATH = '/wp-admin/admin.php?page=fair-finance-entries';

const makeEntry = ( overrides = {} ) => ( {
	id: 7,
	entry_date: '2026-09-01',
	entry_type: 'cost',
	amount: 40,
	description: 'Venue deposit',
	budget_id: null,
	event_url: null,
	parent_entry_id: null,
	transaction_ids: [],
	imported_at: null,
	...overrides,
} );

const FULL_LIST_ENTRY = makeEntry( { id: 99, description: 'Unrelated entry' } );

/**
 * Route apiFetch by path. `entries` answers list requests that carry
 * `entry_id`; every other list request gets the full list.
 *
 * @param {Object} options
 * @param {Array}  options.entries Entries for focused list requests.
 * @param {Object} options.totals  Totals for focused totals requests.
 */
const mockApi = ( {
	entries = [ makeEntry() ],
	totals = { total_cost: 40, total_income: 0, balance: -40 },
} = {} ) => {
	apiFetch.mockImplementation( ( { path } ) => {
		const [ route, query = '' ] = path.split( '?' );
		const focused = new URLSearchParams( query ).has( 'entry_id' );

		if ( route === '/fair-finance/v1/financial-entries' ) {
			const list = focused ? entries : [ FULL_LIST_ENTRY ];
			return Promise.resolve( {
				entries: list,
				total: list.length,
				pages: list.length ? 1 : 0,
			} );
		}
		if ( route === '/fair-finance/v1/financial-entries/totals' ) {
			return Promise.resolve(
				focused
					? totals
					: { total_cost: 1000, total_income: 0, balance: -1000 }
			);
		}
		if ( route === '/fair-finance/v1/financial-entries/totals-by-tag' ) {
			return Promise.resolve( {} );
		}
		return Promise.resolve( [] );
	} );
};

const requestsTo = ( route ) =>
	apiFetch.mock.calls
		.map( ( [ { path } ] ) => path )
		.filter( ( path ) => path.split( '?' )[ 0 ] === route )
		.map( ( path ) => new URLSearchParams( path.split( '?' )[ 1 ] || '' ) );

const listRequests = () => requestsTo( '/fair-finance/v1/financial-entries' );
const totalsRequests = () =>
	requestsTo( '/fair-finance/v1/financial-entries/totals' );

const openAt = ( search ) => {
	window.history.replaceState( null, '', `${ BASE_PATH }${ search }` );
};

// Notices are also announced in an a11y live region; match the visible one.
const IN_NOTICE = { selector: '.components-notice__content' };

afterEach( () => {
	jest.clearAllMocks();
	openAt( '' );
} );

describe( 'EntriesApp — focused entry view (#1291)', () => {
	it( 'narrows the first list and totals requests to the entry and says so', async () => {
		openAt( '&entry_id=7&budget_id=3' );
		mockApi();

		render( <EntriesApp /> );

		expect(
			await screen.findByText( 'Showing entry #7', IN_NOTICE )
		).toBeInTheDocument();
		expect( await screen.findByText( 'Venue deposit' ) ).toBeVisible();

		// Every list/totals request is focused; focus beats the budget filter.
		expect( listRequests().length ).toBeGreaterThan( 0 );
		for ( const params of [ ...listRequests(), ...totalsRequests() ] ) {
			expect( params.get( 'entry_id' ) ).toBe( '7' );
			expect( params.has( 'budget_id' ) ).toBe( false );
		}
		expect(
			requestsTo( '/fair-finance/v1/financial-entries/totals-by-tag' )
		).toHaveLength( 0 );

		// Ordinary filters are hidden while focused.
		expect(
			screen.queryByLabelText( 'From Date' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Unrelated entry' )
		).not.toBeInTheDocument();
	} );

	it( 'shows the totals the server returns for the focused entry', async () => {
		openAt( '&entry_id=7' );
		mockApi( {
			totals: { total_cost: 40, total_income: 0, balance: -40 },
		} );

		render( <EntriesApp /> );

		expect( await screen.findByText( '-€40.00' ) ).toBeInTheDocument();
		expect( screen.queryByText( '€1,000.00' ) ).not.toBeInTheDocument();
	} );

	it( 'renders a focused split child as its own row, without siblings', async () => {
		openAt( '&entry_id=8' );
		const parent = makeEntry( {
			id: 5,
			amount: 100,
			description: 'Split parent',
			children: [
				makeEntry( {
					id: 8,
					parent_entry_id: 5,
					description: 'Child A',
				} ),
				makeEntry( {
					id: 9,
					parent_entry_id: 5,
					description: 'Child B',
				} ),
			],
		} );
		mockApi( {
			entries: [
				makeEntry( {
					id: 8,
					parent_entry_id: 5,
					description: 'Child A',
					parent,
				} ),
			],
		} );

		render( <EntriesApp /> );

		expect( await screen.findByText( 'Child A' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Edit Split' } )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Child B' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Split parent' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a focused split parent with its nested children', async () => {
		openAt( '&entry_id=5' );
		mockApi( {
			entries: [
				makeEntry( {
					id: 5,
					amount: 100,
					description: 'Split parent',
					children: [
						makeEntry( {
							id: 8,
							amount: 60,
							parent_entry_id: 5,
							description: 'Child A',
						} ),
						makeEntry( {
							id: 9,
							amount: 40,
							parent_entry_id: 5,
							description: 'Child B',
						} ),
					],
				} ),
			],
			totals: { total_cost: 100, total_income: 0, balance: -100 },
		} );

		render( <EntriesApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: /Split ▸/ } )
		);
		expect( screen.getByText( 'Child A' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Child B' ) ).toBeInTheDocument();
		expect( screen.getByText( '-€100.00' ) ).toBeInTheDocument();
	} );

	it( 'exports only the focused entry', async () => {
		openAt( '&entry_id=7' );
		mockApi();

		render( <EntriesApp /> );
		await screen.findByText( 'Venue deposit' );
		apiFetch.mockClear();

		fireEvent.click( screen.getByRole( 'button', { name: 'Export CSV' } ) );

		await waitFor( () => expect( downloadCsv ).toHaveBeenCalled() );
		expect( listRequests() ).toHaveLength( 1 );
		expect( listRequests()[ 0 ].get( 'entry_id' ) ).toBe( '7' );
		const [ csv, filename ] = downloadCsv.mock.calls[ 0 ];
		expect( filename ).toBe( 'fair-finance-entries-entry-7.csv' );
		expect( csv ).toContain( 'Venue deposit' );
		expect( csv ).not.toContain( 'Unrelated entry' );
	} );

	it( 'clears back to the full list, removing the focus from the URL', async () => {
		openAt( '&entry_id=7' );
		mockApi();

		render( <EntriesApp /> );
		await screen.findByText( 'Venue deposit' );
		apiFetch.mockClear();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Show all entries' } )
		);

		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();
		expect(
			screen.queryByText( 'Showing entry #7', IN_NOTICE )
		).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'From Date' ) ).toBeInTheDocument();
		expect( window.location.search ).toBe( '?page=fair-finance-entries' );

		for ( const params of [ ...listRequests(), ...totalsRequests() ] ) {
			expect( params.has( 'entry_id' ) ).toBe( false );
		}
		expect( listRequests().at( -1 ).get( 'page' ) ).toBe( '1' );
		expect(
			requestsTo( '/fair-finance/v1/financial-entries/totals-by-tag' )
		).toHaveLength( 1 );
	} );

	it( 'ignores a focused response that arrives after focus was cleared', async () => {
		openAt( '&entry_id=7' );
		let resolveFocused;
		apiFetch.mockImplementation( ( { path } ) => {
			const [ route, query = '' ] = path.split( '?' );
			const focused = new URLSearchParams( query ).has( 'entry_id' );
			if ( route === '/fair-finance/v1/financial-entries' ) {
				if ( focused ) {
					return new Promise( ( resolve ) => {
						resolveFocused = resolve;
					} );
				}
				return Promise.resolve( {
					entries: [ FULL_LIST_ENTRY ],
					total: 1,
					pages: 1,
				} );
			}
			if (
				route === '/fair-finance/v1/financial-entries/totals-by-tag'
			) {
				return Promise.resolve( {} );
			}
			if ( route === '/fair-finance/v1/financial-entries/totals' ) {
				return Promise.resolve( {
					total_cost: 0,
					total_income: 0,
					balance: 0,
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <EntriesApp /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Show all entries' } )
		);
		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();

		await act( async () => {
			resolveFocused( {
				entries: [ makeEntry() ],
				total: 1,
				pages: 1,
			} );
		} );

		expect( screen.getByText( 'Unrelated entry' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Venue deposit' ) ).not.toBeInTheDocument();
	} );

	it( 'explains a missing entry and offers the full list', async () => {
		openAt( '&entry_id=404' );
		mockApi( { entries: [] } );

		render( <EntriesApp /> );

		expect(
			await screen.findByText(
				'Entry #404 was not found. It may have been deleted.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Show all entries' } )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Unrelated entry' )
		).not.toBeInTheDocument();
	} );

	it.each( [ 'abc', '0', '-3', '1.5' ] )(
		'rejects the invalid entry id "%s" without loading the full list',
		async ( raw ) => {
			openAt( `&entry_id=${ encodeURIComponent( raw ) }` );
			mockApi();

			render( <EntriesApp /> );

			expect(
				await screen.findByText(
					'This entry link is not valid.',
					IN_NOTICE
				)
			).toBeInTheDocument();
			expect( listRequests() ).toHaveLength( 0 );
			expect( totalsRequests() ).toHaveLength( 0 );
			expect(
				screen.queryByText( 'Unrelated entry' )
			).not.toBeInTheDocument();

			fireEvent.click(
				screen.getByRole( 'button', { name: 'Show all entries' } )
			);
			expect(
				await screen.findByText( 'Unrelated entry' )
			).toBeVisible();
		}
	);

	it( 'loads the full list with no focus parameter', async () => {
		mockApi();

		render( <EntriesApp /> );

		expect( await screen.findByText( 'Unrelated entry' ) ).toBeVisible();
		expect(
			screen.queryByText( /Showing entry/, IN_NOTICE )
		).not.toBeInTheDocument();
		for ( const params of listRequests() ) {
			expect( params.has( 'entry_id' ) ).toBe( false );
		}
	} );
} );

describe( 'EntriesApp — unmatching an entry (#1986)', () => {
	const MATCHED = makeEntry( {
		id: 12,
		entry_type: 'income',
		amount: 25,
		description: 'Mollie payout',
		transaction_ids: [ 3, 4 ],
	} );
	const DETAILS = {
		transactions: [
			{
				id: 3,
				amount: 10,
				currency: 'EUR',
				description: 'Ticket Ana',
				created_at: '2026-08-30 10:00:00',
				missing: false,
			},
			{ id: 4, missing: true },
		],
		settlement_protected: false,
	};

	/**
	 * Route the list, the entry detail and the unmatch request. The list
	 * shows the entry matched until a DELETE succeeds.
	 *
	 * @param {Object}   options
	 * @param {Function} options.details Detail response (may reject).
	 * @param {Function} options.unmatch DELETE response (may reject).
	 */
	const mockUnmatchApi = ( {
		details = () => Promise.resolve( { ...MATCHED, unmatch: DETAILS } ),
		unmatch = () => Promise.resolve( { ...MATCHED, transaction_ids: [] } ),
	} = {} ) => {
		let matched = true;
		apiFetch.mockImplementation( ( { path, method } ) => {
			const route = path.split( '?' )[ 0 ];
			if ( route === '/fair-finance/v1/financial-entries' ) {
				const entry = matched
					? MATCHED
					: { ...MATCHED, transaction_ids: [] };
				return Promise.resolve( {
					entries: [ entry ],
					total: 1,
					pages: 1,
				} );
			}
			if ( route === '/fair-finance/v1/financial-entries/12' ) {
				return details();
			}
			if (
				route === '/fair-finance/v1/financial-entries/12/match' &&
				method === 'DELETE'
			) {
				return unmatch().then( ( data ) => {
					matched = false;
					return data;
				} );
			}
			if ( route === '/fair-finance/v1/financial-entries/totals' ) {
				return Promise.resolve( {
					total_cost: 0,
					total_income: 25,
					balance: 25,
				} );
			}
			if (
				route === '/fair-finance/v1/financial-entries/totals-by-tag'
			) {
				return Promise.resolve( {} );
			}
			return Promise.resolve( [] );
		} );
	};

	const deleteRequests = () =>
		apiFetch.mock.calls.filter( ( [ { method } ] ) => method === 'DELETE' );

	const openDialog = async () => {
		render( <EntriesApp /> );
		const trigger = await screen.findByRole( 'button', {
			name: 'Unmatch',
		} );
		await act( async () => {
			fireEvent.click( trigger );
		} );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Unmatch entry — Mollie payout',
		} );
		return { trigger, dialog };
	};

	const confirmButton = () =>
		within( screen.getByRole( 'dialog' ) ).getByRole( 'button', {
			name: /^Unmatch/,
		} );

	it( 'lists every affected transaction, including a missing record, and unmatches', async () => {
		mockUnmatchApi();
		const { dialog } = await openDialog();

		expect(
			await within( dialog ).findByText(
				'This removes the links to all 2 transactions:'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( /Ticket Ana \(#3\)/ )
		).toBeVisible();
		expect(
			within( dialog ).getByText(
				'Transaction #4 (its record no longer exists)'
			)
		).toBeVisible();
		expect(
			within( dialog ).getByText(
				/payment-provider transactions are kept/
			)
		).toBeVisible();

		await act( async () => {
			fireEvent.click( confirmButton() );
		} );

		expect(
			await screen.findByText(
				'Entry unmatched successfully.',
				IN_NOTICE
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteRequests() ).toHaveLength( 1 );
		// The refreshed row now offers Match instead.
		expect(
			await screen.findByRole( 'button', { name: 'Match' } )
		).toBeInTheDocument();
	} );

	it( 'leaves the associations unchanged on cancel', async () => {
		mockUnmatchApi();
		const { dialog } = await openDialog();
		await within( dialog ).findByText( /This removes the links/ );

		await act( async () => {
			fireEvent.click(
				within( dialog ).getByRole( 'button', { name: 'Cancel' } )
			);
		} );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteRequests() ).toHaveLength( 0 );
		expect(
			screen.getByRole( 'button', { name: 'Unmatch' } )
		).toBeInTheDocument();
	} );

	it( 'withholds Unmatch until details load, and offers a retry when they fail', async () => {
		let fail = true;
		mockUnmatchApi( {
			details: () =>
				fail
					? Promise.reject( { message: 'Server unavailable.' } )
					: Promise.resolve( { ...MATCHED, unmatch: DETAILS } ),
		} );
		const { dialog } = await openDialog();

		expect(
			await within( dialog ).findByText( 'Server unavailable.' )
		).toBeVisible();
		expect( confirmButton() ).toBeDisabled();

		fail = false;
		await act( async () => {
			fireEvent.click(
				within( dialog ).getByRole( 'button', { name: 'Try again' } )
			);
		} );

		expect(
			await within( dialog ).findByText( /This removes the links/ )
		).toBeVisible();
		expect( confirmButton() ).toBeEnabled();
	} );

	it( 'blocks dismissal and duplicate submissions while pending, then keeps the dialog for a retry after failure', async () => {
		let reject;
		let attempts = 0;
		mockUnmatchApi( {
			unmatch: () => {
				attempts++;
				if ( attempts === 1 ) {
					return new Promise( ( resolve, rejectFn ) => {
						reject = rejectFn;
					} );
				}
				return Promise.resolve( {} );
			},
		} );
		const { dialog } = await openDialog();
		await within( dialog ).findByText( /This removes the links/ );

		await act( async () => {
			fireEvent.click( confirmButton() );
			fireEvent.click( confirmButton() );
		} );

		expect( deleteRequests() ).toHaveLength( 1 );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( confirmButton() ).toHaveTextContent( 'Unmatching…' );
		await act( async () => {
			fireEvent.keyDown( dialog, { key: 'Escape' } );
		} );
		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();

		await act( async () => {
			reject( { code: 'rest_unmatch_failed', message: '' } );
		} );

		expect(
			await within( dialog ).findByText(
				'The entry could not be unmatched. Nothing was changed; try again.'
			)
		).toBeVisible();
		expect( confirmButton() ).toBeEnabled();

		await act( async () => {
			fireEvent.click( confirmButton() );
		} );

		expect(
			await screen.findByText(
				'Entry unmatched successfully.',
				IN_NOTICE
			)
		).toBeInTheDocument();
		expect( deleteRequests() ).toHaveLength( 2 );
	} );

	it( 'explains a protected settlement association and links to Reconciliation', async () => {
		mockUnmatchApi( {
			details: () =>
				Promise.resolve( {
					...MATCHED,
					unmatch: { ...DETAILS, settlement_protected: true },
				} ),
		} );
		const { dialog } = await openDialog();

		expect(
			await within( dialog ).findByText(
				/belongs to a saved settlement reconciliation/
			)
		).toBeVisible();
		expect(
			within( dialog ).getByRole( 'link', {
				name: 'Open Reconciliation',
			} )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-reconciliation'
		);
		expect( confirmButton() ).toBeDisabled();
		expect( deleteRequests() ).toHaveLength( 0 );
	} );

	it( 'switches to the protected explanation when the server reports a conflict', async () => {
		mockUnmatchApi( {
			unmatch: () =>
				Promise.reject( {
					code: 'reconciliation_entry_in_use',
					message: 'This entry belongs to a saved settlement.',
				} ),
		} );
		const { dialog } = await openDialog();
		await within( dialog ).findByText( /This removes the links/ );

		await act( async () => {
			fireEvent.click( confirmButton() );
		} );

		expect(
			await within( dialog ).findByRole( 'link', {
				name: 'Open Reconciliation',
			} )
		).toBeVisible();
		expect( confirmButton() ).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Unmatch' } )
		).toBeInTheDocument();
	} );

	it( 'reports a failed refresh separately from the unmatch', async () => {
		let refreshFails = false;
		mockUnmatchApi( {
			unmatch: () => {
				refreshFails = true;
				return Promise.resolve( {} );
			},
		} );
		const original = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) => {
			if (
				refreshFails &&
				request.path.startsWith( '/fair-finance/v1/financial-entries?' )
			) {
				return Promise.reject( { message: 'Gateway timeout.' } );
			}
			return original( request );
		} );
		const { dialog } = await openDialog();
		await within( dialog ).findByText( /This removes the links/ );

		await act( async () => {
			fireEvent.click( confirmButton() );
		} );

		expect(
			await screen.findByText(
				'The list could not be refreshed. Reload the page to see the current entries.',
				IN_NOTICE
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		// The rows stay rather than emptying the table.
		expect( screen.getByText( 'Mollie payout' ) ).toBeInTheDocument();
	} );
} );

describe( 'EntriesApp — deleting and unsplitting entries (#1936)', () => {
	const ENTRY = makeEntry( {
		id: 21,
		description: 'Projector rental',
		amount: 60,
		transaction_ids: [ 5 ],
	} );
	const SPLIT = makeEntry( {
		id: 30,
		description: 'Bulk purchase',
		amount: 100,
		children: [
			makeEntry( {
				id: 31,
				parent_entry_id: 30,
				description: 'Bulk purchase',
				amount: 70,
				budget_id: 2,
			} ),
			makeEntry( {
				id: 32,
				parent_entry_id: 30,
				description: 'Bulk purchase',
				amount: 30,
			} ),
		],
	} );

	/**
	 * Route the list and the DELETE requests.
	 *
	 * @param {Function} remove Response to every DELETE (may reject).
	 */
	const mockRemovalApi = ( remove ) => {
		apiFetch.mockImplementation( ( { path, method } ) => {
			const route = path.split( '?' )[ 0 ];
			if ( method === 'DELETE' ) {
				return remove( route );
			}
			if ( route === '/fair-finance/v1/financial-entries' ) {
				return Promise.resolve( {
					entries: [ ENTRY, SPLIT ],
					total: 2,
					pages: 1,
				} );
			}
			if ( route === '/fair-finance/v1/budgets' ) {
				return Promise.resolve( [ { id: 2, name: 'Venue' } ] );
			}
			if ( route === '/fair-finance/v1/financial-entries/totals' ) {
				return Promise.resolve( {
					total_cost: 160,
					total_income: 0,
					balance: -160,
				} );
			}
			if (
				route === '/fair-finance/v1/financial-entries/totals-by-tag'
			) {
				return Promise.resolve( {} );
			}
			return Promise.resolve( [] );
		} );
	};

	const deleteRequests = () =>
		apiFetch.mock.calls.filter( ( [ { method } ] ) => method === 'DELETE' );

	it( 'names the entry and its matched transaction, and cancelling sends nothing', async () => {
		mockRemovalApi( () => Promise.resolve( {} ) );
		render( <EntriesApp /> );
		await screen.findByText( 'Projector rental' );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		const dialog = screen.getByRole( 'dialog', {
			name: 'Delete entry — Projector rental',
		} );

		expect(
			within( dialog ).getByText( 'Dated 2026-09-01, €60.00.' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'It is matched to 1 transaction, which is not deleted.'
			)
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteRequests() ).toHaveLength( 0 );
	} );

	it( 'keeps the delete dialog open on failure and retries', async () => {
		let attempts = 0;
		mockRemovalApi( () => {
			attempts++;
			return attempts === 1
				? Promise.reject( {} )
				: Promise.resolve( { deleted: true } );
		} );
		render( <EntriesApp /> );
		await screen.findByText( 'Projector rental' );
		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		const dialog = screen.getByRole( 'dialog' );
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete entry',
		} );

		await act( async () => {
			fireEvent.click( confirm );
			fireEvent.click( confirm );
		} );

		expect( deleteRequests() ).toHaveLength( 1 );
		expect(
			within( dialog ).getByText(
				'The entry could not be deleted. Try again.',
				IN_NOTICE
			)
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( confirm );
		} );

		expect( deleteRequests()[ 1 ][ 0 ].path ).toBe(
			'/fair-finance/v1/financial-entries/21'
		);
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByText(
				'Entry “Projector rental” deleted.',
				IN_NOTICE
			)
		).toBeInTheDocument();
	} );

	it( 'confirms unsplitting over the split editor, listing its allocations', async () => {
		mockRemovalApi( () => Promise.resolve( {} ) );
		render( <EntriesApp /> );
		await screen.findByText( 'Projector rental' );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Edit Split' } )[ 0 ]
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Unsplit' } ) );

		const confirmDialog = screen.getByRole( 'dialog', {
			name: 'Unsplit entry — Bulk purchase',
		} );
		expect(
			within( confirmDialog ).getByText(
				'This deletes all 2 of its allocations:'
			)
		).toBeInTheDocument();
		expect(
			within( confirmDialog ).getByText( '€70.00 to Venue' )
		).toBeInTheDocument();
		expect(
			within( confirmDialog ).getByText( '€30.00 to Unbudgeted' )
		).toBeInTheDocument();

		// Cancelling returns to the split editor without a request.
		fireEvent.click(
			within( confirmDialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		expect( deleteRequests() ).toHaveLength( 0 );
		expect(
			screen.getByRole( 'button', { name: 'Unsplit' } )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Unsplit' } ) );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Unsplit entry' } )
			);
		} );

		expect( deleteRequests()[ 0 ][ 0 ].path ).toBe(
			'/fair-finance/v1/financial-entries/30/split'
		);
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByText(
				'Entry “Bulk purchase” unsplit.',
				IN_NOTICE
			)
		).toBeInTheDocument();
	} );

	it( 'keeps both the confirmation and the split editor while an unsplit is pending', async () => {
		let resolve;
		mockRemovalApi( () => new Promise( ( done ) => ( resolve = done ) ) );
		render( <EntriesApp /> );
		await screen.findByText( 'Projector rental' );
		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Edit Split' } )[ 0 ]
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Unsplit' } ) );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Unsplit entry' } )
			);
		} );

		const confirmDialog = screen.getByRole( 'dialog', {
			name: 'Unsplit entry — Bulk purchase',
		} );
		await act( async () => {
			fireEvent.keyDown(
				within( confirmDialog ).getByRole( 'button', {
					name: 'Unsplitting…',
				} ),
				{ key: 'Escape', code: 'Escape' }
			);
			// Outlast the modal exit animation a dismissal would wait for.
			await new Promise( ( done ) => setTimeout( done, 500 ) );
		} );

		expect( confirmDialog ).toBeInTheDocument();
		expect( document.querySelectorAll( '[role="dialog"]' ) ).toHaveLength(
			2
		);
		expect( deleteRequests() ).toHaveLength( 1 );

		await act( async () => resolve( {} ) );

		expect( document.querySelectorAll( '[role="dialog"]' ) ).toHaveLength(
			0
		);
	} );
} );
