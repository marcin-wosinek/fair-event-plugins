import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EMPTY_TREE_SHA,
	ensureBranch,
	getExistingSha,
	isNotFoundError,
	uploadFile,
} from '../pr-assets.mjs';

/** Any long-lived storage branch; `performance-history` is the real user. */
const BRANCH = 'storage';

/** A `run` failure shaped like what `gh api` reports for a 404 response. */
function notFoundError() {
	const error = new Error('gh: Not Found (HTTP 404)');
	error.stderr = 'gh: Not Found (HTTP 404)';
	return error;
}

test('isNotFoundError recognizes a gh api 404 failure', () => {
	assert.equal(isNotFoundError(notFoundError()), true);
	assert.equal(
		isNotFoundError(new Error('gh: Validation Failed (HTTP 422)')),
		false
	);
});

test('ensureBranch no-ops when the branch already exists', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		return { name: BRANCH };
	};

	const result = await ensureBranch({ repo: 'o/r', run, branch: BRANCH });

	assert.deepEqual(result, { created: false });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], { path: `repos/o/r/branches/${BRANCH}` });
});

test('ensureBranch bootstraps the branch via an empty root commit when missing', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		if (options.path === `repos/o/r/branches/${BRANCH}`) {
			throw notFoundError();
		}
		if (options.path === 'repos/o/r/git/commits') {
			assert.equal(options.method, 'POST');
			assert.deepEqual(options.body, {
				message: 'Initialize storage branch',
				tree: EMPTY_TREE_SHA,
				parents: [],
			});
			return { sha: 'commit-sha' };
		}
		if (options.path === 'repos/o/r/git/refs') {
			assert.equal(options.method, 'POST');
			assert.deepEqual(options.body, {
				ref: `refs/heads/${BRANCH}`,
				sha: 'commit-sha',
			});
			return { ref: `refs/heads/${BRANCH}` };
		}
		throw new Error(`unexpected call: ${options.path}`);
	};

	const result = await ensureBranch({ repo: 'o/r', run, branch: BRANCH });

	assert.deepEqual(result, { created: true });
	assert.equal(calls.length, 3);
});

test('ensureBranch rethrows an error that is not a 404', async () => {
	const boom = new Error('network down');
	const run = async () => {
		throw boom;
	};

	await assert.rejects(
		ensureBranch({ repo: 'o/r', run, branch: BRANCH }),
		/network down/
	);
});

test('getExistingSha returns the blob sha for an existing file', async () => {
	const run = async (options) => {
		assert.equal(
			options.path,
			`repos/o/r/contents/reports/latest.json?ref=${BRANCH}`
		);
		return { sha: 'blob-sha' };
	};

	const sha = await getExistingSha({
		repo: 'o/r',
		path: 'reports/latest.json',
		run,
		branch: BRANCH,
	});

	assert.equal(sha, 'blob-sha');
});

test('getExistingSha returns null when the file does not exist yet', async () => {
	const run = async () => {
		throw notFoundError();
	};

	const sha = await getExistingSha({
		repo: 'o/r',
		path: 'reports/missing.json',
		run,
		branch: BRANCH,
	});

	assert.equal(sha, null);
});

test('getExistingSha rethrows an error that is not a 404', async () => {
	const run = async () => {
		throw new Error('gh: Bad credentials (HTTP 401)');
	};

	await assert.rejects(
		getExistingSha({
			repo: 'o/r',
			path: 'reports/missing.json',
			run,
			branch: BRANCH,
		}),
		/HTTP 401/
	);
});

test('uploadFile creates a new file when no prior sha is given', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		return { content: { sha: 'new-sha' } };
	};
	const buffer = Buffer.from('png-bytes');

	const result = await uploadFile({
		repo: 'o/r',
		path: 'reports/latest.json',
		buffer,
		run,
		branch: BRANCH,
	});

	assert.equal(calls[0].method, 'PUT');
	assert.equal(calls[0].path, 'repos/o/r/contents/reports/latest.json');
	assert.equal(calls[0].body.content, buffer.toString('base64'));
	assert.equal(calls[0].body.branch, BRANCH);
	assert.equal('sha' in calls[0].body, false);
	assert.deepEqual(result, {
		path: 'reports/latest.json',
		sha: 'new-sha',
		rawUrl: `https://raw.githubusercontent.com/o/r/${BRANCH}/reports/latest.json`,
	});
});

test('uploadFile replaces an existing file by passing its prior sha through', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		return { content: { sha: 'replaced-sha' } };
	};

	const result = await uploadFile({
		repo: 'o/r',
		path: 'reports/latest.json',
		buffer: Buffer.from('updated-bytes'),
		sha: 'old-sha',
		run,
		branch: BRANCH,
	});

	assert.equal(calls[0].body.sha, 'old-sha');
	assert.equal(result.sha, 'replaced-sha');
});

test('uploadFile rejects without claiming success when the response has no content sha', async () => {
	const run = async () => ({});

	await assert.rejects(
		uploadFile({
			repo: 'o/r',
			path: 'reports/latest.json',
			buffer: Buffer.from('x'),
			run,
			branch: BRANCH,
		}),
		/did not return a content sha/
	);
});

test('uploadFile propagates an upload failure instead of swallowing it', async () => {
	const run = async () => {
		throw new Error('gh: Validation Failed (HTTP 422)');
	};

	await assert.rejects(
		uploadFile({
			repo: 'o/r',
			path: 'reports/latest.json',
			buffer: Buffer.from('x'),
			run,
			branch: BRANCH,
		}),
		/HTTP 422/
	);
});
