/**
 * E2E: set up Telegram weekly notifications through Connectors and send a
 * test summary (#1660, #1735, #1734), on the Event notifications page of
 * Fair Events (#1810).
 *
 * Drives Fair Events → Event notifications and Settings → Connectors as an
 * administrator. The former entry points — the Experimental settings tab and
 * Fair Audience's Weekly Digest page — lead to that page, and saving the
 * Telegram section leaves the bulk email section alone. A bot token saved before the credential
 * moved to Connectors keeps working with no action. The administrator then
 * picks an event feed and a plain page (no calendar block) for the heading,
 * saves two chats, and sends the next week's formatted summary as a test,
 * which reaches one chat and fails for the other. In Connectors the token is
 * replaced with one Telegram rejects, a malformed one is refused, and it is
 * removed; each change shows in the weekly notification status and in what a
 * test send does. No request reaches Telegram — lib/telegram-http-double.php
 * answers api.telegram.org and records each request's chat ID, text and
 * formatting entities (never the token).
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin, runScript } from '../support/wp-cli.js';

const TOKEN = '123456789:AAEe2eWeeklyTelegramToken0123456789';
// The Telegram double answers this bot ID like a revoked token.
const REJECTED_TOKEN = '401401401:AAEe2eRejectedTelegramToken0123456789';
const TOKEN_OPTION = 'fair_events_experimental_weekly_telegram_token';
const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-events-event-notifications';
const EXPERIMENTAL_TAB_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';
const WEEKLY_DIGEST_URL = '/wp-admin/admin.php?page=fair-audience-weekly-digest';
const CONNECTORS_URL = '/wp-admin/options-connectors.php';
const SAVED_STATUS =
	'A bot token is saved in Connectors. It is not shown here. Send a test to confirm Telegram accepts it.';
const MISSING_STATUS =
	'No bot token is configured. Add one in Connectors to post to Telegram.';

function resetState() {
	for (const option of [
		'fair_events_experimental_weekly_telegram_token',
		'fair_e2e_telegram_requests',
	]) {
		wpCli(`option delete ${option}`, { allowFailure: true });
	}
	// Settings and queued sends of the Telegram summary this site started
	// with: turning it on queues its next send.
	runScript(
		'notification-configurations-fixture.php',
		'E2E_NOTIFICATION_CONFIGURATIONS',
		'reset telegram'
	);
}

function telegramRequests() {
	const out = wpCli('option get fair_e2e_telegram_requests --format=json', {
		allowFailure: true,
	}).trim();
	return out ? JSON.parse(out) : [];
}

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

/**
 * The Telegram connector on the Connectors screen.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {import('@playwright/test').Locator} Connector card.
 */
/**
 * A channel's section on the Event notifications page.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {string}                          name Section heading.
 * @return {import('@playwright/test').Locator} Section.
 */
function channel(page, name) {
	return page
		.locator('.fair-events-notifications__channel')
		.filter({ has: page.getByRole('heading', { name, exact: true }) });
}

