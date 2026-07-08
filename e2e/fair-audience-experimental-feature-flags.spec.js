/**
 * Fair Audience Experimental feature-flag registry (#1041).
 *
 * Mirrors `fair-events-feature-flags.spec.js`: two branches of the same
 * companion plugin —
 *   - all bundles off — only the Settings page is reachable.
 *   - all bundles on — every migrated bundle's admin page mounts and its
 *     REST routes register.
 *
 * `weekly-schedule` and `manage-event-ext` are intentionally not probed here:
 * `weekly-schedule` has no REST routes of its own (it reads fair-events'
 * event-dates routes), and `manage-event-ext` has no standalone admin page —
 * it only mounts a tab inside fair-events' manage-event screen, which needs
 * an event fixture. Both are exercised by the manual smoke checks instead
 * (TESTING.md).
 *
 * Run: `npm run test:e2e -- fair-audience-experimental-feature-flags`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

/** Set the `fair_audience_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(
		`option update fair_audience_experimental_features '${json}' --format=json`
	);
}

/** Clear the experimental features option — restores all-on defaults. */
function clearExperimentalFeatures() {
	wpCli('option delete fair_audience_experimental_features');
}

/** Bundle keys mirror FairAudienceExperimental\\Core\\Features::registry(). */
const ALL_BUNDLES_ON = {
	fees: true,
	polls: true,
	galleries: true,
	instagram: true,
	groups: true,
	collaborators: true,
	messaging: true,
	'image-templates': true,
	timeline: true,
	import: true,
	'weekly-schedule': true,
	invitations: true,
	'manage-event-ext': true,
};

const ALL_BUNDLES_OFF = {
	fees: false,
	polls: false,
	galleries: false,
	instagram: false,
	groups: false,
	collaborators: false,
	messaging: false,
	'image-templates': false,
	timeline: false,
	import: false,
	'weekly-schedule': false,
	invitations: false,
	'manage-event-ext': false,
};

/**
 * Bundle → admin page slug + React root id, for bundles with a standalone
 * top-level admin page.
 */
const BUNDLE_PAGES = {
	fees: [
		{ slug: 'fair-audience-fees', root: 'fair-audience-fees-list-root' },
	],
	polls: [{ slug: 'fair-audience-polls', root: 'fair-audience-polls-root' }],
	instagram: [
		{
			slug: 'fair-audience-instagram-posts',
			root: 'fair-audience-instagram-posts-root',
		},
	],
	collaborators: [
		{
			slug: 'fair-audience-collaborators',
			root: 'fair-audience-collaborators-root',
		},
	],
	'image-templates': [
		{
			slug: 'fair-audience-image-templates',
			root: 'fair-audience-image-templates-root',
		},
	],
	timeline: [
		{ slug: 'fair-audience-timeline', root: 'fair-audience-timeline-root' },
	],
	import: [
		{ slug: 'fair-audience-import', root: 'fair-audience-import-root' },
	],
	groups: [
		{ slug: 'fair-audience-groups', root: 'fair-audience-groups-root' },
	],
	messaging: [
		{
			slug: 'fair-audience-custom-mail',
			root: 'fair-audience-custom-mail-root',
		},
		{
			slug: 'fair-audience-extra-messages',
			root: 'fair-audience-extra-messages-root',
		},
	],
};

/**
 * Bundle → a representative REST route. Probed with GET; a registered route
 * returns *anything* other than `rest_no_route` (401/403/404 for missing
 * resource still count as "registered").
 */
const BUNDLE_PROBE_ROUTES = {
	fees: '/fair-audience/v1/fees',
	polls: '/fair-audience/v1/polls',
	instagram: '/fair-audience/v1/instagram/posts',
	collaborators: '/fair-audience/v1/collaborators',
	'image-templates': '/fair-audience/v1/image-templates',
	timeline: '/fair-audience/v1/timeline',
	import: '/fair-audience/v1/import/entradium',
	groups: '/fair-audience/v1/groups',
	messaging: '/fair-audience/v1/custom-mail',
	invitations: '/fair-audience/v1/event-dates/1/event-invitations',
	galleries: '/fair-audience/v1/gallery-access/validate',
};

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
		.locator('[id^="fair-audience-"][id$="-root"]')
		.count();
	expect(
		rootCount,
		`${slug}: should not mount a Fair Audience Experimental React root when its bundle is off`
	).toBe(0);
}

/**
 * True iff WordPress has a route matching `path`, regardless of which HTTP
 * methods it accepts. A plain GET can't tell a registered POST-only route
 * (e.g. `/import/entradium`) apart from a genuinely unregistered one — both
 * return 404 `rest_no_route`. OPTIONS instead reports the route's schema
 * (`{ namespace, methods, endpoints, ... }`) for any registered route and an
 * empty array for an unregistered one, independent of the methods it allows.
 */
async function routeIsRegistered(request, path) {
	const response = await request.fetch(`/wp-json${path}`, {
		method: 'OPTIONS',
	});
	const body = await response.json();
	return !Array.isArray(body);
}

test.describe('Fair Audience Experimental — all bundles off', () => {
	test.beforeAll(() => {
		setExperimentalFeatures(ALL_BUNDLES_OFF);
	});

	test.afterAll(() => {
		clearExperimentalFeatures();
	});

	test('only the Settings page mounts; bundle pages are gone', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		await expectRootMounts(
			page,
			'fair-audience-experimental-settings',
			'fair-audience-experimental-settings-root'
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
				`${bundle}: ${path} should be unregistered when its bundle is off`
			).toBe(false);
		}
	});

	test('Settings page is reachable with every bundle off', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-audience-experimental-settings'
		);
		await expect(
			page.getByRole('heading', {
				name: 'Fair Audience Experimental Settings',
			})
		).toBeVisible();
	});
});

test.describe('Fair Audience Experimental — all bundles on', () => {
	test.beforeAll(() => {
		setExperimentalFeatures(ALL_BUNDLES_ON);
	});

	test.afterAll(() => {
		// Leave the suite in the all-on default so other suites (which assume
		// the full feature set is available) inherit a clean baseline.
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
				`${bundle}: ${path} should be registered when its bundle is on`
			).toBe(true);
		}
	});

	test('Settings page still mounts with every bundle on', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-audience-experimental-settings'
		);
		await expect(
			page.getByRole('heading', {
				name: 'Fair Audience Experimental Settings',
			})
		).toBeVisible();
	});
});
