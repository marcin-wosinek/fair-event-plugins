/**
 * Fair Form admin pages — mount smoke (#1077).
 *
 * fair-form's admin pages had zero e2e coverage, so PR #1076 (blank Answers
 * Overview page — `__experimentalToggleGroupControl` didn't exist, and
 * DataViews needs `view.fields`) shipped without CI catching it: the crash
 * was a runtime-only React error, invisible to `npm run build` and `phpcs`.
 * Mirrors fair-events-admin-menu.spec.js and
 * fair-payments-connector-admin-menu.spec.js — every admin page must mount
 * something into its React root, not just render an empty `<div>`.
 *
 * The Answers Overview check goes further: it seeds one real submission and
 * asserts its row renders with real data, since "root has children" alone
 * would not have caught the missing `view.fields` regression (DataViews can
 * mount with a table that has zero visible columns).
 *
 * Run: `npm run test:e2e -- fair-form-admin-menu`.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript } from './support/wp-cli.js';

/** Visible Fair Form admin pages and their React root element ids. */
const VISIBLE_PAGES = [
	{ slug: 'fair-form', root: 'fair-form-answers-overview-root' },
	{
		slug: 'fair-form-form-answers',
		root: 'fair-form-form-answers-root',
	},
];

/**
 * Hidden pages (empty parent slug — not in the visible menu, so navigate
 * directly instead of asserting a menu link).
 */
const HIDDEN_PAGES = [
	{
		slug: 'fair-form-questionnaire-responses',
		root: 'fair-form-questionnaire-responses-root',
	},
	{
		slug: 'fair-form-submission-detail',
		root: 'fair-form-submission-detail-root',
	},
];

test.describe('Fair Form admin menu', () => {
	test('top-level menu is present with Answers Overview and All Answers', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/');

		const menu = page.locator('#toplevel_page_fair-form');
		await expect(menu).toBeVisible();

		for (const { slug } of VISIBLE_PAGES) {
			await expect(
				menu.locator(`a[href*="page=${slug}"]`).first(),
				`menu link for ${slug} missing`
			).toBeAttached();
		}
	});

	test('every page mounts its React root', async ({ page }) => {
		await loginAsAdmin(page);

		for (const { slug, root } of [...VISIBLE_PAGES, ...HIDDEN_PAGES]) {
			await page.goto(`/wp-admin/admin.php?page=${slug}`);
			await expect(
				page.locator(`#${root}`),
				`${slug}: React root element missing`
			).toBeAttached();
			await expect(
				page.locator(`#${root} > *`).first(),
				`${slug}: root is empty — admin bundle did not load`
			).toBeAttached({ timeout: 15000 });
		}
	});

	test.describe('Answers Overview with seeded data', () => {
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

		test('renders the seeded submission row, not just an empty table', async ({
			page,
		}) => {
			await loginAsAdmin(page);
			await page.goto('/wp-admin/admin.php?page=fair-form');

			await expect(
				page.getByRole('cell', { name: seed.postTitle }),
				'seeded page title missing from the grouped-by-page table — a ' +
					'root with children is not enough, the row must carry real data'
			).toBeVisible({ timeout: 15000 });
		});
	});
});
