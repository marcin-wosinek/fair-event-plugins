/**
 * E2E: Signups tab "Export" popup includes Fair Form answers (#1568).
 *
 * The List tab (home of the CSV/Export button) is only visible when
 * fair-audience is inactive — fair-events/src/Admin/manage-event/
 * ManageEventApp.js's `audienceUrl` gate. Deactivated for the whole suite,
 * mirroring get-tickets-purchase.spec.js.
 *
 * A signup submitted through the live page below therefore always resolves
 * `participant_id` NULL (fair-audience is what normally sets it), so it
 * exercises the "answer not joinable, row kept, empty value" branch.
 * seed-signup-export-answers.php additionally seeds a second signup directly
 * with a participant_id and a matching Fair Form answer — the only way to
 * reach the "answer present" branch here, since fair-audience active (which
 * is what normally links a live signup to a participant) would hide this
 * very tab. See that script's docblock for the full reasoning.
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
			`${seed.eventId} ${seed.eventDateId} ${seed.ticketTypeId} ${seed.linkedSignupId} ${seed.submissionId}`
		);
		wpCli('plugin activate fair-audience');
	});

	test('exports Fair Form answers alongside signup fields, keeping unmatched rows with an empty value', async ({
		page,
	}) => {
		const stamp = Date.now();
		const browserEmail = `signup-export-browser-${stamp}@example.test`;

		await page.goto(seed.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form.locator('input[name="name"]').fill('Browser Signup Tester');
		await form.locator('input[name="email"]').fill(browserEmail);
		await form
			.locator('[data-question-key="diet"] input[type="text"]')
			.fill('Should not appear (no participant_id)');
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
		await expect(page.getByText(seed.linkedEmail)).toBeVisible();
		await expect(page.getByText(browserEmail)).toBeVisible();

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

		const linkedRow = lines
			.find((line) => line.includes(seed.linkedEmail))
			?.split(',');
		expect(linkedRow).toBeTruthy();
		expect(linkedRow[dietIndex]).toBe('Vegan (seeded)');

		// Row kept even though its answer isn't joinable — empty, not omitted.
		const browserRow = lines
			.find((line) => line.includes(browserEmail))
			?.split(',');
		expect(browserRow).toBeTruthy();
		expect(browserRow[dietIndex]).toBe('');
	});
});
