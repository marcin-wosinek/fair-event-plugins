import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	findMissingOutputs,
	formatMissingOutputs,
	TEST_SITE_BUILDS,
} from '../prepared-outputs.mjs';

const pluginHeader = '<?php\n/**\n * Plugin Name: Example\n */\n';
const pluginScripts = {
	build: 'wp-scripts build',
	'composer:install:prod': 'composer install --no-dev',
};

async function withTree(files, callback) {
	const directory = await mkdtemp(join(tmpdir(), 'prepared-outputs-'));
	try {
		for (const [name, content] of Object.entries(files)) {
			const path = join(directory, name);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(
				path,
				typeof content === 'string' ? content : JSON.stringify(content)
			);
		}
		return await callback(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function plugin(name, { build = true, vendor = true, scripts } = {}) {
	const files = {
		[`${name}/package.json`]: { scripts: scripts ?? pluginScripts },
		[`${name}/${name}.php`]: pluginHeader,
	};
	if (build) {
		files[`${name}/build/blocks/example/index.js`] = '';
	}
	if (vendor) {
		files[`${name}/vendor/autoload.php`] = '<?php';
	}
	return files;
}

test('a fully prepared tree has nothing missing', async () => {
	await withTree(
		{
			'package.json': { workspaces: ['alpha', 'beta'] },
			...plugin('alpha'),
			...plugin('beta'),
		},
		async (root) => {
			assert.deepEqual(await findMissingOutputs(root), []);
		}
	);
});

test('every plugin workspace is checked and all problems are reported', async () => {
	await withTree(
		{
			'package.json': { workspaces: ['alpha', 'beta', 'gamma'] },
			...plugin('alpha', { build: false }),
			...plugin('beta'),
			...plugin('gamma', { vendor: false, build: false }),
		},
		async (root) => {
			assert.deepEqual(await findMissingOutputs(root), [
				{
					workspace: 'alpha',
					missing: ['alpha/build/ (no JavaScript build output)'],
					commands: ['npm run build --workspace=alpha'],
				},
				{
					workspace: 'gamma',
					missing: [
						'gamma/build/ (no JavaScript build output)',
						'gamma/vendor/autoload.php',
					],
					commands: [
						'npm run build --workspace=gamma',
						'npm run composer:install:prod --workspace=gamma',
					],
				},
			]);
		}
	);
});

test('a build directory without JavaScript counts as missing', async () => {
	await withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...plugin('alpha', { build: false }),
			'alpha/build/languages/readme.txt': '',
		},
		async (root) => {
			const [problem] = await findMissingOutputs(root);
			assert.equal(problem.workspace, 'alpha');
			assert.deepEqual(problem.commands, [
				'npm run build --workspace=alpha',
			]);
		}
	);
});

test('outputs are required only for scripts the workspace defines', async () => {
	await withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...plugin('alpha', {
				build: false,
				vendor: false,
				scripts: { test: 'jest' },
			}),
		},
		async (root) => {
			assert.deepEqual(await findMissingOutputs(root), []);
		}
	);
});

test('library workspaces without a plugin header are skipped', async () => {
	await withTree(
		{
			'package.json': { workspaces: ['shared', 'notes'] },
			// Like fair-events-shared: an example build, no plugin file.
			'shared/package.json': { scripts: { build: 'wp-scripts build' } },
			'notes/package.json': { scripts: pluginScripts },
			'notes/notes.php': '<?php // not a plugin',
		},
		async (root) => {
			assert.deepEqual(await findMissingOutputs(root), []);
		}
	);
});

test('the failure message names each path and its preparation command', () => {
	const lines = formatMissingOutputs([
		{
			workspace: 'gamma',
			missing: ['gamma/vendor/autoload.php'],
			commands: ['npm run composer:install:prod --workspace=gamma'],
		},
	]);
	assert.ok(lines.includes('  - gamma/vendor/autoload.php'));
	assert.ok(
		lines.includes('  npm run composer:install:prod --workspace=gamma')
	);
	assert.match(lines.at(-1), /drop --prepared/);
});

test('a library build written into the test site is required', async () => {
	const files = {
		'package.json': { workspaces: ['fair-events-shared'] },
		'fair-events-shared/package.json': {
			scripts: { build: 'wp-scripts build' },
		},
	};
	await withTree(files, async (root) => {
		const [problem] = await findMissingOutputs(root);
		assert.equal(problem.workspace, 'fair-events-shared');
		assert.match(
			problem.missing[0],
			/e2e\/mu-plugins\/admin-table-example\/build/
		);
		assert.deepEqual(problem.commands, [
			'npm run build --workspace=fair-events-shared',
		]);
	});
	await withTree(
		{
			...files,
			'e2e/mu-plugins/admin-table-example/build/index.js': '',
		},
		async (root) => {
			assert.deepEqual(await findMissingOutputs(root), []);
		}
	);
});

test('TEST_SITE_BUILDS match where the library build writes', async () => {
	const { readFile } = await import('node:fs/promises');
	const repository = new URL('../../', import.meta.url);
	for (const { workspace, path } of TEST_SITE_BUILDS) {
		const config = await readFile(
			new URL(`${workspace}/webpack.example.config.cjs`, repository),
			'utf8'
		);
		assert.ok(config.includes(`'../${path}'`), `${workspace} → ${path}`);
	}
});
