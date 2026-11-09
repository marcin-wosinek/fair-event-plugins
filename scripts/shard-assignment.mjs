/**
 * Duration-based shard assignment shared by the lifecycle runner and the
 * shard inventory checks.
 *
 * Whole spec files are assigned, longest first, to the currently lightest
 * shard. Weights come from the checked-in timing data in
 * `scripts/shard-timings/<suite>.json` (refreshed deliberately with
 * `node scripts/shard-timings.mjs refresh`). A file without a timing entry
 * (new or renamed) weighs the median of the recorded files. Ties keep
 * discovery order and go to the lowest-numbered shard, so the same inventory
 * and timing data always give the same assignment. Inside a shard, files keep
 * their discovery order.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const TIMINGS_DIRECTORY = 'scripts/shard-timings';

// Matches the shard notation Playwright accepts: --shard=<current>/<total>.
export function parseShard(value) {
	const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
	const current = Number(match?.[1]);
	const total = Number(match?.[2]);
	if (!match || current < 1 || total < 1 || current > total) {
		throw new Error(
			'The --shard option must look like --shard=<current>/<total>, e.g. --shard=2/4.'
		);
	}
	return { current, total };
}

function toPosix(path) {
	return path.split(sep).join('/');
}

/**
 * Spec files of a Playwright JSON report (`--list` or results), in the order
 * Playwright discovered them.
 *
 * The id is the file's path from the repository root, which is how timing
 * data names it: the root config lives at the repository root and every
 * workspace config at its workspace root. `listPath` is the path relative to
 * the config's rootDir, which `--test-list` matches exactly.
 *
 * @param {Object} report      Parsed Playwright JSON report.
 * @param {string} [workspace] Workspace of a workspace config; omit for root.
 * @return {{id: string, listPath: string, workspace: string|undefined}[]}
 *   One entry per spec file.
 */
export function reportFiles(report, workspace) {
	const configDirectory = dirname(report.config.configFile);
	const prefix = workspace ? `${workspace}/` : '';
	return (report.suites ?? []).map((suite) => ({
		id:
			prefix +
			toPosix(
				relative(
					configDirectory,
					join(report.config.rootDir, suite.file)
				)
			),
		listPath: toPosix(suite.file),
		workspace,
	}));
}

/**
 * Median recorded weight, the documented weight of a file with no entry.
 *
 * @param {Object<string, {seconds: number}>} weights Timing entries by id.
 * @return {number} Seconds; 1 when there is no timing data at all.
 */
export function fallbackWeight(weights) {
	const values = Object.values(weights)
		.map((entry) => entry.seconds)
		.sort((a, b) => a - b);
	if (!values.length) {
		return 1;
	}
	const middle = Math.floor(values.length / 2);
	return values.length % 2
		? values[middle]
		: (values[middle - 1] + values[middle]) / 2;
}

/**
 * Assign whole files to shards, longest first, to the lightest shard.
 *
 * @param {{id: string}[]}                    files   Files in execution order.
 * @param {Object<string, {seconds: number}>} weights Timing entries by id.
 * @param {number}                            total   Shard count.
 * @return {{shards: Object[][], loads: number[], fallback: string[], stale: string[]}}
 *   Files per shard (index 0 = shard 1) in execution order, the estimated
 *   seconds per shard, files that used the fallback weight, and timing
 *   entries that match no listed file.
 */
export function assignShards(files, weights, total) {
	const ids = new Set();
	for (const file of files) {
		if (ids.has(file.id)) {
			throw new Error(`Spec file listed twice: ${file.id}`);
		}
		ids.add(file.id);
	}

	const defaultWeight = fallbackWeight(weights);
	const fallback = [];
	const weighted = files.map((file, index) => {
		const entry = weights[file.id];
		if (!entry) {
			fallback.push(file.id);
		}
		return { file, index, seconds: entry ? entry.seconds : defaultWeight };
	});
	weighted.sort((a, b) => b.seconds - a.seconds || a.index - b.index);

	const loads = Array.from({ length: total }, () => 0);
	const members = Array.from({ length: total }, () => []);
	for (const item of weighted) {
		let lightest = 0;
		for (let shard = 1; shard < total; shard++) {
			if (loads[shard] < loads[lightest]) {
				lightest = shard;
			}
		}
		loads[lightest] += item.seconds;
		members[lightest].push(item);
	}

	return {
		shards: members.map((items) =>
			items.sort((a, b) => a.index - b.index).map((item) => item.file)
		),
		loads: loads.map((seconds) => Math.round(seconds * 10) / 10),
		fallback,
		stale: Object.keys(weights)
			.filter((id) => !ids.has(id))
			.sort(),
	};
}

/**
 * Contents of a Playwright `--test-list` file selecting whole files.
 *
 * @param {{listPath: string}[]} files Selected files.
 * @return {string} One rootDir-relative path per line.
 */
export function testListContent(files) {
	return files.map((file) => `${file.listPath}\n`).join('');
}

/**
 * Read the checked-in timing data of a suite.
 *
 * @param {string} rootDirectory Repository root.
 * @param {string} suite         "e2e" or "api".
 * @return {Promise<Object<string, {seconds: number}>>} Timing entries by id;
 *   empty when the suite has no timing file yet.
 */
