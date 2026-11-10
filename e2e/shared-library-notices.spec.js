/**
 * Administrator notices about bundled shared-library copies (#2181).
 *
 * Each page load runs next to a real, shipped Fair Timetable release; see
 * e2e/mu-plugins/fair-e2e-shared-loader.php. Covers the outdated-copy
 * warning, the distinct conflict error, who sees them, where, and that
 * they clear once the old release is gone.
 *
 * Run: `npm run test:e2e -- e2e/shared-library-notices.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

const EDITOR = {
	login: 'e2e_shared_notice_editor',
	password: 'e2e-editor-pass',
};

const OUTDATED =
	'Fair Timetable includes an outdated copy of the Fair Event Plugins shared library. Update Fair Timetable to keep all Fair plugins working correctly.';
const CONFLICT =
	'are paused on this page because Fair Timetable loaded an outdated copy of the Fair Event Plugins shared library first. Update Fair Timetable, then reload this page.';

const legacy = (early) => ({
	'X-Fair-E2E-Legacy-Shared': '0.8.0',
	'X-Fair-E2E-Legacy-Order': 'last',
	'X-Fair-E2E-Legacy-Early': early ? '1' : '0',
});

const notices = (page) => page.locator('#wpbody-content .notice');
const sharedNotices = (page) =>
	notices(page).filter({ hasText: 'Fair Event Plugins shared library' });

test.describe('Shared library notices', () => {
	test('an administrator sees one outdated-copy warning on the Plugins screen and Fair pages', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.setExtraHTTPHeaders(legacy(false));

		for (const url of [
			'/wp-admin/plugins.php',
			'/wp-admin/admin.php?page=fair-events-settings',
			'/wp-admin/edit.php?post_type=fair_event',
		]) {
			await page.goto(url);
			await expect(sharedNotices(page), url).toHaveCount(1);
			await expect(
				page.locator('.notice-warning', { hasText: OUTDATED }),
				url
			).toHaveCount(1);
		}

		await page.goto('/wp-admin/');
		await expect(sharedNotices(page)).toHaveCount(0);
	});

	test('a class loaded too early shows the conflict error instead', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.setExtraHTTPHeaders(legacy(true));
		await page.goto('/wp-admin/plugins.php');

		const error = page.locator('.notice-error', { hasText: CONFLICT });
		await expect(error).toHaveCount(1);
		await expect(error).toContainText('Fair Events');
		// Fair Timetable is named once, as the cause, not again as outdated.
		await expect(sharedNotices(page)).toHaveCount(1);
	});

	test('the notices clear once the old release is gone', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/plugins.php');
		await expect(page.locator('#the-list')).toBeVisible();
		await expect(sharedNotices(page)).toHaveCount(0);
	});

	test('other roles and the public site see no notices', async ({ page }) => {
		wpCli(`user delete ${EDITOR.login} --yes`, { allowFailure: true });
		wpCli(
			`user create ${EDITOR.login} ${EDITOR.login}@example.com --role=editor --user_pass=${EDITOR.password}`
		);
		try {
			await page.goto('/wp-login.php');
			await page.fill('#user_login', EDITOR.login);
			await page.fill('#user_pass', EDITOR.password);
			await page.click('#wp-submit');
			await page.waitForURL(/\/wp-admin\/?/);

			for (const early of [false, true]) {
				await page.setExtraHTTPHeaders(legacy(early));
				// After a conflict Fair Events is off and its screens are gone.
				await page.goto(
					early
						? '/wp-admin/'
						: '/wp-admin/edit.php?post_type=fair_event'
				);
				await expect(page.locator('#wpbody-content')).toBeVisible();
				await expect(sharedNotices(page)).toHaveCount(0);

				await page.goto('/');
				await expect(
					page.getByText('Fair Event Plugins shared library')
				).toHaveCount(0);
			}
		} finally {
			wpCli(`user delete ${EDITOR.login} --yes`, {
				allowFailure: true,
			});
		}
	});
});
