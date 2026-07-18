/**
 * Screenshot e2e: the unified fair-events/event-signup block across three
 * plugin combinations, for manual visual review (#1185).
 *
 * The SAME `wp:fair-events/event-signup` block is placed on the page in every
 * combination — only the active-plugin set changes. The block is designed to
 * be usable always: with fair-audience inactive it renders its own anonymous
 * get-tickets form; with fair-audience active it delegates to
 * fair-audience/event-signup for the participant-aware flow (see
 * fair-events/src/blocks/event-signup/render.php). fair-audience-experimental
 * is deactivated in all three combos (it's active by default in
 * .wp-env.json). fair-payments-connector, fair-form, and fair-platform are
 * infrastructure and stay untouched throughout.
 *
 * Each combo seeds the same 'three-ticket-scopes' event (a 3-occurrence
 * recurring series with one ticket type per recurrence scope: single_instance,
 * whole_series, multiple_instances) at a fixed future date, so the three
 * screenshots are directly comparable and stable across runs.
 *
 * No behavioural assertions beyond "the render-gate selector is visible" —
 * pass = page renders + screenshot captured. Plugin toggling follows the
 * established in-instance pattern from user-flows/get-tickets-purchase.spec.js;
 * the single-worker serial Playwright run guarantees no cross-spec bleed.
 */

import path from 'node:path';
import { test, expect } from '../support/fixtures.js';
import { wpCli } from '../support/wp-cli.js';

const OUTPUT_DIR = path.join(process.cwd(), 'e2e/screenshots/output');

/** Reactivate the full default .wp-env.json plugin set. */
function restoreDefaultPlugins() {
	wpCli(
		'plugin activate fair-audience fair-audience-experimental fair-events-experimental'
	);
}

test.describe('Event Signup screenshots: fair-events only', () => {
	test.beforeAll(() => {
		wpCli(
			'plugin deactivate fair-audience fair-audience-experimental fair-events-experimental'
		);
	});

	test.afterAll(() => {
		restoreDefaultPlugins();
	});

	test('renders the anonymous get-tickets form', async ({
		page,
		seedEvent,
	}, testInfo) => {
		const event = seedEvent('three-ticket-scopes');

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const screenshotPath = path.join(
			OUTPUT_DIR,
			'signup-fair-events-only.png'
		);
		await page.screenshot({ path: screenshotPath });
		await testInfo.attach('signup-fair-events-only', {
			path: screenshotPath,
			contentType: 'image/png',
		});
	});
});

test.describe('Event Signup screenshots: fair-events + fair-audience', () => {
	test.beforeAll(() => {
		wpCli(
			'plugin deactivate fair-audience-experimental fair-events-experimental'
		);
		wpCli('plugin activate fair-audience');
	});

	test.afterAll(() => {
		restoreDefaultPlugins();
	});

	test('renders the participant-aware signup flow', async ({
		page,
		seedEvent,
	}, testInfo) => {
		const event = seedEvent('three-ticket-scopes');

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-event-signup');
		await expect(form).toBeVisible();

		const screenshotPath = path.join(
			OUTPUT_DIR,
			'signup-fair-events-audience.png'
		);
		await page.screenshot({ path: screenshotPath });
		await testInfo.attach('signup-fair-events-audience', {
			path: screenshotPath,
			contentType: 'image/png',
		});
	});
});

test.describe('Event Signup screenshots: fair-events + fair-audience + fair-events-experimental', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience-experimental');
		wpCli('plugin activate fair-audience fair-events-experimental');
	});

	test.afterAll(() => {
		restoreDefaultPlugins();
	});

	test('renders the participant-aware signup flow with the experimental layer active', async ({
		page,
		seedEvent,
	}, testInfo) => {
		const event = seedEvent('three-ticket-scopes');

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-event-signup');
		await expect(form).toBeVisible();

		const screenshotPath = path.join(
			OUTPUT_DIR,
			'signup-fair-events-audience-experimental.png'
		);
		await page.screenshot({ path: screenshotPath });
		await testInfo.attach('signup-fair-events-audience-experimental', {
			path: screenshotPath,
			contentType: 'image/png',
		});
	});
});
