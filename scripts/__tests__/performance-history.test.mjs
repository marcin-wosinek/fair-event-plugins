import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HISTORY_BRANCH,
	publishPerformanceHistory,
} from '../performance-history.mjs';

/** A `run` failure shaped like what `gh api` reports for a 404 response. */
function notFoundError() {
	const error = new Error('gh: Not Found (HTTP 404)');
	error.stderr = 'gh: Not Found (HTTP 404)';
	return error;
}

test('publishPerformanceHistory ensures the branch, then writes a dated entry and latest.json', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		if (options.path === `repos/o/r/branches/${HISTORY_BRANCH}`) {
			return { name: HISTORY_BRANCH };
		}
		if (
			options.path ===
			`repos/o/r/contents/latest.json?ref=${HISTORY_BRANCH}`
		) {
			throw notFoundError();
		}
		if (options.method === 'PUT') {
			return { content: { sha: `uploaded-${options.path}` } };
		}
		throw new Error(`unexpected call: ${JSON.stringify(options)}`);
	};

	const result = await publishPerformanceHistory({
		repo: 'o/r',
		buffer: Buffer.from('{"generatedAt":"2026-09-22T00:00:00.000Z"}'),
		runId: '12345',
		run,
	});

	const today = new Date().toISOString().slice(0, 10);
	const entryPath = `repos/o/r/contents/${today}-12345.json`;
	const entryCall = calls.find(
		(c) => c.method === 'PUT' && c.path === entryPath
	);
	assert.ok(entryCall, 'writes a dated, run-id-keyed entry');
	assert.equal(
		'sha' in entryCall.body,
		false,
		'entry is always a create, never a replace'
	);
	assert.equal(entryCall.body.branch, HISTORY_BRANCH);

	const latestCall = calls.find(
		(c) => c.method === 'PUT' && c.path === 'repos/o/r/contents/latest.json'
	);
	assert.ok(latestCall, 'also writes latest.json');
	assert.equal(
		'sha' in latestCall.body,
		false,
		'no prior latest.json to replace'
	);

	assert.deepEqual(result, {
		entryUrl: `https://raw.githubusercontent.com/o/r/${HISTORY_BRANCH}/${
			entryPath.split('/contents/')[1]
		}`,
		latestUrl: `https://raw.githubusercontent.com/o/r/${HISTORY_BRANCH}/latest.json`,
	});
});

test('publishPerformanceHistory replaces an existing latest.json rather than failing', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		if (options.path === `repos/o/r/branches/${HISTORY_BRANCH}`) {
			return { name: HISTORY_BRANCH };
		}
		if (
			options.path ===
			`repos/o/r/contents/latest.json?ref=${HISTORY_BRANCH}`
		) {
			return { sha: 'prior-latest-sha' };
		}
		if (options.method === 'PUT') {
			return { content: { sha: 'new-sha' } };
		}
		throw new Error(`unexpected call: ${JSON.stringify(options)}`);
	};

	await publishPerformanceHistory({
		repo: 'o/r',
		buffer: Buffer.from('{}'),
		runId: '999',
		run,
	});

	const latestCall = calls.find(
		(c) => c.method === 'PUT' && c.path === 'repos/o/r/contents/latest.json'
	);
	assert.equal(latestCall.body.sha, 'prior-latest-sha');
});

test('publishPerformanceHistory bootstraps the branch first when it does not exist yet', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options.path);
		if (options.path === `repos/o/r/branches/${HISTORY_BRANCH}`) {
			throw notFoundError();
		}
		if (options.path === 'repos/o/r/git/commits') {
			return { sha: 'commit-sha' };
		}
		if (options.path === 'repos/o/r/git/refs') {
			return {};
		}
		if (
			options.path ===
			`repos/o/r/contents/latest.json?ref=${HISTORY_BRANCH}`
		) {
			throw notFoundError();
		}
		return { content: { sha: 'some-sha' } };
	};

	const result = await publishPerformanceHistory({
		repo: 'o/r',
		buffer: Buffer.from('{}'),
		runId: '1',
		run,
	});

	assert.equal(calls[0], `repos/o/r/branches/${HISTORY_BRANCH}`);
	assert.equal(calls[1], 'repos/o/r/git/commits');
	assert.equal(calls[2], 'repos/o/r/git/refs');
	assert.ok(result.entryUrl.includes(HISTORY_BRANCH));
	assert.ok(result.latestUrl.includes(HISTORY_BRANCH));
});