function telegramConnector(page) {
	return page.getByRole('group', { name: 'Telegram' });
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

		// A token saved before the credential moved to Connectors.
		wpCli(`option add ${TOKEN_OPTION} ${TOKEN} --autoload=no`);

		await loginAsAdmin(page);

		// The former entry points lead to the one Event notifications page.
		await page.goto(EXPERIMENTAL_TAB_URL);
		await expect(
			page.getByRole('link', { name: 'Open Event notifications' })
		).toHaveAttribute('href', /page=fair-events-event-notifications$/);
		await expect(
			page.getByRole('button', {
				name: 'Save weekly notification settings',
			})
		).toHaveCount(0);
		await page.goto(WEEKLY_DIGEST_URL);
		await expect(page).toHaveURL(/page=fair-events-event-notifications$/);

		await page.goto(SETTINGS_URL);
		await expect(
			page.getByRole('heading', { name: 'Event notifications' })
		).toBeVisible();
		const telegram = channel(page, 'Telegram');
		const bulkEmail = channel(page, 'Bulk email');
		await expect(telegram).toBeVisible();
		await expect(bulkEmail).toBeVisible();
		const bulkEmailTime = await bulkEmail.getByLabel('Send at').inputValue();

		await telegram
			.getByLabel('Events to include')
			.selectOption({ label: source.sourceName });
		await telegram
			.getByLabel('Page linked in the heading')
			.selectOption({ label: pageTitle });

		// The token saved before the upgrade is in use, with no token controls.
		await expect(page.getByText(SAVED_STATUS).first()).toBeVisible();
		await expect(page.locator('input[type="password"]')).toHaveCount(0);
		await expect(page.getByLabel(/bot token/i)).toHaveCount(0);
		await expect(
			page.getByRole('link', { name: /Manage in Connectors/ })
		).toHaveAttribute('href', /options-connectors\.php$/);

		await telegram.getByLabel('Post the weekly summary to Telegram').check();
		await telegram.getByLabel('Send at').fill('07:45');
		await telegram
			.getByLabel('Chats and channels')
			.fill('@e2e_channel\n@e2e_missing_chat');
		await expect(telegram.getByText('Unsaved changes')).toBeVisible();
		await telegram
			.getByRole('button', { name: 'Save Telegram settings' })
			.click();

		await expect(
			telegram.getByText('Telegram settings saved.').first()
		).toBeVisible();
		await expect(telegram.getByText('Unsaved changes')).toHaveCount(0);
		// Saving schedules the next send; nothing is sent by saving.
		await expect(telegram.getByText(/^Next send: /)).toBeVisible();
		expect(telegramRequests()).toEqual([]);
		// The bulk email keeps its own schedule.
		await expect(bulkEmail.getByLabel('Send at')).toHaveValue(
			bulkEmailTime
		);

		// Saving notification settings leaves the token alone (#1733).
		expect(storedTokenIs(TOKEN)).toBe(true);
		await page.reload();
		await expect(telegram.getByLabel('Send at')).toHaveValue('07:45');
		await expect(
			telegram.getByLabel('Page linked in the heading')
		).toHaveValue(pageId);
		await expect(telegram.getByLabel('Chats and channels')).toHaveValue(
			'@e2e_channel\n@e2e_missing_chat'
		);
		await expect(bulkEmail.getByLabel('Send at')).toHaveValue(
			bulkEmailTime
		);
		expect(await page.content()).not.toContain(TOKEN);

		// An event in the selected week relative to today.
		event = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			`event ${source.termId}`
		);

		// The preview shows the Telegram presentation, with linked titles.
		await page
			.getByRole('button', { name: 'Preview next Telegram message' })
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

		const previewText = await previewMessage.evaluate((element) => {
			const copy = element.cloneNode(true);
			// WordPress replaces emoji text with images in the browser.
			for (const emoji of copy.querySelectorAll('img.emoji')) {
				emoji.replaceWith(emoji.alt);
			}
			return copy.textContent;
		});

		// The test names where it goes before it is sent.
		await expect(
			telegram.getByText(/summary to: @e2e_channel, @e2e_missing_chat\./)
		).toBeVisible();
		await page
			.getByRole('button', { name: 'Send test to the saved chats' })
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
			expect(request.text).toBe(previewText);
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
			telegram.getByText('No Telegram summary has been sent yet.')
		).toBeVisible();
		await expect(
			telegram.getByRole('heading', { name: 'Messages by chat' })
		).toHaveCount(0);

		// Replace the token in Connectors with one Telegram rejects.
		await page.goto(CONNECTORS_URL);
		const connector = telegramConnector(page);
		await expect(connector.getByText('Connected')).toBeVisible();
		await connector.getByRole('button', { name: 'Edit' }).click();
		expect(await page.content()).not.toContain(TOKEN);
		await connector
			.getByRole('button', { name: 'Remove and replace' })
			.click();
		await expect(connector.getByText('Connected')).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		// A malformed token is refused and nothing is stored.
		await connector.getByLabel('API Key').fill('not-a-bot-token');
		await connector.getByRole('button', { name: 'Save' }).click();
		await expect(
			connector.getByRole('button', { name: 'Save' })
		).toBeEnabled();
		await expect(connector.getByText('Connected')).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		await connector.getByLabel('API Key').fill(REJECTED_TOKEN);
		await connector.getByRole('button', { name: 'Save' }).click();
		await expect(connector.getByText('Connected')).toBeVisible();
		expect(storedTokenIs(REJECTED_TOKEN)).toBe(true);
		expect(await page.content()).not.toContain(REJECTED_TOKEN);

		// The token is configured; only the test send shows Telegram rejects it.
		wpCli('option delete fair_e2e_telegram_requests', {
			allowFailure: true,
		});
		await page.goto(SETTINGS_URL);
		await expect(page.getByText(SAVED_STATUS).first()).toBeVisible();
		await page
			.getByRole('button', { name: 'Send test to the saved chats' })
			.click();
		await expect(
			page
				.getByText(
					'The test summary did not reach every chat. See the results below.'
				)
				.first()
		).toBeVisible();
		await expect(page.getByText('Unauthorized')).toHaveCount(2);
		// A failing Telegram test leaves the bulk email section usable.
		await expect(
			channel(page, 'Bulk email').getByRole('button', {
				name: 'Save bulk email settings',
			})
		).toBeEnabled();
		expect(await page.content()).not.toContain(REJECTED_TOKEN);
		expect(telegramRequests().map((r) => r.rejected)).toEqual([true, true]);

		// Remove the token in Connectors.
		await page.goto(CONNECTORS_URL);
		await telegramConnector(page)
			.getByRole('button', { name: 'Edit' })
			.click();
		await telegramConnector(page)
			.getByRole('button', { name: 'Remove and replace' })
			.click();
		await expect(
			telegramConnector(page).getByText('Connected')
		).toHaveCount(0);
		expect(storedTokenIs('')).toBe(true);

		// Without a token the screen says so, the test send is unavailable,
		// and a direct request is refused before anything reaches Telegram.
		wpCli('option delete fair_e2e_telegram_requests', {
			allowFailure: true,
		});
		await page.goto(SETTINGS_URL);
		await expect(page.getByText(MISSING_STATUS).first()).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Send test to the saved chats' })
		).toBeDisabled();
		await expect(
			page.getByText(
				'Fix the bot token in Connectors before sending a test message.'
			)
		).toBeVisible();
		await expect(page.getByLabel('Chats and channels')).toHaveValue(
			'@e2e_channel\n@e2e_missing_chat'
		);
		const refusal = await page.evaluate(() =>
			window.wp
				.apiFetch({
					path: '/fair-events/v1/event-notifications/telegram/test',
					method: 'POST',
				})
				.then(
					() => 'sent',
					(error) => error.code
				)
		);
		expect(refusal).toBe('missing_token');
		expect(telegramRequests()).toEqual([]);
	});
});
