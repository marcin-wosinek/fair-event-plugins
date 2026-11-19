/**
 * Connecting Instagram from Fair Events → Instagram through Meta's Unified
 * Login (#2427), in the browser.
 *
 * The tests site is its own Fair Platform OAuth service
 * (e2e/mu-plugins/fair-e2e-instagram-unified-login.php answers Meta's OAuth
 * calls by authorization code). The browser leg to Meta's login dialog is
 * answered here: the dialog redirects straight back to the platform's
 * callback with a code, or with Meta's cancellation.
 *
 * Covers the reconnect notice for a connection from before Unified Login,
 * the return carrying only a single-use handoff code that leaves the
 * address bar, no access token in any URL or browser response, a
 * cancelled authorization keeping the current connection, and choosing
 * between two shared accounts in WordPress after returning from Meta (#2429).
 *
 * Run: `npm run test:e2e -- fair-events-experimental-instagram-connect`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

const PAGE = '/wp-admin/admin.php?page=fair-events-instagram';
const LEGACY_TOKEN = 'e2e-ig-legacy-browser-token';
const UNIFIED_TOKEN = 'e2e-ig-unified-ok';
const OPTIONS = [
	'fair_audience_instagram_access_token',
	'fair_audience_instagram_user_id',
	'fair_audience_instagram_username',
	'fair_audience_instagram_connected',
	'fair_audience_instagram_token_expires',
	'fair_audience_instagram_connection_format',
	'fair_audience_instagram_token_type',
	'fair_audience_instagram_scopes',
	'fair_audience_instagram_token_expiry',
	'fair_audience_instagram_graph_version',
];

/** Run PHP on the tests instance (no single quotes inside). */
function php(code) {
	return wpCli(`eval '${code}'`).trim();
}

function clearConnection() {
	php(OPTIONS.map((o) => `delete_option( "${o}" );`).join(' '));
}

/**
 * Answer Meta's login dialog: back to the platform callback with `meta`.
 *
 * Playwright does not route the redirect from the platform's authorize step
 * to Meta, so that step is fetched here, and the dialog URL it redirects to
 * is answered without leaving the site. WordPress's canonical 301 (adding
 * the trailing slash) is followed on the way.
 *
 * @param {import('@playwright/test').Page} page Page.
 * @param {Object}                          meta Query to send back.
 */
async function answerMetaDialog(page, meta) {
	await page.route('**/oauth/instagram/authorize**', async (route) => {
		let url = route.request().url();
		let response = await route.fetch({ url, maxRedirects: 0 });
		for (let i = 0; i < 2 && response.status() === 301; i++) {
			url = new URL(response.headers().location, url).toString();
			response = await route.fetch({ url, maxRedirects: 0 });
		}
		const dialog = new URL(response.headers().location);
		expect(dialog.origin).toBe('https://www.facebook.com');

		const callback = new URL(dialog.searchParams.get('redirect_uri'));
		callback.searchParams.set('state', dialog.searchParams.get('state'));
		for (const [key, value] of Object.entries(meta)) {
			callback.searchParams.set(key, value);
		}
		await route.fulfill({
			status: 302,
			headers: { location: callback.toString() },
		});
	});
	// Nothing may reach the real Meta.
	await page.route('https://www.facebook.com/**', (route) => route.abort());
}

/**
 * Watch every URL the page visits and every REST response it reads, so the
 * test can assert no access token passed through the browser.
 *
 * @param {import('@playwright/test').Page} page Page.
 * @return {{urls: string[], bodies: string[]}} What was seen.
 */
function watchBrowser(page) {
	const seen = { urls: [], bodies: [] };
	page.on('request', (request) => seen.urls.push(request.url()));
	page.on('response', async (response) => {
		if (response.url().includes('/wp-json/')) {
			seen.bodies.push(await response.text().catch(() => ''));
		}
	});
	return seen;
}

