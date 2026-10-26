import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	PHPUNIT,
	ROOT,
	parseArguments,
	phpSuiteWorkspaces,
	phpunitCommand,
	runPhpTests,
	selectWorkspaces,
} from '../php-test-runner.mjs';

const root = '/repo';
const suites = ['fair-payments-connector', 'fair-events', 'fair-finance'];

test('runs every PHP suite from the repository root', () => {
	assert.deepEqual(selectWorkspaces({ cwd: root, root, suites }), suites);
});

test('runs only the current workspace when started inside one', () => {
	assert.deepEqual(
		selectWorkspaces({
			cwd: path.join(root, 'fair-events', '__tests__'),
			root,
			suites,
		}),
		['fair-events']
	);
});

test('explicit --workspace selections win over the current directory', () => {
	assert.deepEqual(
		selectWorkspaces({
			requested: ['fair-finance', 'fair-events'],
			cwd: path.join(root, 'fair-payments-connector'),
			root,
			suites,
		}),
		['fair-finance', 'fair-events']
	);
});

test('refuses workspaces without a PHP suite', () => {
	assert.throws(
		() =>
			selectWorkspaces({
				requested: ['fair-form'],
				cwd: root,
				root,
				suites,
			}),
		/"fair-form" has no PHP suite/
	);
	assert.throws(
		() =>
			selectWorkspaces({
				cwd: path.join(root, 'fair-form'),
				root,
				suites,
			}),
		/"fair-form" has no PHP suite/
	);
});

test('forwards everything after the workspace options to PHPUnit', () => {
	assert.deepEqual(
		parseArguments(['--workspace=fair-events', '--', '--filter', 'Signup']),
		{ workspaces: ['fair-events'], forwarded: ['--filter', 'Signup'] }
	);
	// `npm run test:php -w fair-events -- --filter Signup` arrives without --.
	assert.deepEqual(parseArguments(['--filter', 'Signup']), {
		workspaces: [],
		forwarded: ['--filter', 'Signup'],
	});
	assert.deepEqual(parseArguments(['--filter', '--workspace=x']), {
		workspaces: [],
		forwarded: ['--filter', '--workspace=x'],
	});
});

test('runs the shared PHPUnit with the workspace configuration', () => {
	assert.deepEqual(
		phpunitCommand({ root, forwarded: ['--filter', 'X'], env: {} }),
		{
			command: 'php',
			args: [
				path.join(root, PHPUNIT),
				'--configuration',
				'phpunit.xml',
				'--filter',
				'X',
			],
		}
	);
	assert.equal(
		phpunitCommand({ root, env: { PHP_BINARY: '/opt/php84/bin/php' } })
			.command,
		'/opt/php84/bin/php'
	);
});

test('discovers the repository PHP suites in workspace order', () => {
	assert.deepEqual(phpSuiteWorkspaces(ROOT), [
		'fair-payments-connector',
		'fair-events',
		'fair-platform',
		'fair-audience',
		'fair-timetable',
		'fair-finance',
		'fair-events-experimental',
		'fair-payments-connector-experimental',
		'fair-form',
	]);
});

/**
 * A repository whose "PHPUnit" is a Node script failing inside `failing`,
 * run through PHP_BINARY so no PHP is needed.
 */
async function withFakeSuites(workspaces, callback) {
	const fakeRoot = mkdtempSync(path.join(tmpdir(), 'php-test-runner-'));
	const write = (relative, contents) => {
		const full = path.join(fakeRoot, relative);
		mkdirSync(path.dirname(full), { recursive: true });
		writeFileSync(full, contents);
	};
	try {
		write(
			'package.json',
			JSON.stringify({ workspaces: Object.keys(workspaces) })
		);
		write(
			PHPUNIT,
			"process.exit(require('node:path').basename(process.cwd()) === 'failing' ? 1 : 0);\n"
		);
		for (const [workspace, { autoload = true }] of Object.entries(
			workspaces
		)) {
			write(path.join(workspace, 'phpunit.xml'), '<phpunit/>');
			if (autoload) {
				write(path.join(workspace, 'vendor', 'autoload.php'), '<?php');
			}
		}
		return await callback(fakeRoot);
	} finally {
		rmSync(fakeRoot, { recursive: true, force: true });
	}
}

async function runQuietly(t, fakeRoot) {
	const log = t.mock.method(console, 'log', () => {});
	const error = t.mock.method(console, 'error', () => {});
	const code = await runPhpTests([], {
		cwd: fakeRoot,
		root: fakeRoot,
		env: { PHP_BINARY: process.execPath },
	});
	const output = [...log.mock.calls, ...error.mock.calls]
		.map((call) => call.arguments.join(' '))
		.join('\n');
	return { code, output };
}

test('a failing suite fails the run and is named, later suites still run', async (t) => {
	await withFakeSuites(
		{ passing: {}, failing: {}, later: {} },
		async (fakeRoot) => {
			const { code, output } = await runQuietly(t, fakeRoot);
			assert.equal(code, 1);
			assert.match(output, /▶ later/);
			assert.match(output, /PHP suites failed: failing$/m);
		}
	);
});

test('a suite without its autoloader counts as failed', async (t) => {
	await withFakeSuites(
		{ passing: {}, unprepared: { autoload: false } },
		async (fakeRoot) => {
			const { code, output } = await runQuietly(t, fakeRoot);
			assert.equal(code, 1);
			assert.match(
				output,
				/unprepared: vendor\/autoload\.php is missing/
			);
			assert.match(output, /PHP suites failed: unprepared$/m);
		}
	);
});

test('all suites passing exits cleanly', async (t) => {
	await withFakeSuites({ passing: {}, later: {} }, async (fakeRoot) => {
		const { code, output } = await runQuietly(t, fakeRoot);
		assert.equal(code, 0);
		assert.match(output, /PHP suites passed: passing, later/);
	});
});
