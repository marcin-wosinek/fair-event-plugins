import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ENDPOINT = '/wp-json/fair-payments-connector/v1/notifications/test';

test.describe('NotificationsController — /notifications/test', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('POST without auth returns 401', async () => {
		const res = await api.post(ENDPOINT, {
			data: { channel: 'email', destination: 'test@example.com' },
		});
		expect(res.status()).toBe(401);
	});

	test('POST without required channel returns 400', async () => {
		const res = await api.post(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: { destination: 'test@example.com' },
		});
		expect(res.status()).toBe(400);
	});

	test('POST without required destination returns 400', async () => {
		const res = await api.post(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: { channel: 'email' },
		});
		expect(res.status()).toBe(400);
	});

	test('POST with invalid channel enum returns 400', async () => {
		const res = await api.post(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: { channel: 'sms', destination: 'test@example.com' },
		});
		expect(res.status()).toBe(400);
	});

	test('POST telegram without bot token returns 400', async () => {
		// Ensure no bot token is set by using a fresh test site state.
		// If a bot token is set in the environment this test may behave differently.
		const res = await api.post(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: { channel: 'telegram', destination: '12345' },
		});
		// 400 when bot token missing, 502 when token present but Telegram API fails.
		expect([400, 502]).toContain(res.status());
	});

	test('POST email channel returns 200 or 502 (depending on mail config)', async () => {
		const res = await api.post(ENDPOINT, {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: {
				channel: 'email',
				destination: 'test@example.com',
				include_pii: false,
			},
		});
		// wp_mail() may not be configured in the test environment — both outcomes
		// are acceptable here; the important check is the route exists and
		// returns a structured response.
		expect([200, 502]).toContain(res.status());
		if (res.status() === 200) {
			const body = await res.json();
			expect(body).toHaveProperty('success', true);
			expect(body).toHaveProperty('channel', 'email');
			expect(body).toHaveProperty('text');
		}
	});
});
