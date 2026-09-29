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
 *   4. The retired migration tools (#1674) stay unavailable in both branches,
 *      even with a stale `migration: true` left in the stored option.
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
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

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
	sources: true,
	ticketing: true,
	'event-tools': true,
};

const ALL_BUNDLES_OFF = {
	sources: false,
	ticketing: false,
	'event-tools': false,
};

/**
 * Key of the removed migration bundle (#1674). Sites that saved settings
 * before the removal may still store it; it must stay inert.
 */
const LEGACY_MIGRATION_ON = { migration: true };

/**
 * Bundle → admin page slug + React root id. Pages without a menu entry are
 * tested by direct URL so we still catch enqueue/registration regressions.
 */
const BUNDLE_PAGES = {
	sources: [
		{ slug: 'fair-events-sources', root: 'fair-events-sources-root' },
		{
			slug: 'fair-events-source-view',
			root: 'fair-events-source-view-root',
		},
	],
};

/** Admin pages of the removed migration tools (#1674). */
const RETIRED_PAGES = [
	'fair-events-migration',
	'fair-events-migration-summary',
];

/**
 * Bundle → a representative REST route. Probed with GET; a registered route
 * returns *anything* other than `rest_no_route` (401/403/404 for missing
 * resource still count as "registered").
 */
const BUNDLE_PROBE_ROUTES = {
	sources: '/fair-events/v1/sources',
	ticketing: '/fair-events/v1/event-dates/1/group-pricing-rules',
};

/**
 * Every REST route of the removed migration tools (#1674), probed with the
 * method it used to accept: a method mismatch alone also yields
 * `rest_no_route`, so a GET probe would not prove a POST route is gone.
 */
const RETIRED_ROUTES = [
	{ method: 'GET', path: '/fair-events/v1/migration/post-types' },
	{ method: 'GET', path: '/fair-events/v1/migration/categories' },
	{ method: 'GET', path: '/fair-events/v1/migration/posts' },
	{ method: 'POST', path: '/fair-events/v1/migration/migrate' },
	{ method: 'GET', path: '/fair-events/v1/migration-summary' },
	{
		method: 'POST',
		path: '/fair-events/v1/migration-summary/update-orphans',
	},
	{
		method: 'POST',
		path: '/fair-events/v1/migration-summary/delete-orphans',
	},
];

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

/**
 * Assert the removed migration tools (#1674) neither render through an old
 * bookmark nor answer on any of their former REST routes.
 */
async function expectMigrationToolsRetired(page, request) {
	await loginAsAdmin(page);
	for (const slug of RETIRED_PAGES) {
		await expectPageMissing(page, slug);
	}
	for (const { method, path } of RETIRED_ROUTES) {
		expect(
			await routeIsRegistered(request, path, method),
			`${method} ${path} should no longer be registered`
		).toBe(false);
	}
}

/** True iff WordPress returned a registered route (anything but rest_no_route). */
async function routeIsRegistered(request, path, method = 'GET') {
	const response = await request.fetch(`/wp-json${path}`, { method });
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
		setExperimentalFeatures({ ...ALL_BUNDLES_OFF, ...LEGACY_MIGRATION_ON });
	});

	test.afterAll(() => {
		clearExperimentalFeatures();
	});

	test('only core admin pages mount; bundle pages are gone', async ({
		page,
	}) => {
		await loginAsAdmin(page);

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
		await expectRootMounts(
			page,
			'fair-events-venues',
			'fair-events-venues-root'
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

	test('retired migration pages and routes are unavailable', async ({
		page,
		request,
	}) => {
		await expectMigrationToolsRetired(page, request);
	});

	test('Settings page exposes the Features tab', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-settings');
		await expect(
			page.getByRole('tab', { name: 'Features' }),
			'Features tab should be reachable in every build'
		).toBeVisible();
	});
});

test.describe('Fair Events — full internal build (all bundles on)', () => {
	test.beforeAll(() => {
		setExperimentalFeatures({ ...ALL_BUNDLES_ON, ...LEGACY_MIGRATION_ON });
	});

	test.afterAll(() => {
		// Leave the suite in the minimal-public default so other suites
		// inherit a clean baseline.
		clearExperimentalFeatures();
	});

	test('every bundle page mounts its React root', async ({ page }) => {
		await loginAsAdmin(page);
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

	test('retired migration pages and routes stay unavailable', async ({
		page,
		request,
	}) => {
		await expectMigrationToolsRetired(page, request);
	});

	test('Experimental Settings no longer offers a Migration toggle', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-events-experimental-settings'
		);
		await expect(
			page.getByRole('checkbox', { name: 'Ticketing', exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Migration', exact: true })
		).toHaveCount(0);
	});

	test('Settings page still exposes the Features tab', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-settings');
		await expect(page.getByRole('tab', { name: 'Features' })).toBeVisible();
	});
});
