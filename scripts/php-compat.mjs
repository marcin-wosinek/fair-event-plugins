#!/usr/bin/env node
/* eslint-disable no-console */

// PHP runtime compatibility policy and checks. The POLICY table is the single
// source for each workspace's supported PHP minimum; TESTING.md documents it
// and CI groups its runtime jobs by it.
//
//   node scripts/php-compat.mjs check                 declarations agree with POLICY
//   node scripts/php-compat.mjs list --minimum=8.0    workspaces with that minimum
//   node scripts/php-compat.mjs runtime --minimum=8.0 production install, platform
//                                                     check, lint, autoload (runs
//                                                     on the minimum PHP in CI)
//   node scripts/php-compat.mjs phpcompat             PHPCompatibility scan of
//                                                     shipped PHP per range

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);

export const RUNNER_SCRIPT = 'node ../scripts/php-test-runner.mjs';

/**
 * Supported PHP minimum per workspace. `dir` is where its composer.json
 * lives; `plugin: false` marks the shared library, which has no plugin
 * header or readme and no dependencies to resolve against a platform.
 */
export const POLICY = {
	'fair-payments-connector': { minimum: '8.2' },
	'fair-events': { minimum: '7.4' },
	'fair-events-shared': {
		minimum: '7.4',
		dir: 'fair-events-shared/php',
		plugin: false,
	},
	'fair-platform': { minimum: '8.2' },
	'fair-audience': { minimum: '8.2' },
	'fair-timetable': { minimum: '8.0' },
	'fair-finance': { minimum: '8.0' },
	'fair-events-experimental': { minimum: '8.0' },
	'fair-payments-connector-experimental': { minimum: '8.0' },
	'fair-form': { minimum: '8.0' },
	'fair-audience-experimental': { minimum: '8.0' },
	'fair-calendar-button': { minimum: '8.0' },
};

// Directories that never ship in a plugin ZIP.
export const UNSHIPPED_DIRS = new Set([
	'vendor',
	'node_modules',
	'__tests__',
	'e2e',
	'scripts',
	'svn',
	'test-results',
	'playwright-report',
]);

export function entries(policy = POLICY) {
	return Object.entries(policy).map(([workspace, entry]) => ({
		workspace,
		dir: entry.dir ?? workspace,
		plugin: entry.plugin ?? true,
		minimum: entry.minimum,
	}));
}

export function minimums(policy = POLICY) {
	return [...new Set(entries(policy).map(({ minimum }) => minimum))].sort();
}

/**
 * Lower bound of a Composer PHP constraint such as `^8.0` or `>=7.4 <9.0`.
 */
export function constraintMinimum(constraint) {
	const match = String(constraint ?? '').match(
		/^\s*(?:\^|~|>=)?\s*(\d+\.\d+)/
	);
	return match ? match[1] : null;
}

export function headerValue(source, name) {
	const match = source.match(
		new RegExp(`^[\\s*#@]*${name}:\\s*(.+?)\\s*$`, 'm')
	);
	return match ? match[1] : null;
}

function readJson(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}

