/**
 * E2E: several notifications of the same kind (#1919).
 *
 * An administrator adds two individual emails on Fair Events → Event
 * notifications, sends both to the same address, saves each on its own and
 * pauses one. Each keeps its own name, settings and queued send; both
 * scheduled sends reach the address in the same week, and running each again
 * sends nothing more; pausing one leaves the other scheduled.
 *
 * Individual email needs no other plugin or event feed, so the spec does not
 * depend on Fair Audience or Telegram. No mail leaves the host:
 * fair-e2e-support.php captures wp_mail().
 */

import { test, expect } from '@playwright/test';
import {
	wpCli,
	loginAsAdmin,
	resetCapturedMail,
	runScript,
} from '../support/wp-cli.js';

const SETTINGS_URL = '/wp-admin/admin.php?page=fair-events-event-notifications';
const RECIPIENT = 'shared-1919@example.test';

function fixture(args) {
	return runScript(
		'notification-configurations-fixture.php',
		'E2E_NOTIFICATION_CONFIGURATIONS',
		args
	);
}

function capturedMail() {
	const out = wpCli('option get fair_e2e_captured_mail --format=json', {
		allowFailure: true,
	}).trim();
	return out ? JSON.parse(out) : [];
}

function section(page, name) {
	return page
		.locator('.fair-events-notifications__channel')
		.filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function configurationId(page, name) {
	return page.evaluate(
		(wanted) =>
			window.wp
				.apiFetch({ path: '/fair-events/v1/event-notifications' })
				.then(
					(data) =>
						data.configurations.find(
							(configuration) => configuration.name === wanted
						).id
				),
		name
	);
}

async function addIndividualEmail(page, name) {
	const add = section(page, 'Add a notification');
	await add.getByLabel('Kind').selectOption('individual_email');
	await add.getByLabel('Name').fill(name);
	await add.getByRole('button', { name: 'Add notification' }).click();
	await expect(
		add.getByText(`“${name}” was added above.`, { exact: false })
	).toBeVisible();
	return section(page, name);
}

async function turnOn(own, time) {
	await own.getByLabel('Send to').fill(RECIPIENT);
	await own.getByLabel('Send at').fill(time);
	// The test site may have no events this week.
	await own
		.getByLabel('Skip the email when the week has no events')
		.uncheck();
	await own.getByLabel('Email the weekly summary to this address').check();
	await own
		.getByRole('button', { name: 'Save individual email settings' })
		.click();
	await expect(
		own.getByText('Individual email settings saved.')
	).toBeVisible();
}

test.describe('Several notifications of the same kind', () => {
	const ids = [];

	test.beforeAll(() => {
		resetCapturedMail();
	});

	test.afterAll(() => {
		if (ids.length) {
			fixture(`remove ${ids.join(' ')}`);
		}
		resetCapturedMail();
	});

	test('two individual emails to one address run and pause independently', async ({
		page,
	}) => {
		test.setTimeout(180000);
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		const team = await addIndividualEmail(page, 'Team inbox');
		const board = await addIndividualEmail(page, 'Board inbox');
		ids.push(
			await configurationId(page, 'Team inbox'),
			await configurationId(page, 'Board inbox')
		);
		const [teamId, boardId] = ids;
		expect(teamId).not.toBe(boardId);

		// Both start paused, each under its own name and kind.
		for (const own of [team, board]) {
			await expect(
				own.getByLabel('Email the weekly summary to this address')
			).not.toBeChecked();
			await expect(
				own.getByText('Individual email', { exact: true })
			).toBeVisible();
		}
		expect(fixture(`state ${teamId}`).queued).toEqual([]);

		// Saving one leaves the other's unsaved draft alone.
		await board.getByLabel('Send to').fill(RECIPIENT);
		await turnOn(team, '06:15');
		await expect(board.getByText('Unsaved changes')).toBeVisible();
		await expect(board.getByLabel('Send to')).toHaveValue(RECIPIENT);
		await turnOn(board, '19:45');

		const teamQueued = fixture(`state ${teamId}`).queued;
		const boardQueued = fixture(`state ${boardId}`).queued;
		expect(teamQueued).toHaveLength(1);
		expect(boardQueued).toHaveLength(1);
		expect(teamQueued[0].timestamp).not.toBe(boardQueued[0].timestamp);

		// Both scheduled sends of this week reach the same address, once each.
		for (const id of [teamId, boardId, teamId, boardId]) {
			fixture(`run ${id}`);
		}
		const mail = capturedMail().filter((entry) =>
			[].concat(entry.to).includes(RECIPIENT)
		);
		expect(mail).toHaveLength(2);
		expect(fixture(`state ${teamId}`).runs).toHaveLength(1);
		expect(fixture(`state ${boardId}`).runs).toHaveLength(1);

		// Pausing one removes only its queued send.
		const boardBefore = fixture(`state ${boardId}`);
		await team
			.getByLabel('Email the weekly summary to this address')
			.uncheck();
		await team
			.getByRole('button', { name: 'Save individual email settings' })
			.click();
		await expect(
			team.getByText('Individual email settings saved.')
		).toBeVisible();
		expect(fixture(`state ${teamId}`).queued).toEqual([]);
		expect(fixture(`state ${boardId}`).queued).toEqual(boardBefore.queued);
		expect(fixture(`state ${boardId}`).nextRun).toEqual(
			boardBefore.nextRun
		);

		// Both are kept as saved.
		await page.reload();
		await expect(
			section(page, 'Team inbox').getByLabel(
				'Email the weekly summary to this address'
			)
		).not.toBeChecked();
		await expect(
			section(page, 'Board inbox').getByLabel(
				'Email the weekly summary to this address'
			)
		).toBeChecked();
		await expect(
			section(page, 'Board inbox').getByLabel('Send at')
		).toHaveValue('19:45');
	});
});
