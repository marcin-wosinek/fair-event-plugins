import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ENDPOINT = '/wp-json/fair-payments-connector/v1/webhook';

test.describe('WebhookEndpoint — POST /webhook', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('returns 400 when id param is missing', async () => {
		const res = await api.post(ENDPOINT, { data: {} });
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('missing_payment_id');
	});

	test('returns 404 for an unknown mollie payment id', async () => {
		const res = await api.post(ENDPOINT, {
			data: { id: 'tr_nonexistent_test_id' },
		});
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.code).toBe('transaction_not_found');
	});
});
