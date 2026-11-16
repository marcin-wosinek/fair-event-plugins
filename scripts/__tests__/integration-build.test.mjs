import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	ARCHIVE_NAME,
	IntegrationBuildError,
	MANIFEST_NAME,
	entriesOutside,
	pack,
	restore,
} from '../integration-build.mjs';

const execFileAsync = promisify(execFile);

const COMMIT = 'a'.repeat(40);
const pluginHeader = '<?php\n/**\n * Plugin Name: Example\n */\n';
const pluginScripts = {
	build: 'wp-scripts build',
	'composer:install:prod': 'composer install --no-dev',
};

async function writeTree(root, files) {
	for (const [name, content] of Object.entries(files)) {
		const path = join(root, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			typeof content === 'string' ? content : JSON.stringify(content)
		);
	}
}

// Sources every checkout has: the workspace list and plugin headers.
const sources = {
	'package.json': { workspaces: ['alpha', 'beta', 'shared'] },
	'alpha/package.json': { scripts: pluginScripts },
	'alpha/alpha.php': pluginHeader,
	'beta/package.json': { scripts: pluginScripts },
	'beta/beta.php': pluginHeader,
	'shared/package.json': { scripts: { build: 'wp-scripts build' } },
};

// What the build and production Composer install generate.
const outputs = {
	'alpha/build/index.js': 'alpha();',
	'alpha/block-docs/example.md': '# Example',
	'alpha/vendor/autoload.php': '<?php',
	'alpha/vendor/bin/tool': '#!/bin/sh\n',
	'beta/build/index.js': 'beta();',
	'beta/vendor/autoload.php': '<?php',
	'shared/build/example.js': 'example();',
};

/**
 * A prepared checkout and a fresh one of the same sources.
 */
