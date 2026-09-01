#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export function parseArguments(args) {
	let reuse = false;
	let suite = 'api';
	let workspace;
	const forwarded = [];

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

	return { reuse, suite, workspace, forwarded };
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
					env,
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

export async function runTests({
	options,
	executor,
	workspaceConfig,
	browserValidator = validateChromium,
	logger = console.log,
	signalSource = process,
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

	try {
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
			const status = await executor.run(
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
			for (const args of [
				['run', 'build'],
				['run', 'composer:install:prod'],
			]) {
				const result = await executor.run('npm', args);
				if (result.code !== 0) {
					return result.code;
				}
			}

			phase('Starting isolated WordPress test environment', logger);
			const start = await executor.run('npx', ['wp-env', 'start']);
			if (start.code !== 0) {
				return start.code;
			}
			ownsEnvironment = true;
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
		for (const args of readinessCommands) {
			const result = await executor.run('npx', args);
			if (result.code !== 0) {
				primaryResult = result.code;
				return primaryResult;
			}
		}

		phase(
			options.suite === 'api' ? 'Running API tests' : 'Running E2E tests',
			logger
		);
		const testArgs = ['run', `test:${options.suite}`];
		if (options.workspace) {
			testArgs.push(`--workspace=${options.workspace}`);
		}
		if (options.forwarded.length) {
			testArgs.push('--', ...options.forwarded);
		}
		primaryResult = (await executor.run('npm', testArgs)).code;
		return primaryResult;
	} finally {
		signalSource.off('SIGINT', onSigint);
		signalSource.off('SIGTERM', onSigterm);
		if (ownsEnvironment) {
			phase('Stopping owned WordPress test environment', logger);
			const cleanup = await executor.run('npx', ['wp-env', 'stop']);
			if (cleanup.code !== 0) {
				logger(
					`Cleanup failed with exit status ${cleanup.code}; the isolated environment may still be running.`
				);
				if (!primaryResult && !interruptedSignal) {
					return cleanup.code;
				}
			}
		}
		if (interruptedSignal) {
			return SIGNAL_EXIT_CODES[interruptedSignal];
		}
	}
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
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url)).replace(
		/\/$/,
		''
	);
	const workspaceConfig = await loadWorkspaces(rootDirectory);
	const env = {
		...process.env,
		CI: '1',
		WP_BASE_URL: 'http://localhost:8889',
		WP_ADMIN_USER: 'admin',
		WP_ADMIN_PASS: 'password',
		WP_ADMIN_PASSWORD: 'password',
	};
	process.exitCode = await runTests({
		options,
		executor: createProcessExecutor({ cwd: rootDirectory, env }),
		workspaceConfig,
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
