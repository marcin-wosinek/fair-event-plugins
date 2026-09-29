/**
 * E2E: Signups tab "Export" popup includes Fair Form answers (#1568).
 *
 * The List tab (home of the CSV/Export button) is only visible when
 * fair-audience is inactive — fair-events/src/Admin/manage-event/
 * ManageEventApp.js's `audienceUrl` gate. Deactivated for the whole suite,
 * mirroring get-tickets-purchase.spec.js.
 *
 * A live signup has no participant_id while fair-audience is inactive, but
 * its answers are linked to its ticket. The seed also creates a legacy
 * participant-linked answer and a signup with no answers.
 */

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

test.describe('Signups tab export with Fair Form answers', () => {
	let seed;

	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience');
		seed = runScript(
			'seed-signup-export-answers.php',
			'E2E_EXPORT_ANSWERS_SEED'
		);
	});

	test.afterAll(() => {
		runScript(
			'cleanup-signup-export-answers.php',
			'E2E_EXPORT_ANSWERS_CLEANUP',
			`${seed.eventId} ${seed.eventDateId} ${seed.ticketTypeId}`
		);
		wpCli('plugin activate fair-audience');
	});

	test('exports ticket and participant answers while keeping signups without answers', async ({
		page,
	}) => {
		const stamp = Date.now();
		const browserName = `Browser Signup Tester ${stamp}`;
		const browserEmail = `signup-export-browser-${stamp}@example.test`;

		await page.goto(seed.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form.locator('input[name="name"]').fill(browserName);
		await form.locator('input[name="email"]').fill(browserEmail);
		await form
			.locator('[data-question-key="diet"] input[type="text"]')
			.fill('Vegetarian (browser)');
		await form.locator('.form-button').click();

		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${seed.eventDateId}`
		);

		await page.getByRole('tab', { name: 'List' }).click();
		// The List shows names only; emails appear in the export (#1683).
		const table = page.getByRole('table');
		await expect(table).toContainText(seed.linkedName);
		await expect(table).toContainText(seed.unansweredName);
		await expect(table).toContainText(browserName);

		await page.getByRole('button', { name: 'Export' }).click();
		const dialog = page.getByRole('dialog', { name: 'Export' });
		await expect(dialog).toBeVisible();

		await dialog.getByRole('radio', { name: 'CSV' }).click();
		await dialog
			.getByRole('checkbox', { name: 'Include Fair Form answers' })
			.click();

		const downloadPromise = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Download CSV' }).click();
		const download = await downloadPromise;
		const path = await download.path();
		const csv = readFileSync(path, 'utf8').replace(/^﻿/, '');

		const lines = csv.split('\r\n').filter(Boolean);
		const header = lines[0].split(',');
		expect(header).toContain('Dietary needs?');
		const dietIndex = header.indexOf('Dietary needs?');
		const ownerIndex = header.indexOf('Answers for');
		expect(ownerIndex).toBeGreaterThanOrEqual(0);

		const linkedRow = lines
			.find((line) => line.includes(seed.linkedEmail))
			?.split(',');
		expect(linkedRow).toBeTruthy();
		expect(linkedRow[dietIndex]).toBe('Vegan (seeded)');
		expect(linkedRow[ownerIndex]).toBe('No ticket');

		const unansweredRow = lines
			.find((line) => line.includes(seed.unansweredEmail))
			?.split(',');
		expect(unansweredRow).toBeTruthy();
		expect(unansweredRow[dietIndex]).toBe('');
		expect(unansweredRow[ownerIndex]).toBe('');

		const browserRow = lines
			.find((line) => line.includes(browserEmail))
			?.split(',');
		expect(browserRow).toBeTruthy();
		expect(browserRow[dietIndex]).toBe('Vegetarian (browser)');
		expect(browserRow[ownerIndex]).toMatch(/^Ticket 1 \([A-F0-9]{8}\)$/);
	});
});
