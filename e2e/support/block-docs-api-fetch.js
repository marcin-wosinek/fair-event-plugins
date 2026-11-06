/**
 * Browser `wp.apiFetch` calls for the block documentation example spec
 * (issue #2152).
 *
 * The spec's fixture requests run inside an authenticated admin page, so
 * `wp.apiFetch` sends the REST nonce. The admin bar is printed long before
 * the footer script that defines `wp.apiFetch`, so a page that shows the
 * admin bar can still be parsing with `window.wp` present but
 * `wp.apiFetch` undefined. Every request therefore waits, with a bounded
 * timeout, for an admin URL and a callable client first. The wait only
 * polls; the request itself is issued exactly once, and a REST error is
 * reported as it came back.
 */

export const READINESS_TIMEOUT = 10_000;

const ADMIN_PATH = /\/wp-admin\//;

const describeRequest = (options) =>
	`${options.method || 'GET'} ${options.path}`;

/**
 * Report what the page holds instead of a callable client.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<string>} `typeof window.wp.apiFetch`, or why it is absent.
 */
async function observeClient(page) {
	try {
		return await page.evaluate(() => {
			if (typeof window.wp !== 'object' || window.wp === null) {
				return `window.wp is ${typeof window.wp}`;
			}
			return `wp.apiFetch is ${typeof window.wp.apiFetch}`;
		});
	} catch (error) {
		return `unavailable (${error.message.split('\n')[0]})`;
	}
}

/**
 * Wait until the page is an admin page with a callable `wp.apiFetch`.
 *
 * @param {import('@playwright/test').Page} page              Playwright page.
 * @param {Object}                          context           What the wait is for.
 * @param {string}                          context.stage     Test stage, e.g. "setup".
 * @param {Object}                          context.request   The request about to be made.
 * @param {number}                          [context.timeout] Readiness budget in ms.
 */
export async function waitForApiFetch(
	page,
	{ stage, request, timeout = READINESS_TIMEOUT }
) {
	try {
		await page.waitForFunction(
			(adminPath) =>
				new RegExp(adminPath).test(window.location.pathname) &&
				typeof window.wp?.apiFetch === 'function',
			ADMIN_PATH.source,
			{ timeout }
		);
	} catch (error) {
		const client = await observeClient(page);
		throw new Error(
			`wp.apiFetch not ready after ${timeout}ms during ${stage}` +
				` (before ${describeRequest(request)}): url ${page.url()},` +
				` ${client}. ${error.message.split('\n')[0]}`
		);
	}
}

/**
 * Call `wp.apiFetch` once the page is ready for it.
 *
 * @param {import('@playwright/test').Page} page              Playwright page.
 * @param {Object}                          options           `wp.apiFetch` options.
 * @param {Object}                          context           What the call is for.
 * @param {string}                          context.stage     Test stage, e.g. "cleanup".
 * @param {number}                          [context.timeout] Readiness budget in ms.
 * @return {Promise<unknown>} The response body.
 */
export async function blockDocsApiFetch(page, options, { stage, timeout }) {
	await waitForApiFetch(page, { stage, request: options, timeout });
	const result = await page.evaluate(async (opts) => {
		try {
			return { ok: true, data: await window.wp.apiFetch(opts) };
		} catch (error) {
			return { ok: false, message: error?.message, code: error?.code };
		}
	}, options);
	if (!result.ok) {
		throw new Error(
			`apiFetch ${describeRequest(options)} failed during ${stage}: ${
				result.code
			} ${result.message}`
		);
	}
	return result.data;
}
