import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	ROOT,
	RUNNER_SCRIPT,
	checkDeclarations,
	constraintMinimum,
	headerValue,
	minimums,
	shippedPhpFiles,
} from '../php-compat.mjs';

const POLICY = {
	'fair-plugin': { minimum: '8.0' },
	'fair-shared': { minimum: '7.4', dir: 'fair-shared/php', plugin: false },
};

function consistentFiles() {
	return {
		'package.json': { workspaces: ['fair-plugin', 'fair-shared'] },
		'fair-plugin/package.json': { scripts: { 'test:php': RUNNER_SCRIPT } },
		'fair-plugin/phpunit.xml': '<phpunit/>',
		'fair-plugin/composer.json': {
			require: { php: '>=8.0 <9.0' },
			config: { platform: { php: '8.0' } },
		},
		'fair-plugin/fair-plugin.php':
			'<?php\n/**\n * Plugin Name: Fair Plugin\n * Requires PHP: 8.0\n */\n',
		'fair-plugin/readme.txt': '=== Fair Plugin ===\nRequires PHP: 8.0\n',
		'fair-shared/package.json': { scripts: {} },
		'fair-shared/php/composer.json': { require: { php: '>=7.4 <9.0' } },
	};
}

function withRepo(files, callback) {
	const root = mkdtempSync(path.join(tmpdir(), 'php-compat-'));
	try {
		for (const [relative, contents] of Object.entries(files)) {
			if (contents === undefined) {
				continue;
			}
			const full = path.join(root, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(
				full,
				typeof contents === 'string'
					? contents
					: JSON.stringify(contents, null, '\t')
			);
		}
		return callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function problems(overrides) {
	return withRepo({ ...consistentFiles(), ...overrides }, (root) =>
		checkDeclarations(root, POLICY)
	);
}

test('reads the lower bound of Composer PHP constraints', () => {
	assert.equal(constraintMinimum('^8.2'), '8.2');
	assert.equal(constraintMinimum('>=7.4 <9.0'), '7.4');
	assert.equal(constraintMinimum('~8.0'), '8.0');
	assert.equal(constraintMinimum(undefined), null);
});

test('reads plugin header and readme fields', () => {
	assert.equal(headerValue(' * Requires PHP: 8.2\n', 'Requires PHP'), '8.2');
	assert.equal(headerValue('Requires PHP: 7.4 \n', 'Requires PHP'), '7.4');
	assert.equal(headerValue('Requires at least: 6.0', 'Requires PHP'), null);
});

test('lists each policy minimum once', () => {
	assert.deepEqual(minimums(POLICY), ['7.4', '8.0']);
});

test('accepts consistent declarations', () => {
	assert.deepEqual(problems({}), []);
});

test('reports a Composer requirement that disagrees with the policy', () => {
	assert.deepEqual(
		problems({
			'fair-plugin/composer.json': {
				require: { php: '^8.2' },
				config: { platform: { php: '8.0' } },
			},
		}),
		['fair-plugin/composer.json: require.php "^8.2" should start at 8.0.']
	);
});

test('reports a resolution platform other than the minimum', () => {
	assert.deepEqual(
		problems({
			'fair-plugin/composer.json': {
				require: { php: '>=8.0 <9.0' },
				config: { platform: { php: '8.3' } },
			},
		}),
		[
			'fair-plugin/composer.json: config.platform.php is "8.3", expected "8.0".',
		]
	);
});

test('reports plugin header and readme mismatches', () => {
	assert.deepEqual(
		problems({
			'fair-plugin/fair-plugin.php':
				'<?php\n/**\n * Requires PHP: 7.4\n */\n',
			'fair-plugin/readme.txt': '=== Fair Plugin ===\n',
		}),
		[
			'fair-plugin/fair-plugin.php: "Requires PHP: 7.4" should be 8.0.',
			'fair-plugin/readme.txt: "Requires PHP: null" should be 8.0.',
		]
	);
});

test('keeps PHPUnit out of workspace dependencies', () => {
	assert.deepEqual(
		problems({
			'fair-plugin/composer.json': {
				require: { php: '>=8.0 <9.0' },
				'require-dev': { 'phpunit/phpunit': '^9.6' },
				config: { platform: { php: '8.0' } },
			},
		}),
		[
			'fair-plugin/composer.json: require-dev "phpunit/phpunit" belongs in tools/php-tests/composer.json.',
		]
	);
});

test('requires PHP suites to use the shared runner', () => {
	assert.deepEqual(
		problems({
			'fair-plugin/package.json': {
				scripts: { 'test:php': 'vendor/bin/phpunit' },
			},
		}),
		[`fair-plugin/package.json: test:php should be "${RUNNER_SCRIPT}".`]
	);
	assert.deepEqual(
		problems({
			'fair-plugin/phpunit.xml': undefined,
		}),
		[
			'fair-plugin/package.json: test:php is set but there is no phpunit.xml.',
		]
	);
});

test('requires a policy entry for every workspace', () => {
	assert.deepEqual(
		problems({
			'package.json': {
				workspaces: ['fair-plugin', 'fair-shared', 'fair-new'],
			},
		}),
		['fair-new: no PHP minimum in scripts/php-compat.mjs POLICY.']
	);
});

test('lists shipped PHP files, skipping tests and dependencies', () => {
	withRepo(
		{
			'plugin/plugin.php': '<?php',
			'plugin/src/A.php': '<?php',
			'plugin/build/blocks/x/render.php': '<?php',
			'plugin/vendor/autoload.php': '<?php',
			'plugin/__tests__/ATest.php': '<?php',
			'plugin/node_modules/x/y.php': '<?php',
			'plugin/.tmp-check.php': '<?php',
			'plugin/readme.txt': '',
		},
		(root) => {
			assert.deepEqual(shippedPhpFiles(path.join(root, 'plugin')), [
				path.join('build', 'blocks', 'x', 'render.php'),
				'plugin.php',
				path.join('src', 'A.php'),
			]);
		}
	);
});

test('repository declarations match the policy', () => {
	assert.deepEqual(checkDeclarations(), []);
});

test('CI checks every policy minimum on its own runtime', () => {
	const workflow = readFileSync(
		path.join(ROOT, '.github', 'workflows', 'continuous-integration.yml'),
		'utf8'
	);
	const job = workflow.split(/\n {4}php-runtime:\n/)[1];
	assert.ok(job, 'continuous-integration.yml has a php-runtime job');
	const matrix = job.match(/\n {16}php: \[([^\]]+)\]/)[1];
	assert.deepEqual(
		matrix.split(',').map((value) => value.trim().replace(/'/g, '')),
		minimums()
	);
});