export async function loadWeights(rootDirectory, suite) {
	try {
		const data = JSON.parse(
			await readFile(
				join(rootDirectory, TIMINGS_DIRECTORY, `${suite}.json`),
				'utf8'
			)
		);
		return data.files ?? {};
	} catch (error) {
		if (error.code === 'ENOENT') {
			return {};
		}
		throw error;
	}
}

/**
 * Log lines describing an assignment, for job logs and the inventory checks.
 *
 * @param {Object} assignment Result of assignShards().
 * @return {string[]} Lines.
 */
export function describeAssignment(assignment) {
	const total = assignment.shards.length;
	const lines = assignment.shards.map(
		(files, index) =>
			`Shard ${index + 1}/${total}: ${files.length} files, ~${(
				assignment.loads[index] / 60
			).toFixed(1)} min estimated`
	);
	if (assignment.fallback.length) {
		lines.push(
			`No timing data (median weight used): ${assignment.fallback.join(', ')}`
		);
	}
	if (assignment.stale.length) {
		lines.push(
			`Stale timing entries (no such spec file): ${assignment.stale.join(', ')}`
		);
	}
	return lines;
}

/**
 * Command that lists a suite without WordPress, the same way it runs: the
 * root config for E2E, and each workspace's own `test:api` script for API.
 *
 * @param {string}   suite       "e2e" or "api".
 * @param {string}   [workspace] API workspace.
 * @param {string[]} [extraArgs] Extra Playwright arguments.
 * @return {[string, string[]]} Command and arguments.
 */
export function listCommand(suite, workspace, extraArgs = []) {
	const listing = ['--list', '--reporter=json', ...extraArgs];
	if (suite === 'e2e') {
		return [
			'npx',
			['playwright', 'test', '--config=playwright.config.js', ...listing],
		];
	}
	return [
		'npm',
		[
			'run',
			'test:api',
			'--silent',
			`--workspace=${workspace}`,
			'--',
			...listing,
		],
	];
}

/**
 * List a suite (or one API workspace) and fail on Playwright listing errors.
 *
 * @param {string}   rootDirectory Repository root.
 * @param {string}   suite         "e2e" or "api".
 * @param {string}   [workspace]   API workspace.
 * @param {string[]} [extraArgs]   Extra Playwright arguments.
 * @return {Promise<Object>} Parsed `--list --reporter=json` output.
 */
export async function listReport(rootDirectory, suite, workspace, extraArgs) {
	const [command, args] = listCommand(suite, workspace, extraArgs);
	const { stdout } = await execFileAsync(command, args, {
		cwd: rootDirectory,
		maxBuffer: 64 * 1024 * 1024,
	});
	const report = JSON.parse(stdout);
	if (report.errors?.length) {
		throw new Error(
			`Playwright reported listing errors${
				workspace ? ` in ${workspace}` : ''
			}:\n${report.errors.map((error) => error.message).join('\n')}`
		);
	}
	return report;
}

/**
 * List every file of a suite and assign the files to shards. API files from
 * all workspaces are balanced together, in workspace order.
 *
 * @param {Object}   root               Parameters.
 * @param {string}   root.rootDirectory Repository root.
 * @param {string}   root.suite         "e2e" or "api".
 * @param {string[]} root.workspaces    API workspaces in root package order.
 * @param {number}   root.total         Shard count.
 * @param {Function} [root.list]        Listing function (listReport).
 * @param {Object}   [root.weights]     Timing entries; read from disk if unset.
 * @return {Promise<{listings: Object[], files: Object[], assignment: Object}>}
 *   Per-workspace listings, all files, and the assignment.
 */
export async function planSuite({
	rootDirectory,
	suite,
	workspaces = [],
	total,
	list = listReport,
	weights,
}) {
	const listings = [];
	for (const workspace of suite === 'api' ? workspaces : [undefined]) {
		listings.push({
			workspace,
			report: await list(rootDirectory, suite, workspace, []),
		});
	}
	const files = listings.flatMap(({ workspace, report }) =>
		reportFiles(report, workspace)
	);
	const assignment = assignShards(
		files,
		weights ?? (await loadWeights(rootDirectory, suite)),
		total
	);
	return { listings, files, assignment };
}

/**
 * Write one `--test-list` file per workspace (or one for the root suite).
 *
 * @param {Object[]} files       Files of one shard.
 * @param {string}   [directory] Target directory; a new temporary one if unset.
 * @return {Promise<Map<string|undefined, string>>} List path per workspace;
 *   a workspace with no files in the shard has no entry.
 */
export async function writeTestLists(files, directory) {
	const target = directory ?? (await mkdtemp(join(tmpdir(), 'fair-shard-')));
	const byWorkspace = new Map();
	for (const file of files) {
		byWorkspace.set(file.workspace, [
			...(byWorkspace.get(file.workspace) ?? []),
			file,
		]);
	}
	const paths = new Map();
	for (const [workspace, selected] of byWorkspace) {
		const path = join(target, `${workspace ?? 'root'}.txt`);
		await writeFile(path, testListContent(selected));
		paths.set(workspace, path);
	}
	return paths;
}
