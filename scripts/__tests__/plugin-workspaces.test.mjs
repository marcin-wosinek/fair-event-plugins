import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	discoverPlugins,
	NON_PLUGIN_WORKSPACES,
	PluginDiscoveryError,
} from '../plugin-workspaces.mjs';
import {
	describePluginTag,
	stampBuildVersions,
	withStampedHeaders,
} from '../version-stamp.mjs';
import { findCoverageProblems } from '../validate-plugin-coverage.mjs';
import { plugins as versionSync } from '../sync-wp-versions.js';
import {
	plugins as changelogSync,
	CHANGELOG_EXCLUSIONS,
} from '../sync-changelog.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function header(version = '1.2.3') {
	return `<?php\n/**\n * Plugin Name: Example\n * Version: ${version}\n */\n`;
}

function readme(version = '1.2.3') {
	return `=== Example ===\nStable tag: ${version}\n\n== Changelog ==\n`;
}

function pluginFiles(name, { file = `${name}.php`, version = '1.2.3' } = {}) {
	return {
		[`${name}/package.json`]: { name, version },
		[`${name}/${file}`]: header(version),
		[`${name}/readme.txt`]: readme(version),
	};
}

function withTree(files, callback) {
	const root = mkdtempSync(join(tmpdir(), 'plugin-workspaces-'));
	try {
		for (const [name, content] of Object.entries(files)) {
			const path = join(root, name);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(
				path,
				typeof content === 'string' ? content : JSON.stringify(content)
			);
		}
		return callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function read(root, path) {
	return readFileSync(join(root, path), 'utf8');
}

function discoveryProblems(root) {
	try {
		discoverPlugins(root);
	} catch (error) {
		assert.ok(error instanceof PluginDiscoveryError);
		return error.problems;
	}
	assert.fail('discovery should fail');
}

test('discovers plugins in workspace order and skips the shared library', () => {
	withTree(
		{
			'package.json': {
				workspaces: ['beta', 'fair-events-shared', 'alpha'],
			},
			'fair-events-shared/package.json': { version: '0.1.0' },
			...pluginFiles('alpha'),
			...pluginFiles('beta', { version: '2.0.0' }),
		},
		(root) => {
			assert.deepEqual(discoverPlugins(root), [
				{
					name: 'beta',
					phpFile: 'beta/beta.php',
					readmeFile: 'beta/readme.txt',
					packageVersion: '2.0.0',
				},
				{
					name: 'alpha',
					phpFile: 'alpha/alpha.php',
					readmeFile: 'alpha/readme.txt',
					packageVersion: '1.2.3',
				},
			]);
		}
	);
});

test('finds a differently named entry file by its Plugin Name header', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha', { file: 'main.php' }),
			'alpha/uninstall.php': '<?php\n// No header here.\n',
		},
		(root) => {
			assert.equal(discoverPlugins(root)[0].phpFile, 'alpha/main.php');
		}
	);
});

test('fails loudly, naming the workspace, for malformed plugins', () => {
	withTree(
		{
			'package.json': {
				workspaces: ['none', 'twice', 'noversion', 'notag', 'noreadme'],
			},
			'none/package.json': { version: '1.0.0' },
			'none/none.php': '<?php\n',
			...pluginFiles('twice'),
			'twice/other.php': header(),
			'noversion/package.json': { version: '1.0.0' },
			'noversion/noversion.php': '<?php\n/**\n * Plugin Name: X\n */\n',
			'noversion/readme.txt': readme(),
			'notag/package.json': { version: '1.0.0' },
			'notag/notag.php': header(),
			'notag/readme.txt': '=== X ===\n',
			'noreadme/package.json': { version: '1.0.0' },
			'noreadme/noreadme.php': header(),
		},
		(root) => {
			assert.deepEqual(discoveryProblems(root), [
				'none: no top-level PHP file with a "Plugin Name:" header',
				'twice: several PHP files with a "Plugin Name:" header (twice/other.php, twice/twice.php)',
				'noversion: no "Version:" header in noversion/noversion.php',
				'notag: no "Stable tag:" in notag/readme.txt',
				'noreadme: noreadme/readme.txt not found',
			]);
		}
	);
});

