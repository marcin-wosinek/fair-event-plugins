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

function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
				'base64'
			),
	};
}

test.describe( 'Transaction — fee cap enforcement', () => {
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

	test( 'cap_remaining stays within [0, fee_cap] after seeding transactions below the cap', async () => {
		// Seed two small transactions (fee €0.10 each) that together stay well below the cap.
		const seedPayload = [
			{
				mollie_payment_id: 'tr_test_cap_seed_a',
				amount: 10.0,
				currency: 'EUR',
				application_fee: 0.1,
				status: 'paid',
				testmode: true,
			},
			{
				mollie_payment_id: 'tr_test_cap_seed_b',
				amount: 10.0,
				currency: 'EUR',
				application_fee: 0.1,
				status: 'paid',
				testmode: true,
			},
		];

		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: { transactions: seedPayload },
		} );
		expect( importRes.status() ).toBe( 200 );

		const dashRes = await api.get( DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( dashRes.status() ).toBe( 200 );
		const dash = await dashRes.json();

		// cap_remaining must be non-negative and never exceed the configured cap.
		expect( dash.cap_remaining ).toBeGreaterThanOrEqual( 0 );
		expect( dash.cap_remaining ).toBeLessThanOrEqual( dash.fee_cap );
	} );

	test( 'application_fee is 0 or null on new transactions during the waiver period', async () => {
		const mollie_payment_id = 'tr_waiver_check_' + Date.now();
		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id,
						amount: 100.0,
						currency: 'EUR',
						status: 'paid',
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		// Retrieve the imported transaction and verify its fee is 0 or null.
		const listRes = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( listRes.status() ).toBe( 200 );
		const { transactions } = await listRes.json();
		const txn = transactions.find(
			( t ) => t.mollie_payment_id === mollie_payment_id
		);
		expect( txn ).toBeDefined();
		const fee = txn?.application_fee ?? null;
		expect( fee == null || fee === 0 || fee === '0.00' ).toBe( true );
	} );

	test( 'cap_remaining is 0 when seeded fees exhaust the monthly cap', async () => {
		const dashRes = await api.get( DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( dashRes.status() ).toBe( 200 );
		const { fee_cap } = await dashRes.json();

		// Seed a single transaction whose application_fee equals the full cap,
		// pushing cap_remaining to 0.
		const importRes = await api.post( IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: {
				transactions: [
					{
						mollie_payment_id: 'tr_test_cap_exhaust',
						amount: fee_cap * 100,
						currency: 'EUR',
						application_fee: fee_cap,
						status: 'paid',
						testmode: true,
					},
				],
			},
		} );
		expect( importRes.status() ).toBe( 200 );

		const afterRes = await api.get( DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( afterRes.status() ).toBe( 200 );
		const after = await afterRes.json();

		expect( after.cap_remaining ).toBe( 0 );
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
