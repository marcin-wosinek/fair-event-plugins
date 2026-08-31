import assert from 'node:assert/strict';
import test from 'node:test';

import {
	formatterFor,
	isGeneratedPath,
	normalizeRepositoryPaths,
	parseHookPaths,
} from '../agent-hook.mjs';

test('parses a Claude single-file payload', () => {
	assert.deepEqual(
		parseHookPaths(
			'claude',
			{ tool_input: { file_path: '/repo/src/a.js' } },
			'guard'
		),
		['/repo/src/a.js']
	);
});

test('parses every Codex patch path needed by each action', () => {
	const payload = {
		tool_input: {
			command:
				'*** Begin Patch\n*** Add File: src/a.js\n*** Update File: src/b.php\n*** Delete File: src/c.css\n*** End Patch',
		},
	};
	assert.deepEqual(parseHookPaths('codex', payload, 'guard'), [
		'src/a.js',
		'src/b.php',
		'src/c.css',
	]);
	assert.deepEqual(parseHookPaths('codex', payload, 'format'), [
		'src/a.js',
		'src/b.php',
	]);
});

test('normalizes repository paths and ignores outside paths', () => {
	assert.deepEqual(
		normalizeRepositoryPaths('/repo', ['src/a.js', '../secret', '/tmp/a']),
		['/repo/src/a.js']
	);
});

test('recognizes generated path segments', () => {
	assert.equal(isGeneratedPath('/repo', '/repo/plugin/build/a.js'), true);
	assert.equal(isGeneratedPath('/repo', '/repo/src/building/a.js'), false);
});

test('selects supported formatters and ignores other extensions', () => {
	assert.equal(formatterFor('/repo/a.jsx')[0], 'npx');
	assert.equal(formatterFor('/repo/a.scss')[0], 'npx');
	assert.equal(formatterFor('/repo/a.php')[0], 'vendor/bin/phpcbf');
	assert.equal(formatterFor('/repo/a.md'), null);
});