function readIfExists(file) {
	return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/**
 * Returns every disagreement between the declarations and the policy.
 */
export function checkDeclarations(root = ROOT, policy = POLICY) {
	const problems = [];
	const workspaces = readJson(path.join(root, 'package.json')).workspaces;

	for (const workspace of workspaces) {
		if (!policy[workspace]) {
			problems.push(
				`${workspace}: no PHP minimum in scripts/php-compat.mjs POLICY.`
			);
		}
	}

	for (const { workspace, dir, plugin, minimum } of entries(policy)) {
		if (!workspaces.includes(workspace)) {
			problems.push(`${workspace}: in POLICY but not a root workspace.`);
			continue;
		}
		const composer = readJson(path.join(root, dir, 'composer.json'));
		const required = constraintMinimum(composer.require?.php);
		if (required !== minimum) {
			problems.push(
				`${dir}/composer.json: require.php "${composer.require?.php}" should start at ${minimum}.`
			);
		}
		const platform = composer.config?.platform?.php;
		if (plugin && platform !== minimum) {
			problems.push(
				`${dir}/composer.json: config.platform.php is "${platform}", expected "${minimum}".`
			);
		}
		const devPackages = Object.keys(composer['require-dev'] ?? {});
		for (const name of devPackages.filter((n) =>
			n.startsWith('phpunit/')
		)) {
			problems.push(
				`${dir}/composer.json: require-dev "${name}" belongs in tools/php-tests/composer.json.`
			);
		}

		if (plugin) {
			const main = readIfExists(path.join(root, dir, `${workspace}.php`));
			const readme = readIfExists(path.join(root, dir, 'readme.txt'));
			for (const [file, source] of [
				[`${workspace}.php`, main],
				['readme.txt', readme],
			]) {
				const declared = source && headerValue(source, 'Requires PHP');
				if (declared !== minimum) {
					problems.push(
						`${dir}/${file}: "Requires PHP: ${declared}" should be ${minimum}.`
					);
				}
			}
		}

		const scripts =
			readJson(path.join(root, workspace, 'package.json')).scripts ?? {};
		const hasSuite = existsSync(path.join(root, workspace, 'phpunit.xml'));
		if (hasSuite && scripts['test:php'] !== RUNNER_SCRIPT) {
			problems.push(
				`${workspace}/package.json: test:php should be "${RUNNER_SCRIPT}".`
			);
		}
		if (!hasSuite && scripts['test:php']) {
			problems.push(
				`${workspace}/package.json: test:php is set but there is no phpunit.xml.`
			);
		}
	}
	return problems;
}

/**
 * Shipped PHP files of a workspace, relative to its directory.
 */
export function shippedPhpFiles(directory) {
	const files = [];
	const walk = (relative) => {
		for (const entry of readdirSync(path.join(directory, relative), {
			withFileTypes: true,
		})) {
			const child = path.join(relative, entry.name);
			if (entry.isDirectory()) {
				if (
					!UNSHIPPED_DIRS.has(entry.name) &&
					!entry.name.startsWith('.')
				) {
					walk(child);
				}
			} else if (
				entry.name.endsWith('.php') &&
				!entry.name.startsWith('.')
			) {
				files.push(child);
			}
		}
	};
	walk('');
	return files.sort();
}

function parseMinimum(args) {
	const option = args.find((argument) => argument.startsWith('--minimum='));
	return option ? option.slice('--minimum='.length) : null;
}

function selected(minimum, policy = POLICY) {
	if (minimum && !minimums(policy).includes(minimum)) {
		throw new Error(
			`No workspace declares PHP ${minimum}. Known minimums: ${minimums(
				policy
			).join(', ')}.`
		);
	}
	return entries(policy).filter(
		(entry) => !minimum || entry.minimum === minimum
	);
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return {
		ok: result.status === 0,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
	};
}

function runtime(minimum) {
	if (!minimum) {
		throw new Error('runtime needs --minimum=<version>.');
	}
	let failed = false;
	for (const { dir } of selected(minimum)) {
		const cwd = path.join(ROOT, dir);
		console.log(`\n▶ ${dir} (PHP ${minimum})`);
		const steps = [
			[
				'composer install --no-dev',
				() =>
					run(
						'composer',
						[
							'install',
							'--no-dev',
							'--no-interaction',
							'--no-progress',
						],
						cwd
					),
			],
			[
				'composer check-platform-reqs --no-dev',
				() => run('composer', ['check-platform-reqs', '--no-dev'], cwd),
			],
			[
				'php -l on shipped files',
				() => {
					const errors = shippedPhpFiles(cwd)
						.map((file) => ({
							file,
							...run('php', ['-l', file], cwd),
						}))
						.filter(({ ok }) => !ok);
					return {
						ok: errors.length === 0,
						output: errors.map(({ output }) => output).join('\n'),
					};
				},
			],
			[
				'production autoloader loads',
				() =>
					run(
						'php',
						['-r', 'require "vendor/autoload.php"; echo "ok";'],
						cwd
					),
			],
		];
		for (const [label, step] of steps) {
			const { ok, output } = step();
			console.log(`${ok ? '✓' : '✗'} ${label}`);
			if (!ok) {
				failed = true;
				console.log(output);
				break;
			}
		}
	}
	return failed ? 1 : 0;
}

function phpcompat(minimum) {
	const phpcs = path.join(
		ROOT,
		'tools',
		'php-tests',
		'vendor',
		'bin',
		'phpcs'
	);
	if (!existsSync(phpcs)) {
		throw new Error(
			'PHPCompatibility is not installed. Run `npm run test:php:install` (requires PHP 8.4+).'
		);
	}
	let failed = false;
	for (const { dir, minimum: version } of selected(minimum)) {
		const files = shippedPhpFiles(path.join(ROOT, dir));
		const { ok, output } = run(
			'php',
			[
				phpcs,
				'-q',
				'--standard=PHPCompatibilityWP',
				'--runtime-set',
				'testVersion',
				`${version}-`,
				...files,
			],
			path.join(ROOT, dir)
		);
		console.log(`${ok ? '✓' : '✗'} ${dir} (PHP ${version}+)`);
		if (!ok) {
			failed = true;
			console.log(output);
		}
	}
	return failed ? 1 : 0;
}

export function main(args = process.argv.slice(2)) {
	const [command = 'check', ...rest] = args;
	const minimum = parseMinimum(rest);
	switch (command) {
		case 'check': {
			const problems = checkDeclarations();
			for (const problem of problems) {
				console.error(problem);
			}
			if (problems.length === 0) {
				console.log('PHP compatibility declarations match the policy.');
			}
			return problems.length === 0 ? 0 : 1;
		}
		case 'list':
			for (const { dir } of selected(minimum)) {
				console.log(dir);
			}
			return 0;
		case 'runtime':
			return runtime(minimum);
		case 'phpcompat':
			return phpcompat(minimum);
		default:
			throw new Error(
				`Unknown command "${command}". Use check, list, runtime or phpcompat.`
			);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
