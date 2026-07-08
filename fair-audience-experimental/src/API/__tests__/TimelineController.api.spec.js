/**
 * Playwright API tests for the TimelineController ticket-sales branch.
 *
 * Exercises GET /fair-audience/v1/timeline against a live WordPress instance,
 * focusing on the testmode flag visibility and mode-driven filtering:
 *
 * - The response shape always includes a `testmode` field on each ticket entry.
 * - When fair_payment_mode = 'test', test-mode transactions appear; when 'live'
 *   they are absent.
 *
 * Note: seeding real `fair_payment_transactions` rows requires the Mollie
 * webhook flow, so mode-driven visibility is exercised via the WP-CLI eval-file
 * manual check (TESTING.md). This spec covers the shape contract and the
 * settings-toggle path observable from the outside.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

async function getPaymentMode(api) {
	const res = await api.get('/wp-json/wp/v2/settings', {
		headers: authHeaders,
	});
	expect(res.ok()).toBeTruthy();
	const body = await res.json();
	return body.fair_payment_mode;
}

async function setPaymentMode(api, mode) {
	const res = await api.post('/wp-json/wp/v2/settings', {
		headers: authHeaders,
		data: { fair_payment_mode: mode },
	});
	expect(res.ok()).toBeTruthy();
}

test.describe('TimelineController – ticket-sales testmode', () => {
	let api;
	let originalMode;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
		originalMode = await getPaymentMode(api);
	});

	test.afterAll(async () => {
		if (originalMode !== undefined) {
			await setPaymentMode(api, originalMode);
		}
		await api.dispose();
	});

	test('GET /timeline returns 200 and an array', async () => {
		const res = await api.get('/wp-json/fair-audience/v1/timeline', {
			headers: authHeaders,
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
	});

	test('ticket_sales_day items carry testmode on each ticket entry', async () => {
		await setPaymentMode(api, 'test');

		const res = await api.get('/wp-json/fair-audience/v1/timeline', {
			headers: authHeaders,
			params: { per_page: 50, page: 1 },
		});
		expect(res.ok()).toBeTruthy();
		const items = await res.json();

		const ticketDays = items.filter(
			(item) => item.type === 'ticket_sales_day'
		);

		// If there are ticket-sale items, every ticket entry must have a boolean testmode field.
		for (const day of ticketDays) {
			expect(day.details).toHaveProperty('tickets');
			for (const ticket of day.details.tickets) {
				expect(typeof ticket.testmode).toBe('boolean');
			}
		}
	});

	test('switching to live mode causes the timeline endpoint to respond without error', async () => {
		await setPaymentMode(api, 'live');

		const res = await api.get('/wp-json/fair-audience/v1/timeline', {
			headers: authHeaders,
			params: { per_page: 50, page: 1 },
		});
		expect(res.status()).toBe(200);
		const items = await res.json();

		// In live mode, no ticket entry should be flagged as testmode=true.
		const ticketDays = items.filter(
			(item) => item.type === 'ticket_sales_day'
		);
		for (const day of ticketDays) {
			for (const ticket of day.details.tickets) {
				expect(ticket.testmode).toBe(false);
			}
		}
	});

	test('switching back to test mode restores connector mode', async () => {
		await setPaymentMode(api, 'test');

		const res = await api.get('/wp-json/fair-audience/v1/timeline', {
			headers: authHeaders,
		});
		expect(res.status()).toBe(200);
	});
});
