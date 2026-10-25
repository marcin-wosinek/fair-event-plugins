/**
 * Fair Audience Experimental feature-flag registry (#1041).
 *
 * Mirrors `fair-events-feature-flags.spec.js`: two branches of the same
 * companion plugin —
 *   - all bundles off — only the Settings page is reachable.
 *   - all bundles on — every migrated bundle's admin page mounts and its
 *     REST routes register.
 *
 * `manage-event-ext` is intentionally not probed here: it has no standalone
 * admin page — it only mounts a tab inside fair-events' manage-event screen,
 * which needs an event fixture. It is exercised by the manual smoke checks
 * instead (TESTING.md).
 *
 * Custom Mail is not a bundle page any more (#1784): Fair Audience owns its
 * page and routes, so both stay available with every bundle off. The
 * `messaging` bundle only adds the all-audience choice there.
 *
 * The removed Weekly Schedule bundle (#1809) has its own block: its menu
 * entry, settings toggle and bookmarked page stay absent, whatever a stale
 * option, a filter or a constant says. The removed Image Templates bundle
 * (#1985) gets the same coverage, plus its REST routes being gone and its
 * media and template metadata being left intact.
 *
 * Run: `npm run test:e2e -- fair-audience-experimental-feature-flags`.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
	ADMIN_USER,
	ADMIN_PASSWORD,
	wpCli,
	loginAsAdmin,
	runScript,
} from './support/wp-cli.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';

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
	instagram: true,
	groups: true,
	collaborators: true,
	messaging: true,
	timeline: true,
	import: true,
	invitations: true,
	'manage-event-ext': true,
};

const ALL_BUNDLES_OFF = {
	fees: false,
	polls: false,
	instagram: false,
	groups: false,
	collaborators: false,
	messaging: false,
	timeline: false,
	import: false,
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
	timeline: '/fair-audience/v1/timeline',
	import: '/fair-audience/v1/import/entradium',
	groups: '/fair-audience/v1/groups',
	messaging: '/fair-audience/v1/extra-messages',
	invitations: '/fair-audience/v1/event-dates/1/event-invitations',
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

	test('Custom Mail stays in Fair Audience, limited to event emails', async ({
		page,
		request,
	}) => {
		await loginAsAdmin(page);
		await expectRootMounts(
			page,
			'fair-audience-custom-mail',
			'fair-audience-custom-mail-root'
		);
		await expect(
			page
				.getByRole('combobox', { name: 'Event' })
				.locator('option', { hasText: 'All audience' })
		).toHaveCount(0);

		expect(
			await routeIsRegistered(request, '/fair-audience/v1/custom-mail')
		).toBe(true);
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

	test('Custom Mail mounts once and offers the all-audience choice', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await expectRootMounts(
			page,
			'fair-audience-custom-mail',
			'fair-audience-custom-mail-root'
		);
		await expect(
			page.locator(
				'#adminmenu a[href="admin.php?page=fair-audience-custom-mail"]'
			)
		).toHaveCount(1);
		await expect(
			page
				.getByRole('combobox', { name: 'Event' })
				.locator('option', { hasText: 'All audience' })
		).toHaveCount(1);
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

test.describe('Fair Audience Experimental — removed Weekly Schedule', () => {
	const SLUG = 'fair-audience-weekly-schedule';
	const state = (mode) =>
		runScript(
			'retired-experimental-bundle-state.php',
			'E2E_STATE',
			`weekly-schedule ${mode}`
		);

	test.afterAll(() => {
		clearExperimentalFeatures();
	});

	test('a stale enabled option does not bring it back', async ({ page }) => {
		// A site that had the bundle on keeps the key in its stored option.
		const seeded = state('seed');
		expect(seeded.stored['weekly-schedule']).toBe(true);
		expect(seeded.enabled).toBe(false);
		expect(seeded.inSnapshot).toBe(false);

		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-audience-experimental-settings'
		);
		// Another bundle's toggle and menu entry prove both lists rendered.
		await expect(page.getByLabel('Timeline', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Weekly schedule')).toHaveCount(0);
		await expect(
			page.locator('#adminmenu a[href*="fair-audience-timeline"]')
		).toHaveCount(1);
		await expect(page.locator(`#adminmenu a[href*="${SLUG}"]`)).toHaveCount(
			0
		);

		// The bookmarked page gets WordPress's answer for an unregistered page.
		const response = await page.goto(`/wp-admin/admin.php?page=${SLUG}`);
		expect(response.status()).toBe(403);
		await expect(page.locator(`#${SLUG}-root`)).toHaveCount(0);
		await expect(
			page.getByRole('heading', { name: 'Weekly Schedule' })
		).toHaveCount(0);
	});

	test('a constant and a filter cannot revive it', () => {
		const revived = state('revive');
		expect(revived.enabled).toBe(false);
		expect(revived.forced).toBe(false);
		expect(revived.inSnapshot).toBe(false);
	});

	test('saving settings discards the obsolete key and keeps the rest', () => {
		state('seed');
		const resaved = state('resave');
		expect(resaved.stored).not.toHaveProperty('weekly-schedule');
		expect(resaved.stored.fees).toBe(true);
		expect(resaved.stored.timeline).toBe(true);
	});
});

test.describe('Fair Audience Experimental — removed Image Templates', () => {
	test.describe.configure({ mode: 'serial' });

	const SLUG = 'fair-audience-image-templates';
	const ROUTES = [
		['GET', '/fair-audience/v1/image-templates'],
		['POST', '/fair-audience/v1/image-templates'],
		['DELETE', '/fair-audience/v1/image-templates/1'],
		['POST', '/fair-audience/v1/image-templates/1/render'],
	];
	const state = (mode) =>
		runScript(
			'retired-experimental-bundle-state.php',
			'E2E_STATE',
			`image-templates ${mode}`
		);
	const media = (mode, ids = []) =>
		runScript(
			'retired-image-templates-media.php',
			'E2E_MEDIA',
			[mode, ...ids].join(' ')
		);

	let api;
	let mediaIds = [];

	test.beforeAll(async () => {
		// Authenticated as an administrator, so a still-registered route would
		// answer instead of failing its permission check.
		api = await playwrightRequest.newContext({
			baseURL: BASE_URL,
			extraHTTPHeaders: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
	});

	test.afterAll(async () => {
		if (mediaIds.length) {
			media('cleanup', mediaIds);
		}
		clearExperimentalFeatures();
		await api?.dispose();
	});

	test('a stale enabled option does not bring it back', async ({ page }) => {
		const seeded = state('seed');
		expect(seeded.stored['image-templates']).toBe(true);
		expect(seeded.enabled).toBe(false);
		expect(seeded.inSnapshot).toBe(false);

		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-audience-experimental-settings'
		);
		// Another bundle's toggle and menu entry prove both lists rendered.
		await expect(page.getByLabel('Timeline', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Image templates')).toHaveCount(0);
		await expect(
			page.locator('#adminmenu a[href*="fair-audience-timeline"]')
		).toHaveCount(1);
		await expect(page.locator(`#adminmenu a[href*="${SLUG}"]`)).toHaveCount(
			0
		);

		// The bookmarked page gets WordPress's answer for an unregistered page.
		const response = await page.goto(`/wp-admin/admin.php?page=${SLUG}`);
		expect(response.status()).toBe(403);
		await expect(page.locator(`#${SLUG}-root`)).toHaveCount(0);
		await expect(
			page.getByRole('heading', { name: 'Image Templates' })
		).toHaveCount(0);
	});

	test('a constant and a filter cannot revive it', () => {
		const revived = state('revive');
		expect(revived.enabled).toBe(false);
		expect(revived.forced).toBe(false);
		expect(revived.inSnapshot).toBe(false);
	});

	test('saving settings discards the obsolete key and keeps the rest', () => {
		state('seed');
		const resaved = state('resave');
		expect(resaved.stored).not.toHaveProperty('image-templates');
		expect(resaved.stored.fees).toBe(true);
		expect(resaved.stored.timeline).toBe(true);
	});

	test('every removed route and method answers rest_no_route', async () => {
		for (const [method, path] of ROUTES) {
			const response = await api.fetch(`/wp-json${path}`, { method });
			expect(response.status(), `${method} ${path}`).toBe(404);
			expect((await response.json()).code, `${method} ${path}`).toBe(
				'rest_no_route'
			);
		}
	});

	test('template media and metadata are left intact', async () => {
		const seeded = media('seed');
		mediaIds = seeded.media.map(({ id }) => id);
		const [templateId] = mediaIds;

		// The old "remove template" call must not reach anything.
		const response = await api.delete(
			`/wp-json/fair-audience/v1/image-templates/${templateId}`
		);
		expect(response.status()).toBe(404);

		const { media: after, expectedVariables, expectedImages } = media(
			'check',
			mediaIds
		);
		for (const item of after) {
			expect(item.exists, `attachment ${item.id}`).toBe(true);
			expect(item.fileExists, `file of attachment ${item.id}`).toBe(true);
		}
		const [template, generated] = after;
		expect(template.isTemplate).toBe('1');
		expect(template.variables).toEqual(expectedVariables);
		expect(template.images).toEqual(expectedImages);
		expect(generated.isTemplate).toBe('');
	});
});
