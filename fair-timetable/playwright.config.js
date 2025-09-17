import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Playwright configuration for WordPress e2e tests and screenshots
 * In CI: Tests run against external WordPress instance (WP_BASE_URL env var)
 * Locally: Tests start Docker WordPress instance automatically
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
	testDir: './tests',
	/* Run tests in files in parallel */
	fullyParallel: false,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: 1,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: process.env.CI ? 'github' : 'line',
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8080',

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: 'on-first-retry',

		/* Take screenshot on failure */
		screenshot: 'only-on-failure',

		/* WordPress.org screenshot dimensions - full viewport */
		viewport: { width: 1200, height: 900 },
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	/* Configure local dev server for WordPress */
	webServer: process.env.CI
		? undefined
		: {
				command: 'docker compose up',
				url: 'http://localhost:8080',
				reuseExistingServer: !process.env.CI,
				timeout: 120 * 1000, // 2 minutes
			},
});
