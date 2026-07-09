/**
 * Playwright API tests for InstagramPostsController's upload-blob endpoint.
 *
 * Covers the #1063 fix: the schedule PNG is now stored as a WordPress
 * media-library attachment instead of being round-tripped through
 * tmpfiles.org (which stopped serving raw image bytes).
 *
 *   POST /fair-audience/v1/instagram/upload-blob
 *
 * Out of HTTP scope (validated manually per TESTING.md's WP-CLI eval-file
 * recipe): the live Instagram Graph API round-trip, and the temp-attachment
 * cleanup that happens inside create_item() after a successful publish
 * (requires configured Instagram credentials).
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

// Well-known 1x1 transparent PNG.
const VALID_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe('InstagramPostsController – upload-blob', () => {
	let api;
	const createdAttachmentIds = [];

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		for (const id of createdAttachmentIds) {
			await api.delete(`/wp-json/wp/v2/media/${id}`, {
				headers: authHeaders,
				params: { force: true },
			});
		}
		await api.dispose();
	});

	test('stores a valid PNG as a local media-library attachment', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-blob',
			{
				headers: authHeaders,
				data: { image_data: VALID_PNG_BASE64 },
			}
		);
		expect(res.ok()).toBeTruthy();

		const body = await res.json();
		expect(typeof body.attachment_id).toBe('number');
		createdAttachmentIds.push(body.attachment_id);

		// Not tmpfiles.org — a URL on this same WordPress origin.
		expect(body.url.startsWith(BASE_URL)).toBe(true);
		expect(body.url).toContain('/wp-content/uploads/');

		// The Graph API needs a URL that actually serves image bytes.
		const imageRes = await api.get(body.url);
		expect(imageRes.ok()).toBeTruthy();
		expect(imageRes.headers()['content-type']).toBe('image/png');
	});

	test('rejects data that is not a valid image', async () => {
		const notAnImage = Buffer.from('this is not an image').toString(
			'base64'
		);

		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-blob',
			{
				headers: authHeaders,
				data: { image_data: notAnImage },
			}
		);
		expect(res.status()).toBe(400);

		const body = await res.json();
		expect(body.code).toBe('invalid_image_data');
	});

	test('rejects a blob over the size cap', async () => {
		// MAX_BLOB_SIZE is 5 MiB in InstagramPostsController.
		const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 'a').toString(
			'base64'
		);

		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-blob',
			{
				headers: authHeaders,
				data: { image_data: oversized },
			}
		);
		expect(res.status()).toBe(400);

		const body = await res.json();
		expect(body.code).toBe('file_too_large');
	});

	test('rejects unauthenticated requests', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-blob',
			{
				data: { image_data: VALID_PNG_BASE64 },
			}
		);
		expect(res.status()).toBe(401);
	});
});
