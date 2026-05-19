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
	reporter: 'html',
	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8080',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'docker compose up',
		url: 'http://localhost:8080',
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000,
	},
});
