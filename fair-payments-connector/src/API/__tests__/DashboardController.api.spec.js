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
});
