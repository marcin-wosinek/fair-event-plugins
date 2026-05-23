import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Root-level Playwright config for the isolated E2E harness.
 *
 * Tests run against the `tests` instance booted by `@wordpress/env`, which
 * listens on port 8889 by default — separate from the dev `docker compose`
 * stack on 8080. Boot it with `npm run test:e2e:setup` before running.
 *
 * This config is E2E-only; per-plugin API tests keep their own
 * `playwright.config.js` (e.g. fair-audience).
 */
export default defineConfig( {
	testDir: './e2e',
	testMatch: [ '**/*.spec.js' ],

	fullyParallel: false,
	forbidOnly: !! process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? [ [ 'github' ], [ 'html' ] ] : 'html',

	timeout: 60 * 1000,
	expect: { timeout: 10 * 1000 },

	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8889',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		viewport: { width: 1200, height: 900 },
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices[ 'Desktop Chrome' ] },
		},
	],
} );
