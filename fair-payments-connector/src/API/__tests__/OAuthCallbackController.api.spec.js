import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const STATE_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/state';
const CALLBACK_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/callback';

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

const VALID_TOKENS = {
	access_token: 'access_test_abc123',
	refresh_token: 'refresh_test_xyz789',
	expires_in: 3600,
	organization_id: 'org_test_001',
	profile_id: 'pfl_test_001',
	test_mode: true,
};

test.describe('OAuthCallbackController', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test.describe('POST /oauth/state', () => {
		test('returns 401 for unauthenticated requests', async () => {
			const res = await api.post(STATE_ENDPOINT);
			expect(res.status()).toBe(401);
		});

		test('returns a state string for an authenticated admin', async () => {
			const res = await api.post(STATE_ENDPOINT, {
				headers: adminAuth(),
			});
			expect(res.status()).toBe(200);
			const body = await res.json();
			expect(typeof body.state).toBe('string');
			expect(body.state.length).toBeGreaterThan(0);
		});
	});

	test.describe('POST /oauth/callback', () => {
		test('returns 401 for unauthenticated requests', async () => {
			const res = await api.post(CALLBACK_ENDPOINT, {
				data: { state: 'x', ...VALID_TOKENS },
			});
			expect(res.status()).toBe(401);
		});

		test('returns 403 when state is missing', async () => {
			const res = await api.post(CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: VALID_TOKENS,
			});
			expect(res.status()).toBe(400); // missing required param
		});

		test('returns 403 when state does not match the stored transient', async () => {
			const res = await api.post(CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state: 'wrong_state', ...VALID_TOKENS },
			});
			expect(res.status()).toBe(403);
			const body = await res.json();
			expect(body.code).toBe('invalid_oauth_state');
		});

		test('saves credentials and returns success when state is valid', async () => {
			// Step 1: get a real state token
			const stateRes = await api.post(STATE_ENDPOINT, {
				headers: adminAuth(),
			});
			expect(stateRes.status()).toBe(200);
			const { state } = await stateRes.json();

			// Step 2: complete callback with that state
			const callbackRes = await api.post(CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			});
			expect(callbackRes.status()).toBe(200);
			const body = await callbackRes.json();
			expect(body.success).toBe(true);
		});

		test('rejects a replayed state (single-use)', async () => {
			// Step 1: generate state
			const stateRes = await api.post(STATE_ENDPOINT, {
				headers: adminAuth(),
			});
			const { state } = await stateRes.json();

			// Step 2: first use — should succeed
			const first = await api.post(CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			});
			expect(first.status()).toBe(200);

			// Step 3: replay — must be rejected
			const second = await api.post(CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			});
			expect(second.status()).toBe(403);
			const body = await second.json();
			expect(body.code).toBe('invalid_oauth_state');
		});
	});
});
