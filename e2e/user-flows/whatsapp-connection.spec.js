/**
 * E2E: connect WhatsApp manually and send a test template (#1923).
 *
 * An administrator saves the access token in Settings → Connectors, enters
 * the WhatsApp Business Account ID and Phone Number ID on Fair Events →
 * WhatsApp, validates the connection, and sends an approved template to a
 * recipient who agreed to it. Replacing the token in Connectors invalidates
 * the validation; removing it blocks validation with the reason. The page is
 * also driven at a phone-sized viewport. No request reaches Meta —
 * lib/whatsapp-http-double.php answers graph.facebook.com for a synthetic
 * account and logs each request without the token.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/whatsapp-connection.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin } from '../support/wp-cli.js';

const TOKEN = 'e2e-whatsapp-browser-token-0123456789';
const REPLACEMENT = 'e2e-whatsapp-browser-replacement-9876543210';
const TOKEN_OPTION = 'fair_events_experimental_whatsapp_access_token';
const PAGE_URL = '/wp-admin/admin.php?page=fair-events-whatsapp';
const CONNECTORS_URL = '/wp-admin/options-connectors.php';
const AUTHORIZED = 'The recipient agreed to receive this test message.';

const OPTIONS = [
	TOKEN_OPTION,
	'fair_events_experimental_whatsapp_waba_id',
	'fair_events_experimental_whatsapp_phone_number_id',
	'fair_events_experimental_whatsapp_validation',
	'fair_e2e_whatsapp_requests',
];

/** Test sends the double received. */
function sentMessages() {
	const out = wpCli('option get fair_e2e_whatsapp_requests --format=json', {
		allowFailure: true,
	}).trim();
	const start = out.indexOf('[');
	return start < 0
		? []
		: JSON.parse(out.slice(start)).filter((r) => 'POST' === r.method);
}

/**
 * The WhatsApp connector on the Connectors screen.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {import('@playwright/test').Locator} Connector card.
 */
function whatsappConnector(page) {
	return page.getByRole('group', { name: 'WhatsApp' });
}

/**
 * Save a token in Connectors, replacing any saved one.
 *
 * @param {import('@playwright/test').Page} page  Playwright page.
 * @param {string}                          token Token.
 */
async function saveTokenInConnectors(page, token) {
	await page.goto(CONNECTORS_URL);
	const connector = whatsappConnector(page);
	const edit = connector.getByRole('button', { name: 'Edit' });
	// Wait for the card to render before choosing a path.
	await expect(
		connector.getByRole('button', { name: /^(Edit|Set up)$/ })
	).toBeVisible();
	if (await edit.isVisible()) {
		await edit.click();
		await connector
			.getByRole('button', { name: 'Remove and replace' })
			.click();
		await expect(connector.getByText('Connected')).toHaveCount(0);
	} else {
		await connector.getByRole('button', { name: 'Set up' }).click();
	}
	if (token) {
		await connector.getByLabel('API Key').fill(token);
		await connector.getByRole('button', { name: 'Save' }).click();
		await expect(connector.getByText('Connected')).toBeVisible();
	}
}

