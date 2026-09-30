import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseArgs,
	resolveGithubTarget,
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

test('validateUploadOptions requires --issue or --pr for the github target', () => {
	const message = validateUploadOptions({
		upload: 'github',
		issue: null,
		pr: null,
	});

	assert.match(message, /--issue <number>.*--pr <number>/);
});

test('validateUploadOptions accepts the github target with a PR number', () => {
	assert.equal(
		validateUploadOptions({ upload: 'github', issue: null, pr: '20' }),
		null
	);
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

test('parseArgs captures --pr and --branch', () => {
	const { opts } = parseArgs(['--pr', '20', '--branch', 'feature-12']);

	assert.equal(opts.pr, '20');
	assert.equal(opts.branch, 'feature-12');
});

test('resolveGithubTarget uses an explicit --pr without looking up the branch', () => {
	const target = resolveGithubTarget(
		{ pr: '20', issue: '12' },
		{
			currentBranch: 'main',
			findPr: () => assert.fail('no lookup needed'),
		}
	);

	assert.deepEqual(target, { kind: 'pr', pr: '20' });
});

test('resolveGithubTarget attaches to the open PR for the branch once it exists', () => {
	const target = resolveGithubTarget(
		{ issue: '12' },
		{
			currentBranch: 'feature-12',
			findPr: (branch) => (branch === 'feature-12' ? 20 : null),
		}
	);

	assert.deepEqual(target, { kind: 'pr', pr: '20' });
});

test('resolveGithubTarget falls back to the issue before the PR exists', () => {
	const target = resolveGithubTarget(
		{ issue: '12' },
		{ currentBranch: 'feature-12', findPr: () => null }
	);

	assert.deepEqual(target, {
		kind: 'issue',
		issue: '12',
		branch: 'feature-12',
	});
});

test('resolveGithubTarget records --branch instead of the checked-out branch', () => {
	const target = resolveGithubTarget(
		{ issue: '12', branch: 'followup-12' },
		{ currentBranch: 'main', findPr: () => null }
	);

	assert.equal(target.branch, 'followup-12');
});

test('resolveGithubTarget refuses main and detached HEAD', () => {
	for (const currentBranch of ['main', 'HEAD']) {
		assert.throws(
			() =>
				resolveGithubTarget(
					{ issue: '12' },
					{ currentBranch, findPr: () => null }
				),
			/needs an implementation branch/
		);
	}
});

test('resolveGithubTarget asks for --issue when the branch has no PR yet', () => {
	assert.throws(
		() =>
			resolveGithubTarget(
				{},
				{ currentBranch: 'feature-12', findPr: () => null }
			),
		/has no open PR yet; pass --issue/
	);
});
