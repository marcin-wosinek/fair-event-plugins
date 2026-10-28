/**
 * E2E: Meta integration on its own Fair Events → Meta page (#2003).
 *
 * The submenu appears only while the Meta Conversions bundle is on; the
 * Experimental tab keeps the toggle and links to the page instead of
 * embedding its controls. Saved settings carry over and persist across a
 * reload. The page is refused when the bundle is off and for
 * non-administrators. Without Fair Payments Connector the page, saving, the
 * calendar test and a consented calendar click on a free event still work.
 *
 * Consent is stubbed like the other Meta specs: `window.wp_has_consent` plus
 * a synthetic `_fbp` cookie. lib/meta-http-double.php answers the Graph API.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/meta-admin-page.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript, loginAsAdmin } from '../support/wp-cli.js';

const META_URL = '/wp-admin/admin.php?page=fair-events-meta';
const TAB_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';
const CAPTURE = /\/fair-events-experimental\/v1\/meta-engagement/;
const EDITOR = { login: 'e2e_meta_editor', password: 'e2e-editor-pass' };
const NOT_ALLOWED = 'Sorry, you are not allowed to access this page.';

/** Set the `fair_events_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	wpCli(
		`option update fair_events_experimental_features '${JSON.stringify(
			map
		)}' --format=json`
	);
}

/** Read one option's value, or '' when it is unset. */
function option(name) {
	return wpCli(`option get ${name}`, { allowFailure: true }).trim();
}

/**
 * Stub the consent API and a Meta browser identifier before pages load.
 *
 * @param {import('@playwright/test').Page} page    Playwright page.
 * @param {string}                          baseURL Site URL (cookie scope).
 */
async function grantMarketingConsent(page, baseURL) {
	await page.addInitScript(() => {
		// eslint-disable-next-line camelcase -- matches the real consent API's global name.
		window.wp_has_consent = () => true;
	});
	await page.context().addCookies([
		{
			name: '_fbp',
			value: `fb.1.${Date.now()}.e2emetapage`,
			url: baseURL,
		},
	]);
}