test('a non-plugin workspace not in NON_PLUGIN_WORKSPACES fails discovery', () => {
	withTree(
		{
			'package.json': { workspaces: ['fair-new-library'] },
			'fair-new-library/package.json': { version: '0.1.0' },
		},
		(root) => {
			assert.match(
				discoveryProblems(root)[0],
				/^fair-new-library: no top-level PHP file/
			);
		}
	);
});

test('the repository discovers every workspace except the shared library', () => {
	const { workspaces } = JSON.parse(read(repoRoot, 'package.json'));
	const names = discoverPlugins(repoRoot).map((plugin) => plugin.name);
	assert.deepEqual(
		names,
		workspaces.filter(
			(workspace) => !Object.hasOwn(NON_PLUGIN_WORKSPACES, workspace)
		)
	);
	assert.ok(names.includes('fair-audience-experimental'));
	assert.ok(!names.includes('fair-events-shared'));
});

test('stamps the header, readme and block docs with the tag description', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha', { file: 'main.php' }),
			'alpha/block-docs/index.json': { pluginVersion: '1.2.3' },
		},
		(root) => {
			const errors = stampBuildVersions({
				rootDir: root,
				plugins: discoverPlugins(root),
				describe: () => '1.2.3-4-gabc1234',
				log: () => {},
			});
			assert.deepEqual(errors, []);
			assert.match(
				read(root, 'alpha/main.php'),
				/Version: 1\.2\.3-4-gabc1234\n/
			);
			assert.match(
				read(root, 'alpha/readme.txt'),
				/Stable tag: 1\.2\.3-4-gabc1234\n/
			);
			assert.equal(
				JSON.parse(read(root, 'alpha/block-docs/index.json'))
					.pluginVersion,
				'1.2.3-4-gabc1234'
			);
		}
	);
});

test('a plugin without a release tag falls back to its package version', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha', { version: '0.1.0' }),
			'alpha/package.json': { name: 'alpha', version: '0.2.0' },
		},
		(root) => {
			const errors = stampBuildVersions({
				rootDir: root,
				plugins: discoverPlugins(root),
				describe: () => null,
				log: () => {},
			});
			assert.deepEqual(errors, []);
			assert.match(read(root, 'alpha/alpha.php'), /Version: 0\.2\.0\n/);
			assert.match(
				read(root, 'alpha/readme.txt'),
				/Stable tag: 0\.2\.0\n/
			);
		}
	);
});

test('an already-current header and stable tag count as success', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha', { version: '0.1.0' }),
		},
		(root) => {
			const lines = [];
			const errors = stampBuildVersions({
				rootDir: root,
				plugins: discoverPlugins(root),
				describe: () => null,
				log: (line) => lines.push(line),
			});
			assert.deepEqual(errors, []);
			assert.equal(read(root, 'alpha/alpha.php'), header('0.1.0'));
			assert.ok(
				lines.includes('  ✅ alpha/alpha.php (already current)'),
				lines.join('\n')
			);
		}
	);
});

test('a header removed after discovery fails the stamp', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha'),
		},
		(root) => {
			const plugins = discoverPlugins(root);
			writeFileSync(join(root, 'alpha/readme.txt'), '=== Example ===\n');
			const errors = stampBuildVersions({
				rootDir: root,
				plugins,
				describe: () => '1.2.3-1-gabc1234',
				log: () => {},
			});
			assert.deepEqual(errors, [
				'alpha: alpha/readme.txt: no version header found in alpha/readme.txt',
			]);
		}
	);
});

test('describePluginTag reads per-plugin tags and returns null without one', () => {
	withTree({ 'file.txt': 'x' }, (root) => {
		const git = (...args) =>
			execFileSync('git', args, { cwd: root, stdio: 'pipe' });
		git('init', '-q');
		git('add', '.');
		git(
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'-qm',
			'init'
		);
		assert.equal(describePluginTag(root, 'alpha'), null);
		git('tag', 'alpha@1.0.0');
		git('tag', 'alpha-experimental@9.0.0');
		assert.equal(describePluginTag(root, 'alpha'), '1.0.0');
		assert.equal(describePluginTag(root, 'beta'), null);
	});
});

