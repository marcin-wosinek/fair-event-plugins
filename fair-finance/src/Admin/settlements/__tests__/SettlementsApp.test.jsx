/**
 * Component tests for the Settlements page (#1694): the saved list, the
 * resumable Mollie import, the CSV import dialog and one settlement's detail.
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
import SettlementsApp from '../SettlementsApp.js';

jest.mock( '@wordpress/api-fetch' );
// Notices also announce themselves in a live region, which would make every
// notice text match twice.
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

const BASE = '/fair-payments-connector/v1/settlements';

const VERIFIED = {
	id: 1,
	label: 'Mollie org_test',
	verified: true,
	organization_id: 'org_test',
	is_connected: true,
};
const LOCAL = {
	id: 2,
	label: 'Old exports',
	verified: false,
	organization_id: null,
	is_connected: false,
};
const CONNECTED = {
	connected: true,
	organization_id: 'org_test',
	can_import: true,
	problem: null,
	problem_message: null,
};

const summary = ( overrides = {} ) => ( {
	id: 3,
	account: VERIFIED,
	provider_id: 'stl_test1',
	reference: 'TEST.2605.01',
	currency: 'EUR',
	amount: '38.55',
	status: 'paidout',
	created_at: '2026-05-01 08:00:00',
	settled_at: '2026-05-02 08:00:00',
	invoice_id: 'inv_test1',
	sources: [ 'api' ],
	completeness: 'verified',
	discrepancy_count: 0,
	last_refreshed_at: '2026-05-03 09:00:00',
	last_csv_import_at: null,
	last_failure: null,
	material_change_at: null,
	...overrides,
} );

const movement = ( overrides = {} ) => ( {
	key: 'api:payment:tr_test1#1',
	type: 'payment',
	external_id: 'tr_test1',
	payment_reference: 'tr_test1',
	description: 'Ticket A',
	provider_status: 'paid',
	occurred_at: '2026-05-01 10:00:00',
	amount: '25.00',
	currency: 'EUR',
	settlement_amount: '25.00',
	settlement_currency: 'EUR',
	needs_review: false,
	sources: [ 'api' ],
	conflict: null,
	local_transaction_id: null,
	...overrides,
} );

const totals = ( amount ) => ( {
	by_type: {
		payment: {
			count: 2,
			unknown: 0,
			currency: 'EUR',
			settlement_amount: amount,
		},
	},
	detail: {
		count: 2,
		unknown: 0,
		currency: 'EUR',
		settlement_amount: amount,
	},
	aggregate: {
		count: 0,
		unknown: 0,
		currency: null,
		settlement_amount: null,
	},
	payments_settled_by_captures: 0,
} );

const detail = ( overrides = {} ) => ( {
	...summary(),
	revisions: {
		api: {
			id: 9,
			content_hash: 'abc',
			published_at: '2026-05-03 09:00:00',
			item_count: 2,
			coverage: { summary_check: 'verified' },
			totals: totals( '40.00' ),
		},
	},
	movements: [ movement() ],
	aggregates: [],
	unresolved_payment_count: 1,
	discrepancies: [],
	proposed_changes: [],
	can_refresh: true,
	...overrides,
} );

const run = ( overrides = {} ) => ( {
	id: 5,
	kind: 'history',
	status: 'running',
	resumable: false,
	account_id: 1,
	settlement_id: null,
	progress: {
		settlements_done: 0,
		settlements_queued: 0,
		listing_done: false,
		requests_done: 0,
		current_part: null,
	},
	error_code: null,
	error_message: null,
	...overrides,
} );

/**
 * Route apiFetch calls to canned answers; unlisted routes get defaults.
 *
 * @param {Object} routes `"METHOD path"` to a value or a function of the request.
 * @return {Array} Requests made, in order.
 */
