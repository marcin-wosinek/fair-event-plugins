#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED_DIRECTORIES = new Set([
	'build',
	'vendor',
	'node_modules',
	'svn',
	'dist',
]);
const FORMAT_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.css',
	'.scss',
	'.json',
]);

export function parseHookPaths(platform, payload, action) {
	if (platform === 'claude') {
		const file = payload?.tool_input?.file_path;
		return typeof file === 'string' && file.length > 0 ? [file] : [];
	}

	if (platform === 'codex') {
		const command = payload?.tool_input?.command;
		if (typeof command !== 'string') {
			return [];
		}

		const operations =
			action === 'guard' ? 'Add|Update|Delete' : 'Add|Update';
		const pattern = new RegExp(
			`^\\*\\*\\* (?:${operations}) File: (.+)$`,
			'gm'
		);
		return [...command.matchAll(pattern)].map((match) => match[1]);
	}

	throw new Error(`Unsupported platform: ${platform}`);
}

export function normalizeRepositoryPaths(root, files) {
	const absoluteRoot = path.resolve(root);
	return [
		...new Set(
			files
				.map((file) =>
					path.resolve(absoluteRoot, file.replace(/^['"]|['"]$/g, ''))
				)
				.filter((file) => {
					const relative = path.relative(absoluteRoot, file);
					return (
						relative !== '' &&
						!relative.startsWith(`..${path.sep}`) &&
						relative !== '..'
					);
				})
		),
	];
}

export function isGeneratedPath(root, file) {
	return path
		.relative(root, file)
		.split(path.sep)
		.some((part) => GENERATED_DIRECTORIES.has(part));
}

export function formatterFor(file) {
	const extension = path.extname(file).toLowerCase();
	if (FORMAT_EXTENSIONS.has(extension)) {
		return ['npx', ['wp-scripts', 'format', file]];
	}
	if (extension === '.php') {
		return [
			'vendor/bin/phpcbf',
			['--standard=WordPress', '--extensions=php', file],
		];
	}
	return null;
}

function findRepositoryRoot() {
	const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.trim() : process.cwd();
}

export function runHook({
	platform,
	action,
	payload,
	root = findRepositoryRoot(),
}) {
	if (!['claude', 'codex'].includes(platform)) {
		throw new Error(`Unsupported platform: ${platform}`);
	}
	if (!['guard', 'format'].includes(action)) {
		throw new Error(`Unsupported action: ${action}`);
	}

	const paths = normalizeRepositoryPaths(
		existsSync(root) ? realpathSync(root) : root,
		parseHookPaths(platform, payload, action)
	);

	if (action === 'guard') {
		const generated = paths.find((file) => isGeneratedPath(root, file));
		if (generated) {
			process.stderr.write(
				`Refusing to edit a generated/vendored path: ${generated}\n` +
					'build/, vendor/, node_modules/, svn/, and dist/ are generated. Edit source and rebuild instead.\n'
			);
			return 2;
		}
		return 0;
	}

	for (const file of paths) {
		if (!existsSync(file) || !statSync(file).isFile()) {
			continue;
		}
		const formatter = formatterFor(file);
		if (formatter) {
			spawnSync(formatter[0], formatter[1], {
				cwd: root,
				stdio: 'ignore',
			});
		}
	}
	return 0;
}

async function main() {
	const [platform, action] = process.argv.slice(2);
	let input = '';
	for await (const chunk of process.stdin) {
		input += chunk;
	}
	let payload = {};
	try {
		payload = input ? JSON.parse(input) : {};
	} catch {
		// A malformed payload contains no actionable paths.
	}
	process.exitCode = runHook({ platform, action, payload });
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	});
}
