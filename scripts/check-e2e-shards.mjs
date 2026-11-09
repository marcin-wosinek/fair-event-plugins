#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Verify that the duration-based shard assignment covers the root E2E suite
 * exactly once.
 *
 * Lists the unsharded suite (`playwright test --list --reporter=json`, no
 * WordPress needed), assigns its files to shards the way the lifecycle runner
 * does (scripts/shard-assignment.mjs), lists every shard through the same
 * `--test-list` the runner passes, and fails when the suite is empty, a test
 * is missing from all shards, appears in more than one shard, or a shard lists
 * a test the unsharded run does not know.
 *
 * Usage: node scripts/check-e2e-shards.mjs --total=4
 */

import { fileURLToPath } from 'node:url';

import {
	describeAssignment,
	listReport,
	planSuite,
	writeTestLists,
} from './shard-assignment.mjs';

export function parseTotal(args) {
	const argument = args.find((value) => value.startsWith('--total='));
	const total = Number(argument?.slice('--total='.length));
	if (!Number.isInteger(total) || total < 1) {
		throw new Error('Pass the shard count as --total=<positive integer>.');
	}
	return total;
}

/**
 * Flatten a Playwright JSON report into one key per test and project.
 *
 * @param {Object} report Parsed `--reporter=json` output.
 * @return {string[]} Keys of the form `<file> › <title path> [<project>]`.
 */
export function collectTests(report) {
	const keys = [];
	const walk = (suite, titles) => {
		const path = suite.title ? [...titles, suite.title] : titles;
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				keys.push(
					`${[...path, spec.title].join(' › ')} [${test.projectName}]`
				);
			}
		}
		for (const child of suite.suites ?? []) {
			walk(child, path);
		}
	};
	for (const suite of report.suites ?? []) {
		walk(suite, []);
	}
	return keys;
}

/**
 * Compare the unsharded inventory with the shard inventories.
 *
 * @param {string[]}   full   Test keys from the unsharded listing.
 * @param {string[][]} shards Test keys per shard, in shard order.
 * @return {string[]} Problems found; empty when every test runs exactly once.
 */
export function compareInventories(full, shards) {
	const problems = [];
	const expected = new Set(full);
	if (expected.size !== full.length) {
		problems.push(
			'The unsharded listing contains duplicate test keys; the check cannot tell tests apart.'
		);
	}

	const seen = new Map();
	shards.forEach((keys, index) => {
		for (const key of keys) {
			seen.set(key, [...(seen.get(key) ?? []), index + 1]);
		}
	});

	for (const key of expected) {
		const owners = seen.get(key) ?? [];
		if (owners.length === 0) {
			problems.push(`Missing from every shard: ${key}`);
		} else if (owners.length > 1) {
			problems.push(`Runs in shards ${owners.join(', ')}: ${key}`);
		}
	}
	for (const [key, owners] of seen) {
		if (!expected.has(key)) {
			problems.push(
				`Listed by shard ${owners.join(
					', '
				)} but not by the unsharded run: ${key}`
			);
		}
	}
	return problems;
}

async function main() {
	const total = parseTotal(process.argv.slice(2));
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
	const fullReport = await listReport(rootDirectory, 'e2e');
	const full = collectTests(fullReport);
	const { assignment } = await planSuite({
		rootDirectory,
		suite: 'e2e',
		total,
		list: async () => fullReport,
	});
	describeAssignment(assignment).forEach((line) => console.log(line));

	const shards = [];
	for (const files of assignment.shards) {
		const lists = await writeTestLists(files);
		shards.push(
			lists.has(undefined)
				? collectTests(
						await listReport(rootDirectory, 'e2e', undefined, [
							`--test-list=${lists.get(undefined)}`,
						])
					)
				: []
		);
	}

	shards.forEach((keys, index) =>
		console.log(`Shard ${index + 1}/${total}: ${keys.length} tests`)
	);
	console.log(`Unsharded: ${full.length} tests`);

	const problems = compareInventories(full, shards);
	if (full.length === 0) {
		problems.push('The E2E suite lists no tests.');
	}
	if (problems.length) {
		problems.forEach((problem) => console.error(problem));
		process.exitCode = 1;
		return;
	}
	console.log('Every E2E test is assigned to exactly one shard.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
