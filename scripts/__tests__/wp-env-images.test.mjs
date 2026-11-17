import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	ADAPTER_PATH,
	buildComposeConfig,
	computeCacheKey,
	createDocker,
	findPreparationFailures,
	formatSummary,
	isTransientFailure,
	isoWeek,
	prepareImages,
	preparedStartEnvironment,
	resolveDocker,
	withRetries,
} from '../wp-env-images.mjs';

const require = createRequire(import.meta.url);
const adapter = require('../wp-env-image-adapter.cjs');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function withDirectory(callback) {
	const directory = await mkdtemp(join(tmpdir(), 'wp-env-images-'));
	try {
		return await callback(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function planFor(wpEnvJson) {
	return withDirectory(async (directory) => {
		await writeFile(
			join(directory, '.wp-env.json'),
			JSON.stringify(wpEnvJson)
		);
		// wp-env resolves from the repository's node_modules.
		const config = { ...process.env };
		try {
			process.env.CI = '1';
			return await adapter.createBuildPlan(directory, ROOT);
		} finally {
			process.env.CI = config.CI;
			if (config.CI === undefined) {
				delete process.env.CI;
			}
		}
	});
}

const runner = {
	os: 'Linux',
	arch: 'X64',
	image: 'ubuntu24',
	imageVersion: '20261110.1',
};
const files = { '.wp-env.json': 'a', 'package-lock.json': 'b' };

function fakePlan(overrides = {}) {
	return {
		wpEnvVersion: '12.1.0',
		builds: [
			{
				service: 'wordpress',
				dockerfile: 'WordPress.Dockerfile',
				contents: 'FROM wordpress:php8.5\n',
				args: { HOST_UID: '1001' },
				hash: 'wp-hash',
			},
			{
				service: 'cli',
				dockerfile: 'CLI.Dockerfile',
				contents: 'FROM wordpress:cli-php8.5\n',
				args: { HOST_UID: '1001' },
				hash: 'cli-hash',
			},
		],
		upstream: ['mariadb:lts', 'wordpress:cli-php8.5', 'wordpress:php8.5'],
		...overrides,
	};
}

test('isoWeek follows ISO 8601 week numbering', () => {
	assert.equal(isoWeek(new Date('2026-11-16T10:00:00Z')), '2026-W47');
	assert.equal(isoWeek(new Date('2026-11-22T23:59:59Z')), '2026-W47');
	assert.equal(isoWeek(new Date('2026-11-23T00:00:00Z')), '2026-W48');
	assert.equal(isoWeek(new Date('2021-01-03T12:00:00Z')), '2020-W53');
});

test('the cache key is stable for unchanged inputs and changes with each input', () => {
	const base = { plan: fakePlan(), runner, files, epoch: '2026-W47' };
	const { key } = computeCacheKey(base);
	assert.equal(computeCacheKey(base).key, key);
	assert.match(key, /^wp-env-images-v1-linux-x64-2026-W47-[0-9a-f]{24}$/);

	const variants = {
		dockerfile: {
			...base,
			plan: fakePlan({
				builds: [
					{ ...fakePlan().builds[0], hash: 'php8.4' },
					fakePlan().builds[1],
				],
			}),
		},
		upstream: {
			...base,
			plan: fakePlan({ upstream: ['mariadb:11.4', 'wordpress:php8.5'] }),
		},
		wpEnv: { ...base, plan: fakePlan({ wpEnvVersion: '12.2.0' }) },
		runnerImage: {
			...base,
			runner: { ...runner, imageVersion: '20261117.1' },
		},
		files: { ...base, files: { ...files, 'package-lock.json': 'c' } },
		epoch: { ...base, epoch: '2026-W48' },
	};
	for (const [name, inputs] of Object.entries(variants)) {
		assert.notEqual(computeCacheKey(inputs).key, key, name);
	}
});

test('the build plan comes from wp-env itself and covers every generated image', async () => {
	const plan = await planFor({ phpVersion: '8.5' });
	assert.deepEqual(plan.builds.map((build) => build.service).sort(), [
		'cli',
		'tests-cli',
		'tests-wordpress',
		'wordpress',
	]);
	assert.deepEqual(
		plan.builds.map((build) => build.dockerfile).sort(),
		Object.keys(adapter.DOCKERFILES).sort()
	);
	for (const build of plan.builds) {
		assert.match(build.contents, /getcomposer\.org/);
		assert.ok(build.args.HOST_UID);
	}
	assert.ok(plan.upstream.includes('wordpress:php8.5'));
	assert.ok(plan.upstream.includes('wordpress:cli-php8.5'));
	assert.ok(plan.upstream.some((image) => image.startsWith('mariadb:')));
});

test('changing the PHP version changes every build hash', async () => {
	const [php85, php84] = await Promise.all([
		planFor({ phpVersion: '8.5' }),
		planFor({ phpVersion: '8.4' }),
	]);
	const hashes = (plan) =>
		Object.fromEntries(plan.builds.map((b) => [b.service, b.hash]));
	for (const [service, hash] of Object.entries(hashes(php85))) {
		assert.notEqual(hashes(php84)[service], hash, service);
	}
	assert.ok(php84.upstream.includes('wordpress:php8.4'));
});

function generatedCompose() {
	return {
		services: {
			mysql: { image: 'mariadb:lts' },
			phpmyadmin: { image: 'phpmyadmin' },
			wordpress: {
				build: {
					context: '.',
					dockerfile: 'WordPress.Dockerfile',
					args: { HOST_UID: '1001' },
				},
				ports: ['8888:80'],
			},
			cli: {
				build: {
					context: '.',
					dockerfile: 'CLI.Dockerfile',
					args: { HOST_UID: '1001' },
				},
			},
		},
	};
}

const fakeDockerConfig = {
	wordpressDockerFileContents: (env) => `FROM wordpress:php8.5\n# ${env}\n`,
	cliDockerFileContents: (env) => `FROM wordpress:cli-php8.5\n# ${env}\n`,
};

function manifestFor(compose) {
	const builds = adapter.describeBuilds(compose, {}, fakeDockerConfig);
	return {
		services: Object.fromEntries(
			builds.map(({ service, hash }) => [
				service,
				{ image: `fair-wp-env/${service}:abc`, hash },
			])
		),
		upstream: ['mariadb:lts', 'wordpress:php8.5', 'wordpress:cli-php8.5'],
	};
}

test('the adapter swaps built services for prepared images and disables pulls', () => {
	const manifest = manifestFor(generatedCompose());
	const compose = adapter.applyPreparedImages(
		generatedCompose(),
		{},
		fakeDockerConfig,
		manifest
	);
	assert.deepEqual(compose.services.wordpress, {
		image: 'fair-wp-env/wordpress:abc',
		pull_policy: 'never',
		ports: ['8888:80'],
	});
	assert.equal(compose.services.cli.build, undefined);
	assert.equal(compose.services.mysql.pull_policy, 'never');
	// Not in the archive, so wp-env may still pull it.
	assert.equal(compose.services.phpmyadmin.pull_policy, undefined);
});

test('the adapter refuses an image built from a different Dockerfile', () => {
	const manifest = manifestFor(generatedCompose());
	const changed = generatedCompose();
	changed.services.wordpress.build.args.HOST_UID = '1002';
	assert.throws(
		() =>
			adapter.applyPreparedImages(
				changed,
				{},
				fakeDockerConfig,
				manifest
			),
		adapter.StaleImageError
	);
	delete manifest.services.cli;
	assert.throws(
		() =>
			adapter.applyPreparedImages(
				generatedCompose(),
				{},
				fakeDockerConfig,
				manifest
			),
		/No prepared image for the "cli" service/
	);
});

test('the adapter fails clearly when wp-env generates something it does not know', () => {
	const compose = generatedCompose();
	compose.services.cli.build.dockerfile = 'Cli.Dockerfile';
	assert.throws(
		() => adapter.describeBuilds(compose, {}, fakeDockerConfig),
		adapter.UnsupportedWpEnvError
	);
	assert.throws(
		() =>
			adapter.describeBuilds(
				generatedCompose(),
				{},
				{ cliDockerFileContents() {} }
			),
		/no longer exports wordpressDockerFileContents/
	);
	assert.throws(
		() =>
			adapter.describeBuilds(
				{ services: { mysql: { image: 'mariadb:lts' } } },
				{},
				fakeDockerConfig
			),
		/builds no services/
	);
});

test('the preloaded adapter installs only in wp-env and checks the manifest', async () => {
	await withDirectory(async (directory) => {
		const manifestPath = join(directory, 'result.json');
		const wpEnvBin = join(
			adapter.locateWpEnv(ROOT).directory,
			'bin/wp-env'
		);
		const run = (script = wpEnvBin) =>
			spawnSync(process.execPath, [script, '--version'], {
				cwd: ROOT,
				encoding: 'utf8',
				env: {
					...process.env,
					NODE_OPTIONS: `--require=${ADAPTER_PATH}`,
					FAIR_WP_ENV_IMAGE_MANIFEST: manifestPath,
				},
			}).stderr;
		const { version } = require('@wordpress/env/package.json');

		await writeFile(
			manifestPath,
			JSON.stringify({ key: 'k1', wpEnvVersion: version })
		);
		assert.match(run(), /starting from prepared images \(k1\)/);

		await writeFile(
			manifestPath,
			JSON.stringify({ key: 'k1', wpEnvVersion: '0.0.1' })
		);
		assert.match(run(), /prepared for @wordpress\/env 0\.0\.1/);

		const other = join(directory, 'other.js');
		await writeFile(other, '');
		assert.doesNotMatch(run(other), /prepared images/);
	});
});

test('transient network errors are recognized; deterministic errors are not', () => {
	for (const output of [
		'WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.22/main: temporary error (try again later)',
		'ERROR: https://dl-cdn.alpinelinux.org/alpine/v3.22/main: Permission denied',
		'curl: (55) OpenSSL SSL_read: OpenSSL/3.5.9: error:0A000126:SSL routines::unexpected eof while reading, errno 0',
		'curl: (6) Could not resolve host: composer.github.io',
		'E: Failed to fetch http://deb.debian.org/debian/pool/main/g/git/git_2.47.deb  Connection reset by peer',
		'failed to resolve source metadata for docker.io/library/wordpress:php8.5: net/http: TLS handshake timeout',
		'Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled',
		'toomanyrequests: You have reached your pull rate limit.',
		'The "https://repo.packagist.org/packages.json" file could not be downloaded: failed to open stream',
	]) {
		assert.equal(isTransientFailure(output), true, output);
	}
	for (const output of [
		'failed to solve: dockerfile parse error on line 3: unknown instruction: RUNN',
		'/bin/sh: 1: phpize: not found\nexit code: 127',
		'service "cli" refers to undefined volume',
		'Your requirements could not be resolved to an installable set of packages.',
	]) {
		assert.equal(isTransientFailure(output), false, output);
	}
});

test('withRetries retries a transient failure and recovers, logging each retry', async () => {
	const logs = [];
	const waits = [];
	const outputs = [
		{ code: 1, output: 'curl: (55) OpenSSL SSL_read: unexpected eof' },
		{ code: 0, output: '' },
	];
	const result = await withRetries({
		phase: 'image build',
		attempt: async () => outputs.shift(),
		sleep: async (seconds) => waits.push(seconds),
		logger: (line) => logs.push(line),
	});
	assert.deepEqual(result, { ok: true, attempts: 2 });
	assert.deepEqual(waits, [15]);
	assert.match(
		logs[0],
		/^::warning title=Transient network error during image build::Attempt 1\/3/
	);
});

test('withRetries gives up after three transient failures and never retries a deterministic one', async () => {
	let calls = 0;
	const exhausted = await withRetries({
		phase: 'image build',
		attempt: async () => {
			calls++;
			return {
				code: 1,
				output: 'Temporary failure resolving deb.debian.org',
			};
		},
		sleep: async () => {},
		logger() {},
	});
	assert.equal(calls, 3);
	assert.equal(exhausted.ok, false);
	assert.equal(exhausted.transient, true);

	calls = 0;
	const deterministic = await withRetries({
		phase: 'image build',
		attempt: async () => {
			calls++;
			return {
				code: 1,
				output: 'dockerfile parse error: unknown instruction',
			};
		},
		sleep: async () => assert.fail('must not wait'),
		logger() {},
	});
	assert.equal(calls, 1);
	assert.deepEqual(deterministic, {
		ok: false,
		attempts: 1,
		transient: false,
		error: 'dockerfile parse error: unknown instruction',
	});
});

const KEY = 'wp-env-images-v1-linux-x64-2026-W47-0123456789abcdef01234567';

// Simulated Docker: `images` is the local image store, each label the cache
// key it was built with. `failures` maps a command prefix to the outputs of
// its next failing attempts.
function fakeDocker({ images = {}, loads = {}, failures = {} } = {}) {
	const calls = [];
	const store = { ...images };
	return {
		calls,
		store,
		async run(args) {
			const command = args.join(' ');
			calls.push(command);
			for (const [prefix, queue] of Object.entries(failures)) {
				if (command.startsWith(prefix) && queue.length) {
					return { code: 1, output: queue.shift() };
				}
			}
			if (args[0] === 'load') {
				if (!loads.ok) {
					return {
						code: 1,
						output: 'Error: unexpected EOF in archive',
					};
				}
				Object.assign(store, loads.images);
				return { code: 0, output: '' };
			}
			if (args[0] === 'image' && args[1] === 'inspect') {
				const image = args.at(-1);
				return image in store
					? { code: 0, output: `${store[image] ?? ''}\n` }
					: { code: 1, output: 'No such image' };
			}
			if (args[0] === 'pull') {
				store[args[1]] = null;
			}
			if (args[0] === 'compose') {
				for (const service of ['wordpress', 'cli']) {
					store[`fair-wp-env/${service}:${KEY.slice(-24)}`] = KEY;
				}
			}
			return { code: 0, output: '' };
		},
	};
}

function fullStore(key = KEY) {
	return {
		[`fair-wp-env/wordpress:${KEY.slice(-24)}`]: key,
		[`fair-wp-env/cli:${KEY.slice(-24)}`]: key,
		'mariadb:lts': null,
		'wordpress:cli-php8.5': null,
		'wordpress:php8.5': null,
	};
}

async function prepare(docker, { archive = true, simulateFailure } = {}) {
	return withDirectory(async (directory) => {
		const archivePath = join(directory, 'images.tar');
		if (archive) {
			await writeFile(archivePath, 'archive');
		}
		return prepareImages({
			plan: fakePlan(),
			key: KEY,
			archive: archivePath,
			buildDirectory: join(directory, 'build'),
			docker,
			logger() {},
			sleep: async () => {},
			simulateFailure,
		});
	});
}

test('a valid restored archive is reused without pulling or building', async () => {
	const docker = fakeDocker({ loads: { ok: true, images: fullStore() } });
	const result = await prepare(docker);
	assert.equal(result.status, 'ready');
	assert.equal(result.cache, 'hit');
	assert.equal(result.save, false);
	assert.ok(docker.calls.every((call) => !/^(pull|compose|save)/.test(call)));
	assert.deepEqual(result.services.wordpress, {
		image: `fair-wp-env/wordpress:${KEY.slice(-24)}`,
		hash: 'wp-hash',
	});
});

test('a missing archive builds fresh, pulls current upstream images and saves', async () => {
	const docker = fakeDocker();
	const result = await prepare(docker, { archive: false });
	assert.equal(result.status, 'ready');
	assert.equal(result.cache, 'miss');
	assert.equal(result.save, true);
	const pulls = docker.calls.filter((call) => call.startsWith('pull '));
	assert.deepEqual(pulls, [
		'pull mariadb:lts',
		'pull wordpress:cli-php8.5',
		'pull wordpress:php8.5',
	]);
	assert.ok(docker.calls.findIndex((c) => c.startsWith('compose')) > 2);
	assert.ok(docker.calls.at(-1).startsWith('save -o '));
});

test('a corrupt or incompatible archive falls back to a fresh build', async () => {
	const corrupt = await prepare(fakeDocker({ loads: { ok: false } }));
	assert.equal(corrupt.cache, 'fallback');
	assert.match(corrupt.fallbackReason, /could not be loaded/);
	assert.equal(corrupt.status, 'ready');

	const otherKey = await prepare(
		fakeDocker({ loads: { ok: true, images: fullStore('another-key') } })
	);
	assert.equal(otherKey.cache, 'fallback');
	assert.match(otherKey.fallbackReason, /different cache key/);
	assert.equal(otherKey.status, 'ready');

	const images = fullStore();
	delete images['mariadb:lts'];
	const missing = await prepare(fakeDocker({ loads: { ok: true, images } }));
	assert.equal(missing.cache, 'fallback');
	assert.match(missing.fallbackReason, /mariadb:lts is missing/);
});

test('a temporary download failure during a fresh build is retried and recovers', async () => {
	const docker = fakeDocker({
		failures: {
			'compose ': [
				'target cli: failed to solve: process "/bin/sh -c curl -sS https://getcomposer.org/installer -o /tmp/composer-setup.php" did not complete successfully: exit code: 55\ncurl: (55) OpenSSL SSL_read: OpenSSL/3.5.9: error:0A000126:SSL routines::unexpected eof while reading, errno 0',
			],
			'pull wordpress:php8.5': ['net/http: TLS handshake timeout'],
		},
	});
	const result = await prepare(docker, { archive: false });
	assert.equal(result.status, 'ready');
	assert.equal(result.attempts.build, 2);
	assert.equal(result.attempts['pull wordpress:php8.5'], 2);
});

test('persistent or deterministic failures stop preparation with the failing phase', async () => {
	const persistent = await prepare(
		fakeDocker({
			failures: {
				'compose ': Array(3).fill(
					'ERROR: https://dl-cdn.alpinelinux.org/alpine/v3.22/main: temporary error (try again later)'
				),
			},
		}),
		{ archive: false }
	);
	assert.equal(persistent.status, 'failed');
	assert.equal(persistent.failurePhase, 'build');
	assert.equal(persistent.failedAttempts, 3);
	assert.equal(persistent.save, false);

	const docker = fakeDocker({
		failures: {
			'compose ': ['dockerfile parse error: unknown instruction'],
		},
	});
	const deterministic = await prepare(docker, { archive: false });
	assert.equal(deterministic.failedAttempts, 1);
	assert.equal(
		docker.calls.filter((call) => call.startsWith('compose')).length,
		1
	);
	assert.ok(docker.calls.every((call) => !call.startsWith('save')));
});

test('the build Compose file tags and labels images with the cache key', () => {
	const compose = buildComposeConfig(fakePlan(), KEY);
	assert.deepEqual(compose.services.wordpress, {
		image: `fair-wp-env/wordpress:${KEY.slice(-24)}`,
		build: {
			context: '.',
			dockerfile: 'WordPress.Dockerfile',
			args: { HOST_UID: '1001' },
			labels: { [adapter.KEY_LABEL]: KEY },
		},
	});
});

test('the runners start from prepared images only after a successful preparation', async () => {
	assert.deepEqual(await preparedStartEnvironment({}), {});

	await withDirectory(async (directory) => {
		const resultPath = join(directory, 'result.json');
		await writeFile(resultPath, JSON.stringify({ status: 'ready' }));
		const ready = await preparedStartEnvironment({
			FAIR_WP_ENV_PREPARED: resultPath,
			NODE_OPTIONS: '--max-old-space-size=4096',
		});
		assert.deepEqual(ready, {
			env: {
				FAIR_WP_ENV_IMAGE_MANIFEST: resultPath,
				NODE_OPTIONS: `--max-old-space-size=4096 --require=${ADAPTER_PATH}`,
			},
		});

		await writeFile(
			resultPath,
			JSON.stringify({
				status: 'failed',
				failurePhase: 'build',
				error: 'curl: (55)',
			})
		);
		const failed = await preparedStartEnvironment({
			FAIR_WP_ENV_PREPARED: resultPath,
		});
		assert.match(
			failed.error,
			/^Environment preparation failed during build/
		);

		const unreadable = await preparedStartEnvironment({
			FAIR_WP_ENV_PREPARED: join(directory, 'missing.json'),
		});
		assert.match(unreadable.error, /cannot read/);
	});
});

test('failure reporting names failed preparation phases, latest attempt first', () => {
	const failures = findPreparationFailures([
		{
			name: 'wp-env-prepare-api-shard-2-of-4-attempt-1',
			result: {
				status: 'failed',
				failurePhase: 'build',
				error: 'curl: (55)',
			},
		},
		{
			name: 'wp-env-prepare-api-shard-3-of-4-attempt-1',
			result: { status: 'failed', failurePhase: 'pull', error: 'TLS' },
		},
		{
			name: 'wp-env-prepare-api-shard-3-of-4-attempt-2',
			result: { status: 'ready' },
		},
		{ name: 'wp-env-prepare-api-shard-4-of-4-attempt-1', result: null },
		{ name: 'api-report-shard-1-of-4-attempt-1', result: null },
	]);
	assert.deepEqual(failures, [
		{
			label: 'api-shard-2-of-4',
			attempt: 1,
			phase: 'build',
			error: 'curl: (55)',
		},
		{
			label: 'api-shard-4-of-4',
			attempt: 1,
			phase: 'unknown',
			error: 'no result was written',
		},
	]);

	const summary = formatSummary({
		status: 'failed',
		failurePhase: 'build',
		failedAttempts: 3,
		error: 'curl: (55) | eof',
		cache: 'miss',
		attempts: { build: 3 },
		timings: { build: 120.5 },
		key: KEY,
	});
	assert.match(summary, /^### Environment preparation failed/);
	assert.match(summary, /not a test failure/);
	assert.match(summary, /curl: \(55\) \\\| eof/);
});

test('the preparation action restores exact keys only', async () => {
	const action = await readFile(
		join(ROOT, '.github/actions/prepare-wp-env/action.yml'),
		'utf8'
	);
	assert.doesNotMatch(action, /^\s+restore-keys:/m);
	for (const workflow of ['e2e', 'api-tests', 'performance']) {
		const text = await readFile(
			join(ROOT, `.github/workflows/${workflow}.yml`),
			'utf8'
		);
		assert.match(
			text,
			/uses: \.\/\.github\/actions\/prepare-wp-env/,
			workflow
		);
		assert.doesNotMatch(text, /docker (pull|load|save)/, workflow);
	}
});

test('a simulated failure skips reuse and exercises the retry or failure path', async () => {
	const transientDocker = fakeDocker({
		loads: { ok: true, images: fullStore() },
	});
	const transient = await prepare(transientDocker, {
		simulateFailure: 'transient',
	});
	assert.equal(transient.status, 'ready');
	assert.equal(transient.attempts.build, 2);
	assert.ok(transientDocker.calls.every((call) => !call.startsWith('load')));

	const persistent = await prepare(fakeDocker(), {
		simulateFailure: 'persistent',
	});
	assert.equal(persistent.status, 'failed');
	assert.equal(persistent.failedAttempts, 3);
	assert.match(persistent.error, /simulated/);
});

test('docker is resolved from fixed absolute paths, never from PATH', async () => {
	await withDirectory(async (directory) => {
		const missing = join(directory, 'missing-docker');
		const present = join(directory, 'docker');
		await writeFile(present, '');
		assert.equal(resolveDocker([missing, present]), present);
		assert.throws(
			() => resolveDocker([missing]),
			new RegExp(`docker not found in ${missing}`)
		);
	});
});

test('createDocker runs the resolved binary with BuildKit enabled', async () => {
	await withDirectory(async (directory) => {
		const docker = join(directory, 'docker');
		await writeFile(docker, '#!/bin/sh\necho "$DOCKER_BUILDKIT $*"\n');
		await chmod(docker, 0o755);
		const log = join(directory, 'prepare.log');
		const runner = createDocker({ log, docker });
		const result = await runner.run(['image', 'ls'], { quiet: true });
		await runner.close();
		assert.equal(result.code, 0);
		assert.equal(result.output.trim(), '1 image ls');
		assert.match(await readFile(log, 'utf8'), /\$ docker image ls/);
	});
});