const mockApi = ( routes = {} ) => {
	const calls = [];
	const defaults = {
		[ `GET ${ BASE }?per_page=20&page=1` ]: {
			items: [],
			total: 0,
			pages: 0,
			page: 1,
		},
		[ `GET ${ BASE }/accounts` ]: {
			accounts: [ VERIFIED ],
			connection: CONNECTED,
		},
		[ `GET ${ BASE }/imports` ]: { run: null },
	};

	apiFetch.mockImplementation( ( request ) => {
		const key = `${ request.method || 'GET' } ${ request.path }`;
		calls.push( { key, request } );
		const answer = key in routes ? routes[ key ] : defaults[ key ];
		if ( answer === undefined ) {
			return Promise.reject( { code: 'unexpected', message: key } );
		}
		const value = typeof answer === 'function' ? answer( request ) : answer;
		return value instanceof Error || value?.reject
			? Promise.reject( value.reject || value )
			: Promise.resolve( value );
	} );

	return calls;
};

const openAt = ( search ) =>
	window.history.pushState( {}, '', `/wp-admin/admin.php${ search }` );

const chooseFile = async ( contents = 'csv' ) => {
	const file = new window.File( [ contents ], 'settlement.csv', {
		type: 'text/csv',
	} );
	await act( async () => {
		fireEvent.change( screen.getByLabelText( 'Settlement file' ), {
			target: { files: [ file ] },
		} );
	} );
	return file;
};

beforeEach( () => {
	openAt( '?page=fair-finance-settlements' );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'SettlementsApp — saved list', () => {
	it( 'lists saved settlements with stable links and explicit unknowns', async () => {
		mockApi( {
			[ `GET ${ BASE }?per_page=20&page=1` ]: {
				items: [
					summary( { discrepancy_count: 2 } ),
					summary( {
						id: 4,
						account: LOCAL,
						provider_id: null,
						reference: 'FILE.2604.01',
						amount: null,
						status: null,
						settled_at: null,
						sources: [ 'csv' ],
						completeness: 'unverified',
					} ),
				],
				total: 2,
				pages: 1,
				page: 1,
			},
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [ VERIFIED, LOCAL ],
				connection: CONNECTED,
			},
		} );

		render( <SettlementsApp /> );

		const link = await screen.findByRole( 'link', {
			name: 'TEST.2605.01',
		} );
		expect( link ).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-settlements&settlement=3'
		);

		const apiRow = link.closest( 'tr' );
		expect( within( apiRow ).getByText( '38.55 EUR' ) ).toBeInTheDocument();
		expect(
			within( apiRow ).getByText( 'Adds up to payout' )
		).toBeInTheDocument();
		expect(
			within( apiRow ).getByText( '2 points to review' )
		).toBeInTheDocument();

		// A file states no payout, status or date: shown as unknown, not zero.
		const fileRow = screen
			.getByRole( 'link', { name: 'FILE.2604.01' } )
			.closest( 'tr' );
		expect( within( fileRow ).getAllByText( 'Unknown' ) ).toHaveLength( 3 );
		expect( within( fileRow ).getByText( 'File' ) ).toBeInTheDocument();
		expect(
			within( fileRow ).getByText( 'Loaded, not verified' )
		).toBeInTheDocument();
		expect(
			within( fileRow ).getByText( 'Not confirmed' )
		).toBeInTheDocument();
	} );

	it( 'filters by account', async () => {
		const calls = mockApi( {
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [ VERIFIED, LOCAL ],
				connection: CONNECTED,
			},
			[ `GET ${ BASE }?per_page=20&page=1&account_id=2` ]: {
				items: [],
				total: 0,
				pages: 0,
				page: 1,
			},
		} );

		render( <SettlementsApp /> );

		fireEvent.change( await screen.findByLabelText( 'Mollie account' ), {
			target: { value: '2' },
		} );

		await waitFor( () =>
			expect(
				calls.some( ( call ) =>
					call.key.endsWith( 'page=1&account_id=2' )
				)
			).toBe( true )
		);
	} );

	it( 'says what to do when Fair Payments Connector does not offer settlements', async () => {
		mockApi( {
			[ `GET ${ BASE }?per_page=20&page=1` ]: {
				reject: { code: 'rest_no_route' },
			},
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText( /kept by Fair Payments Connector/ )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Load settlements from Mollie',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'offers to confirm an account named during a file import', async () => {
		const calls = mockApi( {
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [ VERIFIED, LOCAL ],
				connection: CONNECTED,
			},
			[ `POST ${ BASE }/accounts/2/confirm` ]: { account: VERIFIED },
		} );

		render( <SettlementsApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Confirm it is org_test',
			} )
		);

		// The dialog names the account and what happens.
		expect(
			screen.getByText( /every file imported into “Old exports”/ )
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Confirm account' } )
		);

		expect(
			await screen.findByText( /Old exports is now confirmed/ )
		).toBeInTheDocument();
		const confirm = calls.find( ( call ) =>
			call.key.endsWith( '/accounts/2/confirm' )
		);
		expect( confirm.request.data ).toEqual( {
			organization_id: 'org_test',
		} );
	} );
} );

