/**
 * E2E: configure Telegram weekly notifications and send a test summary (#1660, #1735).
 *
 * Drives the Experimental tab of Fair Events Settings as an administrator:
 * picks an event source and a plain page (no calendar block) for the heading,
 * saves a bot token and two chats, checks the token is never shown again,
 * saves unrelated settings with no token field present (#1733), and sends the
 * next week's formatted summary as a test, which reaches one chat and fails
 * for the other. No request reaches Telegram — lib/telegram-http-double.php
 * answers api.telegram.org and records each request's chat ID, text and
 * formatting entities (never the token).
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin, runScript } from '../support/wp-cli.js';

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

/**
 * Text an entity covers; offsets count UTF-16 units, like JavaScript strings.
 *
 * @param {string} text   Message text.
 * @param {Object} entity Telegram message entity.
 * @return {string} Covered text.
 */
function covered(text, entity) {
	return text.slice(entity.offset, entity.offset + entity.length);
}

test.describe('Weekly Telegram notifications', () => {
	let pageId;
	let source;
	let event;

	test.beforeEach(resetState);
	// Remove the source, category and event after each attempt, so retries
	// never leave fixtures behind.
	test.afterEach(() => {
		if (source) {
			runScript(
				'weekly-summary-fixture.php',
				'E2E_WEEKLY',
				`cleanup ${source.termId} ${source.sourceId} ${
					event ? event.eventId : 0
				}`
			);
		}
		source = null;
		event = null;
	});
	test.afterAll(() => {
		resetState();
		if (pageId) {
			wpCli(`post delete ${pageId} --force`, { allowFailure: true });
		}
	});

	test('an administrator configures Telegram and sends a test summary', async ({
		page,
	}) => {
		// A plain page with no calendar block can head the message.
		const pageTitle = `Weekly heading ${Date.now()}`;
		pageId = wpCli(
			`post create --post_type=page --post_status=publish --post_title="${pageTitle}" --post_content="No calendar here." --porcelain`
		).match(/(\d+)\s*$/)[1];
		source = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			'source'
		);

		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		await expect(
			page.getByRole('heading', { name: 'Weekly notifications' })
		).toBeVisible();

		await page
			.getByLabel('Event source', { exact: true })
			.selectOption({ label: source.sourceName });
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

		// An event in the week the next send covers, now the schedule is final.
		event = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			`event ${source.termId}`
		);

		// The preview shows the Telegram presentation, with linked titles.
		await page
			.getByRole('button', { name: 'Preview next message' })
			.click();
		const previewMessage = page.getByRole('group', {
			name: 'Telegram message 1 of 1',
		});
		await expect(
			previewMessage.getByRole('link', { name: pageTitle })
		).toHaveAttribute('href', /^http/);
		await expect(
			previewMessage.getByRole('link', { name: event.eventTitle })
		).toHaveAttribute('href', event.eventUrl);

		await page
			.getByRole('button', { name: 'Send test summary to Telegram' })
			.click();

		await expect(
			page
				.getByText(
					'The test summary did not reach every chat. See the results below.'
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
			const lines = request.text.split('\n');
			// Linked heading, visible date range, then bullet items.
			expect(lines[0]).toBe(pageTitle);
			expect(lines[1]).toMatch(/\d/);
			expect(lines[2]).toBe('');
			expect(lines).toHaveLength(4);
			expect(lines[3].startsWith('• ')).toBe(true);
			expect(lines[3].endsWith(`, ${event.eventTitle}`)).toBe(true);
			// Formatting travels as entities: no markup, no raw URLs.
			expect(request.text).not.toContain('http');
			const links = request.entities
				.filter((entity) => 'text_link' === entity.type)
				.map((entity) => [covered(request.text, entity), entity.url]);
			expect(links).toEqual([
				[pageTitle, expect.stringMatching(/^http/)],
				[event.eventTitle, event.eventUrl],
			]);
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
