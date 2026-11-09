#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Prove that API test sharding covers every API workspace's suite exactly once.
 *
 * Planning (no WordPress needed), run by the inventory job:
 *
 *   node scripts/check-api-shards.mjs --total=4 --output=api-inventory.json
 *
 * Lists each workspace's tests through its own `test:api` script, assigns the
 * files of all workspaces to shards the way the lifecycle runner does
 * (scripts/shard-assignment.mjs), lists every shard through the same
 * per-workspace `--test-list` the runner passes, and fails on listing errors,
 * an empty suite, or a test that is missing from every shard, assigned to more
 * than one, or only listed by a shard. Writes the planned assignment to the
 * output file.
 *
 * Verification, run by the final status job after the shards:
 *
 *   node scripts/check-api-shards.mjs --verify --results=<downloaded artifacts>
 *
 * Reads the planned inventory (api-inventory-attempt-A/) and each shard's
 * per-workspace Playwright JSON reports (api-report-shard-N-of-T-attempt-A/)
 * and fails when a planned test did not run in its shard or a shard ran an
 * unplanned test. After "Re-run failed jobs", the latest attempt of each
 * artifact wins, so shards that passed earlier still count. Existing skips
 * count as run; retries and failures are reported separately.
 */

import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectTests, compareInventories } from './check-e2e-shards.mjs';

export function parseOptions(args) {
	const value = (name) =>
		args
			.find((argument) => argument.startsWith(`--${name}=`))
			?.slice(name.length + 3);
	if (args.includes('--verify')) {
		const results = value('results');
		if (!results) {
			throw new Error('Verification needs --results=<dir>.');
		}
		return { mode: 'verify', results };
	}
	const total = Number(value('total'));
	if (!Number.isInteger(total) || total < 1) {
		throw new Error('Pass the shard count as --total=<positive integer>.');
	}
	return { mode: 'plan', total, output: value('output') };
}

/**
 * Prefix test keys with their workspace so equal file paths and titles in two
 * workspaces stay distinct.
 *
 * @param {string}   workspace Workspace directory name.
 * @param {string[]} keys      Keys from collectTests().
 * @return {string[]} Keys of the form `<workspace>: <file> › … [<project>]`.
 */
export function workspaceKeys(workspace, keys) {
	return keys.map((key) => `${workspace}: ${key}`);
}

/**
 * Build the planned inventory from per-workspace listings.
 *
 * @param {Object<string, {full: string[], shards: string[][]}>} listings
 *                                                                        Keys per workspace, unsharded and per shard.
 * @param {number}                                               total    Shard count.
 * @return {{problems: string[], inventory: Object}} Problems and the plan.
 */
export function planInventory(listings, total) {
	const full = [];
	const shards = Array.from({ length: total }, () => []);
	const workspaces = {};

	for (const [workspace, listing] of Object.entries(listings)) {
		full.push(...workspaceKeys(workspace, listing.full));
		listing.shards.forEach((keys, index) =>
			shards[index].push(...workspaceKeys(workspace, keys))
		);
		workspaces[workspace] = {
			tests: listing.full.length,
			perShard: listing.shards.map((keys) => keys.length),
		};
	}

	const problems = compareInventories(full, shards);
	if (full.length === 0) {
		problems.push('No API tests were listed in any workspace.');
	}
	return {
		problems,
		inventory: { total, tests: full.length, workspaces, shards },
	};
}

/**
 * Flatten a Playwright JSON results report into executed test keys.
 *
 * A test counts as run when Playwright recorded at least one result for it,
 * including an existing `test.skip()`. A test with no result never started.
 *
 * @param {string} workspace Workspace directory name.
 * @param {Object} report    Parsed JSON reporter output.
 * @return {{key: string, ran: boolean, status: string, attempts: number}[]}
 *   One entry per test and project.
 */
