#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export function parseArguments(args) {
	let reuse = false;
	let workspace;
	const forwarded = [];

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--reuse') {
			reuse = true;
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

	return { reuse, workspace, forwarded };
}

export async function loadApiWorkspaces(rootDirectory) {
	const rootPackage = JSON.parse(
		await readFile(`${rootDirectory}/package.json`, 'utf8')
	);
	const apiWorkspaces = [];

	for (const workspace of rootPackage.workspaces) {
		const workspacePackage = JSON.parse(
			await readFile(`${rootDirectory}/${workspace}/package.json`, 'utf8')
		);
		if (workspacePackage.scripts?.['test:api']) {
			apiWorkspaces.push(workspace);
		}
	}

	return { workspaces: rootPackage.workspaces, apiWorkspaces };
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

export async function runApiTests({
	options,
	executor,
	workspaceConfig,
	logger = console.log,
	signalSource = process,
}) {
	if (
		options.workspace &&
		(!workspaceConfig.workspaces.includes(options.workspace) ||
			!workspaceConfig.apiWorkspaces.includes(options.workspace))
	) {
		logger(
			`Workspace "${options.workspace}" does not define a test:api script.`
		);
		return 2;
	}

	let ownsEnvironment = false;
	let interruptedSignal;
	const onSignal = (signal) => {
		interruptedSignal ??= signal;
		executor.terminate(signal);
	};
	const onSigint = () => onSignal('SIGINT');
	const onSigterm = () => onSignal('SIGTERM');
	signalSource.on('SIGINT', onSigint);
	signalSource.on('SIGTERM', onSigterm);

	try {
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

		phase('Configuring and checking WordPress readiness', logger);
		for (const args of [
			[
				'wp-env',
				'run',
				'tests-cli',
				'wp',
				'rewrite',
				'structure',
				'/%postname%/',
				'--hard',
			],
			['wp-env', 'run', 'tests-cli', 'wp', 'core', 'is-installed'],
		]) {
			const result = await executor.run('npx', args);
			if (result.code !== 0) {
				return result.code;
			}
		}

		phase('Running API tests', logger);
		const testArgs = ['run', 'test:api'];
		if (options.workspace) {
			testArgs.push(`--workspace=${options.workspace}`);
		}
		if (options.forwarded.length) {
			testArgs.push('--', ...options.forwarded);
		}
		return (await executor.run('npm', testArgs)).code;
	} finally {
		signalSource.off('SIGINT', onSigint);
		signalSource.off('SIGTERM', onSigterm);
		if (ownsEnvironment) {
			phase('Stopping owned WordPress test environment', logger);
			await executor.run('npx', ['wp-env', 'stop']);
		}
		if (interruptedSignal) {
			return SIGNAL_EXIT_CODES[interruptedSignal];
		}
	}
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
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url)).replace(
		/\/$/,
		''
	);
	const workspaceConfig = await loadApiWorkspaces(rootDirectory);
	const env = {
		...process.env,
		CI: '1',
		WP_BASE_URL: 'http://localhost:8889',
		WP_ADMIN_USER: 'admin',
		WP_ADMIN_PASS: 'password',
		WP_ADMIN_PASSWORD: 'password',
	};
	process.exitCode = await runApiTests({
		options,
		executor: createProcessExecutor({ cwd: rootDirectory, env }),
		workspaceConfig,
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