describe( 'SettlementsApp — loading from Mollie', () => {
	it( 'steps the import until it completes, then reloads the list', async () => {
		const steps = [
			run( { progress: { ...run().progress, settlements_done: 1 } } ),
			run( {
				status: 'completed',
				progress: { ...run().progress, settlements_done: 3 },
			} ),
		];
		const calls = mockApi( {
			[ `POST ${ BASE }/imports` ]: { run: run() },
			[ `POST ${ BASE }/imports/5/step` ]: () => ( {
				run: steps.shift(),
			} ),
		} );

		render( <SettlementsApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Load settlements from Mollie',
			} )
		);

		expect(
			await screen.findByText( 'Loaded 3 settlements from Mollie.' )
		).toBeInTheDocument();
		expect(
			calls.filter( ( call ) => call.key.endsWith( '/imports/5/step' ) )
		).toHaveLength( 2 );
		expect(
			calls.find( ( call ) => call.key === `POST ${ BASE }/imports` )
				.request.data
		).toEqual( { kind: 'history', settlement_id: 0 } );
		// The list was loaded again after the run stopped.
		expect(
			calls.filter(
				( call ) => call.key === `GET ${ BASE }?per_page=20&page=1`
			).length
		).toBeGreaterThan( 1 );
	} );

	it( 'stops on a failure and continues the same run', async () => {
		const failed = run( {
			status: 'failed',
			resumable: true,
			error_code: 'mollie_request_failed',
			error_message: 'Mollie could not be reached.',
			progress: { ...run().progress, settlements_done: 2 },
		} );
		const answers = [ failed, run( { status: 'completed' } ) ];
		const calls = mockApi( {
			[ `POST ${ BASE }/imports` ]: { run: run() },
			[ `POST ${ BASE }/imports/5/step` ]: () => ( {
				run: answers.shift(),
			} ),
		} );

		render( <SettlementsApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Load settlements from Mollie',
			} )
		);

		expect(
			await screen.findByText( 'An import from Mollie did not finish.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Mollie could not be reached\./ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /2 settlements loaded so far\./ )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Continue import' } )
		);

		expect(
			await screen.findByText( /Loaded \d+ settlements? from Mollie\./ )
		).toBeInTheDocument();
		// Continued, not restarted.
		expect(
			calls.filter( ( call ) => call.key === `POST ${ BASE }/imports` )
		).toHaveLength( 1 );
	} );

	it( 'offers continuation when the page is reopened on an unfinished run', async () => {
		mockApi( {
			[ `GET ${ BASE }/imports` ]: {
				run: run( {
					status: 'interrupted',
					resumable: true,
					error_code: 'interrupted',
					error_message: 'The import stopped before it finished.',
				} ),
			},
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByRole( 'button', { name: 'Continue import' } )
		).toBeEnabled();
		expect(
			screen.getByRole( 'button', { name: 'Start over' } )
		).toBeEnabled();
		expect(
			screen.getByText( /The import stopped before it finished\./ )
		).toBeInTheDocument();
	} );

	it( 'explains why loading is unavailable while files still import', async () => {
		mockApi( {
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [ VERIFIED ],
				connection: {
					connected: true,
					organization_id: 'org_test',
					can_import: false,
					problem: 'settlement_access_missing',
					problem_message:
						'Reconnect Mollie and approve settlement access.',
				},
			},
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText(
				/Reconnect Mollie and approve settlement access\./
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Load settlements from Mollie',
			} )
		).toBeDisabled();
		expect(
			screen.getByRole( 'link', {
				name: 'Open Mollie connection settings',
			} )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-settings'
		);
		expect(
			screen.getByRole( 'button', { name: 'Import settlement CSV' } )
		).toBeEnabled();
	} );
} );

