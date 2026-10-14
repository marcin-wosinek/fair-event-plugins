import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const TEST_PAYMENT_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/test-payment';
const SETTINGS_WRITE_ENDPOINT = '/wp-json/fair-payments-connector/v1/settings';
const TRANSACTIONS_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Return Basic-auth headers for the WP admin account.
 */
function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASS }` ).toString(
				'base64'
			),
	};
}

test.describe( 'Test payment endpoint', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'rejects unauthenticated requests with 401', async () => {
		const res = await api.post( TEST_PAYMENT_ENDPOINT );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'returns a graceful error for an authenticated admin when not connected', async () => {
		test.skip(
			true,
			'Skipped pending #1405 — the shared e2e test env forces a connected Mollie state'
		);
		// This suite runs without an established OAuth connection, so the site is
		// expected to be disconnected here. The live-Mollie success path can't be
		// exercised in CI (no real Mollie creds).
		const res = await api.post( TEST_PAYMENT_ENDPOINT, {
			headers: adminAuth(),
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'not_connected' );
	} );

	test.describe( 'GET /test-payment (#1773)', () => {
		test.afterAll( async () => {
			await setCurrency( 'EUR' );
		} );

		test( 'rejects unauthenticated requests with 401', async () => {
			const res = await api.get( TEST_PAYMENT_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		for ( const currency of [ 'EUR', 'PLN', 'USD' ] ) {
			test( `reports the amount, ${ currency }, mode and account without creating a transaction`, async () => {
				await setCurrency( currency );
				const before = await transactionTotal();

				const res = await api.get( TEST_PAYMENT_ENDPOINT, {
					headers: adminAuth(),
				} );
				expect( res.status(), await res.text() ).toBe( 200 );
				const body = await res.json();

				expect( body ).toMatchObject( {
					amount: '1.00',
					currency,
					// The shared test environment forces test mode and this
					// fake profile (e2e/mu-plugins/fair-e2e-support.php).
					mode: 'test',
					profile_id: 'pfl_e2e0000000',
				} );
				expect( body.amount_display ).toContain( currency );
				expect( body ).toHaveProperty( 'organization_id' );
				expect( await transactionTotal() ).toBe( before );
			} );
		}
	} );

	test.describe( 'POST /test-payment with a confirmed context (#1773)', () => {
		test.afterAll( async () => {
			await setCurrency( 'EUR' );
		} );

		const confirmedContext = async () => {
			const res = await api.get( TEST_PAYMENT_ENDPOINT, {
				headers: adminAuth(),
			} );
			const { mode, currency, profile_id, organization_id } =
				await res.json();
			return { mode, currency, profile_id, organization_id };
		};

		test( 'refuses a confirmation whose currency changed, before creating a transaction', async () => {
			await setCurrency( 'EUR' );
			const confirmed = await confirmedContext();
			await setCurrency( 'PLN' );
			const before = await transactionTotal();

			const res = await api.post( TEST_PAYMENT_ENDPOINT, {
				headers: adminAuth(),
				data: { confirmed },
			} );

			expect( res.status() ).toBe( 409 );
			const body = await res.json();
			expect( body.code ).toBe( 'test_payment_context_changed' );
			expect( body.data.context.currency ).toBe( 'PLN' );
			expect( await transactionTotal() ).toBe( before );
		} );

		test( 'refuses a confirmation for another account or mode', async () => {
			const current = await confirmedContext();
			const before = await transactionTotal();

			for ( const changed of [
				{ profile_id: 'pfl_someone_else' },
				{ organization_id: 'org_someone_else' },
				{ mode: 'live' },
			] ) {
				const res = await api.post( TEST_PAYMENT_ENDPOINT, {
					headers: adminAuth(),
					data: { confirmed: { ...current, ...changed } },
				} );
				expect( res.status() ).toBe( 409 );
				expect( ( await res.json() ).code ).toBe(
					'test_payment_context_changed'
				);
			}

			expect( await transactionTotal() ).toBe( before );
		} );
	} );

	/**
	 * Set the site currency through the connector's settings endpoint.
	 *
	 * @param {string} currency Currency code.
	 */
	async function setCurrency( currency ) {
		const res = await api.post( SETTINGS_WRITE_ENDPOINT, {
			headers: adminAuth(),
			data: { settings: { fair_payment_currency: currency } },
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
	}

	/**
	 * Count every stored transaction.
	 *
	 * @return {Promise<number>} Transaction total
	 */
	async function transactionTotal() {
		const res = await api.get( TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
			params: { per_page: 1 },
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		return ( await res.json() ).total;
	}
} );
