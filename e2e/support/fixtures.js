/**
 * Playwright fixtures for the E2E specs.
 *
 * Exposes `seedEvent(flavour, overrides)` — a thin wrapper over the
 * seed-event.php factory that records what it created and tears it down after
 * each test (deleting the event + child rows by id, and resetting captured
 * mail). Each call returns a fresh, isolated event, so specs run in any order,
 * any number of times, without colliding or accumulating data.
 *
 * Usage:
 *   import { test, expect } from '../support/fixtures.js';
 *   test('…', async ({ page, seedEvent }) => {
 *     const event = seedEvent('paid-with-options', { options: ['dinner'] });
 *     await page.goto(event.pageUrl);
 *   });
 */

import { test as base, expect } from '@playwright/test';
import { runScript, resetCapturedMail } from './wp-cli.js';

export const test = base.extend({
	/**
	 * Test-scoped event seeder with automatic cleanup.
	 *
	 * @param {object}   _        Unused fixtures bag.
	 * @param {Function} use      Playwright fixture callback.
	 */
	seedEvent: async ({}, use) => {
		const seeded = [];

		/**
		 * Seed a fresh event in the given flavour and return its parsed
		 * E2E_SEED payload (pageUrl + ids).
		 *
		 * @param {string} flavour   Preset: free | paid | paid-with-options | capacity-1.
		 * @param {object} overrides Optional JSON overrides (e.g. { price, options }).
		 * @return {object} Parsed E2E_SEED payload.
		 */
		const seedEvent = (flavour = 'paid', overrides = {}) => {
			const hasOverrides = overrides && Object.keys(overrides).length > 0;
			const args = hasOverrides
				? `${flavour} '${JSON.stringify(overrides)}'`
				: flavour;
			const event = runScript('seed-event.php', 'E2E_SEED', args);
			seeded.push(event);
			return event;
		};

		await use(seedEvent);

		// Per-test teardown: delete every seeded event by id, then clear mail.
		for (const event of seeded) {
			runScript(
				'cleanup-event.php',
				'E2E_CLEANUP',
				`${event.eventId} ${event.eventDateId}`
			);
		}
		resetCapturedMail();
	},
});

export { expect };