test.describe('Fair Events → Instagram: Unified Login', () => {
	test.describe.configure({ mode: 'serial' });

	let previousFeatures;

	test.beforeAll(() => {
		previousFeatures = php(
			'echo wp_json_encode( get_option( "fair_events_experimental_features", null ) );'
		);
		php(
			'$f = get_option( "fair_events_experimental_features", array() ); $f = is_array( $f ) ? $f : array(); $f["instagram"] = true; update_option( "fair_events_experimental_features", $f );'
		);
		clearConnection();
		// A connection from before Unified Login.
		php(
			`update_option( "fair_audience_instagram_access_token", "${LEGACY_TOKEN}" ); update_option( "fair_audience_instagram_user_id", "17841400000000009" ); update_option( "fair_audience_instagram_username", "e2e_legacy" ); update_option( "fair_audience_instagram_connected", true );`
		);
	});

	test.afterAll(() => {
		clearConnection();
		if (previousFeatures === 'null' || previousFeatures === '') {
			wpCli('option delete fair_events_experimental_features', {
				allowFailure: true,
			});
		} else {
			php(
				`update_option( "fair_events_experimental_features", json_decode( "${previousFeatures.replace(
					/"/g,
					'\\"'
				)}", true ) );`
			);
		}
	});

	test.beforeEach(async ({ page }) => {
		await loginAsAdmin(page);
	});

	test('asks a connection from before Unified Login to reconnect', async ({
		page,
	}) => {
		await page.goto(PAGE);

		await expect(
			page
				.locator('.fair-events-instagram')
				.getByText(/Instagram needs to be reconnected: Meta replaced/)
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Connect with Instagram' })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Test connection' })
		).toHaveCount(0);
		await expect(page.getByLabel('Access token')).toHaveCount(0);
	});

	test('connects through Meta and returns with a single-use code, never the token', async ({
		page,
	}) => {
		const seen = watchBrowser(page);
		await answerMetaDialog(page, { code: 'e2e-code-ok' });
		await page.goto(PAGE);

		await page
			.getByRole('button', { name: 'Connect with Instagram' })
			.click();

		await expect(
			page
				.getByText('Connected to Instagram as @e2e_unified_club.')
				.first()
		).toBeVisible();
		await expect(
			page.getByText(
				'The access token does not expire. It stops working if the business removes the app in Meta Business Settings.'
			)
		).toBeVisible();

		// The handoff code left the address bar.
		const address = new URL(page.url());
		expect(address.searchParams.get('page')).toBe('fair-events-instagram');
		expect(address.searchParams.has('instagram_handoff')).toBe(false);
		expect(address.searchParams.has('state')).toBe(false);

		// The return carried a handoff code, and nothing in the browser
		// carried the access token.
		expect(
			seen.urls.some((url) => url.includes('instagram_handoff='))
		).toBe(true);
		for (const text of [...seen.urls, ...seen.bodies]) {
			expect(text).not.toContain(UNIFIED_TOKEN);
			expect(text).not.toContain(LEGACY_TOKEN);
		}
	});

	test('a cancelled authorization keeps the current connection', async ({
		page,
	}) => {
		// Disconnect is not offered as a way into the dialog here: start
		// from the connect card by marking the connection as expired.
		php(
			'update_option( "fair_audience_instagram_token_expiry", "expires" ); update_option( "fair_audience_instagram_token_expires", time() - 60 );'
		);
		await answerMetaDialog(page, {
			error: 'access_denied',
			error_reason: 'user_denied',
		});
		await page.goto(PAGE);
		await expect(
			page
				.locator('.fair-events-instagram')
				.getByText(
					'Instagram needs to be reconnected: the access token has expired. Connect with Instagram again.'
				)
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Connect with Instagram' })
			.click();

		await expect(
			page
				.getByText(
					'Instagram authorization was cancelled. Nothing was changed.'
				)
				.first()
		).toBeVisible();
		expect(new URL(page.url()).searchParams.has('instagram_error')).toBe(
			false
		);
		// The stored connection is the one from before.
		expect(
			php('echo get_option( "fair_audience_instagram_username" );')
		).toBe('e2e_unified_club');
	});

	test('chooses between two shared accounts in WordPress after returning from Meta', async ({
		page,
	}) => {
		const seen = watchBrowser(page);
		await answerMetaDialog(page, { code: 'e2e-code-multiple' });
		await page.goto(PAGE);

		await page
			.getByRole('button', { name: 'Connect with Instagram' })
			.click();

		const card = page.locator('.fair-events-instagram-choice');
		await expect(
			card.getByRole('heading', { name: 'Choose the Instagram account' })
		).toBeVisible();
		await expect(card.getByRole('radio')).toHaveCount(2);
		const current = card.getByLabel(
			'@e2e_unified_club (currently connected)'
		);
		const other = card.getByLabel('@e2e_other_club');
		await expect(current).not.toBeChecked();
		await expect(other).not.toBeChecked();
		const confirm = card.getByRole('button', {
			name: 'Connect selected account',
		});
		await expect(confirm).toBeDisabled();
		// Nothing is saved before the confirmation.
		expect(
			php('echo get_option( "fair_audience_instagram_username" );')
		).toBe('e2e_unified_club');

		await other.check();
		await confirm.click();

		await expect(
			page.getByText('Connected to Instagram as @e2e_other_club.').first()
		).toBeVisible();
		await expect(card).toHaveCount(0);
		expect(
			php(
				'echo get_option( "fair_audience_instagram_user_id" ) . " " . get_option( "fair_audience_instagram_username" );'
			)
		).toBe('17841400000000002 e2e_other_club');

		// The handoff code left the address bar, and no token reached the
		// browser.
		expect(new URL(page.url()).searchParams.has('instagram_handoff')).toBe(
			false
		);
		for (const text of [...seen.urls, ...seen.bodies]) {
			expect(text).not.toContain('e2e-ig-unified-multiple');
		}
	});
});
