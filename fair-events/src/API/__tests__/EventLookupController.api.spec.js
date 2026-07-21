/**
 * Playwright API tests for EventLookupController.
 *
 * Verifies POST /fair-events/v1/lookup-url rejects non-http(s) URLs,
 * enforces the permission check, and fetches metadata from a live page.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeader = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('EventLookupController', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('rejects a non-http(s) URL', async () => {
		const res = await api.post('/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: 'ftp://example.com/event' },
		});

		expect(res.status()).toBe(400);
	});

	test('rejects requests without permission', async () => {
		const anonymousApi = await request.newContext({ baseURL: BASE_URL });
		const res = await anonymousApi.post(
			'/wp-json/fair-events/v1/lookup-url',
			{
				data: { url: 'https://example.com' },
			}
		);

		expect([401, 403]).toContain(res.status());
		await anonymousApi.dispose();
	});

	test('fetches and extracts metadata from a known page', async () => {
		const res = await api.post('/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: 'https://example.com' },
		});

		expect(res.status()).toBe(200);
		const body = await res.json();

		expect(body.title).toBeTruthy();
		expect(body).toHaveProperty('found');
	});
});
