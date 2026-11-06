/**
 * Readiness guard for the block documentation example fixtures (issue
 * #2152). Browser-only: every page is served by a route on a fake origin,
 * with a stub `wp.apiFetch` that records each call, so no WordPress site is
 * needed.
 *
 * Run: `npm run test:e2e:local -- --reuse e2e/block-docs-api-fetch.spec.js`.
 */

import { test, expect } from '@playwright/test';
import {
	blockDocsApiFetch,
	READINESS_TIMEOUT,
} from './support/block-docs-api-fetch.js';

const ORIGIN = 'http://block-docs-helper.test';
const ADMIN_URL = `${ORIGIN}/wp-admin/`;
const REQUEST = { path: '/wp/v2/pages', method: 'POST', data: { title: 'x' } };

// A short budget keeps the failure cases fast; the bound is still checked.
const SHORT_TIMEOUT = 750;

// Installs `wp.apiFetch` as a stub that records every call and either
// resolves with the request echoed back or rejects with a REST error.
const stubClient = (behaviour) => `
	window.wp = window.wp || {};
	window.__calls = [];
	window.wp.apiFetch = (options) => {
		window.__calls.push(options);
		return ${
			behaviour === 'reject'
				? "Promise.reject({ code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts as this user.' })"
				: 'Promise.resolve({ id: 42, echoed: options })'
		};
	};
`;

const html = (body) =>
	`<!doctype html><html><head><script>window.wp = { hooks: {} };</script></head><body><div id="wpadminbar"></div>${body}</body></html>`;

/**
 * Route every request on the fake origin, holding the client script back.
 *
 * @param {import('@playwright/test').Page} page          Playwright page.
 * @param {Object}                          site          What to serve.
 * @param {Object}                          site.pages    HTML keyed by pathname.
 * @param {string}                          [site.client] Body of `/client.js`.
 * @return {Promise<Object>} `requested` resolves once the browser asks for
 *                           `/client.js`; `release()` lets it load.
 */
async function serve(page, { pages, client = '' }) {
	let release;
	const held = new Promise((resolve) => (release = resolve));
	let requested;
	const asked = new Promise((resolve) => (requested = resolve));
	await page.route(`${ORIGIN}/**`, async (route) => {
		const { pathname } = new URL(route.request().url());
		if (pathname === '/client.js') {
			requested();
			await held;
			return route.fulfill({
				contentType: 'text/javascript',
				body: client,
			});
		}
		return route.fulfill({
			contentType: 'text/html',
			body: pages[pathname] ?? html(''),
		});
	});
	return { requested: asked, release };
}

test.describe('Block docs apiFetch readiness', () => {
	test('waits for a client that becomes callable later, then calls it once', async ({
		page,
	}) => {
		const site = await serve(page, {
			pages: {
				'/wp-admin/': html('<script src="/client.js"></script>'),
			},
			client: stubClient('resolve'),
		});
		// `commit` returns while the parser is still blocked on the held
		// client script, like the admin bar appearing before the footer.
		await page.goto(ADMIN_URL, { waitUntil: 'commit' });
		await site.requested;

		const call = blockDocsApiFetch(page, REQUEST, { stage: 'setup' });
		expect(
			await page.evaluate(() => ({
				ready: document.readyState,
				client: typeof window.wp?.apiFetch,
				calls: window.__calls,
			}))
		).toEqual({ ready: 'loading', client: 'undefined' });

		site.release();
		const data = await call;

		expect(data).toEqual({ id: 42, echoed: REQUEST });
		expect(await page.evaluate(() => window.__calls)).toEqual([REQUEST]);
	});

	for (const scenario of [
		{
			name: 'the client never loads',
			url: ADMIN_URL,
			pages: { '/wp-admin/': html('') },
			observed: 'wp.apiFetch is undefined',
		},
		{
			name: 'wp is missing',
			url: ADMIN_URL,
			pages: { '/wp-admin/': '<!doctype html><body></body>' },
			observed: 'window.wp is undefined',
		},
		{
			name: 'the client is not callable',
			url: ADMIN_URL,
			pages: {
				'/wp-admin/': html('<script>window.wp.apiFetch = {};</script>'),
			},
			observed: 'wp.apiFetch is object',
		},
		{
			name: 'the page is not an admin page',
			url: `${ORIGIN}/wp-login.php`,
			pages: {
				'/wp-login.php': html(
					`<script>${stubClient('resolve')}</script>`
				),
			},
			observed: 'wp.apiFetch is function',
		},
	]) {
		test(`fails within its budget with diagnostics when ${scenario.name}`, async ({
			page,
		}) => {
			await serve(page, { pages: scenario.pages });
			await page.goto(scenario.url);

			const started = Date.now();
			const error = await blockDocsApiFetch(page, REQUEST, {
				stage: 'setup',
				timeout: SHORT_TIMEOUT,
			}).catch((caught) => caught);
			const elapsed = Date.now() - started;

			expect(error).toBeInstanceOf(Error);
			expect(error.message).toContain(
				`wp.apiFetch not ready after ${SHORT_TIMEOUT}ms during setup`
			);
			expect(error.message).toContain('before POST /wp/v2/pages');
			expect(error.message).toContain(`url ${scenario.url}`);
			expect(error.message).toContain(scenario.observed);
			expect(elapsed).toBeLessThan(SHORT_TIMEOUT + 5_000);
			// Readiness never issued the request.
			expect(await page.evaluate(() => window.__calls?.length ?? 0)).toBe(
				0
			);
		});
	}

	test('reports a rejected request as-is and does not retry it', async ({
		page,
	}) => {
		await serve(page, {
			pages: {
				'/wp-admin/': html(`<script>${stubClient('reject')}</script>`),
			},
		});
		await page.goto(ADMIN_URL);

		const error = await blockDocsApiFetch(page, REQUEST, {
			stage: 'cleanup',
		}).catch((caught) => caught);

		expect(error.message).toBe(
			'apiFetch POST /wp/v2/pages failed during cleanup: rest_cannot_create Sorry, you are not allowed to create posts as this user.'
		);
		expect(await page.evaluate(() => window.__calls)).toEqual([REQUEST]);
	});

	test('uses a 10-second readiness budget by default', () => {
		expect(READINESS_TIMEOUT).toBe(10_000);
	});
});
