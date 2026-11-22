import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const shim = require('../wp-env-pinned-core.cjs');
const adapter = require('../wp-env-image-adapter.cjs');
const { UnsupportedWpEnvError } = require('../wp-env-locate.cjs');

const PIN = 'WordPress/WordPress#7.1.5';

// A stand-in for @wordpress/env 12.x: the same module layout, a lookup that
// records every "network" call, and a parse-config that imports the lookup
// when it loads, as the real one does. As in the real one, the Compose
// generator imports the config module, which imports parse-config.
const FAKE_MODULES = {
	'lib/wordpress.js': `'use strict';
globalThis.lookups = 0;
module.exports = {
	canAccessWPORG: async () => true,
	getLatestWordPressVersion: async () => {
		globalThis.lookups++;
		return '9.9.9';
	},
};`,
	'lib/config/parse-config.js': `'use strict';
const { getLatestWordPressVersion } = require('../wordpress');
module.exports = { parseCoreSource: () => getLatestWordPressVersion() };`,
	'lib/config/index.js': `'use strict';
require('./parse-config.js');
module.exports = {};`,
	'lib/runtime/docker/build-docker-compose-config.js': `'use strict';
require('../../config');
module.exports = () => ({});`,
	'lib/runtime/docker/docker-config.js': 'module.exports = {};',
	'bin/wp-env': `'use strict';
const { parseCoreSource } = require('../lib/config/parse-config.js');
parseCoreSource().then((version) =>
	process.stdout.write(JSON.stringify({ version, lookups: globalThis.lookups }))
);`,
};

async function withFakeRoot(callback, { version = '12.1.0', files = {} } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'wp-env-pinned-core-'));
	const wpEnv = join(root, 'node_modules/@wordpress/env');
	try {
		await writeFile(
			join(await mkdirp(wpEnv), 'package.json'),
			JSON.stringify({ name: '@wordpress/env', version })
		);
		for (const [file, contents] of Object.entries(FAKE_MODULES)) {
			await mkdirp(join(wpEnv, file, '..'));
			await writeFile(join(wpEnv, file), contents);
		}
		for (const [file, contents] of Object.entries(files)) {
			await writeFile(join(root, file), JSON.stringify(contents));
		}
		return await callback({ root, wpEnv });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function mkdirp(directory) {
	await mkdir(directory, { recursive: true });
	return directory;
}

// Run a script in a fresh Node process with the shim preloaded.
function runPreloaded(root, script, env = {}) {
	const output = execFileSync(process.execPath, [script], {
		cwd: root,
		env: {
			PATH: process.env.PATH,
			...env,
			NODE_OPTIONS: shim.withPinnedCoreNodeOptions(env.NODE_OPTIONS),
		},
		encoding: 'utf8',
	});
	return JSON.parse(output);
}

test('the effective core follows WP_ENV_CORE, then the override, then .wp-env.json', async () => {
	await withFakeRoot(
		async ({ root }) => {
			assert.equal(shim.resolvePinnedVersion(root, {}), '7.1.4');
			assert.equal(
				shim.resolvePinnedVersion(root, {
					WP_ENV_CORE: 'WordPress/WordPress#7.0',
				}),
				'7.0'
			);
		},
		{
			files: {
				'.wp-env.json': { core: PIN },
				'.wp-env.override.json': {
					port: 8890,
					core: 'WordPress/WordPress#7.1.4',
				},
			},
		}
	);
	await withFakeRoot(
		async ({ root }) => {
			assert.equal(shim.resolvePinnedVersion(root, {}), '7.1.5');
		},
		{
			files: {
				'.wp-env.json': { core: PIN },
				'.wp-env.override.json': { port: 8890 },
			},
		}
	);
});

test('a missing or non-exact core is not a pin', async () => {
	for (const core of [
		undefined,
		null,
		'WordPress/WordPress',
		'WordPress/WordPress#trunk',
		'WordPress/WordPress#7.1-RC1',
		'https://wordpress.org/latest.zip',
		'./wordpress',
	]) {
		await withFakeRoot(
			async ({ root }) => {
				assert.equal(shim.resolvePinnedVersion(root, {}), null, core);
			},
			{ files: { '.wp-env.json': { core } } }
		);
	}
	// An override that clears the pin wins over .wp-env.json.
	await withFakeRoot(
		async ({ root }) => {
			assert.equal(shim.resolvePinnedVersion(root, {}), null);
		},
		{
			files: {
				'.wp-env.json': { core: PIN },
				'.wp-env.override.json': { core: null },
			},
		}
	);
});

test('preloaded into wp-env, the lookup returns the pin without the network', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			const bin = join(wpEnv, 'bin/wp-env');
			assert.deepEqual(runPreloaded(root, bin), {
				version: '7.1.5',
				lookups: 0,
			});
			assert.deepEqual(
				runPreloaded(root, bin, {
					WP_ENV_CORE: 'WordPress/WordPress#7.1.3',
				}),
				{ version: '7.1.3', lookups: 0 }
			);
			// Without the shim, the fake wp-env makes its lookup.
			assert.deepEqual(
				JSON.parse(
					execFileSync(process.execPath, [bin], {
						cwd: root,
						encoding: 'utf8',
						env: { PATH: process.env.PATH },
					})
				),
				{ version: '9.9.9', lookups: 1 }
			);
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('preloaded together with the image adapter, the shim still applies', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			// The CI start: the shim first, then the image adapter with a
			// manifest, whose install loads wp-env's config (#2393).
			const manifest = join(root, 'manifest.json');
			await writeFile(
				manifest,
				JSON.stringify({ key: 'test', wpEnvVersion: '12.1.0' })
			);
			const output = execFileSync(
				process.execPath,
				[join(wpEnv, 'bin/wp-env')],
				{
					cwd: root,
					env: {
						PATH: process.env.PATH,
						[adapter.MANIFEST_ENV]: manifest,
						NODE_OPTIONS: `${shim.withPinnedCoreNodeOptions()} --require=${require.resolve('../wp-env-image-adapter.cjs')}`,
					},
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				}
			);
			assert.deepEqual(JSON.parse(output), {
				version: '7.1.5',
				lookups: 0,
			});
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('without an exact pin, the preloaded wp-env keeps its own lookup', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			assert.deepEqual(runPreloaded(root, join(wpEnv, 'bin/wp-env')), {
				version: '9.9.9',
				lookups: 1,
			});
		},
		{ files: { '.wp-env.json': { core: 'WordPress/WordPress#trunk' } } }
	);
});

