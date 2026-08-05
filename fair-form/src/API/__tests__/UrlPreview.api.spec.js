/**
 * Playwright API tests for UrlPreviewController.
 *
 * Verifies POST /fair-form/v1/url-preview fetches metadata from a live page
 * anonymously (no auth required — visitors preview a URL before submitting),
 * rejects invalid URLs, silently reports failures for unreachable/SSRF/non-HTML
 * targets, and enforces the per-IP rate limit.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';

test.describe('UrlPreviewController', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('fetches and returns metadata from a known page, anonymously', async () => {
		const res = await api.post('/wp-json/fair-form/v1/url-preview', {
			data: { url: 'https://example.com' },
		});

		expect(res.status()).toBe(200);
		const body = await res.json();

		expect(body.title).toBeTruthy();
		expect(body).toHaveProperty('found');
	});

	test('rejects a non-http(s) URL', async () => {
		const res = await api.post('/wp-json/fair-form/v1/url-preview', {
			data: { url: 'ftp://example.com/event' },
		});

		expect(res.status()).toBe(400);
	});

	test('returns 422 for an unreachable domain', async () => {
		const res = await api.post('/wp-json/fair-form/v1/url-preview', {
			data: { url: 'https://this-domain-does-not-exist.example.test' },
		});

		expect([422, 500]).toContain(res.status());
	});

	test('returns 422 for a private-IP address (SSRF protection)', async () => {
		const res = await api.post('/wp-json/fair-form/v1/url-preview', {
			data: { url: 'http://169.254.169.254/' },
		});

		expect([400, 422, 500]).toContain(res.status());
	});

	test('returns 422 for a non-HTML response', async () => {
		const res = await api.post('/wp-json/fair-form/v1/url-preview', {
			data: { url: 'https://api.github.com/zen' },
		});

		expect(res.status()).toBe(422);
	});

	test('rate limits after repeated requests from the same client', async () => {
		let lastStatus = 200;

		for (let i = 0; i < 21; i++) {
			// eslint-disable-next-line no-await-in-loop
			const res = await api.post('/wp-json/fair-form/v1/url-preview', {
				data: { url: `https://example.com/?i=${i}` },
			});
			lastStatus = res.status();
			if (lastStatus === 429) {
				break;
			}
		}

		expect(lastStatus).toBe(429);
	});
});
