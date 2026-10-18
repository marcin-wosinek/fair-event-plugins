/**
 * E2E: manage the Meta Conversions API access token in Settings →
 * Connectors (#1953).
 *
 * An access token saved before the credential moved keeps working: the
 * Experimental settings tab reports it as configured, links to Connectors
 * instead of editing it, and a test event goes out with it. In Connectors the
 * token is removed, a malformed one is refused, and a replacement is saved;
 * each change shows in the Experimental tab and in what a test event sends.
 * Removing it leaves testing blocked with the reason. No request reaches
 * Meta — lib/meta-http-double.php answers graph.facebook.com and records
 * each request body.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/meta-access-token-connector.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin } from '../support/wp-cli.js';

const TOKEN = 'e2e-meta-legacy-token-0123456789';
const REPLACEMENT = 'e2e-meta-replacement-token-9876543210';
const TOKEN_OPTION = 'fair_events_experimental_meta_access_token';
const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';
const CONNECTORS_URL = '/wp-admin/options-connectors.php';
const SAVED_STATUS =
	'An access token is saved in Connectors. It is not shown here. Send a test event to confirm Meta accepts it.';
const MISSING_STATUS =
	'No access token is configured, so no conversions are delivered to Meta. Add one in Connectors.';

/**
 * Whether the stored token equals a value, without printing either.
 *
 * @param {string} expected Expected token, or '' for none.
 * @return {boolean} Whether they match.
 */
function storedTokenIs(expected) {
	const stored = wpCli(`option get ${TOKEN_OPTION}`, {
		allowFailure: true,
	}).trim();
	return stored === expected;
}

/** The access token in the last Graph API request. */
function lastSentToken() {
	const out = wpCli('option get fair_e2e_meta_last_request --format=json');
	return JSON.parse(out.slice(out.indexOf('{'))).access_token;
}

/**
 * The Meta connector on the Connectors screen.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {import('@playwright/test').Locator} Connector card.
 */
function metaConnector(page) {
	return page.getByRole('group', { name: 'Meta Conversions API' });
}

/**
 * Send the PageView test from the Experimental tab and wait for Meta's answer.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function sendPageViewTest(page) {
	await page.getByRole('button', { name: 'Send PageView test' }).click();
	await expect(
		page
			.getByText('Meta confirmed receiving the PageView test event.')
			.first()
	).toBeVisible();
}

test.describe('Meta access token in Connectors', () => {
	test.beforeAll(() => {
		wpCli(
			`option update fair_events_experimental_features '{"meta-conversions":true}' --format=json`
		);
		wpCli(
			'option update fair_events_experimental_meta_dataset_id 1234567890123456'
		);
		wpCli(
			'option update fair_events_experimental_meta_test_event_code TEST12345'
		);
		// A token saved before the credential moved to Connectors.
		wpCli(`option delete ${TOKEN_OPTION}`, { allowFailure: true });
		wpCli(`option add ${TOKEN_OPTION} ${TOKEN} --autoload=no`);
	});

	test.afterAll(() => {
		for (const option of [
			'fair_events_experimental_features',
			'fair_events_experimental_meta_dataset_id',
			'fair_events_experimental_meta_test_event_code',
			'fair_events_experimental_meta_test_log',
			TOKEN_OPTION,
		]) {
			wpCli(`option delete ${option}`, { allowFailure: true });
		}
	});

	test('an administrator keeps, replaces and removes the token in Connectors', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		// The saved token keeps working, and is managed elsewhere.
		await page.goto(SETTINGS_URL);
		await expect(page.getByText(SAVED_STATUS).first()).toBeVisible();
		await expect(
			page.getByRole('link', { name: /Manage in Connectors/ })
		).toHaveAttribute('href', /options-connectors\.php$/);
		await expect(page.getByLabel(/access token/i)).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Clear access token' })
		).toHaveCount(0);
		await sendPageViewTest(page);
		expect(lastSentToken()).toBe(TOKEN);

		// Connectors shows it as connected without revealing it, and says
		// what removing it means.
		await page.goto(CONNECTORS_URL);
		const connector = metaConnector(page);
		await expect(connector.getByText('Connected')).toBeVisible();
		await expect(
			connector.getByText(
				/Removing the access token stops conversion delivery until another token is saved\./
			)
		).toBeVisible();
		expect(await page.content()).not.toContain(TOKEN);

		// Remove it.
		await connector.getByRole('button', { name: 'Edit' }).click();
		await connector
			.getByRole('button', { name: 'Remove and replace' })
			.click();
		await expect(connector.getByText('Connected')).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		// A malformed token is refused and nothing is stored.
		await connector.getByLabel('API Key').fill('not a meta token');
		await connector.getByRole('button', { name: 'Save' }).click();
		await expect(
			connector.getByRole('button', { name: 'Save' })
		).toBeEnabled();
		await expect(connector.getByText('Connected')).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		// Save a replacement.
		await connector.getByLabel('API Key').fill(REPLACEMENT);
		await connector.getByRole('button', { name: 'Save' }).click();
		await expect(connector.getByText('Connected')).toBeVisible();
		expect(storedTokenIs(REPLACEMENT)).toBe(true);
		expect(await page.content()).not.toContain(REPLACEMENT);

		// Test events now go out with the replacement.
		await page.goto(SETTINGS_URL);
		await expect(page.getByText(SAVED_STATUS).first()).toBeVisible();
		await sendPageViewTest(page);
		expect(lastSentToken()).toBe(REPLACEMENT);
		expect(await page.content()).not.toContain(REPLACEMENT);

		// Remove it again: the Experimental tab says delivery has stopped and
		// testing is unavailable, while the other settings stay.
		await page.goto(CONNECTORS_URL);
		await metaConnector(page).getByRole('button', { name: 'Edit' }).click();
		await metaConnector(page)
			.getByRole('button', { name: 'Remove and replace' })
			.click();
		await expect(metaConnector(page).getByText('Connected')).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		await page.goto(SETTINGS_URL);
		await expect(page.getByText(MISSING_STATUS).first()).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Send PageView test' })
		).toBeDisabled();
		await expect(
			page
				.getByText(
					'Add a Meta access token in Connectors before sending a test event.'
				)
				.first()
		).toBeVisible();
		await expect(page.getByLabel('Dataset / Pixel ID')).toHaveValue(
			'1234567890123456'
		);
		await expect(page.getByLabel('Test Events code')).toHaveValue(
			'TEST12345'
		);
	});
});
