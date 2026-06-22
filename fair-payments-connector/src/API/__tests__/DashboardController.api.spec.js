import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ENDPOINT =
	'/wp-json/fair-payments-connector/v1/dashboard/monthly-summary';

test.describe('DashboardController — monthly-summary', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('GET returns 200 with required fields for admin', async () => {
		const res = await api.get(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body).toHaveProperty('month');
		expect(body).toHaveProperty('total_volume');
		expect(body).toHaveProperty('total_fees');
		expect(body).toHaveProperty('fee_cap');
		expect(body).toHaveProperty('cap_remaining');
		expect(body).toHaveProperty('testmode');
		expect(typeof body.month).toBe('string');
		expect(/^\d{4}-\d{2}$/.test(body.month)).toBe(true);
		expect(typeof body.total_volume).toBe('number');
		expect(typeof body.total_fees).toBe('number');
		expect(typeof body.fee_cap).toBe('number');
		expect(typeof body.cap_remaining).toBe('number');
		expect(typeof body.testmode).toBe('boolean');
	});

	test('GET without auth returns 401', async () => {
		const res = await api.get(ENDPOINT);
		expect(res.status()).toBe(401);
	});

	test('fee_cap reflects at least the base connector price (4 EUR)', async () => {
		const res = await api.get(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		const body = await res.json();
		// fair-payments-connector base price is 4 EUR; site currency defaults to EUR.
		// With fair-events also active the cap is 12 EUR (4 + 8).
		expect(body.fee_cap).toBeGreaterThanOrEqual(4);
	});

	test('cap_remaining equals max(0, fee_cap - total_fees)', async () => {
		const res = await api.get(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		const body = await res.json();
		const expected = Math.max(0, body.fee_cap - body.total_fees);
		// Allow 0.01 rounding tolerance from decimal arithmetic.
		expect(Math.abs(body.cap_remaining - expected)).toBeLessThanOrEqual(
			0.01
		);
	});

	test('cap_remaining is never negative', async () => {
		const res = await api.get(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		const body = await res.json();
		expect(body.cap_remaining).toBeGreaterThanOrEqual(0);
	});

	test('total_fees is non-negative', async () => {
		const res = await api.get(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		const body = await res.json();
		expect(body.total_fees).toBeGreaterThanOrEqual(0);
	});
});
