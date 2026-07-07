/**
 * Playwright API tests for EventSourceController's category endpoints.
 *
 * Verifies POST /fair-events/v1/sources/categories creates a category term,
 * is idempotent for an existing name, and enforces the permission check.
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

test.describe('EventSourceController categories', () => {
	let api;
	const createdCategoryIds = [];

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		for (const id of createdCategoryIds) {
			await api.delete(`/wp-json/wp/v2/categories/${id}?force=true`, {
				headers: authHeader,
			});
		}
		await api.dispose();
	});

	test('creates a new category and returns its id, name, and slug', async () => {
		const name = `API Test Category ${Date.now()}`;
		const res = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);

		expect(res.status()).toBe(201);
		const body = await res.json();
		createdCategoryIds.push(body.id);

		expect(body).toHaveProperty('id');
		expect(body.name).toBe(name);
		expect(body).toHaveProperty('slug');
	});

	test('is idempotent when the category name already exists', async () => {
		const name = `API Test Category Dup ${Date.now()}`;

		const first = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);
		expect(first.status()).toBe(201);
		const firstBody = await first.json();
		createdCategoryIds.push(firstBody.id);

		const second = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);
		expect(second.status()).toBe(200);
		const secondBody = await second.json();

		expect(secondBody.id).toBe(firstBody.id);
	});

	test('rejects requests without permission', async () => {
		const anonymousApi = await request.newContext({ baseURL: BASE_URL });
		const res = await anonymousApi.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				data: { name: `API Test Category Unauth ${Date.now()}` },
			}
		);

		expect(res.status()).toBe(401);
		await anonymousApi.dispose();
	});
});
