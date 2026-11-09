#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import {
	access,
	appendFile,
	mkdir,
	readFile,
	writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
	describeAssignment,
	parseShard,
	planSuite,
	writeTestLists,
} from './shard-assignment.mjs';

export { parseShard };

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const ROOT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url)).replace(
	/\/$/,
	''
);

export function parseArguments(args) {
	let reuse = false;
	let suite = 'api';
	let workspace;
	let resultsDir;
	let forwarded = [];

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--reuse') {
			reuse = true;
		} else if (argument.startsWith('--suite=')) {
			suite = argument.slice('--suite='.length);
		} else if (argument === '--workspace') {
			workspace = args[++index];
		} else if (argument.startsWith('--workspace=')) {
			workspace = argument.slice('--workspace='.length);
		} else if (argument.startsWith('--results-dir=')) {
			resultsDir = argument.slice('--results-dir='.length);
		} else if (argument !== '--') {
			forwarded.push(argument);
		}
	}

	if (
		workspace === '' ||
		(workspace === undefined && args.includes('--workspace'))
	) {
		throw new Error('The --workspace option requires a value.');
	}
	if (!['api', 'e2e'].includes(suite)) {
		throw new Error('The --suite option must be either "api" or "e2e".');
	}
	if (resultsDir === '') {
		throw new Error('The --results-dir option requires a value.');
	}
	if (resultsDir !== undefined && suite !== 'api') {
		throw new Error('The --results-dir option applies to the API suite.');
	}

	// The runner owns --shard for both suites: it assigns whole spec files by
	// recorded duration (scripts/shard-assignment.mjs) and hands each run an
	// explicit --test-list instead of Playwright's own sharding.
	let shard;
	const shardArguments = forwarded.filter((value) =>
		value.startsWith('--shard')
	);
	if (shardArguments.length > 1) {
		throw new Error('Pass --shard at most once.');
	}
	if (shardArguments.length) {
		if (!shardArguments[0].startsWith('--shard=')) {
			throw new Error(
				'The --shard option must look like --shard=<current>/<total>, e.g. --shard=2/4.'
			);
		}
		shard = parseShard(shardArguments[0].slice('--shard='.length));
		forwarded = forwarded.filter((value) => !value.startsWith('--shard'));
		if (forwarded.some((value) => value.startsWith('--test-list'))) {
			throw new Error(
				'The --shard option selects files with its own --test-list; pass one or the other.'
			);
		}
		if (suite === 'e2e' && workspace !== undefined) {
			throw new Error(
				'Balanced E2E shards cover the root suite only; drop --workspace or --shard.'
			);
		}
	}

	return { reuse, suite, workspace, forwarded, shard, resultsDir };
}

export async function loadWorkspaces(rootDirectory) {
	const rootPackage = JSON.parse(
		await readFile(`${rootDirectory}/package.json`, 'utf8')
	);
	const suiteWorkspaces = { api: [], e2e: [] };

	for (const workspace of rootPackage.workspaces) {
		const workspacePackage = JSON.parse(
			await readFile(`${rootDirectory}/${workspace}/package.json`, 'utf8')
		);
		for (const suite of Object.keys(suiteWorkspaces)) {
			if (workspacePackage.scripts?.[`test:${suite}`]) {
				suiteWorkspaces[suite].push(workspace);
			}
		}
	}

	return { workspaces: rootPackage.workspaces, suiteWorkspaces };
}

