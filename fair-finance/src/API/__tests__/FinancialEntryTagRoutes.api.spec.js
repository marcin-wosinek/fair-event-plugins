/**
 * Playwright API tests for the tag routes on FinancialEntryController.
 *
 * Exercises GET /fair-finance/v1/financial-entries/tags,
 * GET /fair-finance/v1/financial-entries/totals-by-tag, and
 * GET /fair-finance/v1/financial-entries?tag=... against a live WordPress
 * instance using admin Application Password credentials.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
	'base64'
);

test.describe('FinancialEntry tag routes', () => {
	let api;
	let entryId;
	const testTag = `test-tag-${Date.now()}`;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const res = await api.post(
			'/wp-json/fair-finance/v1/financial-entries',
			{
				headers: { Authorization: `Basic ${adminAuth}` },
				data: {
					amount: 42.0,
					entry_type: 'cost',
					entry_date: '2026-01-15',
					description: 'Tag route test entry',
					tag: testTag,
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		entryId = body.id;
		expect(entryId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (entryId) {
			await api.delete(
				`/wp-json/fair-finance/v1/financial-entries/${entryId}`,
				{
					headers: { Authorization: `Basic ${adminAuth}` },
				}
			);
		}
		await api.dispose();
	});

	test('GET /tags returns the test tag', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/tags',
			{
				headers: { Authorization: `Basic ${adminAuth}` },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toContain(testTag);
	});

	test('GET /totals-by-tag returns cost total for the test tag', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/totals-by-tag',
			{
				headers: { Authorization: `Basic ${adminAuth}` },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body[testTag]).toBeDefined();
		expect(body[testTag].total_cost).toBeGreaterThanOrEqual(42.0);
		expect(body[testTag].total_income).toBeDefined();
		expect(body[testTag].balance).toBeDefined();
	});

	test('GET /financial-entries?tag= filters by tag', async () => {
		const res = await api.get(
			`/wp-json/fair-finance/v1/financial-entries?tag=${encodeURIComponent(
				testTag
			)}`,
			{
				headers: { Authorization: `Basic ${adminAuth}` },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body.entries)).toBe(true);
		expect(body.entries.length).toBeGreaterThan(0);
		body.entries.forEach((entry) => {
			expect(entry.tag).toBe(testTag);
		});
	});

	test('GET /financial-entries?tag=none returns only untagged entries', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries?tag=none',
			{
				headers: { Authorization: `Basic ${adminAuth}` },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body.entries)).toBe(true);
		body.entries.forEach((entry) => {
			expect(entry.tag).toBeNull();
		});
	});

	test('requires authentication', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/tags'
		);
		expect(res.status()).toBe(401);
	});
});
