#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Verify that Playwright's sharding covers the root E2E suite exactly once.
 *
 * Lists the unsharded suite and every shard (`playwright test --list
 * --reporter=json`, no WordPress needed) and fails when a test is missing from
 * all shards, appears in more than one shard, or a shard lists a test the
 * unsharded run does not know.
 *
 * Usage: node scripts/check-e2e-shards.mjs --total=4
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

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

async function listTests(extraArgs = []) {
	const { stdout } = await execFileAsync(
		'npx',
		[
			'playwright',
			'test',
			'--config=playwright.config.js',
			'--list',
			'--reporter=json',
			...extraArgs,
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	const report = JSON.parse(stdout);
	if (report.errors?.length) {
		throw new Error(
			`Playwright reported listing errors:\n${report.errors
				.map((error) => error.message)
				.join('\n')}`
		);
	}
	return collectTests(report);
}

async function main() {
	const total = parseTotal(process.argv.slice(2));
	const full = await listTests();
	const shards = [];
	for (let current = 1; current <= total; current++) {
		shards.push(await listTests([`--shard=${current}/${total}`]));
	}

	shards.forEach((keys, index) =>
		console.log(`Shard ${index + 1}/${total}: ${keys.length} tests`)
	);
	console.log(`Unsharded: ${full.length} tests`);

	const problems = compareInventories(full, shards);
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
