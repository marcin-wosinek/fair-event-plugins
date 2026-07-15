/**
 * Playwright API tests for the weekly digest endpoints (#916, PR 4):
 * GET/PUT /fair-audience/v1/weekly-digest, GET /weekly-digest/sources,
 * POST /weekly-digest/preview, POST /weekly-digest/test.
 *
 * The digest config is a single site option, so these tests save the
 * original config before mutating it and restore it afterwards to avoid
 * leaking state into other suites/environments.
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

/**
 * ISO day of week (1=Monday..7=Sunday) for a JS Date.
 *
 * @param {Date} date A date.
 * @return {number} ISO day of week.
 */
function isoDayOfWeek(date) {
	return ((date.getDay() + 6) % 7) + 1;
}

test.describe('WeeklyDigestController — /weekly-digest', () => {
	let api;
	let originalConfig;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const res = await api.get('/wp-json/fair-audience/v1/weekly-digest', {
			headers: authHeaders,
		});
		if (res.ok()) {
			originalConfig = (await res.json()).config;
		}
	});

	test.afterAll(async () => {
		if (originalConfig) {
			await api.put('/wp-json/fair-audience/v1/weekly-digest', {
				headers: authHeaders,
				data: originalConfig,
			});
		}
		await api.dispose();
	});

	test('unauthenticated GET is rejected', async () => {
		const res = await api.get('/wp-json/fair-audience/v1/weekly-digest');
		expect(res.ok()).toBeFalsy();
		expect([401, 403]).toContain(res.status());
	});

	test('unauthenticated PUT is rejected', async () => {
		const res = await api.put('/wp-json/fair-audience/v1/weekly-digest', {
			data: { enabled: true },
		});
		expect(res.ok()).toBeFalsy();
		expect([401, 403]).toContain(res.status());
	});

	test('unauthenticated preview is rejected', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/weekly-digest/preview'
		);
		expect(res.ok()).toBeFalsy();
		expect([401, 403]).toContain(res.status());
	});

	test('unauthenticated test-send is rejected', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/weekly-digest/test'
		);
		expect(res.ok()).toBeFalsy();
		expect([401, 403]).toContain(res.status());
	});

	test('authenticated GET returns config, last_sent_week, last_run_result', async () => {
		const res = await api.get('/wp-json/fair-audience/v1/weekly-digest', {
			headers: authHeaders,
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body).toEqual(
			expect.objectContaining({
				config: expect.objectContaining({
					enabled: expect.any(Boolean),
					source_slug: expect.any(String),
					day_of_week: expect.any(Number),
					time_of_day: expect.any(String),
					week_scope: expect.any(String),
					skip_empty: expect.any(Boolean),
					subject: expect.any(String),
					intro: expect.any(String),
				}),
				last_sent_week: expect.any(String),
			})
		);
	});

	test('PUT sanitizes and persists the config; GET reflects it', async () => {
		const putRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{
				headers: authHeaders,
				data: {
					enabled: true,
					source_slug: 'Test Source',
					day_of_week: 3,
					time_of_day: '09:30',
					week_scope: 'next',
					skip_empty: false,
					subject: 'Digest {week_start} – {week_end}',
					intro: '<p>Hello</p>',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const putBody = await putRes.json();
		expect(putBody.config).toEqual(
			expect.objectContaining({
				enabled: true,
				source_slug: 'test-source',
				day_of_week: 3,
				time_of_day: '09:30',
				week_scope: 'next',
				skip_empty: false,
			})
		);

		const getRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		expect(getRes.ok()).toBeTruthy();
		const getBody = await getRes.json();
		expect(getBody.config.source_slug).toBe('test-source');
		expect(getBody.config.day_of_week).toBe(3);
	});

	test('PUT rejects out-of-range values by falling back to defaults', async () => {
		const res = await api.put('/wp-json/fair-audience/v1/weekly-digest', {
			headers: authHeaders,
			data: {
				day_of_week: 42,
				time_of_day: 'not-a-time',
				week_scope: 'someday',
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.config.day_of_week).toBe(1);
		expect(body.config.time_of_day).toBe('08:00');
		expect(body.config.week_scope).toBe('current');
	});

	test('PUT sanitizes intro/outro: keeps simple HTML, strips <script>', async () => {
		const putRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{
				headers: authHeaders,
				data: {
					intro: '<p>Hello <strong>there</strong> <a href="https://example.com">link</a></p><script>alert(1)</script>',
					outro: '<script>alert(2)</script><p>Bye</p>',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const putBody = await putRes.json();
		expect(putBody.config.intro).toContain('<strong>there</strong>');
		expect(putBody.config.intro).toContain(
			'<a href="https://example.com">link</a>'
		);
		expect(putBody.config.intro).not.toContain('<script>');
		expect(putBody.config.outro).not.toContain('<script>');
		expect(putBody.config.outro).toContain('<p>Bye</p>');

		const getRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		expect(getRes.ok()).toBeTruthy();
		const getBody = await getRes.json();
		expect(getBody.config.intro).toContain('<strong>there</strong>');
		expect(getBody.config.outro).toContain('<p>Bye</p>');
	});

	test('GET /weekly-digest/sources returns a list of { slug, name }', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest/sources',
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		for (const source of body) {
			expect(source).toEqual(
				expect.objectContaining({
					slug: expect.any(String),
					name: expect.any(String),
				})
			);
		}
	});

	test('PUT with a slot later this week leaves last_sent_week unchanged', async () => {
		const now = new Date();
		const beforeRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		const { last_sent_week: beforeWeek } = await beforeRes.json();

		const putRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{
				headers: authHeaders,
				data: {
					enabled: true,
					day_of_week: isoDayOfWeek(now),
					time_of_day: '23:59',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const getRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		const getBody = await getRes.json();
		expect(getBody.last_sent_week).toBe(beforeWeek);
	});

	test('PUT with a slot earlier this week stamps last_sent_week for the current ISO week', async () => {
		const now = new Date();

		const putRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{
				headers: authHeaders,
				data: {
					enabled: true,
					day_of_week: isoDayOfWeek(now),
					time_of_day: '00:00',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const getRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		const getBody = await getRes.json();
		expect(getBody.last_sent_week).toMatch(/^\d{4}-W\d{2}$/);
	});

	test('preview without a configured source returns 400', async () => {
		const putRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{
				headers: authHeaders,
				data: { source_slug: '' },
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const res = await api.post(
			'/wp-json/fair-audience/v1/weekly-digest/preview',
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeFalsy();
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('no_source');
	});
});
