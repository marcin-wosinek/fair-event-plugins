/**
 * API tests for the Fee Dashboard monthly summary (#1685).
 *
 * Controlled transactions are imported into March 2001 — far older than any
 * real data on the test instance — through the admin import route, then
 * removed again. Covers month boundaries, paid vs. pending rows, live/test
 * separation, recorded zero vs. missing fees, mixed currencies, a Mollie fee
 * recorded after the fact, month validation, and access control.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ENDPOINT =
	'/wp-json/fair-payments-connector/v1/dashboard/monthly-summary';
const TRANSACTIONS_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions';
const IMPORT_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions/import';

const MONTH = '2001-03';
const PREFIX = 'tr_dash1685_';

const adminAuth = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const fixture = ( key, overrides ) => ( {
	mollie_payment_id: PREFIX + key,
	currency: 'EUR',
	status: 'paid',
	testmode: true,
	...overrides,
} );

const FIXTURES = [
	// First second of the month: included.
	fixture( 'start', {
		amount: 100,
		application_fee: 2,
		mollie_fee: 1.5,
		created_at: '2001-03-01 00:00:00',
	} ),
	// Last second of the month, recorded zero commission, Mollie fee pending.
	fixture( 'end', {
		amount: 50,
		application_fee: 0,
		created_at: '2001-03-31 23:59:59',
	} ),
	// Fair Event commission never recorded.
	fixture( 'no_app_fee', {
		amount: 20,
		mollie_fee: 0.5,
		created_at: '2001-03-15 12:00:00',
	} ),
	// Not paid: excluded from every figure.
	fixture( 'pending', {
		amount: 999,
		application_fee: 20,
		status: 'pending_payment',
		created_at: '2001-03-10 12:00:00',
	} ),
	// Adjacent months: excluded.
	fixture( 'before', {
		amount: 7,
		application_fee: 0,
		mollie_fee: 0,
		created_at: '2001-02-28 23:59:59',
	} ),
	fixture( 'after', {
		amount: 9,
		application_fee: 0,
		mollie_fee: 0,
		created_at: '2001-04-01 00:00:00',
	} ),
	// Live mode: only visible when the site is in live mode.
	fixture( 'live', {
		amount: 500,
		application_fee: 10,
		mollie_fee: 3,
		testmode: false,
		created_at: '2001-03-05 12:00:00',
	} ),
	// Other currency: reported separately, never added to EUR.
	fixture( 'pln', {
		amount: 40,
		currency: 'PLN',
		application_fee: 0.8,
		mollie_fee: 1,
		created_at: '2001-03-20 12:00:00',
	} ),
];

async function importTransactions( api, transactions ) {
	const res = await api.post( IMPORT_ENDPOINT, {
		headers: adminAuth,
		data: { transactions },
	} );
	expect( res.status() ).toBe( 200 );
}

async function deleteFixtures( api ) {
	for ( const mode of [ 'test', 'live' ] ) {
		const res = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth,
			params: { per_page: 100, mode, order: 'ASC' },
		} );
		const { transactions = [] } = await res.json();
		for ( const txn of transactions ) {
			if ( txn.mollie_payment_id?.startsWith( PREFIX ) ) {
				await api.delete( `${ TRANSACTIONS_ENDPOINT }/${ txn.id }`, {
					headers: adminAuth,
				} );
			}
		}
	}
}

async function getSummary( api, month = MONTH, headers = adminAuth ) {
	return api.get( ENDPOINT, { headers, params: month ? { month } : {} } );
}

const byCurrency = ( body, currency ) =>
	body.currencies.find( ( row ) => row.currency === currency );

test.describe( 'DashboardController — monthly-summary', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await deleteFixtures( api );
		await importTransactions( api, FIXTURES );
	} );

	test.afterAll( async () => {
		await deleteFixtures( api );
		await api.dispose();
	} );

	test( 'defaults to the current UTC month', async () => {
		const res = await getSummary( api, null );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.month ).toBe( new Date().toISOString().slice( 0, 7 ) );
		expect( typeof body.testmode ).toBe( 'boolean' );
		expect( Array.isArray( body.currencies ) ).toBe( true );
		expect( body ).not.toHaveProperty( 'fee_cap' );
		expect( body ).not.toHaveProperty( 'total_fees' );
	} );

	test( 'sums only paid test transactions inside the month, per currency', async () => {
		const res = await getSummary( api );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body.month ).toBe( MONTH );
		expect( body.testmode ).toBe( true );
		expect( body.currencies.map( ( row ) => row.currency ) ).toEqual( [
			'EUR',
			'PLN',
		] );

		expect( byCurrency( body, 'EUR' ) ).toEqual( {
			currency: 'EUR',
			transaction_count: 3,
			paid_total: 170,
			fair_event_commission: 2,
			mollie_commission: 2,
			amount_after_fees: 166,
			missing_fair_event_commission_count: 1,
			missing_mollie_commission_count: 1,
			fair_event_commission_complete: false,
			mollie_commission_complete: false,
			amount_after_fees_complete: false,
		} );

		expect( byCurrency( body, 'PLN' ) ).toEqual( {
			currency: 'PLN',
			transaction_count: 1,
			paid_total: 40,
			fair_event_commission: 0.8,
			mollie_commission: 1,
			amount_after_fees: 38.2,
			missing_fair_event_commission_count: 0,
			missing_mollie_commission_count: 0,
			fair_event_commission_complete: true,
			mollie_commission_complete: true,
			amount_after_fees_complete: true,
		} );
	} );

	test( 'reflects a Mollie fee recorded after the month was first read', async () => {
		await importTransactions( api, [
			fixture( 'end', {
				amount: 50,
				application_fee: 0,
				mollie_fee: 0.75,
			} ),
		] );

		const eur = byCurrency(
			await ( await getSummary( api ) ).json(),
			'EUR'
		);
		expect( eur.transaction_count ).toBe( 3 );
		expect( eur.mollie_commission ).toBeCloseTo( 2.75, 2 );
		expect( eur.missing_mollie_commission_count ).toBe( 0 );
		expect( eur.mollie_commission_complete ).toBe( true );
		expect( eur.amount_after_fees ).toBeCloseTo( 165.25, 2 );
		// The unrecorded Fair Event commission still keeps it incomplete.
		expect( eur.amount_after_fees_complete ).toBe( false );
	} );

	// The test instance pins fair_payment_mode to "test" (see
	// e2e/mu-plugins/fair-e2e-support.php), so live-mode figures can only be
	// checked from this side: a paid live row in the month stays out.
	test( 'keeps live transactions out of the test-mode figures', async () => {
		const list = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth,
			params: { per_page: 100, mode: 'live', order: 'ASC' },
		} );
		const { transactions } = await list.json();
		expect(
			transactions.some(
				( txn ) => txn.mollie_payment_id === `${ PREFIX }live`
			)
		).toBe( true );

		const body = await ( await getSummary( api ) ).json();
		expect( body.testmode ).toBe( true );
		const eur = byCurrency( body, 'EUR' );
		expect( eur.transaction_count ).toBe( 3 );
		expect( eur.paid_total ).toBeLessThan( 500 );
	} );

	test( 'returns zero values for an empty month', async () => {
		const body = await ( await getSummary( api, '2001-06' ) ).json();
		expect( body.month ).toBe( '2001-06' );
		expect( body.currencies ).toHaveLength( 1 );
		expect( body.currencies[ 0 ] ).toMatchObject( {
			transaction_count: 0,
			paid_total: 0,
			fair_event_commission: 0,
			mollie_commission: 0,
			amount_after_fees: 0,
			missing_fair_event_commission_count: 0,
			missing_mollie_commission_count: 0,
			amount_after_fees_complete: true,
		} );
	} );

	for ( const month of [
		'2001-13',
		'2001-00',
		'2001-3',
		'march',
		'1999-12',
	] ) {
		test( `rejects invalid month ${ month }`, async () => {
			const res = await getSummary( api, month );
			expect( res.status() ).toBe( 400 );
		} );
	}

	test( 'requires authentication', async () => {
		const res = await api.get( ENDPOINT, { params: { month: MONTH } } );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'rejects a logged-in user without manage_options', async () => {
		const login = `dash1685-${ Date.now() }`;
		const password = 'Test-password-1685!';
		const created = await api.post( '/wp-json/wp/v2/users', {
			headers: adminAuth,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password,
				roles: [ 'subscriber' ],
			},
		} );
		expect( created.ok() ).toBeTruthy();
		const userId = ( await created.json() ).id;

		try {
			const res = await getSummary( api, MONTH, {
				Authorization:
					'Basic ' +
					Buffer.from( `${ login }:${ password }` ).toString(
						'base64'
					),
			} );
			expect( res.status() ).toBe( 403 );
		} finally {
			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers: adminAuth }
			);
		}
	} );
} );
