import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const TRANSACTIONS_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions';
const IMPORT_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/transactions/import';
const DASHBOARD_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/dashboard/monthly-summary';

function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
	};
}

test.describe('Transaction — fee cap enforcement', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('transactions endpoint requires authentication', async () => {
		const res = await api.get(TRANSACTIONS_ENDPOINT);
		expect(res.status()).toBe(401);
	});

	test('transaction records include application_fee field', async () => {
		const res = await api.get(TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body).toHaveProperty('transactions');
		expect(Array.isArray(body.transactions)).toBe(true);
		for (const txn of body.transactions) {
			expect(txn).toHaveProperty('application_fee');
			expect(txn).toHaveProperty('amount');
		}
	});

	test('cap_remaining stays within [0, fee_cap] after seeding transactions below the cap', async () => {
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

		const importRes = await api.post(IMPORT_ENDPOINT, {
			headers: adminAuth(),
			data: { transactions: seedPayload },
		});
		expect(importRes.status()).toBe(200);

		const dashRes = await api.get(DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		});
		expect(dashRes.status()).toBe(200);
		const dash = await dashRes.json();

		// cap_remaining must be non-negative and never exceed the configured cap.
		expect(dash.cap_remaining).toBeGreaterThanOrEqual(0);
		expect(dash.cap_remaining).toBeLessThanOrEqual(dash.fee_cap);
	});

	test('application_fee is 0 or null on new transactions during the waiver period', async () => {
		const mollie_payment_id = 'tr_waiver_check_' + Date.now();
		const importRes = await api.post(IMPORT_ENDPOINT, {
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
		});
		expect(importRes.status()).toBe(200);

		// Retrieve the imported transaction and verify its fee is 0 or null.
		const listRes = await api.get(TRANSACTIONS_ENDPOINT, {
			headers: adminAuth(),
		});
		expect(listRes.status()).toBe(200);
		const { transactions } = await listRes.json();
		const txn = transactions.find(
			(t) => t.mollie_payment_id === mollie_payment_id
		);
		expect(txn).toBeDefined();
		const fee = txn?.application_fee ?? null;
		expect(fee == null || fee === 0 || fee === '0.00').toBe(true);
	});

	test('cap_remaining is 0 when seeded fees exhaust the monthly cap', async () => {
		const dashRes = await api.get(DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		});
		expect(dashRes.status()).toBe(200);
		const { fee_cap } = await dashRes.json();

		// Seed a single transaction whose application_fee equals the full cap,
		// pushing cap_remaining to 0.
		const importRes = await api.post(IMPORT_ENDPOINT, {
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
		});
		expect(importRes.status()).toBe(200);

		const afterRes = await api.get(DASHBOARD_ENDPOINT, {
			headers: adminAuth(),
		});
		expect(afterRes.status()).toBe(200);
		const after = await afterRes.json();

		expect(after.cap_remaining).toBe(0);
	});
});
