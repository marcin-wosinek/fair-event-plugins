import { test, expect, request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const TRANSACTIONS_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions';
const IMPORT_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions/import';
const DASHBOARD_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/dashboard/monthly-summary';
const FIXTURE_SCRIPT = 'payment-timestamp-fixture.php';
const FIXTURE_MARKER = 'PAYMENT_TIMESTAMP_FIXTURE';
const ROOT_DIRECTORY = path.resolve( __dirname, '../../../..' );

function runFixtureScript( action, fixtureKey, timezone = '' ) {
	const commandArgs = [
		'wp-env',
		'run',
		'tests-cli',
		'wp',
		'eval-file',
		`wp-content/mu-plugins/scripts/${ FIXTURE_SCRIPT }`,
		action,
		fixtureKey,
	];
	if ( timezone ) {
		commandArgs.push( timezone );
	}
	const output = execFileSync( 'npx', commandArgs, {
		cwd: ROOT_DIRECTORY,
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	const match = output.match(
		new RegExp( `${ FIXTURE_MARKER }:(\\{.*\\})` )
	);
	if ( ! match ) {
		throw new Error(
			`Expected ${ FIXTURE_MARKER } in WP-CLI output, got:\n${ output }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

function runFeeFixture( timezone ) {
	const output = execFileSync(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/transaction-fee-fixture.php',
			timezone,
		],
		{
			cwd: ROOT_DIRECTORY,
			encoding: 'utf8',
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);
	const match = output.match( /TRANSACTION_FEE_FIXTURE:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected TRANSACTION_FEE_FIXTURE in WP-CLI output, got:\n${ output }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
				'base64'
			),
	};
}

test.describe( 'Transaction — integration fee', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'transactions endpoint requires authentication', async () => {
		const res = await api.get( TRANSACTIONS_ENDPOINT );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'transaction records include application_fee field', async () => {
		const res = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body ).toHaveProperty( 'transactions' );
		expect( Array.isArray( body.transactions ) ).toBe( true );
		for ( const txn of body.transactions ) {
			expect( txn ).toHaveProperty( 'application_fee' );
			expect( txn ).toHaveProperty( 'amount' );
		}
	} );

	test( 'transactions created through the model pay nothing before local midnight on 1 January 2027 and 2% from then on', () => {
		for ( const timezone of [ 'UTC', 'Europe/Madrid' ] ) {
			const fees = runFeeFixture( timezone );
			expect( fees ).toEqual( { before: 0, cutoff: 20 } );
		}
	} );

	test( 'imported transactions keep their recorded fees, uncapped in the monthly summary', async () => {
		const before = await (
			await api.get( DASHBOARD_ENDPOINT, { headers: adminAuth() } )
		).json();

		const suffix = Date.now();
		const smallFeeId = `tr_fee_keep_small_${ suffix }`;
		const largeFeeId = `tr_fee_keep_large_${ suffix }`;
		const noFeeId = `tr_fee_keep_none_${ suffix }`;

		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id: smallFeeId,
						amount: 10.0,
						currency: 'EUR',
						application_fee: 0.1,
						status: 'paid',
						testmode: true,
					},
					{
						// A 2% fee well above the former €12 monthly cap.
						mollie_payment_id: largeFeeId,
						amount: 2500.0,
						currency: 'EUR',
						application_fee: 50,
						status: 'paid',
						testmode: true,
					},
					{
						mollie_payment_id: noFeeId,
						amount: 100.0,
						currency: 'EUR',
						status: 'paid',
						testmode: true,
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 100, mode: 'test' },
		} );
		expect( listRes.status() ).toBe( 200 );
		const { transactions } = await listRes.json();
		const feeOf = ( id ) =>
			transactions.find( ( t ) => t.mollie_payment_id === id )
				?.application_fee;

		expect( feeOf( smallFeeId ) ).toBe( 0.1 );
		expect( feeOf( largeFeeId ) ).toBe( 50 );
		expect( feeOf( noFeeId ) ).toBeNull();

		const afterRes = await api.get( DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( afterRes.status() ).toBe( 200 );
		const after = await afterRes.json();

		expect( after.total_fees - before.total_fees ).toBeCloseTo( 50.1, 2 );
		expect( after ).not.toHaveProperty( 'fee_cap' );
		expect( after ).not.toHaveProperty( 'cap_remaining' );
	} );
} );

test.describe( 'Transaction — Mollie import', () => {
	let api;
	const endpoint = '/wp-json/fair-payments-connector/v1/transactions/mollie';
	const today = new Date();
	const start = new Date( today );
	start.setDate( today.getDate() - 30 );
	const date = ( value ) => value.toISOString().slice( 0, 10 );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'requires an authenticated administrator', async () => {
		const res = await api.get( endpoint, {
			params: {
				mode: 'test',
				start_date: date( start ),
				end_date: date( today ),
			},
		} );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'validates mode and bounded date range', async () => {
		const invalidMode = await api.get( endpoint, {
			headers: adminAuth(),
			params: {
				mode: 'sandbox',
				start_date: date( start ),
				end_date: date( today ),
			},
		} );
		expect( invalidMode.status() ).toBe( 400 );

		const old = new Date( today );
		old.setDate( today.getDate() - 91 );
		const invalidRange = await api.get( endpoint, {
			headers: adminAuth(),
			params: {
				mode: 'test',
				start_date: date( old ),
				end_date: date( today ),
			},
		} );
		expect( invalidRange.status() ).toBe( 400 );
	} );

	test( 'maps paid payments and skips a duplicate without overwriting it', async () => {
		const params = {
			mode: 'test',
			start_date: date( start ),
			end_date: date( today ),
		};
		const list = await api.get( endpoint, {
			headers: adminAuth(),
			params,
		} );
		expect( list.status() ).toBe( 200 );
		const listed = await list.json();
		expect( listed.payments[ 0 ] ).toEqual(
			expect.objectContaining( {
				mollie_payment_id: 'tr_e2emanualimport',
				status: 'paid',
				testmode: true,
			} )
		);

		const first = await api.post( endpoint, {
			headers: adminAuth(),
			data: { ...params, payment_ids: [ 'tr_e2emanualimport' ] },
		} );
		expect( first.status() ).toBe( 200 );
		const second = await api.post( endpoint, {
			headers: adminAuth(),
			data: { ...params, payment_ids: [ 'tr_e2emanualimport' ] },
		} );
		expect( second.status() ).toBe( 200 );
		expect( await second.json() ).toEqual(
			expect.objectContaining( { imported: 0, skipped: 1, failed: 0 } )
		);
	} );
} );

test.describe( 'Transaction — batch Mollie fee sync', () => {
	let api;
	const endpoint =
		'/wp-json/fair-payments-connector/v1/transactions/sync-mollie-batch';

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'requires an authenticated administrator', async () => {
		const res = await api.post( endpoint, {
			data: { ids: [ 1 ] },
		} );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'rejects an empty or missing ids array', async () => {
		const missing = await api.post( endpoint, {
			headers: adminAuth(),
			data: {},
		} );
		expect( missing.status() ).toBe( 400 );

		const empty = await api.post( endpoint, {
			headers: adminAuth(),
			data: { ids: [] },
		} );
		expect( empty.status() ).toBe( 400 );
	} );

	test( 'tallies processed/updated/failed across a mixed batch', async () => {
		// The Mollie HTTP double used in this environment always returns an
		// empty balance-transaction list, so a forced sync can never *find* a
		// fee — it can only leave an already-stored one untouched. Seed one
		// transaction with a pre-set fee (sync leaves it in place: "updated")
		// and one without (sync finds nothing to set: "failed"), then add a
		// nonexistent transaction id ("failed": not found).
		const suffix = Date.now();
		const withFeeId = `tr_batch_has_fee_${ suffix }`;
		const noFeeId = `tr_batch_no_fee_${ suffix }`;

		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id: withFeeId,
						amount: 10.0,
						currency: 'EUR',
						status: 'paid',
						mollie_fee: 0.29,
						testmode: true,
					},
					{
						mollie_payment_id: noFeeId,
						amount: 10.0,
						currency: 'EUR',
						status: 'paid',
						testmode: true,
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 100, mode: 'test' },
		} );
		expect( listRes.status() ).toBe( 200 );
		const { transactions } = await listRes.json();
		const withFeeTxn = transactions.find(
			( t ) => t.mollie_payment_id === withFeeId
		);
		const noFeeTxn = transactions.find(
			( t ) => t.mollie_payment_id === noFeeId
		);
		expect( withFeeTxn ).toBeDefined();
		expect( noFeeTxn ).toBeDefined();

		const bogusId = 999999999;
		const res = await api.post( endpoint, {
			headers: adminAuth(),
			data: { ids: [ withFeeTxn.id, noFeeTxn.id, bogusId ] },
		} );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toEqual( {
			processed: 3,
			updated: 1,
			failed: 2,
		} );
	} );
} );

test.describe( 'Transaction — payment timestamp storage and presentation', () => {
	let api;
	let fixture;
	const fixtureKey = `timestamp${ Date.now() }`;

	function runFixture( action, timezone = '' ) {
		return runFixtureScript( action, fixtureKey, timezone );
	}

	function rowFor( state, name ) {
		return state.rows.find(
			( row ) => Number( row.id ) === state.ids[ name ]
		);
	}

	async function getTransaction( name ) {
		const response = await api.get(
			`${ TRANSACTIONS_ENDPOINT }/${ fixture.ids[ name ] }`,
			{ headers: adminAuth() }
		);
		expect( response.status() ).toBe( 200 );
		return response.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		fixture = runFixture( 'setup' );
	} );

	test.afterAll( async () => {
		try {
			runFixture( 'cleanup' );
		} finally {
			await api?.dispose();
		}
	} );

	test( 'stores a newly initiated payment in UTC', async () => {
		const row = rowFor( fixture, 'new' );
		const initiated = Date.parse( `${ row.payment_initiated_at }Z` );

		expect( Math.abs( Date.now() - initiated ) ).toBeLessThan( 60_000 );
		expect(
			( initiated - Date.parse( `${ row.created_at }Z` ) ) / 1000
		).toBeGreaterThanOrEqual( 2 );
	} );

	test( 'presents UTC storage unchanged on a UTC site', async () => {
		const row = rowFor( fixture, 'new' );
		const transaction = await getTransaction( 'new' );

		expect( transaction.created_at ).toBe( row.created_at );
		expect( transaction.payment_initiated_at ).toBe(
			row.payment_initiated_at
		);
	} );

	test( 'changes only presentation for a Europe/Madrid site', async () => {
		const before = runFixture( 'inspect' );
		runFixture( 'timezone', 'Europe/Madrid' );
		const transaction = await getTransaction( 'new' );
		const after = runFixture( 'inspect' );
		const row = rowFor( before, 'new' );
		const displayedCreated = Date.parse(
			`${ transaction.created_at.replace( ' ', 'T' ) }Z`
		);
		const displayedInitiated = Date.parse(
			`${ transaction.payment_initiated_at.replace( ' ', 'T' ) }Z`
		);

		expect( after.rows ).toEqual( before.rows );
		expect( transaction.created_at ).not.toBe( row.created_at );
		expect( ( displayedInitiated - displayedCreated ) / 1000 ).toBe(
			( Date.parse( `${ row.payment_initiated_at }Z` ) -
				Date.parse( `${ row.created_at }Z` ) ) /
				1000
		);
	} );

	test( 'uses the date-specific daylight-saving offset', async () => {
		const summer = await getTransaction( 'summer' );
		const winter = await getTransaction( 'winter' );

		expect( summer.created_at ).toBe( '2026-07-15 12:00:00' );
		expect( summer.payment_initiated_at ).toBe( '2026-07-15 12:00:00' );
		expect( summer.updated_at ).toBe( '2026-07-15 12:00:00' );
		expect( winter.created_at ).toBe( '2026-01-15 11:00:00' );
		expect( winter.payment_initiated_at ).toBe( '2026-01-15 11:00:00' );
		expect( winter.updated_at ).toBe( '2026-01-15 11:00:00' );
	} );

	test( 'leaves pre-existing UTC and ambiguous legacy values unchanged', () => {
		const state = runFixture( 'inspect' );

		expect( rowFor( state, 'utc' ).payment_initiated_at ).toBe(
			'2025-04-10 08:15:30'
		);
		expect( rowFor( state, 'legacy' ).payment_initiated_at ).toBe(
			'2025-04-10 10:15:30'
		);
	} );
} );

test.describe( 'Transaction — event link', () => {
	const EVENT_DATES_ENDPOINT = '/wp-json/fair-events/v1/event-dates';

	let api;
	let eventDateId;
	let transactionId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const eventRes = await api.post( EVENT_DATES_ENDPOINT, {
			headers: adminAuth(),
			data: {
				title: `E2E Event Link Test ${ Date.now() }`,
				start_datetime: '2027-03-01 10:00:00',
			},
		} );
		expect( eventRes.status() ).toBe( 201 );
		eventDateId = ( await eventRes.json() ).id;

		const mollie_payment_id = `tr_event_link_${ Date.now() }`;
		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id,
						amount: 5.0,
						currency: 'EUR',
						status: 'paid',
						testmode: true,
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 100, mode: 'test' },
		} );
		expect( listRes.status() ).toBe( 200 );
		const { transactions } = await listRes.json();
		const txn = transactions.find(
			( t ) => t.mollie_payment_id === mollie_payment_id
		);
		expect( txn ).toBeDefined();
		transactionId = txn.id;
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			await api.delete( `${ EVENT_DATES_ENDPOINT }/${ eventDateId }`, {
				headers: adminAuth(),
			} );
		}
		await api.dispose();
	} );

	test( 'links a valid occurrence and returns its display summary', async () => {
		const res = await api.post(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{
				headers: adminAuth(),
				data: { event_date_id: eventDateId },
			}
		);
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.event_date_id ).toBe( eventDateId );
		expect( body.event ).toEqual(
			expect.objectContaining( { id: eventDateId } )
		);
	} );

	test( 'rejects a nonexistent occurrence without changing the existing value', async () => {
		const res = await api.post(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{
				headers: adminAuth(),
				data: { event_date_id: 999999999 },
			}
		);
		expect( res.status() ).toBe( 400 );

		const getRes = await api.get(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( getRes.status() ).toBe( 200 );
		const body = await getRes.json();
		expect( body.event_date_id ).toBe( eventDateId );
	} );

	test( 'clears an existing event link', async () => {
		const res = await api.post(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{
				headers: adminAuth(),
				data: { event_date_id: 0 },
			}
		);
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.event_date_id ).toBeNull();
		expect( body.event ).toBeNull();
	} );
} );

test.describe( 'Transaction — deletion (#1618)', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	async function importTestTransaction() {
		const mollie_payment_id = `tr_delete_test_${ Date.now() }_${ Math.random()
			.toString( 36 )
			.slice( 2 ) }`;
		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id,
						amount: 5.0,
						currency: 'EUR',
						status: 'paid',
						testmode: true,
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 100, mode: 'test' },
		} );
		expect( listRes.status() ).toBe( 200 );
		const { transactions } = await listRes.json();
		const txn = transactions.find(
			( t ) => t.mollie_payment_id === mollie_payment_id
		);
		expect( txn ).toBeDefined();
		return txn.id;
	}

	test( 'requires authentication', async () => {
		const transactionId = await importTestTransaction();
		const res = await api.delete(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`
		);
		expect( res.status() ).toBe( 401 );

		// Cleanup: the unauthenticated attempt above must not have deleted it.
		const getRes = await api.get(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( getRes.status() ).toBe( 200 );
		await api.delete( `${ TRANSACTIONS_ENDPOINT }/${ transactionId }`, {
			headers: adminAuth(),
		} );
	} );

	test( 'returns 404 for a nonexistent transaction', async () => {
		const res = await api.delete( `${ TRANSACTIONS_ENDPOINT }/999999999`, {
			headers: adminAuth(),
		} );
		expect( res.status() ).toBe( 404 );
	} );

	test( 'deletes the local transaction and it no longer appears in list or detail views', async () => {
		const transactionId = await importTestTransaction();

		const deleteRes = await api.delete(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( deleteRes.status() ).toBe( 200 );
		const body = await deleteRes.json();
		expect( body ).toEqual( { deleted: true, id: transactionId } );

		const getRes = await api.get(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( getRes.status() ).toBe( 404 );

		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 100, mode: 'test' },
		} );
		const { transactions } = await listRes.json();
		expect( transactions.some( ( t ) => t.id === transactionId ) ).toBe(
			false
		);
	} );

	test( 'deleting a transaction twice returns 404 the second time', async () => {
		const transactionId = await importTestTransaction();

		const firstRes = await api.delete(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( firstRes.status() ).toBe( 200 );

		const secondRes = await api.delete(
			`${ TRANSACTIONS_ENDPOINT }/${ transactionId }`,
			{ headers: adminAuth() }
		);
		expect( secondRes.status() ).toBe( 404 );
	} );
} );
