import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseArgs,
	resolveScreenshotConfig,
	validateUploadOptions,
} from '../screenshot.js';

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

test('parseArgs captures --issue alongside --upload', () => {
	const { opts } = parseArgs(['--upload', 'github', '--issue', '1554']);

	assert.equal(opts.upload, 'github');
	assert.equal(opts.issue, '1554');
});

test('parseArgs defaults --issue to null', () => {
	const { opts } = parseArgs([]);

	assert.equal(opts.issue, null);
});

test('validateUploadOptions rejects an unknown upload target', () => {
	const message = validateUploadOptions({ upload: 'dropbox', issue: null });

	assert.match(message, /unknown --upload target "dropbox"/);
});

test('validateUploadOptions requires --issue for the github target', () => {
	const message = validateUploadOptions({ upload: 'github', issue: null });

	assert.match(message, /--issue <number>/);
});

test('validateUploadOptions accepts the github target with an issue number', () => {
	assert.equal(
		validateUploadOptions({ upload: 'github', issue: '1554' }),
		null
	);
});

test('validateUploadOptions accepts imgbb without an issue number', () => {
	assert.equal(validateUploadOptions({ upload: 'imgbb', issue: null }), null);
});

test('validateUploadOptions accepts no upload target at all', () => {
	assert.equal(validateUploadOptions({ upload: null, issue: null }), null);
});