describe( 'SettlementsApp — CSV import', () => {
	const preview = ( overrides = {} ) => ( {
		imported: false,
		outcome: 'new',
		settlement_id: null,
		requires_confirming: false,
		format: 'en',
		reference: 'FILE.2604.01',
		currency: 'EUR',
		movement_count: 3,
		totals: totals( '40.00' ),
		...overrides,
	} );

	const openModal = async () => {
		render( <SettlementsApp /> );
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Import settlement CSV',
			} )
		);
	};

	it( 'checks the file before anything can be imported', async () => {
		const calls = mockApi( {
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [],
				connection: { ...CONNECTED, can_import: false },
			},
			[ `POST ${ BASE }/csv/validate` ]: preview(),
			[ `POST ${ BASE }/csv/import` ]: preview( {
				imported: true,
				settlement_id: 7,
			} ),
		} );

		await openModal();

		const submit = screen.getByRole( 'button', {
			name: 'Import settlement',
		} );
		expect( submit ).toBeDisabled();
		expect(
			screen.getByText( 'Choose a file first.' )
		).toBeInTheDocument();

		const file = await chooseFile();

		expect(
			await screen.findByText(
				'The file is valid. A new settlement will be saved.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'FILE.2604.01' ) ).toBeInTheDocument();
		expect( screen.getByText( '3 rows' ) ).toBeInTheDocument();
		expect( screen.getByText( '40.00 EUR' ) ).toBeInTheDocument();

		// A new account must be named; the reason sits by the button.
		expect( submit ).toBeDisabled();
		expect(
			screen.getByText( 'Name the account first.' )
		).toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Account name' ), {
			target: { value: 'Old exports' },
		} );
		expect( submit ).toBeEnabled();
		await act( async () => {
			fireEvent.click( submit );
		} );

		expect(
			await screen.findByText( 'The settlement was saved.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Open settlement' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-settlements&settlement=7'
		);

		const sent = calls.find( ( call ) =>
			call.key.endsWith( '/csv/import' )
		).request.body;
		expect( sent.get( 'file' ) ).toBe( file );
		expect( sent.get( 'account_label' ) ).toBe( 'Old exports' );
		expect( sent.has( 'account_id' ) ).toBe( false );
	} );

	it( 'lists what is wrong with an invalid file and keeps import disabled', async () => {
		mockApi( {
			[ `POST ${ BASE }/csv/validate` ]: {
				reject: {
					code: 'settlement_csv_invalid',
					message:
						'The file could not be imported. Nothing was saved.',
					data: {
						errors: [
							{
								code: 'csv_amount_invalid',
								message: '"1,234" is not an amount.',
								row: 4,
							},
							{
								code: 'csv_reference_missing',
								message: 'No settlement reference was found.',
								row: null,
							},
						],
					},
				},
			},
		} );

		await openModal();
		await chooseFile();

		expect(
			await screen.findByText( 'Line 4: "1,234" is not an amount.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'No settlement reference was found.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Import settlement' } )
		).toBeDisabled();
		expect(
			screen.getByText( 'Fix the file and choose it again.' )
		).toBeInTheDocument();
	} );

	it( 'requires an explicit statement before adding a file to a confirmed organization', async () => {
		const calls = mockApi( {
			[ `POST ${ BASE }/csv/validate` ]: preview( {
				outcome: 'attach',
				settlement_id: 3,
				requires_confirming: true,
			} ),
			[ `POST ${ BASE }/csv/import` ]: preview( {
				imported: true,
				outcome: 'attach',
				settlement_id: 3,
			} ),
		} );

		await openModal();
		await chooseFile();

		expect(
			await screen.findByText( /already saved from Mollie/ )
		).toBeInTheDocument();
		const submit = screen.getByRole( 'button', {
			name: 'Import settlement',
		} );
		expect( submit ).toBeDisabled();
		expect(
			screen.getByText( 'Confirm where the file was exported from.' )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByLabelText(
				'This file was exported from Mollie org_test.'
			)
		);
		expect( submit ).toBeEnabled();
		await act( async () => {
			fireEvent.click( submit );
		} );

		await screen.findByText( 'The settlement was saved.' );
		const sent = calls.find( ( call ) =>
			call.key.endsWith( '/csv/import' )
		).request.body;
		expect( sent.get( 'account_id' ) ).toBe( '1' );
		expect( sent.get( 'confirm_account' ) ).toBe( 'true' );
	} );

	it( 'warns that a conflicting file will not replace the saved data', async () => {
		mockApi( {
			[ `POST ${ BASE }/csv/validate` ]: preview( {
				outcome: 'conflict',
				settlement_id: 3,
			} ),
		} );

		await openModal();
		await chooseFile();

		expect(
			await screen.findByText( /The saved data stays as it is/ )
		).toBeInTheDocument();
	} );
} );

