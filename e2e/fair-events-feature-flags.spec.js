/**
 * Fair Events feature-flag registry (#654).
 *
 * Two branches of the same plugin:
 *   - simplified public — no bundles set; only `core` is active.
 *   - full internal — every bundle flipped on via the stored option (the same
 *     state `FAIR_EVENTS_INTERNAL` produces, exercised through the option
 *     resolver so we don't have to mutate wp-config from the test).
 *
 * For each branch this asserts:
 *   1. The expected admin pages mount (or stop mounting) their React root.
 *   2. The expected REST routes register (or 404 with `rest_no_route`).
 *   3. The Settings → Features tab is reachable in both branches.
 *
 * Sibling-plugin dependencies (`fair-audience` for `ticketing`) are not
 * required for these assertions — the ticketing REST routes register on the
 * flag alone; controller-level dependency checks (e.g.
 * GroupPricingRulesController guarding on FAIR_AUDIENCE_PLUGIN_DIR) are
 * orthogonal and unit-tested elsewhere.
 *
 * Run: `npm run test:e2e -- fair-events-feature-flags`.
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

/** Set the `fair_events_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(
		`option update fair_events_experimental_features '${json}' --format=json`
	);
}

/** Clear the experimental features option — restores all-on defaults. */
function clearExperimentalFeatures() {
	wpCli('option delete fair_events_experimental_features');
}

/** Bundle keys mirror FairEventsExperimental\\Core\\Features::registry(). */
const ALL_BUNDLES_ON = {
	venues: true,
	sources: true,
	galleries: true,
	ticketing: true,
	'event-tools': true,
	migration: true,
};

const ALL_BUNDLES_OFF = {
	venues: false,
	sources: false,
	galleries: false,
	ticketing: false,
	'event-tools': false,
	migration: false,
};

/**
 * Bundle → admin page slug + React root id. Pages without a menu entry are
 * tested by direct URL so we still catch enqueue/registration regressions.
 */
const BUNDLE_PAGES = {
	venues: [{ slug: 'fair-events-venues', root: 'fair-events-venues-root' }],
	sources: [
		{ slug: 'fair-events-sources', root: 'fair-events-sources-root' },
		{
			slug: 'fair-events-source-view',
			root: 'fair-events-source-view-root',
		},
	],
	ticketing: [
		{
			slug: 'fair-events-manage-invitations',
			root: 'fair-events-manage-invitations-root',
		},
	],
	migration: [
		{
			slug: 'fair-events-migration',
			root: 'fair-events-migration-root',
		},
		{
			slug: 'fair-events-migration-summary',
			root: 'fair-events-migration-summary-root',
		},
	],
};

/**
 * Bundle → a representative REST route. Probed with GET; a registered route
 * returns *anything* other than `rest_no_route` (401/403/404 for missing
 * resource still count as "registered").
 */
const BUNDLE_PROBE_ROUTES = {
	sources: '/fair-events/v1/sources/categories',
	galleries: '/fair-events/v1/event-dates/1/gallery',
	ticketing: '/fair-events/v1/event-dates/1/tickets',
	migration: '/fair-events/v1/migration/post-types',
};

async function login(page) {
	await page.goto('/wp-login.php');
	await page.fill('#user_login', ADMIN_USER);
	await page.fill('#user_pass', ADMIN_PASSWORD);
	await page.click('#wp-submit');
	await expect(page).toHaveURL(/\/wp-admin\/?/);
}

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

async function expectPageMissing(page, slug) {
	await page.goto(`/wp-admin/admin.php?page=${slug}`);
	// WP renders a "you do not have permission" / "invalid page" notice when
	// a submenu slug is unregistered. The hallmark is the absence of our
	// React root rather than any specific copy.
	const rootCount = await page
		.locator('[id^="fair-events-"][id$="-root"]')
		.count();
	expect(
		rootCount,
		`${slug}: should not mount a Fair Events React root when its bundle is off`
	).toBe(0);
}

/** True iff WordPress returned a registered route (anything but rest_no_route). */
async function routeIsRegistered(request, path) {
	const response = await request.get(`/wp-json${path}`);
	if (response.status() !== 404) {
		return true;
	}
	let body;
	try {
		body = await response.json();
	} catch {
		return true; // 404 without rest_no_route shape — treat as registered.
	}
	return body?.code !== 'rest_no_route';
}

test.describe('Fair Events — simplified public build (no bundles set)', () => {
	test.beforeAll(() => {
		setExperimentalFeatures(ALL_BUNDLES_OFF);
	});

	test.afterAll(() => {
		clearExperimentalFeatures();
	});

	test('only core admin pages mount; bundle pages are gone', async ({
		page,
	}) => {
		await login(page);

		// Core pages stay available regardless of feature state.
		await expectRootMounts(
			page,
			'fair-events-calendar',
			'fair-events-calendar-root'
		);
		await expectRootMounts(
			page,
			'fair-events-all-events',
			'fair-events-all-events-root'
		);
		await expectRootMounts(
			page,
			'fair-events-settings',
			'fair-events-settings-root'
		);

		for (const pages of Object.values(BUNDLE_PAGES)) {
			for (const { slug } of pages) {
				await expectPageMissing(page, slug);
			}
		}
	});

	test('bundle REST routes 404 with rest_no_route', async ({ request }) => {
		for (const [bundle, path] of Object.entries(BUNDLE_PROBE_ROUTES)) {
			expect(
				await routeIsRegistered(request, path),
				`${bundle}: ${path} should be unregistered in the minimal build`
			).toBe(false);
		}
	});

	test('Settings page exposes the Features tab', async ({ page }) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-settings');
		await expect(
			page.getByRole('tab', { name: 'Features' }),
			'Features tab should be reachable in every build'
		).toBeVisible();
	});
});

test.describe('Fair Events — full internal build (all bundles on)', () => {
	test.beforeAll(() => {
		setExperimentalFeatures(ALL_BUNDLES_ON);
	});

	test.afterAll(() => {
		// Leave the suite in the minimal-public default so other suites
		// inherit a clean baseline.
		clearExperimentalFeatures();
	});

	test('every bundle page mounts its React root', async ({ page }) => {
		await login(page);
		for (const pages of Object.values(BUNDLE_PAGES)) {
			for (const { slug, root } of pages) {
				await expectRootMounts(page, slug, root);
			}
		}
	});

	test('bundle REST routes are registered', async ({ request }) => {
		for (const [bundle, path] of Object.entries(BUNDLE_PROBE_ROUTES)) {
			expect(
				await routeIsRegistered(request, path),
				`${bundle}: ${path} should be registered in the internal build`
			).toBe(true);
		}
	});

	test('Settings page still exposes the Features tab', async ({ page }) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-settings');
		await expect(page.getByRole('tab', { name: 'Features' })).toBeVisible();
	});
});
