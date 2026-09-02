import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveScreenshotConfig } from '../screenshot.js';

test('screenshot config defaults to the regular Docker development site', () => {
	assert.deepEqual(resolveScreenshotConfig({}), {
		baseUrl: 'http://localhost:8080',
		adminUser: 'admin',
		adminPassword: 'password',
	});
});

test('dedicated screenshot variables take precedence over test variables', () => {
	assert.deepEqual(
		resolveScreenshotConfig({
			WP_SCREENSHOT_BASE_URL: 'http://screenshots.test',
			WP_SCREENSHOT_USER: 'visual-user',
			WP_SCREENSHOT_PASSWORD: 'visual-password',
			WP_BASE_URL: 'http://api.test',
			WP_ADMIN_USER: 'api-user',
			WP_ADMIN_PASSWORD: 'api-password',
		}),
		{
			baseUrl: 'http://screenshots.test',
			adminUser: 'visual-user',
			adminPassword: 'visual-password',
		}
	);
});

test('legacy test variables remain supported as fallbacks', () => {
	assert.deepEqual(
		resolveScreenshotConfig({
			WP_BASE_URL: 'http://legacy.test',
			WP_ADMIN_USER: 'legacy-user',
			WP_ADMIN_PASSWORD: 'legacy-password',
		}),
		{
			baseUrl: 'http://legacy.test',
			adminUser: 'legacy-user',
			adminPassword: 'legacy-password',
		}
	);
});
