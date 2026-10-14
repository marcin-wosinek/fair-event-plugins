/**
 * E2E: Fair Form submission dialogs (#1774).
 *
 * Deleting a submission from either response view goes through an in-page
 * dialog that identifies the submission, and the Form Answers event editor
 * shows a failed save inline and keeps the chosen event for a retry. None of
 * these actions may open a native browser confirm/alert.
 *
 * Reuses the standalone-response seed/cleanup pair (#1077): each run creates
 * a page plus one anonymous submission with a single answer.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript } from '../support/wp-cli.js';

function rowFor(page, submissionId) {
	return page.locator('tr', {
		has: page.locator(`a[href$="submission_id=${submissionId}"]`),
	});
}

async function openRowAction(page, row, action) {
	await row.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: action }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('Fair Form submission dialogs', () => {
	test.describe.configure({ mode: 'serial' });

	const seeds = [];
	let nativeDialogs;

	test.beforeAll(() => {
		seeds.push(
			runScript('seed-fair-form-answer.php', 'E2E_FAIR_FORM_SEED')
		);
		seeds.push(
			runScript('seed-fair-form-answer.php', 'E2E_FAIR_FORM_SEED')
		);
	});

	test.afterAll(() => {
		for (const seed of seeds) {
			runScript(
				'cleanup-fair-form-answer.php',
				'E2E_FAIR_FORM_CLEANUP',
				`${seed.postId} ${seed.submissionId} ${seed.answerId}`
			);
		}
	});

	test.beforeEach(async ({ page }) => {
		nativeDialogs = [];
		page.on('dialog', async (dialog) => {
			nativeDialogs.push(dialog.message());
			await dialog.dismiss();
		});
		await loginAsAdmin(page);
	});

	test.afterEach(() => {
		expect(nativeDialogs).toEqual([]);
	});

	test('Questionnaire Responses: cancel keeps the row, confirm deletes it', async ({
		page,
	}) => {
		const [seed] = seeds;
		await page.goto(
			`/wp-admin/admin.php?page=fair-form-questionnaire-responses&post_id=${seed.postId}`
		);
		const row = page.locator('tr', { hasText: 'E2E Answer Value' });
		await expect(row).toBeVisible({ timeout: 15000 });

		let dialog = await openRowAction(page, row, 'Delete');
		await expect(dialog.getByText('Anonymous respondent')).toBeVisible();
		await expect(dialog.getByText('E2E Form')).toBeVisible();
		await expect(dialog.getByText(`#${seed.submissionId}`)).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		await expect(row).toBeVisible();

		dialog = await openRowAction(page, row, 'Delete');
		await dialog.getByRole('button', { name: 'Delete submission' }).click();
		await expect(dialog).toBeHidden();
		await expect(row).toHaveCount(0);

		await page.reload();
		await expect(page.getByText('No results')).toBeVisible({
			timeout: 15000,
		});
	});

	test('Form Answers: a failed event save stays in the dialog and retries', async ({
		page,
	}) => {
		const seed = seeds[1];
		// Deterministic event options and one simulated server failure; the
		// retry is answered as the real controller would for that event.
		await page.route(
			'**/fair-form/v1/questionnaire-responses/grouped*',
			(route) =>
				route.fulfill({
					json: [
						{ event_date_id: null, label: 'No event', count: 1 },
						{
							event_date_id: 424242,
							label: 'E2E Event',
							count: 0,
						},
					],
				})
		);
		let saves = 0;
		await page.route(
			`**/fair-form/v1/questionnaire-responses/${seed.submissionId}*`,
			(route) => {
				// apiFetch tunnels PUT through POST + X-HTTP-Method-Override.
				const request = route.request();
				const method =
					request.headers()['x-http-method-override'] ||
					request.method();
				if (method !== 'PUT') {
					return route.fallback();
				}
				saves++;
				if (saves === 1) {
					return route.fulfill({
						status: 500,
						json: {
							code: 'update_failed',
							message: 'Simulated update failure.',
						},
					});
				}
				return route.fulfill({
					json: { event_date_id: 424242, event_name: 'E2E Event' },
				});
			}
		);

		await page.goto('/wp-admin/admin.php?page=fair-form-form-answers');
		const row = rowFor(page, seed.submissionId);
		await expect(row).toBeVisible({ timeout: 15000 });

		const dialog = await openRowAction(page, row, 'Edit');
		await expect(dialog.getByText(`#${seed.submissionId}`)).toBeVisible();
		await expect(dialog.getByText('E2E Form')).toBeVisible();

		const select = dialog.getByLabel('Event');
		await expect(
			select.locator('option', { hasText: 'E2E Event' })
		).toBeAttached();
		await select.selectOption('424242');
		await dialog.getByRole('button', { name: 'Save' }).click();

		await expect(
			dialog.getByText('Simulated update failure.')
		).toBeVisible();
		await expect(select).toHaveValue('424242');

		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(dialog).toBeHidden();
		expect(saves).toBe(2);
	});

	test('Form Answers: delete through the dialog', async ({ page }) => {
		const seed = seeds[1];
		await page.goto('/wp-admin/admin.php?page=fair-form-form-answers');
		const row = rowFor(page, seed.submissionId);
		await expect(row).toBeVisible({ timeout: 15000 });

		const dialog = await openRowAction(page, row, 'Delete');
		await expect(dialog.getByText(`#${seed.submissionId}`)).toBeVisible();
		await expect(
			dialog.getByText(
				'This permanently deletes this submission and its answers. The participant, other submissions, and uploaded files are kept.'
			)
		).toBeVisible();
		await dialog.getByRole('button', { name: 'Delete submission' }).click();
		await expect(dialog).toBeHidden();
		await expect(row).toHaveCount(0);

		await page.reload();
		await expect(page.locator('tbody tr').first()).toBeVisible({
			timeout: 15000,
		});
		await expect(rowFor(page, seed.submissionId)).toHaveCount(0);
	});
});
