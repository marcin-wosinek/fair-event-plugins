import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const NONCE_ENDPOINT = '/wp-json/fair-payments-connector/v1/nonce';
const PAYMENTS_ENDPOINT = '/wp-json/fair-payments-connector/v1/payments';

test.describe('PaymentEndpoint — GET /nonce', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('returns a nonce string', async () => {
		const res = await api.get(NONCE_ENDPOINT);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(typeof body.nonce).toBe('string');
		expect(body.nonce.length).toBeGreaterThan(0);
	});
});

test.describe('PaymentEndpoint — POST /payments security checks', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('returns 400 when nonce param is missing', async () => {
		const res = await api.post(PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'some-block-id',
			},
		});
		expect(res.status()).toBe(400);
	});

	test('returns 403 for an invalid nonce', async () => {
		const res = await api.post(PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'some-block-id',
				nonce: 'invalid_nonce_value',
			},
		});
		expect(res.status()).toBe(403);
		const body = await res.json();
		expect(body.code).toBe('invalid_nonce');
	});

	test('returns 400 when block_id param is missing', async () => {
		const res = await api.post(PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				nonce: 'some_nonce',
			},
		});
		expect(res.status()).toBe(400);
	});

	test('returns 403 for a valid nonce but missing post_id', async () => {
		const nonceRes = await api.get(NONCE_ENDPOINT);
		const { nonce } = await nonceRes.json();

		const res = await api.post(PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'non-existent-block-id',
				nonce,
			},
		});
		expect(res.status()).toBe(403);
		const body = await res.json();
		expect(body.code).toBe('invalid_block');
	});
});
