import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
	PHPUNIT,
	ROOT,
	parseArguments,
	phpSuiteWorkspaces,
	phpunitCommand,
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
	]);
});
