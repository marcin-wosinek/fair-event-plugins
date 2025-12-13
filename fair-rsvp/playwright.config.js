import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
	testDir: './',
	testMatch: ['e2e/**/*.spec.js', 'src/API/__tests__/**/*.api.spec.js'],

	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'line',

	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8080',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		viewport: { width: 1200, height: 900 },
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	webServer: process.env.CI
		? undefined
		: {
				command: 'docker compose up',
				url: 'http://localhost:8080',
				reuseExistingServer: true,
				timeout: 120 * 1000,
			},
});