export function collectResults(workspace, report) {
	const entries = [];
	const walk = (suite, titles) => {
		const path = suite.title ? [...titles, suite.title] : titles;
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				entries.push({
					key: `${workspace}: ${[...path, spec.title].join(' › ')} [${
						test.projectName
					}]`,
					ran: (test.results ?? []).length > 0,
					status: test.status,
					attempts: (test.results ?? []).length,
				});
			}
		}
		for (const child of suite.suites ?? []) {
			walk(child, path);
		}
	};
	for (const suite of report.suites ?? []) {
		walk(suite, []);
	}
	return entries;
}

/**
 * Compare what each shard ran with the planned inventory.
 *
 * @param {Object}                   inventory Planned inventory.
 * @param {Array<Array|undefined>}   executed  Per shard (index 0 = shard 1):
 *                                             collectResults() entries, or
 *                                             undefined when the shard left no
 *                                             results at all.
 * @return {{problems: string[], retried: string[], failed: string[]}}
 *   Coverage problems, tests that needed a retry, tests that failed.
 */
export function verifyExecution(inventory, executed) {
	const problems = [];
	const retried = [];
	const failed = [];

	inventory.shards.forEach((planned, index) => {
		const shard = `${index + 1}/${inventory.total}`;
		const entries = executed[index];
		if (!entries) {
			if (planned.length) {
				problems.push(
					`Shard ${shard} left no results; its ${planned.length} planned tests are unaccounted for.`
				);
			}
			return;
		}
		const byKey = new Map(entries.map((entry) => [entry.key, entry]));
		for (const key of planned) {
			if (!byKey.get(key)?.ran) {
				problems.push(`Did not run in shard ${shard}: ${key}`);
			}
		}
		const plannedKeys = new Set(planned);
		for (const entry of entries) {
			if (!plannedKeys.has(entry.key)) {
				problems.push(
					`Ran in shard ${shard} but was not planned there: ${entry.key}`
				);
			}
			if (entry.status === 'flaky') {
				retried.push(
					`${entry.key} (shard ${shard}, ${entry.attempts} attempts)`
				);
			}
			if (entry.status === 'unexpected') {
				failed.push(`${entry.key} (shard ${shard})`);
			}
		}
	});
	return { problems, retried, failed };
}

