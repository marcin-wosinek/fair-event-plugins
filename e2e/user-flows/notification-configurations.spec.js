/**
 * E2E: several notifications of the same kind (#1919), in the list of
 * notifications with each one's editor and history (#1921).
 *
 * An administrator adds two individual emails on Fair Events → Event
 * notifications, sends both to the same address, saves each on its own and
 * pauses one. Each keeps its own name, settings and queued send; both
 * scheduled sends reach the address in the same week, and running each again
 * sends nothing more; pausing one leaves the other scheduled. An unsaved
 * draft survives opening the list and another notification. Each
 * notification's history shows only its own sends, the history of all of
 * them shows both and filters by notification, and the browser's Back and
 * Forward buttons move between the views.
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

function view(page) {
	return page.locator('.fair-events-notifications');
}

function listRow(page, name) {
	return page
		.getByRole('row')
		.filter({ has: page.getByRole('link', { name, exact: true }) });
}

// Through the list, as an administrator would.
async function open(page, name, link = name) {
	const back = page.getByRole('link', { name: '← All notifications' });
	if (await back.count()) {
		await back.click();
	}
	await listRow(page, name)
		.getByRole('link', { name: link, exact: true })
		.click();
	await expect(
		page.getByRole('navigation', { name: 'Notification sections' })
	).toBeVisible();
	return view(page);
}

async function addIndividualEmail(page, name) {
	await page.goto(SETTINGS_URL);
	const add = page
		.locator('.fair-events-notifications__add')
		.filter({ has: page.getByRole('heading', { name: 'Add a notification' }) });
	await add.getByLabel('Kind').selectOption('individual_email');
	await add.getByLabel('Name').fill(name);
	await add.getByRole('button', { name: 'Add notification' }).click();
	// Adding opens the new notification's editor.
	await expect(
		page.getByText(`“${name}” was added.`, { exact: false }).first()
	).toBeVisible();
	await expect(page).toHaveURL(/configuration=[a-z0-9-]{36}/);
	return new URL(page.url()).searchParams.get('configuration');
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
		own.getByText('Individual email settings saved.').first()
	).toBeVisible();
}

function historyRows(page) {
	return view(page).getByRole('table').locator('tbody').getByRole('row');
}

test.describe('Several notifications of the same kind', () => {
	const ids = [];

	test.beforeAll(() => {
		resetCapturedMail();
	});

	test.afterAll(() => {
		if (ids.length) {
			fixture(`remove ${ids.join(' ')}`);
			runScript(
				'notification-history-fixture.php',
				'E2E_NOTIFICATION_HISTORY',
				`clear ${ids.join(' ')}`
			);
		}
		resetCapturedMail();
	});

	test('two individual emails to one address run and pause independently', async ({
		page,
	}) => {
		test.setTimeout(240000);
		await loginAsAdmin(page);

		const teamId = await addIndividualEmail(page, 'Team inbox');
		ids.push(teamId);
		const boardId = await addIndividualEmail(page, 'Board inbox');
		ids.push(boardId);
		expect(teamId).not.toBe(boardId);

		// Both start paused, each listed under its own name and kind.
		await page.goto(SETTINGS_URL);
		for (const name of ['Team inbox', 'Board inbox']) {
			await expect(listRow(page, name).getByText('Paused', { exact: true })).toBeVisible();
			await expect(
				listRow(page, name).getByText('Individual email', {
					exact: true,
				})
			).toBeVisible();
		}
		expect(fixture(`state ${teamId}`).queued).toEqual([]);

		// Saving one leaves the other's unsaved draft alone, also while the
		// list and the other editor are open.
		let own = await open(page, 'Board inbox');
		await own.getByLabel('Send to').fill(RECIPIENT);
		own = await open(page, 'Team inbox');
		await turnOn(own, '06:15');
		await page.getByRole('link', { name: '← All notifications' }).click();
		await expect(
			listRow(page, 'Board inbox').getByText('Unsaved changes')
		).toBeVisible();
		await expect(listRow(page, 'Team inbox').getByText('On', { exact: true })).toBeVisible();
		own = await open(page, 'Board inbox');
		await expect(own.getByText('Unsaved changes')).toBeVisible();
		await expect(own.getByLabel('Send to')).toHaveValue(RECIPIENT);
		await turnOn(own, '19:45');

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

		// The list shows each one's latest send.
		await page.goto(SETTINGS_URL);
		for (const name of ['Team inbox', 'Board inbox']) {
			await expect(
				listRow(page, name).getByRole('link', { name: /^Scheduled, / })
			).toBeVisible();
		}

		// Each history shows only its own send; its details stay in scope.
		own = await open(page, 'Team inbox', 'History');
		await expect(historyRows(page)).toHaveCount(1);
		await expect(
			own.getByRole('combobox', { name: 'Notification' })
		).toHaveCount(0);
		await historyRows(page).getByRole('link').click();
		await expect(page).toHaveURL(
			new RegExp(`configuration=${teamId}.*execution=\\d+`)
		);
		await expect(
			own.getByRole('table').getByText(RECIPIENT)
		).toBeVisible();
		await expect(own.getByText('Accepted by the provider')).toBeVisible();
		const teamExecution = new URL(page.url()).searchParams.get('execution');

		// Another notification's entry is not shown in this one's history.
		await page.goto(
			`${SETTINGS_URL}&configuration=${boardId}&tab=history&execution=${teamExecution}`
		);
		await expect(
			view(page)
				.getByText(/It may belong to another notification/)
				.first()
		).toBeVisible();

		// The history of every notification includes both and filters by one.
		await page.goto(SETTINGS_URL);
		await page
			.getByRole('link', { name: 'All notification history' })
			.click();
		await expect(
			page.getByRole('heading', { name: 'All notification history' })
		).toBeVisible();
		await view(page)
			.getByRole('combobox', { name: 'Kind' })
			.selectOption('individual_email');
		await view(page)
			.getByRole('combobox', { name: 'Scheduled or test' })
			.selectOption('scheduled');
		for (const name of ['Team inbox', 'Board inbox']) {
			await expect(
				historyRows(page).filter({ hasText: name })
			).toHaveCount(1);
		}
		await view(page)
			.getByRole('combobox', { name: 'Notification' })
			.selectOption(boardId);
		await expect(historyRows(page)).toHaveCount(1);
		await expect(
			historyRows(page).filter({ hasText: 'Board inbox' })
		).toHaveCount(1);
		await expect(page).toHaveURL(
			new RegExp(`filter_configuration=${boardId}`)
		);

		// Details open from it and return to the same filters.
		await historyRows(page).getByRole('link').click();
		await expect(view(page).getByText('Accepted by the provider')).toBeVisible();
		await view(page)
			.getByRole('link', { name: '← Back to the history' })
			.click();
		await expect(historyRows(page)).toHaveCount(1);
		await expect(
			view(page).getByRole('combobox', { name: 'Notification' })
		).toHaveValue(boardId);

		// Back and Forward move between the views.
		await page.goBack();
		await expect(view(page).getByText('Accepted by the provider')).toBeVisible();
		await page.goForward();
		await expect(historyRows(page)).toHaveCount(1);
		await page.reload();
		await expect(
			view(page).getByRole('combobox', { name: 'Notification' })
		).toHaveValue(boardId);

		// Pausing one removes only its queued send.
		const boardBefore = fixture(`state ${boardId}`);
		await page.goto(`${SETTINGS_URL}&configuration=${teamId}`);
		own = view(page);
		await own
			.getByLabel('Email the weekly summary to this address')
			.uncheck();
		await own
			.getByRole('button', { name: 'Save individual email settings' })
			.click();
		await expect(
			own.getByText('Individual email settings saved.').first()
		).toBeVisible();
		expect(fixture(`state ${teamId}`).queued).toEqual([]);
		expect(fixture(`state ${boardId}`).queued).toEqual(boardBefore.queued);
		expect(fixture(`state ${boardId}`).nextRun).toEqual(
			boardBefore.nextRun
		);

		// Both are kept as saved.
		await page.goto(SETTINGS_URL);
		await expect(
			listRow(page, 'Team inbox').getByText('Paused', { exact: true })
		).toBeVisible();
		await expect(listRow(page, 'Board inbox').getByText('On', { exact: true })).toBeVisible();
		own = await open(page, 'Board inbox');
		await expect(
			own.getByLabel('Email the weekly summary to this address')
		).toBeChecked();
		await expect(own.getByLabel('Send at')).toHaveValue('19:45');
	});
});
