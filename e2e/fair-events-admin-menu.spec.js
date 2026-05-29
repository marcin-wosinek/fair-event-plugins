/**
 * Fair Events admin menu / asset-enqueue regression (#656).
 *
 * The admin menu and its asset enqueuing used to assume the `fair_event` CPT:
 * pages were submenus of `edit.php?post_type=fair_event` and the enqueue logic
 * matched parent-derived hook names (`fair_event_page_*`). This suite guards the
 * decoupling — every page must mount its React root **whether or not the CPT is
 * registered**, and with the CPT on the menu must look unchanged.
 *
 * The CPT-off state is produced by the real `fair_events_register_post_type`
 * setting (#655): `wp option update fair_events_register_post_type 0`. This suite
 * also asserts which menu elements appear/disappear based on that setting.
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

/**
 * Turn every #654 feature bundle on. This suite covers the #656 menu/CPT
 * decoupling, which assumes the full page inventory exists — bundle gating
 * lives in `fair-events-feature-flags.spec.js`.
 */
const ALL_BUNDLES_ON = {
	venues: true,
	sources: true,
	galleries: true,
	ticketing: true,
	'event-tools': true,
	migration: true,
};
function enableAllBundles() {
	const json = JSON.stringify(ALL_BUNDLES_ON).replace(/'/g, "'\\''");
	wpCli(`option update fair_events_features '${json}' --format=json`);
}
function clearBundles() {
	wpCli('option delete fair_events_features');
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

/** CPT submenu link (the fair_event post list) lives under the top-level menu. */
const CPT_LINK =
	'#toplevel_page_fair-events-calendar a[href*="post_type=fair_event"]';
/** Migration page link — a CPT-only affordance. */
const MIGRATION_LINK =
	'#toplevel_page_fair-events-calendar a[href*="page=fair-events-migration"]';

test.describe('Fair Events admin menu — CPT registered (regression)', () => {
	test.beforeAll(() => {
		// Default state: Events post type on, all bundles on (so every page
		// in PAGES is registered — bundle gating is covered separately).
		wpCli('option update fair_events_register_post_type 1');
		enableAllBundles();
	});

	test.afterAll(() => {
		clearBundles();
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

	test('CPT-only menu items are present when the Events post type is on', async ({
		page,
	}) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-calendar');

		await expect(
			page.locator(CPT_LINK),
			'Events post type submenu link should be visible with the CPT on'
		).toHaveCount(1);
		await expect(
			page.locator(MIGRATION_LINK).first(),
			'Migrate Posts link should be visible with the CPT on'
		).toBeVisible();
	});

	test('every page mounts its React root', async ({ page }) => {
		await login(page);
		for (const { slug, root } of PAGES) {
			await expectRootMounts(page, slug, root);
		}
	});
});

test.describe('Fair Events admin menu — Events post type off', () => {
	test.beforeAll(() => {
		wpCli('option update fair_events_register_post_type 0');
		enableAllBundles();
	});

	test.afterAll(() => {
		// Restore the default so other suites see the CPT registered.
		wpCli('option update fair_events_register_post_type 1');
		clearBundles();
	});

	test('top-level menu and every non-CPT page still mount', async ({
		page,
	}) => {
		await login(page);

		await expect(
			page.locator('#toplevel_page_fair-events-calendar'),
			'top-level menu disappeared when the CPT was turned off'
		).toHaveCount(1);

		for (const { slug, root, cptOnly } of PAGES) {
			if (cptOnly) {
				continue;
			}
			await expectRootMounts(page, slug, root);
		}
	});

	test('CPT-only menu items are hidden when the Events post type is off', async ({
		page,
	}) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-calendar');

		await expect(
			page.locator(CPT_LINK),
			'Events post type submenu link should be gone with the CPT off'
		).toHaveCount(0);
		await expect(
			page.locator(MIGRATION_LINK),
			'Migration links should be gone with the CPT off'
		).toHaveCount(0);
	});
});
