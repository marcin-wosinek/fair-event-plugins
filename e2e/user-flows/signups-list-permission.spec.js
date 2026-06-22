/**
 * E2E: signups-list block renders the full participant list for a token-bearing
 * viewer whose participant belongs to a group granted view_signups (#888).
 *
 * Positive case: group member visits with their participant_token → sees the
 * .audience-signups__list, not the count-only fallback.
 * Negative case: non-member token → count-only .audience-signups__count.
 *
 * Covers the class of regression where class_exists() silently returns false
 * (stale namespace) and the permission gate always fails — a PHP unit test
 * mocking the model would not catch that.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * Run a WP-CLI command against the wp-env `tests` instance and return stdout.
 *
 * @param {string} args WP-CLI arguments (everything after `wp`).
 * @return {string} Command stdout.
 */
function wpCli(args) {
	return execSync(`npx wp-env run tests-cli wp ${args}`, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

/**
 * Run a seed/state eval-file script and parse its `MARKER:{json}` output.
 *
 * @param {string} file      Script filename under mu-plugins/scripts/.
 * @param {string} marker    Output marker (e.g. 'E2E_SIGNUPS_SEED').
 * @param {string} extraArgs Positional args passed to the script.
 * @return {object} Parsed JSON payload.
 */
function runScript(file, marker, extraArgs = '') {
	const out = wpCli(
		`eval-file wp-content/mu-plugins/scripts/${file} ${extraArgs}`.trim()
	);
	const match = out.match(new RegExp(`${marker}:(\\{.*\\})`));
	if (!match) {
		throw new Error(`Expected ${marker} in WP-CLI output, got:\n${out}`);
	}
	return JSON.parse(match[1]);
}

let seed;

test.beforeAll(() => {
	seed = runScript('seed-signups-list.php', 'E2E_SIGNUPS_SEED');
});

test.afterAll(() => {
	runScript(
		'cleanup-signups-list.php',
		'E2E_SIGNUPS_CLEANUP',
		`${seed.eventId} ${seed.eventDateId} ${seed.groupId} ${seed.memberParticipantId} ${seed.otherParticipantId}`
	);
});

test.describe('signups-list group permission', () => {
	test('group member with participant_token sees full participant list', async ({
		browser,
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(
			`${seed.pageUrl}?participant_token=${seed.memberToken}`
		);

		await expect(page.locator('.audience-signups__list')).toBeVisible();
		await expect(
			page.locator('.audience-signups__count')
		).not.toBeVisible();

		await context.close();
	});

	test('non-member participant_token shows count-only fallback', async ({
		browser,
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(`${seed.pageUrl}?participant_token=${seed.otherToken}`);

		await expect(page.locator('.audience-signups__count')).toBeVisible();
		await expect(page.locator('.audience-signups__list')).not.toBeVisible();

		await context.close();
	});
});
