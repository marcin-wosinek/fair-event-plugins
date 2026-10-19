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
 * The Experimental `ticketing` probe (group pricing rules) registers only
 * while core Fair Events ticketing is on and Fair Audience is active, both of
 * which hold on the tests site by default.
 *
 * A final block covers the ticketing availability rules (#1849): core
 * ticketing alone decides base ticket configuration, Experimental's setting
 * only its extensions, with conflicting settings and Experimental inactive.
 *
 * Run: `npm run test:e2e -- fair-events-feature-flags`.
 */

import { test, expect } from './support/fixtures.js';
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
};

const ALL_BUNDLES_OFF = {
	sources: false,
	ticketing: false,
};

/**
 * Keys of the removed migration and event-tools bundles. Sites that saved
 * settings before removal may still store them; they must stay inert.
 */
const LEGACY_RETIRED_FEATURES_ON = { migration: true, 'event-tools': true };

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

/** Admin pages of the removed migration and event tools. */
const RETIRED_PAGES = [
	'fair-events-migration',
	'fair-events-migration-summary',
	'fair-events-duplicate-event',
	'fair-events-merge-event',
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
 * Every REST route of the removed tools, probed with the
 * method it used to accept: a method mismatch alone also yields
 * `rest_no_route`, so a GET probe would not prove a POST route is gone.
 */
const RETIRED_ROUTES = [
	{ method: 'POST', path: '/fair-events/v1/event-dates/1/clone-posts' },
	{ method: 'GET', path: '/fair-events/v1/event-dates/1/merge-preview' },
	{ method: 'POST', path: '/fair-events/v1/event-dates/1/merge' },
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
 * Assert the removed tools neither render through an old
 * bookmark nor answer on any of their former REST routes.
 */
async function expectRetiredToolsUnavailable(page, request) {
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
		setExperimentalFeatures({
			...ALL_BUNDLES_OFF,
			...LEGACY_RETIRED_FEATURES_ON,
		});
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

	test('retired tool pages and routes are unavailable', async ({
		page,
		request,
	}) => {
		await expectRetiredToolsUnavailable(page, request);
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
		setExperimentalFeatures({
			...ALL_BUNDLES_ON,
			...LEGACY_RETIRED_FEATURES_ON,
		});
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

	test('retired tool pages and routes stay unavailable', async ({
		page,
		request,
	}) => {
		await expectRetiredToolsUnavailable(page, request);
	});

	test('Experimental Settings omits retired feature toggles', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-events-settings&tab=experimental'
		);
		await expect(
			page.getByRole('checkbox', {
				name: 'Ticketing extensions',
				exact: true,
			})
		).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Migration', exact: true })
		).toHaveCount(0);
		await expect(
			page.getByRole('checkbox', { name: 'Event tools', exact: true })
		).toHaveCount(0);
	});

	test('Settings page still exposes the Features tab', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-settings');
		await expect(page.getByRole('tab', { name: 'Features' })).toBeVisible();
	});
});

/** Core ticket configuration route; Experimental's group pricing route. */
const CORE_TICKETS_ROUTE = '/fair-events/v1/event-dates/1/tickets';
const GROUP_RULES_ROUTE = BUNDLE_PROBE_ROUTES.ticketing;

/** Set the core `fair_events_features` option to a `{bundle: bool}` map. */
function setCoreFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(`option update fair_events_features '${json}' --format=json`);
}

/**
 * Open Manage Event for an event date and wait for its tab list.
 *
 * @param {import('@playwright/test').Page} page        Playwright page.
 * @param {number}                          eventDateId Event date ID.
 */
async function openManageEvent(page, eventDateId) {
	await page.goto(
		`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}&tab=prices`
	);
	await expect(
		page.getByRole('tab', { name: 'Event Details' })
	).toBeVisible();
}

/**
 * Add an add-on on the Prices tab and save the base ticket configuration.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function saveBaseConfiguration(page) {
	await page.getByRole('tab', { name: 'Prices' }).click();
	await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
	await page.getByRole('button', { name: '+ Add Option' }).click();
	await page.getByPlaceholder('Add-on name').last().fill('Dinner');
	await page.getByRole('button', { name: 'Save tickets' }).click();
	await expect(
		page
			.locator('.components-notice__content')
			.getByText('Tickets saved successfully.')
	).toBeVisible();
}

test.describe('Ticketing availability across core and Experimental (#1849)', () => {
	let originalCoreFeatures;

	test.beforeAll(() => {
		const stored = wpCli('option get fair_events_features --format=json', {
			allowFailure: true,
		}).trim();
		originalCoreFeatures = stored.startsWith('{') ? stored : null;
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-events-experimental');
		if (originalCoreFeatures) {
			wpCli(
				`option update fair_events_features '${originalCoreFeatures}' --format=json`
			);
		} else {
			wpCli('option delete fair_events_features', {
				allowFailure: true,
			});
		}
		clearExperimentalFeatures();
	});

	test('core off wins over Experimental on', async ({
		page,
		request,
		seedEvent,
	}) => {
		setCoreFeatures({ ticketing: false });
		setExperimentalFeatures({ ticketing: true });
		const event = seedEvent('paid');

		expect(await routeIsRegistered(request, CORE_TICKETS_ROUTE)).toBe(
			false
		);
		expect(await routeIsRegistered(request, GROUP_RULES_ROUTE)).toBe(false);

		await loginAsAdmin(page);
		await openManageEvent(page, event.eventDateId);
		await expect(
			page.getByRole('tab', { name: 'Event Details' })
		).toHaveAttribute('aria-selected', 'true');
		for (const name of ['Prices', 'List', 'Groups']) {
			await expect(page.getByRole('tab', { name })).toHaveCount(0);
		}
	});

	test('Experimental off keeps base ticketing and hides only its extensions', async ({
		page,
		request,
		seedEvent,
	}) => {
		setCoreFeatures({ ticketing: true });
		setExperimentalFeatures({ ticketing: false });
		const event = seedEvent('paid');

		expect(await routeIsRegistered(request, CORE_TICKETS_ROUTE)).toBe(true);
		expect(await routeIsRegistered(request, GROUP_RULES_ROUTE)).toBe(false);

		await loginAsAdmin(page);
		await openManageEvent(page, event.eventDateId);
		await expect(page.getByRole('tab', { name: 'List' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Groups' })).toHaveCount(0);
		await saveBaseConfiguration(page);
	});

	test('base ticketing works with Experimental inactive', async ({
		page,
		request,
		seedEvent,
	}) => {
		setCoreFeatures({ ticketing: true });
		wpCli('plugin deactivate fair-events-experimental');
		const event = seedEvent('paid');

		expect(await routeIsRegistered(request, CORE_TICKETS_ROUTE)).toBe(true);
		expect(await routeIsRegistered(request, GROUP_RULES_ROUTE)).toBe(false);

		await loginAsAdmin(page);
		await openManageEvent(page, event.eventDateId);
		await expect(page.getByRole('tab', { name: 'List' })).toBeVisible();
		await saveBaseConfiguration(page);
	});
});