test.describe('Meta admin page', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		setExperimentalFeatures({ 'meta-conversions': true });
		wpCli(
			'option update fair_events_experimental_meta_dataset_id 1234567890123456'
		);
		wpCli(
			'option update fair_events_experimental_meta_access_token e2e-meta-access-token'
		);
		wpCli(
			'option update fair_events_experimental_meta_test_event_code TEST12345'
		);
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-payments-connector', {
			allowFailure: true,
		});
		wpCli(`user delete ${EDITOR.login} --yes`, { allowFailure: true });
		for (const name of [
			'fair_events_experimental_features',
			'fair_events_experimental_meta_dataset_id',
			'fair_events_experimental_meta_access_token',
			'fair_events_experimental_meta_test_event_code',
			'fair_events_experimental_meta_test_log',
			'fair_e2e_meta_requests',
		]) {
			wpCli(`option delete ${name}`, { allowFailure: true });
		}
	});

	test('the Meta submenu and the Experimental tab link open the page with the saved settings', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(TAB_URL);

		// The toggle stays in Experimental; the controls do not.
		await expect(
			page.getByRole('checkbox', { name: 'Meta Conversions' })
		).toBeChecked();
		await expect(
			page.getByRole('textbox', { name: 'Dataset / Pixel ID' })
		).toHaveCount(0);
		const link = page.getByRole('link', { name: 'Open Meta' });
		await expect(link).toHaveAttribute('href', /page=fair-events-meta$/);

		const submenu = page
			.locator('#adminmenu')
			.getByRole('link', { name: 'Meta', exact: true });
		await expect(submenu).toHaveAttribute('href', /page=fair-events-meta$/);

		// Admin-menu clicks stall headless rendering; follow the href.
		await page.goto(await link.getAttribute('href'));
		await expect(
			page.getByRole('heading', { level: 1, name: 'Meta' })
		).toBeVisible();
		await expect(
			page.getByRole('textbox', { name: 'Dataset / Pixel ID' })
		).toHaveValue('1234567890123456');
		await expect(
			page.getByRole('textbox', { name: 'Test Events code' })
		).toHaveValue('TEST12345');
		await expect(
			page.locator('#fair-events-meta-root .components-notice__content', {
				hasText: 'An access token is saved in Connectors.',
			})
		).toBeVisible();
	});

	test('saving the settings on the Meta page persists them', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(META_URL);

		await page
			.getByRole('textbox', { name: 'Test Events code' })
			.fill('TEST67890');
		await page.getByRole('button', { name: 'Save Meta settings' }).click();
		await expect(
			page.locator('.fair-events-meta > .components-notice')
		).toContainText('Meta Conversions settings saved.');
		expect(option('fair_events_experimental_meta_test_event_code')).toBe(
			'TEST67890'
		);

		await page.reload();
		await expect(
			page.getByRole('textbox', { name: 'Test Events code' })
		).toHaveValue('TEST67890');

		await page
			.getByRole('textbox', { name: 'Test Events code' })
			.fill('TEST12345');
		await page.getByRole('button', { name: 'Save Meta settings' }).click();
		await expect(
			page.locator('.fair-events-meta > .components-notice')
		).toContainText('Meta Conversions settings saved.');
	});

	test('warns while background delivery cannot be scheduled, until it recovers (#1971)', async ({
		page,
	}) => {
		const source = `https://example.test/meta-admin-${Date.now()}`;
		const warning = page.getByText(
			/Background delivery to Meta could not be scheduled/
		);
		// A queued row with no wake-up, while every scheduling attempt fails.
		wpCli('option update fair_e2e_meta_hold_cron 1');
		wpCli('option update fair_e2e_meta_block_schedule 1');
		try {
			runScript(
				'meta-queue-fixture.php',
				'E2E_META_QUEUE',
				`add ${source} warning`
			);
			runScript(
				'meta-queue-fixture.php',
				'E2E_META_QUEUE',
				`clear-wakeups ${source}`
			);

			await loginAsAdmin(page);
			await page.goto(META_URL);
			await expect(warning).toBeVisible();
			await expect(warning).toContainText('last failure:');
			await expect(
				page.getByText(/Scheduling is retried automatically/)
			).toBeVisible();

			// Background execution works again: the next visit repairs it.
			wpCli('option delete fair_e2e_meta_block_schedule');
			await page.reload();
			await expect(
				page.getByRole('heading', { name: 'Meta Conversions' })
			).toBeVisible();
			await expect(warning).toHaveCount(0);
		} finally {
			wpCli('option delete fair_e2e_meta_block_schedule', {
				allowFailure: true,
			});
			runScript(
				'meta-queue-fixture.php',
				'E2E_META_QUEUE',
				`cleanup ${source}`
			);
			runScript(
				'meta-queue-fixture.php',
				'E2E_META_QUEUE',
				`clear-wakeups ${source}`
			);
			wpCli('option delete fair_e2e_meta_hold_cron', {
				allowFailure: true,
			});
		}
	});

	test('non-administrators cannot open the Meta page', async ({ page }) => {
		wpCli(`user delete ${EDITOR.login} --yes`, { allowFailure: true });
		wpCli(
			`user create ${EDITOR.login} ${EDITOR.login}@example.com --role=editor --user_pass=${EDITOR.password}`
		);

		await page.goto('/wp-login.php');
		await page.fill('#user_login', EDITOR.login);
		await page.fill('#user_pass', EDITOR.password);
		await page.click('#wp-submit');
		await page.waitForURL(/\/wp-admin\/?/);

		await page.goto(META_URL);
		await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
		await expect(
			page.getByRole('textbox', { name: 'Dataset / Pixel ID' })
		).toHaveCount(0);
	});

	test('with the bundle off the submenu, page and link are gone', async ({
		page,
	}) => {
		setExperimentalFeatures({ 'meta-conversions': false });
		try {
			await loginAsAdmin(page);
			await page.goto(TAB_URL);
			await expect(
				page.getByRole('checkbox', { name: 'Meta Conversions' })
			).not.toBeChecked();
			await expect(
				page.getByRole('link', { name: 'Open Meta' })
			).toHaveCount(0);
			await expect(
				page
					.locator('#adminmenu')
					.getByRole('link', { name: 'Meta', exact: true })
			).toHaveCount(0);

			await page.goto(META_URL);
			await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
			await expect(
				page.getByRole('textbox', { name: 'Dataset / Pixel ID' })
			).toHaveCount(0);
			// Stored configuration is kept for when the bundle is back on.
			expect(option('fair_events_experimental_meta_dataset_id')).toBe(
				'1234567890123456'
			);
		} finally {
			setExperimentalFeatures({ 'meta-conversions': true });
		}
	});

	test('works without Fair Payments Connector: save, calendar test and a free-event calendar click', async ({
		page,
		baseURL,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		const title = `E2E Meta page ${event.eventId}-${Date.now()}`;
		// Sync the title onto the date row the picker searches.
		wpCli(`post update ${event.eventId} --post_title="${title}"`);
		wpCli('option delete fair_e2e_meta_requests', { allowFailure: true });

		wpCli('plugin deactivate fair-payments-connector');
		try {
			await grantMarketingConsent(page, baseURL);
			await loginAsAdmin(page);
			await page.goto(META_URL);

			await page
				.getByRole('textbox', { name: 'Test Events code' })
				.fill('TEST24680');
			await page
				.getByRole('button', { name: 'Save Meta settings' })
				.click();
			await expect(
				page.locator('.fair-events-meta > .components-notice')
			).toContainText('Meta Conversions settings saved.');

			const picker = page.getByRole('combobox', { name: 'Event' });
			await picker.fill(title);
			await page.getByRole('option', { name: new RegExp(title) }).click();
			await page
				.getByRole('button', {
					name: 'Send FairEventCalendarClick test',
				})
				.click();
			const latest = page.getByRole('status').filter({
				hasText: 'Latest test result',
			});
			await expect(latest.getByText('Received by Meta')).toBeVisible();

			// A visitor's consented calendar click on the free event.
			const response = page.waitForResponse(CAPTURE);
			await page.goto(event.pageUrl);
			await page.getByText('Add to calendar').click();
			const answer = await response;
			expect(answer.status()).toBe(200);
			expect(await answer.json()).toEqual({ received: true });

			const state = runScript(
				'meta-engagement-state.php',
				'E2E_META_ENGAGEMENT',
				String(event.eventId)
			);
			expect(state.rows).toEqual([
				expect.objectContaining({
					event_name: 'FairEventCalendarClick',
					state: 'immediate_received',
				}),
			]);

			// The click shows in the page's delivery diagnostics.
			await page.goto(META_URL);
			await expect(
				page.getByText('Received by Meta (sent immediately)').first()
			).toBeVisible();
		} finally {
			wpCli('plugin activate fair-payments-connector');
		}
	});
});
