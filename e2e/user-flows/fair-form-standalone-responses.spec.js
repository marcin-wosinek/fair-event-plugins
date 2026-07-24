/**
 * E2E: the per-form Questionnaire Responses table for a standalone form
 * submission (no participant link) should not show the always-empty
 * participant columns, and its primary column must open the submission
 * detail page (#1268).
 *
 * Reuses the existing seed/cleanup pair from the fair-form admin-menu
 * mount-smoke suite (#1077), which already creates a page + submission +
 * answer with no participant attached — exactly the standalone case.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript } from '../support/wp-cli.js';

test.describe('Fair Form standalone questionnaire responses', () => {
	let seed;

	test.beforeAll(() => {
		seed = runScript('seed-fair-form-answer.php', 'E2E_FAIR_FORM_SEED');
	});

	test.afterAll(() => {
		runScript(
			'cleanup-fair-form-answer.php',
			'E2E_FAIR_FORM_CLEANUP',
			`${seed.postId} ${seed.submissionId} ${seed.answerId}`
		);
	});

	test('hides participant columns and opens the submission detail page from the date link', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-form-questionnaire-responses&post_id=${seed.postId}`
		);

		await expect(
			page.getByRole('cell', { name: 'E2E Answer Value' })
		).toBeVisible({ timeout: 15000 });

		await expect(
			page.getByRole('columnheader', { name: 'Email' })
		).not.toBeAttached();

		const row = page.locator('tr', { hasText: 'E2E Answer Value' });
		await row.locator('a').click();

		await expect(page).toHaveURL(
			new RegExp(
				`page=fair-form-submission-detail&submission_id=${seed.submissionId}`
			)
		);
		await expect(
			page.getByText('How did you hear about us?')
		).toBeVisible();
		await expect(page.getByText('E2E Answer Value')).toBeVisible();
	});
});
