/**
 * Read-only check that the outputs an isolated WordPress test run needs are
 * already present, for `--prepared` lifecycle runs that skip building and
 * installing. It checks presence only, not freshness or dependency integrity.
 *
 * The test site loads every plugin workspace together, so all of them are
 * checked, not only the workspace under test. A runtime plugin is a root
 * workspace with a `<workspace>/<workspace>.php` file carrying a WordPress
 * `Plugin Name:` header. Library workspaces such as fair-events-shared are not
 * loaded by WordPress as plugins and are skipped, but a few library builds
 * write test-site fixtures instead (TEST_SITE_BUILDS); those are checked too.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function readTextIfPresent(path) {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (error.code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

async function containsJavaScript(directory) {
	let entries;
	try {
		entries = await readdir(directory, { recursive: true });
	} catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
			return false;
		}
		throw error;
	}
	return entries.some((entry) => entry.endsWith('.js'));
}

/**
 * Builds that library workspaces write into the test site rather than into
 * their own `build/`: fair-events-shared's admin table example, which the
 * `fair-e2e-admin-table-example.php` mu-plugin serves
 * (fair-events-shared/webpack.example.config.cjs).
 */
export const TEST_SITE_BUILDS = [
	{
		workspace: 'fair-events-shared',
		path: 'e2e/mu-plugins/admin-table-example/build',
	},
];

/**
 * The runtime plugin workspaces, in root workspace order.
 *
 * @param {string} rootDirectory Repository root.
 * @return {Promise<Array<{workspace: string, builds: boolean, installsComposer: boolean}>>}
 *   Whether each has a `build` and a `composer:install:prod` script.
 */
export async function runtimePluginWorkspaces(rootDirectory) {
	const rootPackage = JSON.parse(
		await readFile(join(rootDirectory, 'package.json'), 'utf8')
	);
	const plugins = [];

	for (const workspace of rootPackage.workspaces) {
		const directory = join(rootDirectory, workspace);
		const pluginFile = await readTextIfPresent(
			join(directory, `${workspace}.php`)
		);
		if (!pluginFile || !/Plugin Name:/.test(pluginFile)) {
			continue;
		}
		const scripts =
			JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
				.scripts ?? {};
		plugins.push({
			workspace,
			builds: Boolean(scripts.build),
			installsComposer: Boolean(scripts['composer:install:prod']),
		});
	}

	return plugins;
}

/**
 * List the outputs each runtime plugin workspace is missing.
 *
 * @param {string} rootDirectory Repository root.
 * @return {Promise<Array<{workspace: string, missing: string[], commands: string[]}>>}
 *   One entry per workspace with missing outputs, in root workspace order.
 */
export async function findMissingOutputs(rootDirectory) {
	const problems = [];

	for (const {
		workspace,
		builds,
		installsComposer,
	} of await runtimePluginWorkspaces(rootDirectory)) {
		const directory = join(rootDirectory, workspace);
		const missing = [];
		const commands = [];

		if (builds && !(await containsJavaScript(join(directory, 'build')))) {
			missing.push(`${workspace}/build/ (no JavaScript build output)`);
			commands.push(`npm run build --workspace=${workspace}`);
		}
		if (
			installsComposer &&
			!(await isFile(join(directory, 'vendor', 'autoload.php')))
		) {
			missing.push(`${workspace}/vendor/autoload.php`);
			commands.push(
				`npm run composer:install:prod --workspace=${workspace}`
			);
		}
		if (missing.length) {
			problems.push({ workspace, missing, commands });
		}
	}

	const { workspaces } = JSON.parse(
		await readFile(join(rootDirectory, 'package.json'), 'utf8')
	);
	for (const { workspace, path } of TEST_SITE_BUILDS) {
		if (
			workspaces.includes(workspace) &&
			!(await containsJavaScript(join(rootDirectory, path)))
		) {
			problems.push({
				workspace,
				missing: [`${path}/ (no JavaScript build output)`],
				commands: [`npm run build --workspace=${workspace}`],
			});
		}
	}

	return problems;
}

/**
 * Human-readable failure for missing prepared outputs.
 *
 * @param {Array<{missing: string[], commands: string[]}>} problems From findMissingOutputs().
 * @return {string[]} Log lines.
 */
export function formatMissingOutputs(problems) {
	return [
		'Prepared mode needs existing build and production Composer outputs, but these are missing:',
		...problems.flatMap((problem) =>
			problem.missing.map((path) => `  - ${path}`)
		),
		'Prepare them, then retry:',
		...problems.flatMap((problem) =>
			problem.commands.map((command) => `  ${command}`)
		),
		'Or drop --prepared to build and install as part of the run.',
	];
}
