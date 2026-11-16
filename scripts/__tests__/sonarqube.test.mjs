import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../duplication.mjs';
import {
	PROPERTIES_FILE,
	check,
	discoverSourceRoots,
	generate,
} from '../sonarqube.mjs';

function withRepo(workspaces, files, callback) {
	const root = mkdtempSync(path.join(tmpdir(), 'sonarqube-'));
	try {
		writeFileSync(
			path.join(root, 'package.json'),
			JSON.stringify({ workspaces })
		);
		for (const workspace of workspaces) {
			mkdirSync(path.join(root, workspace), { recursive: true });
		}
		for (const [relative, contents] of Object.entries(files)) {
			const full = path.join(root, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, contents);
		}
		return callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function property(text, key) {
	const match = new RegExp(
		`^${key.replace('.', '\\.')}=\\\\\\n((?:    .*\\n)+)`,
		'm'
	).exec(text);
	assert.ok(match, `${key} is a multi-line list`);
	return match[1]
		.split('\n')
		.filter(Boolean)
		.map((line) => line.trim().replace(/,\\$/, ''));
}

test('source roots cover bootstrap PHP and existing source directories only', () => {
	withRepo(
		['plugin-a', 'shared'],
		{
			'plugin-a/plugin-a.php': '<?php',
			'plugin-a/readme.txt': '',
			'plugin-a/src/index.js': '',
			'plugin-a/templates/page.php': '<?php',
			'plugin-a/build/index.js': '',
			'plugin-a/tests/Test.php': '<?php',
			'shared/php/src/Helper.php': '<?php',
			'shared/src/index.js': '',
		},
		(root) => {
			assert.deepEqual(
				discoverSourceRoots(root, ['plugin-a', 'shared']),
				[
					'plugin-a/plugin-a.php',
					'plugin-a/src',
					'plugin-a/templates',
					'shared/php/src',
					'shared/src',
				]
			);
		}
	);
});

test('a listed workspace that does not exist is an error', () => {
	withRepo(['plugin-a'], {}, (root) => {
		assert.throws(
			() => discoverSourceRoots(root, ['plugin-a', 'missing']),
			/Workspace directory not found: missing/
		);
	});
});

test('generated properties exclude dependencies, output and tests', () => {
	withRepo(['plugin-a'], { 'plugin-a/src/a.js': '' }, (root) => {
		const text = generate(root);
		assert.deepEqual(property(text, 'sonar.sources'), ['plugin-a/src']);
		const exclusions = property(text, 'sonar.exclusions');
		for (const pattern of [
			'**/node_modules/**',
			'**/vendor/**',
			'**/build/**',
			'**/svn/**',
			'**/languages/**',
			'**/__tests__/**',
			'**/__mocks__/**',
			'**/fixtures/**',
			'**/playwright-report/**',
			'**/*.test.js',
			'**/*.spec.jsx',
			'**/*.asset.php',
			'**/*.min.js',
		]) {
			assert.ok(exclusions.includes(pattern), `excludes ${pattern}`);
		}
		assert.deepEqual(property(text, 'sonar.inclusions'), [
			'**/*.js',
			'**/*.jsx',
			'**/*.mjs',
			'**/*.cjs',
			'**/*.php',
		]);
		assert.match(
			text,
			/^sonar\.javascript\.file\.suffixes=\.js,\.jsx,\.mjs,\.cjs$/m
		);
		assert.doesNotMatch(
			text,
			/sonar\.(organization|projectKey|login|token)/
		);
	});
});

test('check reports a missing or stale file and accepts a fresh one', () => {
	withRepo(['plugin-a'], { 'plugin-a/src/a.js': '' }, (root) => {
		assert.match(check(root), /is missing/);
		writeFileSync(path.join(root, PROPERTIES_FILE), generate(root));
		assert.equal(check(root), null);
		writeFileSync(path.join(root, 'plugin-a/plugin-a.php'), '<?php');
		assert.match(check(root), /out of date/);
	});
});

test('the committed sonar-project.properties covers every workspace', () => {
	assert.equal(check(ROOT), null);
});