test('local stamping covers every plugin and restores files afterwards', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha', 'beta'] },
			...pluginFiles('alpha'),
			...pluginFiles('beta', { file: 'main.php' }),
		},
		(root) => {
			const plugins = discoverPlugins(root);
			const seen = [];
			const restored = withStampedHeaders({
				rootDir: root,
				plugins,
				version: 'abc1234-dirty',
				callback: () => {
					seen.push(read(root, 'alpha/alpha.php'));
					seen.push(read(root, 'beta/main.php'));
				},
			});
			assert.equal(restored, 2);
			for (const content of seen) {
				assert.match(content, /Version: abc1234-dirty\n/);
			}
			assert.equal(read(root, 'alpha/alpha.php'), header());
			assert.equal(read(root, 'beta/main.php'), header());
		}
	);
});

test('local stamping restores files when packaging fails', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha'),
		},
		(root) => {
			assert.throws(
				() =>
					withStampedHeaders({
						rootDir: root,
						plugins: discoverPlugins(root),
						version: 'abc1234',
						callback: () => {
							throw new Error('dist-archive failed');
						},
					}),
				/dist-archive failed/
			);
			assert.equal(read(root, 'alpha/alpha.php'), header());
		}
	);
});

test('local stamping restores earlier files when a later header is missing', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha', 'beta'] },
			...pluginFiles('alpha'),
			...pluginFiles('beta'),
		},
		(root) => {
			const plugins = discoverPlugins(root);
			writeFileSync(join(root, 'beta/beta.php'), '<?php\n');
			let ran = false;
			assert.throws(
				() =>
					withStampedHeaders({
						rootDir: root,
						plugins,
						version: 'abc1234',
						callback: () => {
							ran = true;
						},
					}),
				/beta: no version header found in beta\/beta\.php/
			);
			assert.equal(ran, false);
			assert.equal(read(root, 'alpha/alpha.php'), header());
		}
	);
});

function coverageFor(plugins, overrides = {}) {
	return findCoverageProblems({
		plugins,
		versionSync: plugins.map((plugin) => ({
			name: plugin.name,
			packagePath: `${plugin.name}/package.json`,
			phpFiles: [plugin.phpFile],
			readmeFiles: [plugin.readmeFile],
		})),
		changelogSync: plugins.map((plugin) => ({
			name: plugin.name,
			readmeFiles: [plugin.readmeFile],
		})),
		changelogExclusions: {},
		...overrides,
	});
}

test('coverage reports a newly added workspace missing from release scripts', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha', 'fair-new'] },
			...pluginFiles('alpha'),
			...pluginFiles('fair-new'),
		},
		(root) => {
			const plugins = discoverPlugins(root);
			const [alpha] = plugins;
			assert.deepEqual(
				findCoverageProblems({
					plugins,
					versionSync: [
						{
							name: 'alpha',
							packagePath: 'alpha/package.json',
							phpFiles: [alpha.phpFile],
							readmeFiles: [alpha.readmeFile],
						},
					],
					changelogSync: [],
					changelogExclusions: { alpha: 'linked' },
				}),
				[
					'fair-new: missing from scripts/sync-wp-versions.js `plugins`',
					'fair-new: missing from scripts/sync-changelog.js `plugins`; add it, or add it to CHANGELOG_EXCLUSIONS with a reason',
				]
			);
		}
	);
});

test('coverage rejects stale, wrong-path and doubly listed entries', () => {
	withTree(
		{
			'package.json': { workspaces: ['alpha'] },
			...pluginFiles('alpha', { file: 'main.php' }),
		},
		(root) => {
			const plugins = discoverPlugins(root);
			assert.deepEqual(
				coverageFor(plugins, {
					versionSync: [
						{
							name: 'alpha',
							packagePath: 'alpha/package.json',
							phpFiles: ['alpha/alpha.php'],
							readmeFiles: ['alpha/readme.txt'],
						},
						{ name: 'fair-events-shared' },
					],
					changelogExclusions: { alpha: 'linked', gone: 'old' },
				}),
				[
					'alpha: scripts/sync-wp-versions.js phpFiles must include alpha/main.php',
					'alpha: both configured and excluded in scripts/sync-changelog.js',
					'fair-events-shared: listed in scripts/sync-wp-versions.js but is not a plugin workspace',
					'gone: listed in scripts/sync-changelog.js but is not a plugin workspace',
				]
			);
		}
	);
});

test('the repository release configuration covers every plugin', () => {
	assert.deepEqual(
		findCoverageProblems({
			plugins: discoverPlugins(repoRoot),
			versionSync,
			changelogSync,
			changelogExclusions: CHANGELOG_EXCLUSIONS,
		}),
		[]
	);
});