async function withCheckouts(callback, { prepared = outputs } = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'integration-build-'));
	const producer = join(directory, 'producer');
	const consumer = join(directory, 'consumer');
	try {
		await writeTree(producer, { ...sources, ...prepared });
		await writeTree(consumer, sources);
		if (prepared['alpha/vendor/bin/tool']) {
			await chmod(join(producer, 'alpha/vendor/bin/tool'), 0o755);
		}
		return await callback({ directory, producer, consumer });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const runOptions = { runId: '100', runAttempt: '1', commit: COMMIT };

test('pack records the revision, run, checksum and every plugin output', async () => {
	await withCheckouts(async ({ directory, producer }) => {
		const dir = join(directory, 'artifact');
		const manifest = await pack({ root: producer, dir, ...runOptions });

		assert.equal(manifest.commit, COMMIT);
		assert.equal(manifest.runId, '100');
		assert.equal(manifest.runAttempt, '1');
		assert.match(manifest.archive.sha256, /^[0-9a-f]{64}$/);
		// Library workspaces without a plugin header stay out.
		assert.deepEqual(manifest.paths, [
			'alpha/block-docs',
			'alpha/build',
			'alpha/vendor',
			'beta/build',
			'beta/vendor',
		]);
		assert.deepEqual(
			JSON.parse(await readFile(join(dir, MANIFEST_NAME), 'utf8')),
			manifest
		);
		const { stdout } = await execFileAsync('tar', [
			'-tf',
			join(dir, ARCHIVE_NAME),
		]);
		assert.ok(!/node_modules|shared\//.test(stdout));
	});
});

test('pack and restore carry library builds written into the test site', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'integration-build-'));
	try {
		const tree = {
			'package.json': { workspaces: ['fair-events-shared'] },
			'fair-events-shared/package.json': {
				scripts: { build: 'wp-scripts build' },
			},
		};
		const fixture = 'e2e/mu-plugins/admin-table-example/build/index.js';
		await writeTree(join(directory, 'producer'), {
			...tree,
			[fixture]: 'example();',
		});
		await writeTree(join(directory, 'consumer'), tree);
		const dir = join(directory, 'artifact');
		const manifest = await pack({
			root: join(directory, 'producer'),
			dir,
			...runOptions,
		});
		assert.deepEqual(manifest.paths, [
			'e2e/mu-plugins/admin-table-example/build',
		]);
		await restore({
			root: join(directory, 'consumer'),
			dir,
			...runOptions,
		});
		assert.equal(
			await readFile(join(directory, 'consumer', fixture), 'utf8'),
			'example();'
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('pack refuses a tree with missing outputs', async () => {
	const { 'beta/vendor/autoload.php': _, ...partial } = outputs;
	await withCheckouts(
		async ({ directory, producer }) => {
			await assert.rejects(
				pack({
					root: producer,
					dir: join(directory, 'artifact'),
					...runOptions,
				}),
				(error) =>
					error instanceof IntegrationBuildError &&
					/beta\/vendor\/autoload\.php/.test(error.message)
			);
		},
		{ prepared: partial }
	);
});

test('restore extracts the outputs with their file modes', async () => {
	await withCheckouts(async ({ directory, producer, consumer }) => {
		const dir = join(directory, 'artifact');
		await pack({ root: producer, dir, ...runOptions });
		const manifest = await restore({ root: consumer, dir, ...runOptions });

		assert.equal(manifest.paths.length, 5);
		assert.equal(
			await readFile(join(consumer, 'alpha/build/index.js'), 'utf8'),
			'alpha();'
		);
		assert.equal(
			(await stat(join(consumer, 'alpha/vendor/bin/tool'))).mode & 0o777,
			0o755
		);
	});
});

test('restore finds an artifact nested one folder down', async () => {
	await withCheckouts(async ({ directory, producer, consumer }) => {
		await pack({
			root: producer,
			dir: join(directory, 'artifact', 'integration-build-attempt-1'),
			...runOptions,
		});
		await restore({
			root: consumer,
			dir: join(directory, 'artifact'),
			...runOptions,
		});
	});
});

async function assertRestoreFails(options, pattern, mutate) {
	await withCheckouts(async ({ directory, producer, consumer }) => {
		const dir = join(directory, 'artifact');
		await pack({ root: producer, dir, ...runOptions });
		await mutate?.(dir);
		await assert.rejects(
			restore({ root: consumer, dir, ...runOptions, ...options }),
			(error) => {
				assert.ok(error instanceof IntegrationBuildError);
				assert.match(error.message, pattern);
				assert.match(error.message, /Re-run/);
				return true;
			}
		);
	});
}

test('restore rejects a build of another commit', () =>
	assertRestoreFails({ commit: 'b'.repeat(40) }, /checked out b{40}/));

test('restore rejects a build from another workflow run', () =>
	assertRestoreFails({ runId: '99' }, /run 100, not this run \(99\)/));

test('restore rejects a build from another preparation attempt', () =>
	assertRestoreFails({ runAttempt: '2' }, /attempt 1.*attempt 2/));

test('restore reports a missing artifact', async () => {
	await withCheckouts(async ({ directory, consumer }) => {
		await assert.rejects(
			restore({
				root: consumer,
				dir: join(directory, 'never-downloaded'),
				...runOptions,
			}),
			/No prepared integration build found.*Re-run/
		);
	});
});

test('restore rejects a missing archive', () =>
	assertRestoreFails({}, /archive .* is missing/, (dir) =>
		rm(join(dir, ARCHIVE_NAME))
	));

test('restore rejects a corrupt archive', () =>
	assertRestoreFails({}, /corrupt/, (dir) =>
		writeFile(join(dir, ARCHIVE_NAME), 'truncated')
	));

test('restore rejects a manifest missing a required plugin output', () =>
	assertRestoreFails({}, /incomplete; missing beta\/vendor/, async (dir) => {
		const path = join(dir, MANIFEST_NAME);
		const manifest = JSON.parse(await readFile(path, 'utf8'));
		manifest.paths = manifest.paths.filter((p) => p !== 'beta/vendor');
		await writeFile(path, JSON.stringify(manifest));
	}));

test('restore rejects an archive that lacks the declared outputs', async () => {
	await withCheckouts(async ({ directory, producer, consumer }) => {
		const dir = join(directory, 'artifact');
		await pack({ root: producer, dir, ...runOptions });
		// Re-create the archive without beta/vendor but keep the manifest
		// consistent with it, as a broken preparation step would.
		const archive = join(dir, ARCHIVE_NAME);
		await execFileAsync('tar', [
			'-cf',
			archive,
			'-C',
			producer,
			'alpha/block-docs',
			'alpha/build',
			'alpha/vendor',
			'beta/build',
		]);
		const path = join(dir, MANIFEST_NAME);
		const manifest = JSON.parse(await readFile(path, 'utf8'));
		const { createHash } = await import('node:crypto');
		manifest.archive.sha256 = createHash('sha256')
			.update(await readFile(archive))
			.digest('hex');
		await writeFile(path, JSON.stringify(manifest));

		await assert.rejects(
			restore({ root: consumer, dir, ...runOptions }),
			/beta\/vendor\/autoload\.php[\s\S]*Re-run/
		);
	});
});

test('entriesOutside flags paths beyond the declared outputs', () => {
	const paths = ['alpha/build', 'alpha/vendor'];
	assert.deepEqual(
		entriesOutside(
			[
				'alpha/build/',
				'alpha/build/index.js',
				'./alpha/vendor/autoload.php',
				'alpha/buildx/evil.js',
				'alpha/build/../../etc/passwd',
				'/etc/passwd',
				'alpha/src/index.js',
			],
			paths
		),
		[
			'alpha/buildx/evil.js',
			'alpha/build/../../etc/passwd',
			'/etc/passwd',
			'alpha/src/index.js',
		]
	);
});