describe( 'SettlementsApp — one settlement', () => {
	beforeEach( () => {
		openAt( '?page=fair-finance-settlements&settlement=3' );
	} );

	it( 'shows payout facts, both sources and conflicting values without contacting Mollie', async () => {
		const calls = mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				sources: [ 'api', 'csv' ],
				discrepancy_count: 1,
				revisions: {
					api: detail().revisions.api,
					csv: {
						id: 10,
						content_hash: 'def',
						published_at: '2026-05-04 09:00:00',
						item_count: 2,
						coverage: { format: 'en' },
						totals: totals( '39.50' ),
					},
				},
				movements: [
					movement( {
						sources: [ 'api', 'csv' ],
						local_transaction_id: 77,
					} ),
					movement( {
						key: 'api:payment:tr_test2#1',
						external_id: 'tr_test2',
						payment_reference: 'tr_test2',
						settlement_amount: '15.00',
						sources: [ 'api', 'csv' ],
						conflict: {
							settlement_amount: { api: '15.00', csv: '14.50' },
						},
					} ),
				],
				aggregates: [
					{
						...movement( {
							key: 'api:agg:fee:x#1',
							type: 'fee',
							external_id: null,
							payment_reference: null,
							description: 'iDEAL',
							settlement_amount: '-1.45',
						} ),
					},
				],
				discrepancies: [
					{
						code: 'value_conflict',
						message:
							'The uploaded file and Mollie state different values for tr_test2.',
					},
				],
			} ),
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByRole( 'heading', {
				name: /Settlement TEST\.2605\.01/,
			} )
		).toBeInTheDocument();
		expect( screen.getByText( '38.55 EUR' ) ).toBeInTheDocument();
		expect( screen.getByText( 'stl_test1' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'The uploaded file and Mollie state different values for tr_test2.'
			)
		).toBeInTheDocument();

		// The value from Mollie is shown, with the file's value beside it.
		const conflicted = screen.getByText( 'tr_test2' ).closest( 'tr' );
		expect(
			within( conflicted ).getByText( '15.00 EUR' )
		).toBeInTheDocument();
		expect(
			within( conflicted ).getByText( 'File says 14.50' )
		).toBeInTheDocument();
		expect(
			within( conflicted ).getByText( 'Not imported yet' )
		).toBeInTheDocument();

		// A payment that exists locally links to its transaction.
		expect(
			screen.getByRole( 'link', { name: 'Transaction #77' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=77'
		);

		// Totals stay per source. Mollie's also equals the movements' total.
		expect( screen.getAllByText( '40.00 EUR' ) ).toHaveLength( 2 );
		expect( screen.getByText( '39.50 EUR' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /They may cover the same money/ )
		).toBeInTheDocument();

		// Only saved data was read.
		expect( calls.map( ( call ) => call.key ).sort() ).toEqual( [
			`GET ${ BASE }/3`,
			`GET ${ BASE }/accounts`,
		] );
	} );

	it( 'links Mollie IDs to the dashboard of the organization the settlement was saved under', async () => {
		mockApi( {
			// A different organization is connected now.
			[ `GET ${ BASE }/accounts` ]: {
				accounts: [ VERIFIED ],
				connection: { ...CONNECTED, organization_id: 'org_other' },
			},
			[ `GET ${ BASE }/3` ]: detail( {
				movements: [
					movement( { local_transaction_id: 77 } ),
					movement( {
						key: 'api:refund:re_test1#1',
						type: 'refund',
						external_id: 're_test1',
						payment_reference: 'tr_test2',
						settlement_amount: '-10.00',
					} ),
					movement( {
						key: 'api:adjustment:x#1',
						type: 'adjustment',
						external_id: 'tr_bad/../x',
						payment_reference: null,
					} ),
				],
			} ),
		} );

		render( <SettlementsApp /> );

		// Mollie has no page per settlement; the ID opens the settlements report.
		const settlementLink = await screen.findByRole( 'link', {
			name: 'stl_test1',
		} );
		expect( settlementLink ).toHaveAttribute(
			'href',
			'https://my.mollie.com/dashboard/org_test/reports/settlements'
		);
		expect( settlementLink ).toHaveAttribute( 'target', '_blank' );
		expect( settlementLink ).toHaveAttribute(
			'rel',
			'noopener noreferrer'
		);

		const paymentLink = screen.getByRole( 'link', { name: 'tr_test1' } );
		expect( paymentLink ).toHaveAttribute(
			'href',
			'https://my.mollie.com/dashboard/org_test/payments/tr_test1'
		);
		expect( paymentLink ).toHaveAttribute( 'target', '_blank' );
		expect( paymentLink ).toHaveAttribute( 'rel', 'noopener noreferrer' );

		// A refund keeps its own ID as text and links its parent payment.
		const refund = screen.getByText( 're_test1' ).closest( 'tr' );
		expect(
			within( refund ).queryByRole( 'link', { name: 're_test1' } )
		).not.toBeInTheDocument();
		expect(
			within( refund ).getByRole( 'link', { name: 'tr_test2' } )
		).toHaveAttribute(
			'href',
			'https://my.mollie.com/dashboard/org_test/payments/tr_test2'
		);

		// An ID Mollie would not issue is shown, never turned into an address.
		const odd = screen.getByText( 'tr_bad/../x' ).closest( 'tr' );
		expect( within( odd ).queryByRole( 'link' ) ).not.toBeInTheDocument();

		// The local payment link is unchanged.
		expect(
			screen.getByRole( 'link', { name: 'Transaction #77' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=77'
		);
	} );

	it( 'leaves the settlement ID as text when its account has no organization', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( { account: LOCAL } ),
		} );

		render( <SettlementsApp /> );

		const id = (
			await screen.findByText( 'Mollie settlement ID' )
		).closest( 'div' );
		expect( within( id ).getByText( 'stl_test1' ) ).toBeInTheDocument();
		expect( within( id ).queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );

	it( 'links without an organization when the account has none, and not at all without an ID', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				account: LOCAL,
				provider_id: null,
				sources: [ 'csv' ],
				movements: [ movement( { sources: [ 'csv' ] } ) ],
				can_refresh: false,
			} ),
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByRole( 'link', { name: 'tr_test1' } )
		).toHaveAttribute(
			'href',
			'https://www.mollie.com/dashboard/payments/tr_test1'
		);
		const id = screen.getByText( 'Mollie settlement ID' ).closest( 'div' );
		expect( within( id ).getByText( 'Unknown' ) ).toBeInTheDocument();
		expect( within( id ).queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );

	it( 'totals the Settled column exactly, with deductions, per currency', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				movements: [
					movement( { settlement_amount: '0.10' } ),
					movement( {
						key: 'api:payment:tr_test2#1',
						external_id: 'tr_test2',
						payment_reference: 'tr_test2',
						settlement_amount: '0.2',
					} ),
					movement( {
						key: 'api:refund:re_test1#1',
						type: 'refund',
						external_id: 're_test1',
						settlement_amount: '-10.005',
					} ),
					movement( {
						key: 'api:payment:tr_test3#1',
						external_id: 'tr_test3',
						payment_reference: 'tr_test3',
						settlement_amount: '36.80',
						settlement_currency: 'USD',
					} ),
				],
				// Neither of these is part of the total.
				aggregates: [
					movement( {
						key: 'api:agg:fee:x#1',
						type: 'fee',
						external_id: null,
						payment_reference: null,
						description: 'iDEAL',
						settlement_amount: '-1.45',
					} ),
				],
				proposed_changes: [
					{
						revision_id: 11,
						created_at: '2026-05-05 09:00:00',
						counts: { added: 1, removed: 0, changed: 0 },
						added: [
							{
								type: 'payment',
								external_id: 'tr_test9',
								description: 'Ticket C',
								settlement_amount: '99.00',
								settlement_currency: 'EUR',
							},
						],
						removed: [],
						changed: [],
					},
				],
			} ),
		} );

		render( <SettlementsApp /> );

		const totalsRow = (
			await screen.findByRole( 'rowheader', { name: 'Totals' } )
		).closest( 'tr' );
		// 0.10 + 0.2 - 10.005, which floats would get wrong.
		expect(
			within( totalsRow ).getByText( '-9.705 EUR' )
		).toBeInTheDocument();
		expect(
			within( totalsRow ).getByText( '36.80 USD' )
		).toBeInTheDocument();
		expect(
			within( totalsRow ).queryByText( /Partial/ )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /They are not the payout amount/ )
		).toBeInTheDocument();
	} );

	it( 'marks the total as partial instead of counting unknown amounts as zero', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				movements: [
					movement(),
					movement( {
						key: 'csv:payment:tr_test2#1',
						external_id: 'tr_test2',
						payment_reference: 'tr_test2',
						settlement_amount: null,
					} ),
					movement( {
						key: 'csv:payment:tr_test3#1',
						external_id: 'tr_test3',
						payment_reference: 'tr_test3',
						settlement_currency: null,
					} ),
				],
			} ),
		} );

		render( <SettlementsApp /> );

		const totalsRow = (
			await screen.findByRole( 'rowheader', { name: 'Totals' } )
		).closest( 'tr' );
		expect(
			within( totalsRow ).getByText( '25.00 EUR' )
		).toBeInTheDocument();
		expect(
			within( totalsRow ).getByText(
				'Partial: 2 rows with unknown amounts are left out.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps unknown facts of a file-only settlement explicit', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				account: LOCAL,
				provider_id: null,
				amount: null,
				status: null,
				settled_at: null,
				created_at: null,
				invoice_id: null,
				sources: [ 'csv' ],
				completeness: 'unverified',
				last_refreshed_at: null,
				last_csv_import_at: '2026-05-04 09:00:00',
				revisions: {
					csv: {
						id: 10,
						content_hash: 'def',
						published_at: '2026-05-04 09:00:00',
						item_count: 1,
						coverage: { format: 'en' },
						totals: totals( '25.00' ),
					},
				},
				movements: [ movement( { sources: [ 'csv' ] } ) ],
				can_refresh: false,
			} ),
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText( /comes from an uploaded file/ )
		).toBeInTheDocument();
		const payout = screen.getByText( 'Payout amount' ).closest( 'div' );
		expect( within( payout ).getByText( 'Unknown' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Refresh from Mollie' } )
		).not.toBeInTheDocument();
	} );

	it( 'marks an incomplete settlement and its last failure apart from its data', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				completeness: 'incomplete',
				sources: [],
				revisions: {},
				movements: [],
				unresolved_payment_count: 0,
				last_refreshed_at: null,
				last_failure: {
					code: 'mollie_request_failed',
					message: 'Mollie could not be reached.',
					at: '2026-05-03 09:00:00',
				},
			} ),
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText( /has not been fully loaded from Mollie/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /The last attempt to load this settlement/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Mollie could not be reached\./ )
		).toBeInTheDocument();
		expect( screen.getByText( 'Incomplete' ) ).toBeInTheDocument();
	} );

	it( 'shows the differences of a file that was not applied', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: detail( {
				proposed_changes: [
					{
						revision_id: 12,
						created_at: '2026-05-05 09:00:00',
						counts: { added: 1, removed: 0, changed: 1 },
						added: [
							{
								type: 'payment',
								external_id: 'tr_extra',
								description: '',
								settlement_amount: '3.00',
								settlement_currency: 'EUR',
							},
						],
						removed: [],
						changed: [
							{
								identity_key: 'payment:tr_test1#1',
								type: 'payment',
								external_id: 'tr_test1',
								description: 'Ticket A',
								fields: {
									settlement_amount: {
										accepted: '25.00',
										proposed: '24.00',
									},
								},
							},
						],
					},
				],
			} ),
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText(
				'This file was not applied. The saved data is unchanged.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( 'tr_test1: saved 25.00, file says 24.00' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Only in the file: tr_extra (3.00 EUR)' )
		).toBeInTheDocument();
	} );

	it( 'refreshes one settlement and reloads it', async () => {
		const calls = mockApi( {
			[ `GET ${ BASE }/3` ]: detail(),
			[ `POST ${ BASE }/imports` ]: {
				run: run( { kind: 'refresh', settlement_id: 3 } ),
			},
			[ `POST ${ BASE }/imports/5/step` ]: {
				run: run( {
					kind: 'refresh',
					settlement_id: 3,
					status: 'completed',
				} ),
			},
		} );

		render( <SettlementsApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Refresh from Mollie' } )
		);

		expect(
			await screen.findByText( 'Refreshed from Mollie.' )
		).toBeInTheDocument();
		expect(
			calls.find( ( call ) => call.key === `POST ${ BASE }/imports` )
				.request.data
		).toEqual( { kind: 'refresh', settlement_id: 3 } );
		expect(
			calls.filter( ( call ) => call.key === `GET ${ BASE }/3` )
		).toHaveLength( 2 );
	} );

	it( 'says when a settlement is not saved', async () => {
		mockApi( {
			[ `GET ${ BASE }/3` ]: {
				reject: { code: 'settlement_not_found' },
			},
		} );

		render( <SettlementsApp /> );

		expect(
			await screen.findByText(
				'This settlement is not saved on this site.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: '← All settlements' } )
		).toHaveAttribute( 'href', 'admin.php?page=fair-finance-settlements' );
	} );
} );
