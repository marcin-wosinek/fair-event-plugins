#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Prepare the wp-env Docker images for CI without depending on package
 * mirrors on every run (#2359).
 *
 *   node scripts/wp-env-images.mjs key
 *   node scripts/wp-env-images.mjs prepare --archive=<tar> [--results-dir=<dir>]
 *
 * `key` prints the exact cache key for the images this checkout would build,
 * and writes it to $GITHUB_OUTPUT. `prepare` loads a restored archive and
 * validates it (a hit), or pulls the upstream images and builds the images
 * wp-env generates itself, retrying transient network errors (a miss, or a
 * fallback when the archive is missing pieces or corrupt). It then writes a
 * manifest that the runners hand to `wp-env start` through
 * scripts/wp-env-image-adapter.cjs, so the start builds and pulls nothing.
 *
 * See TESTING.md § CI environment images.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const adapter = require('./wp-env-image-adapter.cjs');

export const SCHEMA_VERSION = 1;
export const ADAPTER_PATH = fileURLToPath(
	new URL('./wp-env-image-adapter.cjs', import.meta.url)
);
export const PREPARED_ENV = 'FAIR_WP_ENV_PREPARED';
const ROOT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url)).replace(
	/\/$/,
	''
);
const IMAGE_REPOSITORY = 'fair-wp-env';
// The getcomposer.org failure from #2359, for WP_ENV_IMAGES_SIMULATE_FAILURE.
const SIMULATED_FAILURE =
	'target cli: failed to solve: process "/bin/sh -c curl -sS https://getcomposer.org/installer -o /tmp/composer-setup.php" did not complete successfully: exit code: 55\ncurl: (55) OpenSSL SSL_read: OpenSSL/3.5.9: error:0A000126:SSL routines::unexpected eof while reading, errno 0 (simulated)';
const BUILD_PROJECT = 'fair-wp-env-images';

// Files whose contents decide whether a cached build may be reused, besides
// the generated Dockerfiles themselves.
export const KEY_FILES = [
	'.wp-env.json',
	'.wp-env.override.json',
	'package.json',
	'package-lock.json',
	'scripts/wp-env-images.mjs',
	'scripts/wp-env-image-adapter.cjs',
	'.github/actions/prepare-wp-env/action.yml',
];

/**
 * ISO 8601 week of a date, e.g. `2026-W47`: the weekly refresh epoch.
 *
 * @param {Date} date Any instant.
 * @return {string} The ISO week.
 */
export function isoWeek(date) {
	const day = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
	const weekday = day.getUTCDay() || 7;
	day.setUTCDate(day.getUTCDate() + 4 - weekday);
	const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
	return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The exact cache key for a build plan. Every input that changes the built
 * images is part of it, so no prefix match may ever be restored.
 *
 * @param {Object} inputs              Key inputs.
 * @param {Object} inputs.plan         Build plan from createBuildPlan().
 * @param {Object} inputs.runner       { os, arch, image, imageVersion }.
 * @param {Object} inputs.files        Map of KEY_FILES path → sha256 (or null).
 * @param {string} inputs.epoch        Weekly refresh epoch (isoWeek()).
 * @return {{ key: string, digest: string }} Cache key and its full digest.
 */
export function computeCacheKey({ plan, runner, files, epoch }) {
	const material = {
		schema: SCHEMA_VERSION,
		epoch,
		runner,
		wpEnvVersion: plan.wpEnvVersion,
		builds: plan.builds
			.map(({ service, hash }) => ({ service, hash }))
			.sort((a, b) => a.service.localeCompare(b.service)),
		upstream: [...plan.upstream].sort((a, b) => a.localeCompare(b)),
		files: Object.fromEntries(
			Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
		),
	};
	const digest = createHash('sha256')
		.update(JSON.stringify(material))
		.digest('hex');
	const label = `${runner.os}-${runner.arch}`.toLowerCase();
	return {
		key: `wp-env-images-v${SCHEMA_VERSION}-${label}-${epoch}-${digest.slice(
			0,
			24
		)}`,
		digest,
	};
}

/**
 * GitHub-hosted runner identity; local runs fall back to the Node platform.
 *
 * @param {Object} env Process environment.
 * @return {Object} Runner identity for the cache key.
 */
export function runnerIdentity(env = process.env) {
	return {
		os: env.RUNNER_OS ?? process.platform,
		arch: env.RUNNER_ARCH ?? process.arch,
		image: env.ImageOS ?? null,
		imageVersion: env.ImageVersion ?? null,
	};
}

export async function hashKeyFiles(root, files = KEY_FILES) {
	const hashes = {};
	for (const file of files) {
		const path = join(root, file);
		hashes[file] = existsSync(path)
			? createHash('sha256')
					.update(await readFile(path))
					.digest('hex')
			: null;
	}
	return hashes;
}

// Download and network failures seen from Docker pulls, BuildKit, apk,
// apt-get, curl (Composer installer and signature) and Composer itself.
const TRANSIENT_PATTERNS = [
	/curl: \((?:5|6|7|16|18|28|35|52|55|56|92)\)/i,
	/SSL_read|SSL_connect|SSL routines|TLS handshake timeout|unexpected eof while reading/i,
	/\b(?:connection (?:reset|refused|timed out)|connection was reset|broken pipe)\b/i,
	/temporary failure (?:in name resolution|resolving)/i,
	/could not resolve (?:host|proxy)/i,
	/\bi\/o timeout\b|\bnet\/http: (?:request canceled|TLS handshake timeout)/i,
	/\bunexpected EOF\b/,
	/\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/i,
	/toomanyrequests|rate limit exceeded/i,
	/ERROR: https?:\/\/\S+: (?:temporary error|network error|DNS lookup error|IO ERROR|could not connect|Permission denied)/i,
	/WARNING: (?:fetching|updating) https?:\/\/\S+: (?:temporary error|network error|DNS lookup error|IO ERROR)/i,
	/Failed to fetch https?:\/\/|Unable to fetch some archives|Hash Sum mismatch|Could not connect to \S+:\d+/i,
	/The "https?:\/\/[^"]+" file could not be downloaded|curl error \d+ while downloading/i,
	/failed to (?:copy|do request|resolve source metadata|fetch anonymous token|authorize)/i,
	/Installer corrupt/,
];

