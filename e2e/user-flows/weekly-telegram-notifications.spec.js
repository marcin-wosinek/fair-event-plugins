/**
 * E2E: configure Telegram weekly notifications and send a test message (#1660).
 *
 * Drives the Experimental tab of Fair Events Settings as an administrator:
 * picks a plain page (no calendar block) for the heading, saves a bot token
 * and two chats, checks the token is never shown again, saves unrelated
 * settings with no token field present (#1733), and sends a test message
 * that reaches one chat and fails for the other. No request
 * reaches Telegram — lib/telegram-http-double.php answers api.telegram.org
 * and records each request's chat ID and text (never the token).
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from '../support/wp-cli.js';

const TOKEN = '123456789:AAEe2eWeeklyTelegramToken0123456789';
const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';

function resetState() {
	for (const option of [
		'fair_events_experimental_weekly_notifications',
		'fair_events_experimental_weekly_telegram_token',
		'fair_e2e_telegram_requests',
	]) {
		wpCli(`option delete ${option}`, { allowFailure: true });
	}
}

function telegramRequests() {
	const out = wpCli('option get fair_e2e_telegram_requests --format=json', {
		allowFailure: true,
	}).trim();
	return out ? JSON.parse(out) : [];
}

test.describe('Weekly Telegram notifications', () => {
	let pageId;

	test.beforeEach(resetState);
	test.afterAll(() => {
		resetState();
		if (pageId) {
			wpCli(`post delete ${pageId} --force`, { allowFailure: true });
		}
	});

	test('an administrator configures Telegram and sends a test message', async ({
		page,
	}) => {
		// A plain page with no calendar block can head the message.
		const pageTitle = `Weekly heading ${Date.now()}`;
		pageId = wpCli(
			`post create --post_type=page --post_status=publish --post_title="${pageTitle}" --post_content="No calendar here." --porcelain`
		).match(/(\d+)\s*$/)[1];

		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		await expect(
			page.getByRole('heading', { name: 'Weekly notifications' })
		).toBeVisible();

		await page
			.getByLabel('Page linked in the heading')
			.selectOption({ label: pageTitle });

		await page.getByLabel('Post to Telegram').check();
		await page.getByLabel('Bot token', { exact: true }).fill(TOKEN);
		await page
			.getByLabel('Chats and channels')
			.fill('@e2e_channel\n@e2e_missing_chat');
		await page
			.getByRole('button', { name: 'Save weekly notification settings' })
			.click();

		await expect(
			page.getByText('Weekly notification settings saved.').first()
		).toBeVisible();

		// The token is write-only, and with one saved there is no token field
		// for browser autofill to fill.
		await expect(
			page.getByText('A bot token is saved. It is not shown here.')
		).toBeVisible();
		await expect(page.locator('input[type="password"]')).toHaveCount(0);
		await page.reload();
		await expect(page.locator('input[type="password"]')).toHaveCount(0);

		// Saving unrelated settings keeps the saved token (#1733).
		await page.getByLabel('Send at').fill('07:45');
		await page
			.getByRole('button', { name: 'Save weekly notification settings' })
			.click();
		await expect(
			page.getByText('Weekly notification settings saved.').first()
		).toBeVisible();
		// Compare without printing the token if the assertion fails.
		const storedToken = wpCli(
			'option get fair_events_experimental_weekly_telegram_token'
		).trim();
		expect(storedToken === TOKEN).toBe(true);
		await page.reload();
		await expect(page.getByLabel('Send at')).toHaveValue('07:45');
		await expect(page.getByLabel('Page linked in the heading')).toHaveValue(
			pageId
		);
		await expect(page.getByLabel('Chats and channels')).toHaveValue(
			'@e2e_channel\n@e2e_missing_chat'
		);
		expect(await page.content()).not.toContain(TOKEN);

		await page
			.getByRole('button', { name: 'Send Telegram test message' })
			.click();

		await expect(
			page
				.getByText(
					'The test message did not reach every chat. See the results below.'
				)
				.first()
		).toBeVisible();
		await expect(
			page.getByText('Delivered', { exact: true })
		).toBeVisible();
		await expect(
			page.getByText('Bad Request: chat not found')
		).toBeVisible();

		const requests = telegramRequests();
		expect(requests.map((r) => r.chat_id)).toEqual([
			'@e2e_channel',
			'@e2e_missing_chat',
		]);
		for (const request of requests) {
			expect(request.text).toContain('Test message from');
		}

		// A test send never creates a scheduled-delivery record.
		await page.reload();
		await expect(
			page.getByText('No messages delivered yet.')
		).toBeVisible();

		// An unsaved replacement must not restore the token after removal.
		await page.getByRole('button', { name: 'Replace bot token' }).click();
		await page.getByLabel('New bot token').fill(TOKEN);
		await page.getByRole('button', { name: 'Remove bot token' }).click();
		await expect(
			page.getByText(
				'Remove the Telegram bot token? Weekly notifications will not reach Telegram until a new token is saved.'
			)
		).toBeVisible();
		await page
			.getByRole('button', { name: 'Remove bot token' })
			.last()
			.click();
		await expect(
			page.getByLabel('Bot token', { exact: true })
		).toBeVisible();
		await expect(page.getByLabel('Bot token', { exact: true })).toHaveValue(
			''
		);
		await page
			.getByRole('button', { name: 'Save weekly notification settings' })
			.click();
		await expect(
			page.getByText('Weekly notification settings saved.').first()
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByLabel('Bot token', { exact: true })
		).toBeVisible();
	});
});