test.describe('WhatsApp connection', () => {
	test.beforeAll(() => {
		for (const option of OPTIONS) {
			wpCli(`option delete ${option}`, { allowFailure: true });
		}
	});

	test.afterAll(() => {
		for (const option of OPTIONS) {
			wpCli(`option delete ${option}`, { allowFailure: true });
		}
	});

	test('an administrator connects, validates and sends a test template', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		// Without a token the page says where to add one.
		await page.goto(PAGE_URL);
		await expect(
			page.getByRole('heading', { name: 'WhatsApp', level: 1 })
		).toBeVisible();
		await expect(
			page
				.getByText(
					'No WhatsApp access token is configured. Add one in Connectors.'
				)
				.first()
		).toBeVisible();
		await expect(page.getByLabel(/access token/i)).toHaveCount(0);

		await saveTokenInConnectors(page, TOKEN);
		expect(await page.content()).not.toContain(TOKEN);

		// Save the IDs; they are saved, not validated yet.
		await page.goto(PAGE_URL);
		await page
			.getByLabel('WhatsApp Business Account ID')
			.fill('100000000000001');
		await page.getByLabel('Phone Number ID').fill('300000000000003');
		await expect(
			page.getByRole('button', { name: 'Validate connection' })
		).toBeDisabled();
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(
			page.getByText('Settings saved, not validated.')
		).toBeVisible();

		// A number of another account is reported as a mismatch.
		await page.getByRole('button', { name: 'Validate connection' }).click();
		await expect(
			page
				.getByText(
					'This Phone Number ID belongs to a different WhatsApp Business Account. Use two IDs from the same account.'
				)
				.first()
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Send test template' })
		).toBeDisabled();

		// Fix the Phone Number ID and validate.
		await page.getByLabel('Phone Number ID').fill('200000000000002');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(
			page.getByText('Settings saved, not validated.')
		).toBeVisible();
		await page.getByRole('button', { name: 'Validate connection' }).click();
		await expect(
			page
				.getByText(
					/Connection validated: messages are sent as Fair Events E2E \(\+34 600 000 002\)\./
				)
				.first()
		).toBeVisible();
		expect(await page.content()).not.toContain(TOKEN);

		// Only parameterless approved templates are offered.
		const templates = page.getByLabel('Template');
		await expect(
			templates.getByRole('option', { name: 'hello_world (en_US)' })
		).toBeAttached();
		await expect(
			templates.getByRole('option', { name: /event_reminder/ })
		).toHaveCount(0);

		// The send waits for the recipient's authorization.
		await templates.selectOption('hello_world|en_US');
		await page.getByLabel('Recipient number').fill('+34 600 000 123');
		const send = page.getByRole('button', { name: 'Send test template' });
		await expect(send).toBeDisabled();
		await page.getByLabel(AUTHORIZED).check();
		await send.click();
		await expect(
			page.getByRole('heading', { name: 'Accepted by WhatsApp' })
		).toBeVisible();
		await expect(
			page.getByText(/This does not confirm delivery/)
		).toBeVisible();
		await expect(page.getByText(/••••••••123/)).toBeVisible();
		await expect(page.getByLabel(AUTHORIZED)).not.toBeChecked();
		await expect(send).toBeDisabled();
		expect(sentMessages()).toEqual([
			expect.objectContaining({
				to: '34600000123',
				template: 'hello_world',
				language: 'en_US',
				token_suffix: TOKEN.slice(-4),
			}),
		]);

		// Replacing the token invalidates the validation.
		await saveTokenInConnectors(page, REPLACEMENT);
		await page.goto(PAGE_URL);
		await expect(
			page.getByText('Settings saved, not validated.')
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Send test template' })
		).toBeDisabled();

		// Removing it blocks validation and says why; the IDs stay.
		await saveTokenInConnectors(page, '');
		await page.goto(PAGE_URL);
		await expect(
			page.getByText(
				'Add a WhatsApp access token in Connectors before validating the connection.'
			)
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Validate connection' })
		).toBeDisabled();
		await expect(page.getByLabel('Phone Number ID')).toHaveValue(
			'200000000000002'
		);
	});

	test('the page works at a phone-sized viewport', async ({ page }) => {
		wpCli(`option update ${TOKEN_OPTION} ${TOKEN}`);
		wpCli(
			'option update fair_events_experimental_whatsapp_waba_id 100000000000001'
		);
		wpCli(
			'option update fair_events_experimental_whatsapp_phone_number_id 200000000000002'
		);
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		await page.getByRole('button', { name: 'Validate connection' }).click();
		await expect(
			page.getByText(/Connection validated/).first()
		).toBeVisible();
		await page.getByLabel('Template').selectOption('hello_world|en_US');
		await page.getByLabel('Recipient number').fill('+34 600 000 124');
		await page.getByLabel(AUTHORIZED).check();
		const send = page.getByRole('button', { name: 'Send test template' });
		await send.scrollIntoViewIfNeeded();
		await expect(send).toBeInViewport();
		await send.click();
		await expect(
			page.getByRole('heading', { name: 'Accepted by WhatsApp' })
		).toBeVisible();

		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