/**
 * Whether a failed step's output is a recognized transient network error.
 * Anything else (a configuration error, an unknown failure) is deterministic
 * and is never retried.
 *
 * @param {string} output Captured stdout and stderr.
 * @return {boolean} True for a transient network error.
 */
export function isTransientFailure(output) {
	return TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

function lastMeaningfulLine(output) {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	return (
		lines.findLast((line) => /error|fail|curl: \(/i.test(line)) ??
		lines.at(-1) ??
		''
	).slice(0, 300);
}

/**
 * Run one preparation step, retrying recognized transient network errors.
 *
 * @param {Object}   options          Options.
 * @param {string}   options.phase    Phase name for logs and the result.
 * @param {Function} options.attempt  Runs the step; resolves to { code, output }.
 * @param {number}   [options.attempts] Maximum attempts.
 * @param {number[]} [options.delays] Seconds to wait before attempt 2, 3, ….
 * @param {Function} [options.sleep]  Waits the given number of seconds.
 * @param {Function} [options.logger] Log sink.
 * @return {Promise<Object>} { ok, attempts, transient, error }.
 */
export async function withRetries({
	phase,
	attempt,
	attempts = 3,
	delays = [15, 45],
	sleep = (seconds) =>
		new Promise((done) => setTimeout(done, seconds * 1000)),
	logger = console.log,
}) {
	for (let number = 1; ; number++) {
		const { code, output } = await attempt(number);
		if (code === 0) {
			return { ok: true, attempts: number };
		}
		const transient = isTransientFailure(output);
		const error = lastMeaningfulLine(output) || `exit status ${code}`;
		if (!transient || number >= attempts) {
			return { ok: false, attempts: number, transient, error };
		}
		const delay = delays[Math.min(number - 1, delays.length - 1)];
		logger(
			`::warning title=Transient network error during ${phase}::Attempt ${number}/${attempts} failed (${error}); retrying in ${delay} s.`
		);
		await sleep(delay);
	}
}

// Fixed, root-owned locations of the docker CLI. Running it from one of these
// instead of searching PATH keeps a writable PATH entry from substituting
// another binary (SonarCloud S4036). The script runs on GitHub's Ubuntu
// runners, where docker is /usr/bin/docker.
export const DOCKER_CANDIDATES = ['/usr/bin/docker', '/usr/local/bin/docker'];

/**
 * Finds the docker CLI among fixed, unwriteable locations.
 *
 * @param {string[]} candidates Absolute paths to try, in order.
 * @return {string} The first existing path.
 */
export function resolveDocker(candidates = DOCKER_CANDIDATES) {
	const docker = candidates.find((path) => existsSync(path));
	if (!docker) {
		throw new Error(`docker not found in ${candidates.join(', ')}`);
	}
	return docker;
}

/**
 * Spawns docker, teeing its output to the console and the preparation log and
 * keeping the tail for failure classification.
 *
 * @param {Object} options        Options.
 * @param {string} options.log    Path of the preparation log.
 * @param {string} options.docker Absolute path of the docker CLI.
 * @return {Object} { run(args, { quiet }) }.
 */
export function createDocker({ log, docker = resolveDocker() }) {
	const stream = createWriteStream(log, { flags: 'a' });
	return {
		run(args, { quiet = false } = {}) {
			stream.write(`\n$ docker ${args.join(' ')}\n`);
			return new Promise((done) => {
				const child = spawn(docker, args, {
					env: { ...process.env, DOCKER_BUILDKIT: '1' },
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				let output = '';
				const collect = (chunk) => {
					output = (output + chunk).slice(-200_000);
					stream.write(chunk);
					if (!quiet) {
						process.stdout.write(chunk);
					}
				};
				child.stdout.on('data', collect);
				child.stderr.on('data', collect);
				child.on('error', (error) =>
					done({ code: 1, output: `${output}\n${error.message}` })
				);
				child.on('close', (code) => done({ code: code ?? 1, output }));
			});
		},
		close() {
			return new Promise((done) => stream.end(done));
		},
	};
}

function imageTag(service, key) {
	return `${IMAGE_REPOSITORY}/${service}:${key.slice(-24)}`;
}

/**
 * The Compose file used to build the generated images, tagged and labelled
 * with the cache key.
 *
 * @param {Object} plan Build plan.
 * @param {string} key  Cache key.
 * @return {Object} Compose config.
 */
export function buildComposeConfig(plan, key) {
	return {
		services: Object.fromEntries(
			plan.builds.map(({ service, dockerfile, args }) => [
				service,
				{
					image: imageTag(service, key),
					build: {
						context: '.',
						dockerfile,
						args,
						labels: { [adapter.KEY_LABEL]: key },
					},
				},
			])
		),
	};
}

/**
 * Restore or build every image `wp-env start` needs.
 *
 * @param {Object}   options               Options.
 * @param {Object}   options.plan          Build plan.
 * @param {string}   options.key           Cache key.
 * @param {string}   options.archive       Image archive path (restored/saved by CI).
 * @param {string}   options.buildDirectory Directory for generated build files.
 * @param {Object}   options.docker        { run(args, opts) }.
 * @param {Function} [options.logger]      Log sink.
 * @param {Function} [options.clock]       Milliseconds clock.
 * @param {Function} [options.sleep]       Retry wait.
 * @return {Promise<Object>} The preparation result.
 */
export async function prepareImages({
	plan,
	key,
	archive,
	buildDirectory,
	docker,
	logger = console.log,
	clock = () => performance.now(),
	sleep,
	simulateFailure,
}) {
	const services = Object.fromEntries(
		plan.builds.map(({ service, hash }) => [
			service,
			{ image: imageTag(service, key), hash },
		])
	);
	const result = {
		schema: SCHEMA_VERSION,
		key,
		wpEnvVersion: plan.wpEnvVersion,
		status: 'running',
		cache: 'miss',
		fallbackReason: null,
		save: false,
		failurePhase: null,
		error: null,
		attempts: {},
		timings: {},
		services,
		upstream: plan.upstream,
	};
	const timed = async (name, step) => {
		const started = clock();
		try {
			return await step();
		} finally {
			result.timings[name] =
				Math.round(clock() - started) / 1000 +
				(result.timings[name] ?? 0);
		}
	};
	const fail = (phase, outcome) => {
		result.status = 'failed';
		result.failurePhase = phase;
		result.failedAttempts = outcome.attempts ?? 1;
		result.error = outcome.error;
		return result;
	};

	const validate = async () => {
		for (const [service, { image }] of Object.entries(services)) {
			const inspect = await docker.run(
				[
					'image',
					'inspect',
					'--format',
					`{{ index .Config.Labels "${adapter.KEY_LABEL}" }}`,
					image,
				],
				{ quiet: true }
			);
			if (inspect.code !== 0) {
				return `the ${service} image ${image} is missing`;
			}
			if (inspect.output.trim() !== key) {
				return `the ${service} image ${image} carries a different cache key`;
			}
		}
		for (const image of plan.upstream) {
			const inspect = await docker.run(['image', 'inspect', image], {
				quiet: true,
			});
			if (inspect.code !== 0) {
				return `the upstream image ${image} is missing`;
			}
		}
		return null;
	};

	if (simulateFailure) {
		logger(
			`::warning title=Simulated network failure::WP_ENV_IMAGES_SIMULATE_FAILURE=${simulateFailure}: ignoring reusable images and failing the image build ${
				simulateFailure === 'persistent' ? 'on every attempt' : 'once'
			}.`
		);
	} else if (existsSync(archive)) {
		logger(`Loading reusable images from ${archive}.`);
		const load = await timed('load', () =>
			docker.run(['load', '-i', archive], { quiet: true })
		);
		const problem =
			load.code === 0
				? await timed('validate', validate)
				: `the archive could not be loaded (${lastMeaningfulLine(
						load.output
					)})`;
		if (!problem) {
			result.cache = 'hit';
			result.status = 'ready';
			logger(
				'Reusing prepared images: nothing is pulled or built for this run.'
			);
			return result;
		}
		result.cache = 'fallback';
		result.fallbackReason = problem;
		logger(
			`::warning title=Rebuilding wp-env images::Reusable images were unusable (${problem}); building fresh.`
		);
	} else {
		logger('No reusable images for this cache key; building fresh.');
	}

	// A fresh build always starts from current upstream images, so the weekly
	// key refresh also picks up their security updates.
	for (const image of plan.upstream) {
		const pulled = await timed('pull', () =>
			withRetries({
				phase: `pull ${image}`,
				attempt: () => docker.run(['pull', image]),
				logger,
				sleep,
			})
		);
		result.attempts[`pull ${image}`] = pulled.attempts;
		if (!pulled.ok) {
			return fail('pull', pulled);
		}
	}

	await mkdir(buildDirectory, { recursive: true });
	for (const { dockerfile, contents } of plan.builds) {
		await writeFile(join(buildDirectory, dockerfile), contents);
	}
	const composeFile = join(buildDirectory, 'docker-compose.yml');
	// JSON is valid YAML, so Compose reads this without a YAML dependency.
	await writeFile(
		composeFile,
		`${JSON.stringify(buildComposeConfig(plan, key), null, 2)}\n`
	);
	// BuildKit keeps every layer that finished, so a retry resumes at the
	// failed step instead of starting over.
	const built = await timed('build', () =>
		withRetries({
			phase: 'image build',
			attempt: (number) =>
				simulateFailure === 'persistent' ||
				(simulateFailure === 'transient' && number === 1)
					? { code: 1, output: SIMULATED_FAILURE }
					: docker.run([
							'compose',
							'--project-name',
							BUILD_PROJECT,
							'--file',
							composeFile,
							'build',
							'--progress=plain',
						]),
			logger,
			sleep,
		})
	);
	result.attempts.build = built.attempts;
	if (!built.ok) {
		return fail('build', built);
	}

	const problem = await timed('validate', validate);
	if (problem) {
		return fail('validate', { error: problem });
	}

	const save = await timed('save', () =>
		docker.run(
			[
				'save',
				'-o',
				archive,
				...Object.values(services).map(({ image }) => image),
				...plan.upstream,
			],
			{ quiet: true }
		)
	);
	if (save.code !== 0) {
		// The images are built and usable; only the cache entry is lost.
		logger(
			`::warning title=wp-env images not cached::Saving the image archive failed (${lastMeaningfulLine(
				save.output
			)}); the next run builds again.`
		);
	} else {
		result.save = true;
	}
	result.status = 'ready';
	return result;
}

/**
 * Markdown for the job summary.
 *
 * @param {Object} result Preparation result.
 * @return {string} Summary section.
 */
export function formatSummary(result) {
	const timings = Object.entries(result.timings)
		.map(([phase, seconds]) => `${phase} ${seconds.toFixed(1)} s`)
		.join(', ');
	const attempts = Object.entries(result.attempts)
		.map(([phase, count]) => `${phase}: ${count}`)
		.join(', ');
	const rows = [
		['Cache', result.cache],
		...(result.fallbackReason
			? [['Fallback reason', result.fallbackReason]]
			: []),
		['Attempts', attempts || 'none needed'],
		['Timings', timings || '—'],
		['Key', `\`${result.key}\``],
	];
	if (result.status === 'failed') {
		return [
			'### Environment preparation failed',
			'',
			'No tests ran: the WordPress test environment could not be prepared. This is an environment problem, not a test failure. Rerun the job; the preparation log is in the `wp-env-prepare-*` artifact.',
			'',
			'| | |',
			'| --- | --- |',
			['Failed phase', result.failurePhase],
			['Attempts in that phase', result.failedAttempts ?? 1],
			['Error', result.error],
			...rows,
		]
			.map((row) =>
				Array.isArray(row)
					? `| ${row[0]} | ${String(row[1]).replaceAll('|', '\\|')} |`
					: row
			)
			.join('\n');
	}
	return [
		'### Environment preparation',
		'',
		'| | |',
		'| --- | --- |',
		...rows.map(([name, value]) => `| ${name} | ${value} |`),
	].join('\n');
}

/**
 * Environment additions for `wp-env start` in the runners. Without a prepared
 * result (local runs) wp-env builds as usual. A failed preparation refuses to
 * start, so no test runs on an unprepared environment.
 *
 * @param {Object} env Process environment.
 * @return {Promise<Object>} { env } to merge into the start command, or { error }.
 */
export async function preparedStartEnvironment(env = process.env) {
	const resultPath = env[PREPARED_ENV];
	if (!resultPath) {
		return {};
	}
	let result;
	try {
		result = JSON.parse(await readFile(resultPath, 'utf8'));
	} catch (error) {
		return {
			error: `Environment preparation failed: cannot read ${resultPath} (${error.message}).`,
		};
	}
	if (result.status !== 'ready') {
		return {
			error: `Environment preparation failed during ${
				result.failurePhase ?? 'an unknown phase'
			}: ${result.error ?? 'no details'}.`,
		};
	}
	return {
		env: {
			[adapter.MANIFEST_ENV]: resultPath,
			NODE_OPTIONS: [env.NODE_OPTIONS, `--require=${ADAPTER_PATH}`]
				.filter(Boolean)
				.join(' '),
		},
	};
}

/**
 * Find the shards whose latest attempt failed environment preparation, from
 * downloaded `wp-env-prepare-<label>-attempt-<n>` artifact directories.
 *
 * @param {Array<{ name: string, result: Object|null }>} artifacts Artifacts.
 * @return {Array<Object>} { label, attempt, phase, error } per failed shard.
 */
export function findPreparationFailures(artifacts) {
	const latest = new Map();
	for (const { name, result } of artifacts) {
		const match = name.match(/^wp-env-prepare-(.+)-attempt-(\d+)$/);
		if (!match) {
			continue;
		}
		const [, label, attempt] = match;
		if (Number(attempt) >= (latest.get(label)?.attempt ?? 0)) {
			latest.set(label, { label, attempt: Number(attempt), result });
		}
	}
	return [...latest.values()]
		.filter(({ result }) => result?.status !== 'ready')
		.map(({ label, attempt, result }) => ({
			label,
			attempt,
			phase: result?.failurePhase ?? 'unknown',
			error: result?.error ?? 'no result was written',
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

async function readArtifacts(directory) {
	const { readdir } = await import('node:fs/promises');
	if (!existsSync(directory)) {
		return [];
	}
	const artifacts = [];
	for (const name of await readdir(directory)) {
		const path = join(directory, name, 'result.json');
		artifacts.push({
			name,
			result: existsSync(path)
				? JSON.parse(await readFile(path, 'utf8'))
				: null,
		});
	}
	return artifacts;
}

function parseSimulation(value) {
	if (!value || value === 'none') {
		return undefined;
	}
	if (!['transient', 'persistent'].includes(value)) {
		throw new Error(
			`WP_ENV_IMAGES_SIMULATE_FAILURE must be none, transient or persistent, not "${value}".`
		);
	}
	return value;
}

function parseArguments(args) {
	const [command, ...rest] = args;
	const options = { command };
	for (const argument of rest) {
		const match = argument.match(/^--([a-z-]+)=(.*)$/);
		if (!match) {
			throw new Error(`Unknown argument: ${argument}`);
		}
		options[match[1]] = match[2];
	}
	if (!['key', 'prepare', 'report'].includes(command)) {
		throw new Error(
			'Usage: wp-env-images.mjs key | prepare --archive=<tar> | report --results=<dir>'
		);
	}
	if (command === 'report' && !options.results) {
		throw new Error('report needs --results=<dir>.');
	}
	if (command === 'prepare' && !options.archive) {
		throw new Error('prepare needs --archive=<path>.');
	}
	return options;
}

async function resolveKey(root, env) {
	const plan = await adapter.createBuildPlan(root);
	const { key } = computeCacheKey({
		plan,
		runner: runnerIdentity(env),
		files: await hashKeyFiles(root),
		epoch: env.WP_ENV_IMAGES_EPOCH || isoWeek(new Date()),
	});
	return { plan, key };
}

async function main() {
	let options;
	try {
		options = parseArguments(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
		return;
	}
	const env = process.env;
	const outputs = async (values) => {
		if (env.GITHUB_OUTPUT) {
			await appendFile(
				env.GITHUB_OUTPUT,
				Object.entries(values)
					.map(([name, value]) => `${name}=${value}\n`)
					.join('')
			);
		}
	};

	if (options.command === 'report') {
		const failures = findPreparationFailures(
			await readArtifacts(resolve(options.results))
		);
		for (const failure of failures) {
			console.log(
				`::error title=Environment preparation failed::${failure.label} (attempt ${failure.attempt}) could not prepare the WordPress test environment during ${failure.phase}: ${failure.error}. No tests ran there; rerun the failed job.`
			);
		}
		if (failures.length && env.GITHUB_STEP_SUMMARY) {
			await appendFile(
				env.GITHUB_STEP_SUMMARY,
				[
					'### Environment preparation failed',
					'',
					'These jobs failed before any test ran. They are environment problems, not test failures:',
					'',
					...failures.map(
						(failure) =>
							`- **${failure.label}** (attempt ${failure.attempt}), ${failure.phase}: ${failure.error}`
					),
					'',
				].join('\n')
			);
		}
		await outputs({ environment_failures: String(failures.length) });
		return;
	}

	if (options.command === 'key') {
		const { key } = await resolveKey(ROOT_DIRECTORY, env);
		console.log(key);
		await outputs({ key });
		return;
	}

	const resultsDirectory = resolve(
		ROOT_DIRECTORY,
		options['results-dir'] ?? 'wp-env-prepare'
	);
	await mkdir(resultsDirectory, { recursive: true });
	const resultPath = join(resultsDirectory, 'result.json');
	const docker = createDocker({ log: join(resultsDirectory, 'prepare.log') });
	const started = performance.now();
	let result;
	try {
		const { plan, key } = await resolveKey(ROOT_DIRECTORY, env);
		if (options.key && options.key !== key) {
			throw new Error(
				`The cache key changed between restore (${options.key}) and preparation (${key}).`
			);
		}
		result = await prepareImages({
			plan,
			key,
			archive: resolve(options.archive),
			buildDirectory: join(resultsDirectory, 'build'),
			docker,
			simulateFailure: parseSimulation(
				env.WP_ENV_IMAGES_SIMULATE_FAILURE
			),
		});
	} catch (error) {
		result = {
			schema: SCHEMA_VERSION,
			status: 'failed',
			cache: 'unknown',
			failurePhase: 'configuration',
			error: error.message,
			attempts: {},
			timings: {},
			save: false,
		};
	}
	await docker.close();
	result.timings.total = Math.round(performance.now() - started) / 1000;
	result.archiveBytes = existsSync(resolve(options.archive))
		? (await stat(resolve(options.archive))).size
		: 0;
	await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
	const summary = formatSummary(result);
	console.log(`\n${summary}\n`);
	if (env.GITHUB_STEP_SUMMARY) {
		await appendFile(env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
	}
	await outputs({ status: result.status, save: String(result.save) });
	if (result.status !== 'ready') {
		console.log(
			`::error title=Environment preparation failed::${
				result.failurePhase
			} failed after ${result.failedAttempts ?? 1} attempt(s): ${
				result.error
			}. No tests ran; this is not a test failure.`
		);
		process.exitCode = 1;
		return;
	}
	if (env.GITHUB_ENV) {
		await appendFile(env.GITHUB_ENV, `${PREPARED_ENV}=${resultPath}\n`);
	}
	console.log(
		`Images ready (${result.cache}); archive ${(
			result.archiveBytes /
			1024 ** 3
		).toFixed(2)} GiB.`
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