async function readJsonIfPresent(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

// Resolve the tests port the way wp-env does, so a worktree that moves its
// tests site in .wp-env.override.json is tested on its own instance. The
// WP_ENV_TESTS_PORT variable wins. Otherwise the override file is merged over
// .wp-env.json, and a merged env.tests.port takes precedence over testsPort.
export async function resolveTestsPort(rootDirectory, env = process.env) {
	if (env.WP_ENV_TESTS_PORT) {
		return Number(env.WP_ENV_TESTS_PORT);
	}
	const base = await readJsonIfPresent(`${rootDirectory}/.wp-env.json`);
	const override = await readJsonIfPresent(
		`${rootDirectory}/.wp-env.override.json`
	);
	const envTestsPort = override?.env?.tests?.port ?? base?.env?.tests?.port;
	const testsPort = override?.testsPort ?? base?.testsPort;
	return Number(envTestsPort ?? testsPort ?? 8889);
}

export async function validateChromium() {
	await access(chromium.executablePath());
}

export function createProcessExecutor({ cwd, env }) {
	let activeChild;

	return {
		run(command, args, options = {}) {
			return new Promise((resolve) => {
				const child = spawn(command, args, {
					cwd,
					env: options.env ? { ...env, ...options.env } : env,
					stdio: options.capture
						? ['ignore', 'pipe', 'inherit']
						: 'inherit',
				});
				activeChild = child;
				let stdout = '';
				child.stdout?.on('data', (chunk) => {
					stdout += chunk;
				});
				child.on('error', () => resolve({ code: 1, stdout }));
				child.on('exit', (code, signal) => {
					if (activeChild === child) {
						activeChild = undefined;
					}
					resolve({
						code: code ?? SIGNAL_EXIT_CODES[signal] ?? 1,
						stdout,
					});
				});
			});
		},
		terminate(signal) {
			activeChild?.kill(signal);
		},
	};
}

function phase(message, logger) {
	logger(`\n==> ${message}`);
}

function formatSeconds(seconds) {
	return seconds >= 60
		? `${(seconds / 60).toFixed(1)} min`
		: `${seconds.toFixed(1)} s`;
}

/**
 * Playwright arguments for one API workspace run. In a shard, the workspace
 * runs exactly the files of its `--test-list`. A results directory adds a
 * JSON report next to the HTML report, without dropping GitHub annotations.
 *
 * @param {Object} options    Parsed runner options.
 * @param {string} [testList] The workspace's test list in this shard.
 * @return {string[]} Arguments placed after `npm run test:api --workspace=… --`.
 */
export function apiWorkspaceArguments(options, testList) {
	const args = [];
	if (testList) {
		args.push(`--test-list=${testList}`);
	}
	if (options.resultsDir) {
		args.push('--reporter=github,html,json');
	}
	return [...args, ...options.forwarded];
}

/**
 * Files of one shard, from the duration-based assignment of the whole suite.
 *
 * @param {Object}   root            Parameters.
 * @param {string}   root.suite      "e2e" or "api".
 * @param {Object}   root.shard      Parsed shard.
 * @param {string[]} root.workspaces Every API workspace, in root order.
 * @return {Promise<{files: Object[], lines: string[]}>} The shard's files and
 *   a description of the whole assignment.
 */
export async function planShard({ suite, shard, workspaces }) {
	const { assignment } = await planSuite({
		rootDirectory: ROOT_DIRECTORY,
		suite,
		workspaces,
		total: shard.total,
	});
	return {
		files: assignment.shards[shard.current - 1],
		lines: describeAssignment(assignment),
	};
}

/**
 * Markdown summary of one runner invocation's timings, for the GitHub step
 * summary and the job log.
 *
 * @param {Object} timings Timings as written to timings.json.
 * @return {string} Markdown table.
 */
export function formatTimings(timings) {
	const suite = timings.suite === 'e2e' ? 'E2E' : 'API';
	const label = timings.shard
		? `${suite} shard ${timings.shard.current}/${timings.shard.total}`
		: `${suite} tests`;
	const rows = timings.phases.map(
		(entry) =>
			`| ${entry.name} | ${formatSeconds(entry.seconds)} | ${
				entry.code === 0 ? 'ok' : `exit ${entry.code}`
			} |`
	);
	return [
		`### ${label} timings`,
		'',
		'| Phase | Duration | Result |',
		'| --- | --- | --- |',
		...rows,
		'',
	].join('\n');
}

export async function runTests({
	options,
	executor,
	workspaceConfig,
	browserValidator = validateChromium,
	logger = console.log,
	signalSource = process,
	clock = () => performance.now(),
	writeTimings = async () => {},
	shardPlanner = planShard,
	testListWriter = writeTestLists,
}) {
	if (
		options.workspace &&
		(!workspaceConfig.workspaces.includes(options.workspace) ||
			!workspaceConfig.suiteWorkspaces[options.suite].includes(
				options.workspace
			))
	) {
		logger(
			`Workspace "${options.workspace}" does not define a test:${options.suite} script.`
		);
		return 2;
	}

	let ownsEnvironment = false;
	let interruptedSignal;
	let primaryResult;
	const onSignal = (signal) => {
		interruptedSignal ??= signal;
		executor.terminate(signal);
	};
	const onSigint = () => onSignal('SIGINT');
	const onSigterm = () => onSignal('SIGTERM');
	signalSource.on('SIGINT', onSigint);
	signalSource.on('SIGTERM', onSigterm);
	// A signal that lands between steps has no child to terminate, so later
	// steps are skipped instead of started.
	const runStep = async (command, args, runOptions) => {
		if (interruptedSignal) {
			return { code: SIGNAL_EXIT_CODES[interruptedSignal], stdout: '' };
		}
		return executor.run(command, args, runOptions);
	};
	const phases = [];
	// Runs a step and records how long it took, for CI benchmarks.
	const timedStep = async (name, command, args, runOptions) => {
		const startedAt = clock();
		const result = await runStep(command, args, runOptions);
		phases.push({
			name,
			seconds: Math.round(clock() - startedAt) / 1000,
			code: result.code,
		});
		return result;
	};

	try {
		// Select the shard's files first: listing needs no WordPress, and a
		// listing problem then fails before any build or container start.
		let testLists;
		if (options.shard) {
			const label = `${options.shard.current}/${options.shard.total}`;
			phase(`Selecting the files of shard ${label}`, logger);
			const selectionStart = clock();
			let selection;
			try {
				selection = await shardPlanner({
					suite: options.suite,
					shard: options.shard,
					workspaces: workspaceConfig.suiteWorkspaces.api,
				});
				testLists = await testListWriter(selection.files);
			} catch (error) {
				logger(
					`Could not assign spec files to shards: ${error.message}`
				);
				return 1;
			}
			phases.push({
				name: 'Shard selection',
				seconds: Math.round(clock() - selectionStart) / 1000,
				code: 0,
			});
			selection.lines.forEach((line) => logger(line));
			const selected = options.workspace
				? selection.files.filter(
						(file) => file.workspace === options.workspace
					)
				: selection.files;
			if (!selected.length) {
				logger(
					`Shard ${label} has no assigned spec files${
						options.workspace ? ` in ${options.workspace}` : ''
					}; nothing to run.`
				);
				return 0;
			}
		}

		if (options.suite === 'e2e') {
			phase('Validating Chromium browser dependency', logger);
			try {
				await browserValidator();
			} catch {
				logger(
					'Chromium is not installed for this Playwright version. Run `npx playwright install chromium` and retry.'
				);
				return 2;
			}
		}

		if (!options.reuse) {
			const status = await runStep(
				'npx',
				['wp-env', 'status', '--json'],
				{
					capture: true,
				}
			);
			if (status.code !== 0) {
				logger('Could not inspect the isolated wp-env test instance.');
				return status.code;
			}
			if (JSON.parse(status.stdout).status === 'running') {
				logger(
					'The isolated wp-env test instance is already running. Use --reuse to run against it explicitly, or stop it first.'
				);
				return 2;
			}

			phase(
				'Preparing builds and production Composer dependencies',
				logger
			);
			for (const [name, args] of [
				['Build', ['run', 'build']],
				['Composer install', ['run', 'composer:install:prod']],
			]) {
				const result = await timedStep(name, 'npm', args);
				if (result.code !== 0) {
					return result.code;
				}
			}

			phase('Starting isolated WordPress test environment', logger);
			// The instance was not running, so anything a failed or interrupted
			// start leaves behind belongs to this run and is stopped too.
			ownsEnvironment = true;
			const start = await timedStep('wp-env start', 'npx', [
				'wp-env',
				'start',
			]);
			if (start.code !== 0) {
				primaryResult = start.code;
				return primaryResult;
			}
		} else {
			phase(
				'Reusing explicitly managed WordPress test environment',
				logger
			);
		}

		phase('Checking WordPress readiness', logger);
		const readinessCommands = [];
		if (!options.reuse) {
			readinessCommands.push([
				'wp-env',
				'run',
				'tests-cli',
				'wp',
				'rewrite',
				'structure',
				'/%postname%/',
				'--hard',
			]);
		}
		readinessCommands.push([
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'core',
			'is-installed',
		]);
		const readinessStart = clock();
		for (const args of readinessCommands) {
			const result = await runStep('npx', args);
			if (result.code !== 0) {
				primaryResult = result.code;
				return primaryResult;
			}
		}
		phases.push({
			name: 'WordPress readiness',
			seconds: Math.round(clock() - readinessStart) / 1000,
			code: 0,
		});

		if (options.suite === 'api') {
			primaryResult = await runApiWorkspaces({
				options,
				workspaces: options.workspace
					? [options.workspace]
					: workspaceConfig.suiteWorkspaces.api,
				timedStep,
				logger,
				isInterrupted: () => Boolean(interruptedSignal),
				testLists,
			});
			return primaryResult;
		}

		phase('Running E2E tests', logger);
		const testArgs = ['run', `test:${options.suite}`];
		if (options.workspace) {
			testArgs.push(`--workspace=${options.workspace}`);
		}
		const playwrightArgs = testLists
			? [`--test-list=${testLists.get(undefined)}`, ...options.forwarded]
			: options.forwarded;
		if (playwrightArgs.length) {
			testArgs.push('--', ...playwrightArgs);
		}
		primaryResult = (await runStep('npm', testArgs)).code;
		return primaryResult;
	} finally {
		signalSource.off('SIGINT', onSigint);
		signalSource.off('SIGTERM', onSigterm);
		let cleanupFailure;
		if (ownsEnvironment) {
			phase('Stopping owned WordPress test environment', logger);
			const cleanupStart = clock();
			const cleanup = await executor.run('npx', ['wp-env', 'stop']);
			phases.push({
				name: 'wp-env stop',
				seconds: Math.round(clock() - cleanupStart) / 1000,
				code: cleanup.code,
			});
			if (cleanup.code !== 0) {
				logger(
					`Cleanup failed with exit status ${cleanup.code}; the isolated environment may still be running.`
				);
				if (!primaryResult && !interruptedSignal) {
					cleanupFailure = cleanup.code;
				}
			}
		}
		if (phases.length) {
			const timings = {
				suite: options.suite,
				shard: options.shard ?? null,
				phases,
			};
			logger(`\n${formatTimings(timings)}`);
			await writeTimings(timings);
		}
		if (cleanupFailure !== undefined) {
			// eslint-disable-next-line no-unsafe-finally
			return cleanupFailure;
		}
		if (interruptedSignal) {
			// eslint-disable-next-line no-unsafe-finally
			return SIGNAL_EXIT_CODES[interruptedSignal];
		}
	}
}

/**
 * Run `test:api` in each workspace explicitly, so the shard selection and
 * reporter arguments reach every workspace and each one's duration and result
 * is recorded. In a shard, a workspace with no assigned files is skipped
 * rather than run without a filter. Like `npm run --workspaces`, a failing
 * workspace does not stop the others; the first failing status is returned.
 *
 * @param {Object}   root               Parameters.
 * @param {Object}   root.options       Parsed runner options.
 * @param {string[]} root.workspaces    Workspaces to run, in order.
 * @param {Function} root.timedStep     Records and runs one step.
 * @param {Function} root.logger        Log sink.
 * @param {Function} root.isInterrupted Whether a signal arrived.
 * @param {Map}      [root.testLists]   Shard test list per workspace.
 * @return {Promise<number>} Exit status.
 */
async function runApiWorkspaces({
	options,
	workspaces,
	timedStep,
	logger,
	isInterrupted,
	testLists,
}) {
	const shardLabel = options.shard
		? ` (shard ${options.shard.current}/${options.shard.total})`
		: '';
	const failed = [];
	let status = 0;

	for (const workspace of workspaces) {
		if (isInterrupted()) {
			break;
		}
		if (testLists && !testLists.has(workspace)) {
			logger(
				`\nNo ${workspace} spec files are assigned to this shard; skipping it.`
			);
			continue;
		}
		const playwrightArgs = apiWorkspaceArguments(
			options,
			testLists?.get(workspace)
		);
		phase(`Running API tests: ${workspace}${shardLabel}`, logger);
		const args = ['run', 'test:api', `--workspace=${workspace}`];
		if (playwrightArgs.length) {
			args.push('--', ...playwrightArgs);
		}
		const runOptions = options.resultsDir
			? {
					env: {
						PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(
							options.resultsDir,
							`${workspace}.json`
						),
					},
				}
			: undefined;
		const result = await timedStep(
			`API tests: ${workspace}`,
			'npm',
			args,
			runOptions
		);
		if (result.code !== 0) {
			failed.push(workspace);
			status ||= result.code;
		}
	}

	if (failed.length) {
		logger(
			`\nAPI tests failed${shardLabel} in: ${failed.join(
				', '
			)}. Open that workspace's report under <workspace>/playwright-report/.`
		);
	}
	return status;
}

export const runApiTests = runTests;

async function main() {
	let options;
	try {
		options = parseArguments(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
		return;
	}
	const rootDirectory = ROOT_DIRECTORY;
	const workspaceConfig = await loadWorkspaces(rootDirectory);
	const testsPort = await resolveTestsPort(rootDirectory);
	const env = {
		...process.env,
		CI: '1',
		WP_BASE_URL: `http://localhost:${testsPort}`,
		WP_ADMIN_USER: 'admin',
		WP_ADMIN_PASS: 'password',
		WP_ADMIN_PASSWORD: 'password',
	};
	if (options.resultsDir) {
		options.resultsDir = resolve(rootDirectory, options.resultsDir);
		await mkdir(options.resultsDir, { recursive: true });
	}
	process.exitCode = await runTests({
		options,
		executor: createProcessExecutor({ cwd: rootDirectory, env }),
		workspaceConfig,
		writeTimings: async (timings) => {
			if (options.resultsDir) {
				await writeFile(
					`${options.resultsDir}/timings.json`,
					`${JSON.stringify(timings, null, 2)}\n`
				);
			}
			if (options.resultsDir && process.env.GITHUB_STEP_SUMMARY) {
				await appendFile(
					process.env.GITHUB_STEP_SUMMARY,
					`${formatTimings(timings)}\n`
				);
			}
		},
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
