import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const OVERVIEW_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/connection/overview';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Return Basic-auth headers for the WP admin account.
 */
function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64'),
	};
}

test.describe('ConnectionController', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test.describe('GET /connection/overview', () => {
		test('returns 401 for unauthenticated requests', async () => {
			const res = await api.get(OVERVIEW_ENDPOINT);
			expect(res.status()).toBe(401);
		});

		test('returns a graceful error for an authenticated admin when not connected', async () => {
			// This suite runs before any spec establishes an OAuth connection, so
			// the site is expected to be disconnected here. The live-Mollie
			// success path can't be exercised in CI (no real Mollie creds).
			const res = await api.get(OVERVIEW_ENDPOINT, {
				headers: adminAuth(),
			});
			expect(res.status()).toBe(400);
			const body = await res.json();
			expect(body.code).toBe('not_connected');
		});
	});
});