test('a Node process that is not wp-env is left alone', async () => {
	await withFakeRoot(
		async ({ root }) => {
			const script = join(root, 'other.js');
			await writeFile(
				script,
				`const { getLatestWordPressVersion } = require('@wordpress/env/lib/wordpress.js');
getLatestWordPressVersion().then((version) =>
	process.stdout.write(JSON.stringify({ version, lookups: globalThis.lookups }))
);`
			);
			assert.deepEqual(runPreloaded(root, script), {
				version: '9.9.9',
				lookups: 1,
			});
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('in-process install patches before parse-config and follows each root', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			assert.equal(shim.installPinnedCore({ root, env: {} }), '7.1.5');
			const { parseCoreSource } = require(
				join(wpEnv, 'lib/config/parse-config.js')
			);
			assert.equal(await parseCoreSource(), '7.1.5');
			assert.equal(globalThis.lookups, 0);

			// Installing again for a root without a pin restores the lookup.
			await writeFile(
				join(root, '.wp-env.json'),
				JSON.stringify({ core: null })
			);
			assert.equal(shim.installPinnedCore({ root, env: {} }), null);
			assert.equal(await parseCoreSource(), '9.9.9');
			assert.equal(globalThis.lookups, 1);
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('a pin with parse-config already loaded fails loudly', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			require(join(wpEnv, 'lib/config/parse-config.js'));
			assert.throws(
				() => shim.installPinnedCore({ root, env: {} }),
				(error) =>
					error instanceof UnsupportedWpEnvError &&
					/parse-config module loaded before the shim/.test(
						error.message
					) &&
					/pinned-core shim/.test(error.message)
			);
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('a changed lookup shape fails loudly', async () => {
	await withFakeRoot(
		async ({ root, wpEnv }) => {
			await writeFile(
				join(wpEnv, 'lib/wordpress.js'),
				'module.exports = { canAccessWPORG: async () => true };'
			);
			assert.throws(
				() => shim.installPinnedCore({ root, env: {} }),
				/getLatestWordPressVersion\(\) changed shape/
			);
		},
		{ files: { '.wp-env.json': { core: PIN } } }
	);
});

test('an unsupported wp-env major fails loudly', async () => {
	await withFakeRoot(
		async ({ root }) => {
			assert.throws(
				() => shim.installPinnedCore({ root, env: {} }),
				(error) =>
					error instanceof UnsupportedWpEnvError &&
					/13\.0\.0/.test(error.message)
			);
		},
		{ version: '13.0.0', files: { '.wp-env.json': { core: PIN } } }
	);
});

test('NODE_OPTIONS keeps existing options and adds the shim once', () => {
	const flag = `--require=${shim.SHIM_PATH}`;
	assert.equal(shim.withPinnedCoreNodeOptions(undefined), flag);
	assert.equal(shim.withPinnedCoreNodeOptions(''), flag);
	assert.equal(
		shim.withPinnedCoreNodeOptions('--max-old-space-size=4096'),
		`--max-old-space-size=4096 ${flag}`
	);
	assert.equal(
		shim.withPinnedCoreNodeOptions(`--inspect ${flag}`),
		`--inspect ${flag}`
	);
});
