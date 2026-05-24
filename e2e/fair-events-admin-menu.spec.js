/**
 * Fair Events admin menu / asset-enqueue regression (#656).
 *
 * The admin menu and its asset enqueuing used to assume the `fair_event` CPT:
 * pages were submenus of `edit.php?post_type=fair_event` and the enqueue logic
 * matched parent-derived hook names (`fair_event_page_*`). This suite guards the
 * decoupling — every page must mount its React root **whether or not the CPT is
 * registered**, and with the CPT on the menu must look unchanged.
 *
 * The CPT-off state is produced by the `fair_e2e_unregister_fair_event` toggle in
 * e2e/mu-plugins/fair-e2e-support.php (a stand-in for #655's real setting).
 *
 * Run: `npm run test:e2e -- fair-events-admin-menu`.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

/** Run a WP-CLI command against the wp-env `tests` instance. */
function wpCli(args) {
	return execSync(`npx wp-env run tests-cli wp ${args}`, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

/** Every Fair Events admin page and its React root element id. */
const PAGES = [
	{ slug: 'fair-events-calendar', root: 'fair-events-calendar-root' },
	{ slug: 'fair-events-all-events', root: 'fair-events-all-events-root' },
	{ slug: 'fair-events-sources', root: 'fair-events-sources-root' },
	{ slug: 'fair-events-venues', root: 'fair-events-venues-root' },
	{ slug: 'fair-events-manage-event', root: 'fair-events-manage-event-root' },
	{ slug: 'fair-events-source-view', root: 'fair-events-source-view-root' },
	{
		slug: 'fair-events-manage-invitations',
		root: 'fair-events-manage-invitations-root',
	},
	{ slug: 'fair-events-settings', root: 'fair-events-settings-root' },
	// Migration pages only register when the CPT exists.
	{
		slug: 'fair-events-migration',
		root: 'fair-events-migration-root',
		cptOnly: true,
	},
	{
		slug: 'fair-events-migration-summary',
		root: 'fair-events-migration-summary-root',
		cptOnly: true,
	},
];

async function login(page) {
	await page.goto('/wp-login.php');
	await page.fill('#user_login', ADMIN_USER);
	await page.fill('#user_pass', ADMIN_PASSWORD);
	await page.click('#wp-submit');
	await expect(page).toHaveURL(/\/wp-admin\/?/);
}

/**
 * Assert a page's React root is present AND something mounted into it. An empty
 * root with no children is the exact failure mode of a broken enqueue (the page
 * renders `<div id="…-root">` but no JS loads).
 */
async function expectRootMounts(page, slug, root) {
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

test.describe('Fair Events admin menu — CPT registered (regression)', () => {
	test.beforeAll(() => {
		// Default state: CPT registered. Clear any leftover toggle.
		try {
			wpCli('option delete fair_e2e_unregister_fair_event');
		} catch {
			// Not set — fine.
		}
	});

	test('one top-level Fair Events menu, Calendar first and Settings last', async ({
		page,
	}) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-calendar');

		const topLevel = page.locator('#toplevel_page_fair-events-calendar');
		await expect(
			topLevel,
			'expected a single self-owned top-level menu'
		).toHaveCount(1);
		await expect(topLevel.locator('.wp-menu-name').first()).toContainText(
			'Fair Events'
		);

		const labels = (await topLevel.locator('.wp-submenu a').allInnerTexts())
			.map((t) => t.trim())
			.filter(Boolean);

		expect(labels[0]).toBe('Calendar');
		expect(labels[labels.length - 1]).toBe('Settings');
	});

	test('every page mounts its React root', async ({ page }) => {
		await login(page);
		for (const { slug, root } of PAGES) {
			await expectRootMounts(page, slug, root);
		}
	});
});

test.describe('Fair Events admin menu — CPT unregistered', () => {
	test.beforeAll(() => {
		wpCli('option update fair_e2e_unregister_fair_event 1');
	});

	test.afterAll(() => {
		try {
			wpCli('option delete fair_e2e_unregister_fair_event');
		} catch {
			// Already gone — fine.
		}
	});

	test('top-level menu and every page still mount without the CPT', async ({
		page,
	}) => {
		await login(page);

		await expect(
			page.locator('#toplevel_page_fair-events-calendar'),
			'top-level menu disappeared when the CPT was unregistered'
		).toHaveCount(1);

		for (const { slug, root, cptOnly } of PAGES) {
			if (cptOnly) {
				continue;
			}
			await expectRootMounts(page, slug, root);
		}
	});
});
