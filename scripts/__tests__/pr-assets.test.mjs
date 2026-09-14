import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSETS_BRANCH,
	EMPTY_TREE_SHA,
	ensureBranch,
	getExistingSha,
	isNotFoundError,
	publishScreenshot,
	uploadFile,
} from '../pr-assets.mjs';

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
		return { name: ASSETS_BRANCH };
	};

	const result = await ensureBranch({ repo: 'o/r', run });

	assert.deepEqual(result, { created: false });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], { path: `repos/o/r/branches/${ASSETS_BRANCH}` });
});

test('ensureBranch bootstraps the branch via an empty root commit when missing', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		if (options.path === `repos/o/r/branches/${ASSETS_BRANCH}`) {
			throw notFoundError();
		}
		if (options.path === 'repos/o/r/git/commits') {
			assert.equal(options.method, 'POST');
			assert.deepEqual(options.body, {
				message: 'Initialize pr-assets branch',
				tree: EMPTY_TREE_SHA,
				parents: [],
			});
			return { sha: 'commit-sha' };
		}
		if (options.path === 'repos/o/r/git/refs') {
			assert.equal(options.method, 'POST');
			assert.deepEqual(options.body, {
				ref: `refs/heads/${ASSETS_BRANCH}`,
				sha: 'commit-sha',
			});
			return { ref: `refs/heads/${ASSETS_BRANCH}` };
		}
		throw new Error(`unexpected call: ${options.path}`);
	};

	const result = await ensureBranch({ repo: 'o/r', run });

	assert.deepEqual(result, { created: true });
	assert.equal(calls.length, 3);
});

test('ensureBranch rethrows an error that is not a 404', async () => {
	const boom = new Error('network down');
	const run = async () => {
		throw boom;
	};

	await assert.rejects(ensureBranch({ repo: 'o/r', run }), /network down/);
});

test('getExistingSha returns the blob sha for an existing file', async () => {
	const run = async (options) => {
		assert.equal(
			options.path,
			`repos/o/r/contents/1554/before-desktop.png?ref=${ASSETS_BRANCH}`
		);
		return { sha: 'blob-sha' };
	};

	const sha = await getExistingSha({
		repo: 'o/r',
		path: '1554/before-desktop.png',
		run,
	});

	assert.equal(sha, 'blob-sha');
});

test('getExistingSha returns null when the file does not exist yet', async () => {
	const run = async () => {
		throw notFoundError();
	};

	const sha = await getExistingSha({
		repo: 'o/r',
		path: '1554/missing.png',
		run,
	});

	assert.equal(sha, null);
});

test('getExistingSha rethrows an error that is not a 404', async () => {
	const run = async () => {
		throw new Error('gh: Bad credentials (HTTP 401)');
	};

	await assert.rejects(
		getExistingSha({ repo: 'o/r', path: '1554/missing.png', run }),
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
		path: '1554/before-desktop.png',
		buffer,
		run,
	});

	assert.equal(calls[0].method, 'PUT');
	assert.equal(calls[0].path, 'repos/o/r/contents/1554/before-desktop.png');
	assert.equal(calls[0].body.content, buffer.toString('base64'));
	assert.equal(calls[0].body.branch, ASSETS_BRANCH);
	assert.equal('sha' in calls[0].body, false);
	assert.deepEqual(result, {
		path: '1554/before-desktop.png',
		sha: 'new-sha',
		rawUrl: `https://raw.githubusercontent.com/o/r/${ASSETS_BRANCH}/1554/before-desktop.png`,
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
		path: '1554/before-desktop.png',
		buffer: Buffer.from('updated-bytes'),
		sha: 'old-sha',
		run,
	});

	assert.equal(calls[0].body.sha, 'old-sha');
	assert.equal(result.sha, 'replaced-sha');
});

test('uploadFile rejects without claiming success when the response has no content sha', async () => {
	const run = async () => ({});

	await assert.rejects(
		uploadFile({
			repo: 'o/r',
			path: '1554/before-desktop.png',
			buffer: Buffer.from('x'),
			run,
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
			path: '1554/before-desktop.png',
			buffer: Buffer.from('x'),
			run,
		}),
		/HTTP 422/
	);
});

test('publishScreenshot ensures the branch, looks up an existing sha, then uploads', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options);
		if (options.path === `repos/o/r/branches/${ASSETS_BRANCH}`) {
			return { name: ASSETS_BRANCH };
		}
		if (
			options.path ===
			`repos/o/r/contents/1554/before-desktop.png?ref=${ASSETS_BRANCH}`
		) {
			return { sha: 'existing-sha' };
		}
		if (options.path === 'repos/o/r/contents/1554/before-desktop.png') {
			assert.equal(options.method, 'PUT');
			assert.equal(options.body.sha, 'existing-sha');
			return { content: { sha: 'uploaded-sha' } };
		}
		throw new Error(`unexpected call: ${JSON.stringify(options)}`);
	};

	const result = await publishScreenshot({
		repo: 'o/r',
		issue: 1554,
		filename: 'before-desktop.png',
		buffer: Buffer.from('png'),
		run,
	});

	assert.deepEqual(result, {
		path: '1554/before-desktop.png',
		sha: 'uploaded-sha',
		rawUrl: `https://raw.githubusercontent.com/o/r/${ASSETS_BRANCH}/1554/before-desktop.png`,
	});
});

test('publishScreenshot bootstraps the branch first when it does not exist yet', async () => {
	const calls = [];
	const run = async (options) => {
		calls.push(options.path);
		if (options.path === `repos/o/r/branches/${ASSETS_BRANCH}`) {
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
			`repos/o/r/contents/1554/after-mobile.png?ref=${ASSETS_BRANCH}`
		) {
			throw notFoundError();
		}
		if (options.path === 'repos/o/r/contents/1554/after-mobile.png') {
			return { content: { sha: 'new-sha' } };
		}
		throw new Error(`unexpected call: ${options.path}`);
	};

	const result = await publishScreenshot({
		repo: 'o/r',
		issue: 1554,
		filename: 'after-mobile.png',
		buffer: Buffer.from('png'),
		run,
	});

	assert.equal(result.sha, 'new-sha');
	assert.deepEqual(calls, [
		`repos/o/r/branches/${ASSETS_BRANCH}`,
		'repos/o/r/git/commits',
		'repos/o/r/git/refs',
		`repos/o/r/contents/1554/after-mobile.png?ref=${ASSETS_BRANCH}`,
		'repos/o/r/contents/1554/after-mobile.png',
	]);
});
