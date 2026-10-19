#!/usr/bin/env node
/* eslint-disable no-console */

// Runs workspace PHPUnit suites with the shared, isolated test tooling in
// tools/php-tests/. Each suite keeps its own phpunit.xml, bootstrap and
// production autoloader; only the PHPUnit installation is shared.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
export const TOOLS_DIR = path.join('tools', 'php-tests');
export const PHPUNIT = path.join(TOOLS_DIR, 'vendor', 'bin', 'phpunit');

export function rootWorkspaces(root = ROOT) {
	return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
		.workspaces;
}

/**
 * Workspaces with a PHP suite, in root package.json order.
 */
export function phpSuiteWorkspaces(
	root = ROOT,
	exists = (file) => existsSync(file)
) {
	return rootWorkspaces(root).filter((workspace) =>
		exists(path.join(root, workspace, 'phpunit.xml'))
	);
}

/**
 * Leading --workspace=<name> options select suites; everything else (after
 * an optional --) goes to PHPUnit.
 */
export function parseArguments(args) {
	const workspaces = [];
	let index = 0;
	for (; index < args.length; index++) {
		const match = args[index].match(/^--workspace=(.+)$/);
		if (!match) {
			break;
		}
		workspaces.push(match[1]);
	}
	if (args[index] === '--') {
		index++;
	}
	return { workspaces, forwarded: args.slice(index) };
}

/**
 * Picks the suites to run: the explicitly named workspaces, the workspace
 * the command was started from, or every PHP suite when run from the root.
 */
export function selectWorkspaces({
	requested = [],
	cwd,
	root = ROOT,
	suites = phpSuiteWorkspaces(root),
}) {
	if (requested.length > 0) {
		for (const workspace of requested) {
			if (!suites.includes(workspace)) {
				throw new Error(
					`"${workspace}" has no PHP suite. Available: ${suites.join(
						', '
					)}.`
				);
			}
		}
		return requested;
	}
	const relative = path.relative(root, cwd);
	if (relative === '') {
		return suites;
	}
	const current = relative.split(path.sep)[0];
	if (!suites.includes(current)) {
		throw new Error(
			`"${current}" has no PHP suite. Available: ${suites.join(', ')}.`
		);
	}
	return [current];
}

export function phpunitCommand({ root = ROOT, forwarded = [], env }) {
	return {
		command: env.PHP_BINARY || 'php',
		args: [
			path.join(root, PHPUNIT),
			'--configuration',
			'phpunit.xml',
			...forwarded,
		],
	};
}

function run(command, args, cwd) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			env: process.env,
			stdio: 'inherit',
		});
		child.on('error', (error) => {
			console.error(error.message);
			resolve(1);
		});
		child.on('exit', (code, signal) => {
			resolve(code ?? SIGNAL_EXIT_CODES[signal] ?? 1);
		});
	});
}

export async function runPhpTests(
	args = process.argv.slice(2),
	{ cwd = process.cwd(), root = ROOT, env = process.env } = {}
) {
	const { workspaces: requested, forwarded } = parseArguments(args);
	const workspaces = selectWorkspaces({ requested, cwd, root });

	if (!existsSync(path.join(root, PHPUNIT))) {
		console.error(
			'PHPUnit is not installed. Run `npm run test:php:install` from the repository root (requires PHP 8.4+).'
		);
		return 1;
	}

	const failed = [];
	for (const workspace of workspaces) {
		const directory = path.join(root, workspace);
		if (!existsSync(path.join(directory, 'vendor', 'autoload.php'))) {
			console.error(
				`${workspace}: vendor/autoload.php is missing. Run \`composer install\` in ${workspace}.`
			);
			failed.push(workspace);
			continue;
		}
		if (workspaces.length > 1) {
			console.log(`\n▶ ${workspace}`);
		}
		const { command, args: phpunitArgs } = phpunitCommand({
			root,
			forwarded,
			env,
		});
		const code = await run(command, phpunitArgs, directory);
		if (code !== 0) {
			failed.push(workspace);
		}
	}

	if (workspaces.length > 1) {
		console.log(
			failed.length === 0
				? `\nPHP suites passed: ${workspaces.join(', ')}`
				: `\nPHP suites failed: ${failed.join(', ')}`
		);
	}
	return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await runPhpTests();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