async function plan({ total, output }) {
	// Imported here: the runner loads Playwright, which the verification job
	// (Node.js only, no npm install) does not have.
	const { loadWorkspaces } = await import('./api-test-runner.mjs');
	const { describeAssignment, listReport, planSuite, writeTestLists } =
		await import('./shard-assignment.mjs');
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
	const { suiteWorkspaces } = await loadWorkspaces(rootDirectory);
	const reports = new Map();
	const { assignment } = await planSuite({
		rootDirectory,
		suite: 'api',
		workspaces: suiteWorkspaces.api,
		total,
		list: async (root, suite, workspace) => {
			const report = await listReport(root, suite, workspace);
			reports.set(workspace, report);
			return report;
		},
	});
	describeAssignment(assignment).forEach((line) => console.log(line));

	const listings = {};
	for (const workspace of suiteWorkspaces.api) {
		listings[workspace] = {
			full: collectTests(reports.get(workspace)),
			shards: [],
		};
	}
	for (const files of assignment.shards) {
		const lists = await writeTestLists(files);
		for (const workspace of suiteWorkspaces.api) {
			// A workspace with no files in this shard is skipped by the runner.
			listings[workspace].shards.push(
				lists.has(workspace)
					? collectTests(
							await listReport(rootDirectory, 'api', workspace, [
								`--test-list=${lists.get(workspace)}`,
							])
						)
					: []
			);
		}
	}

	const { problems, inventory } = planInventory(listings, total);
	inventory.assignment = {
		estimatedSeconds: assignment.loads,
		files: assignment.shards.map((files) => files.map((file) => file.id)),
		fallback: assignment.fallback,
		stale: assignment.stale,
	};
	for (const [workspace, counts] of Object.entries(inventory.workspaces)) {
		console.log(
			`${workspace}: ${counts.tests} tests, per shard ${counts.perShard.join(' / ')}`
		);
	}
	inventory.shards.forEach((keys, index) =>
		console.log(`Shard ${index + 1}/${total}: ${keys.length} tests`)
	);
	console.log(`Unsharded: ${inventory.tests} tests`);

	if (problems.length) {
		problems.forEach((problem) => console.error(problem));
		process.exitCode = 1;
		return;
	}
	if (output) {
		await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`);
	}
	console.log('Every API test is assigned to exactly one shard.');
}

async function readShardResults(directory) {
	const entries = [];
	for (const file of await readdir(directory)) {
		if (file.endsWith('.json') && file !== 'timings.json') {
			const workspace = file.slice(0, -'.json'.length);
			const report = JSON.parse(
				await readFile(join(directory, file), 'utf8')
			);
			entries.push(...collectResults(workspace, report));
		}
	}
	return entries;
}

/**
 * Pick the latest attempt of the inventory and of each shard's artifact.
 *
 * @param {string[]} folders Artifact folder names from download-artifact.
 * @return {{inventory: string|undefined, shards: Map<string, Object>}}
 *   Latest inventory folder, and the latest folder per `<shard>/<total>`.
 */
export function latestArtifacts(folders) {
	let inventory;
	let inventoryAttempt = 0;
	const shards = new Map();
	for (const folder of folders) {
		const attempt = Number(/-attempt-(\d+)$/.exec(folder)?.[1] ?? 0);
		if (folder.startsWith('api-inventory-')) {
			if (attempt > inventoryAttempt) {
				inventory = folder;
				inventoryAttempt = attempt;
			}
			continue;
		}
		const match = /^api-report-shard-(\d+)-of-(\d+)-attempt-\d+$/.exec(
			folder
		);
		if (!match) {
			continue;
		}
		const key = `${match[1]}/${match[2]}`;
		if (attempt > (shards.get(key)?.attempt ?? 0)) {
			shards.set(key, { folder, attempt });
		}
	}
	return { inventory, shards };
}

async function verify({ results }) {
	const artifacts = latestArtifacts(await readdir(results));
	if (!artifacts.inventory) {
		throw new Error(`No api-inventory-attempt-N folder in ${results}.`);
	}
	const inventory = JSON.parse(
		await readFile(
			join(results, artifacts.inventory, 'api-inventory.json'),
			'utf8'
		)
	);
	const executed = Array.from({ length: inventory.total });
	const timings = [];

	for (let current = 1; current <= inventory.total; current++) {
		const artifact = artifacts.shards.get(`${current}/${inventory.total}`);
		if (!artifact) {
			continue;
		}
		const directory = join(results, artifact.folder, 'api-results');
		try {
			executed[current - 1] = await readShardResults(directory);
			timings.push(
				JSON.parse(
					await readFile(join(directory, 'timings.json'), 'utf8')
				)
			);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	const { problems, retried, failed } = verifyExecution(inventory, executed);
	const ran = executed.flat().filter((entry) => entry?.ran).length;
	const lines = [
		'### API shard coverage',
		'',
		`Planned ${inventory.tests} tests in ${inventory.total} shards; ${ran} ran.`,
		`Failed: ${failed.length}. Passed on retry (flaky): ${retried.length}.`,
		...failed.map((key) => `- Failed: ${key}`),
		...retried.map((key) => `- Flaky: ${key}`),
		'',
	];
	for (const entry of timings.sort(
		(a, b) => a.shard.current - b.shard.current
	)) {
		const total = entry.phases.reduce((sum, item) => sum + item.seconds, 0);
		lines.push(
			`Shard ${entry.shard.current}/${entry.shard.total}: ${(
				total / 60
			).toFixed(1)} min in the runner (${entry.phases
				.map((item) => `${item.name} ${(item.seconds / 60).toFixed(1)}`)
				.join(', ')})`
		);
	}
	console.log(lines.join('\n'));
	if (process.env.GITHUB_STEP_SUMMARY) {
		await appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`${lines.join('\n')}\n`
		);
	}

	if (problems.length) {
		problems.forEach((problem) => console.error(problem));
		process.exitCode = 1;
		return;
	}
	console.log('Every planned API test ran in its shard.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const run = async () => {
		const options = parseOptions(process.argv.slice(2));
		await (options.mode === 'verify' ? verify(options) : plan(options));
	};
	run().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
