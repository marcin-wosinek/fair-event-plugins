import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	STAGING_START,
	attachPrScreenshots,
	findIssueScreenshot,
	findPullRequestForBranch,
	uploadIssueScreenshot,
	verifyImageUrl,
	verifyPrScreenshots,
} from '../pr-assets.mjs';

const REPO = 'o/r';
const NO_WAIT = { delays: [], wait: async () => {} };

/**
 * In-memory stand-in for the parts of GitHub that `gh` touches. `failUploads`
 * names files whose attachment fails (the reference stays `./<name>` and gh
 * exits non-zero, like a partial success); `unresolved` holds URLs that 404.
 */
function fakeGithub({ bodies = {}, pulls = {} } = {}) {
	const state = {
		bodies: { ...bodies },
		pulls,
		comments: [],
		failUploads: new Set(),
		unresolved: new Set(),
		content: {},
		calls: [],
		attachCalls: [],
		nextId: 1,
	};

	const upload = (input, args, cwd) => {
		const names = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--attach') {
				names.push(args[i + 1].split('#')[0].replace(/^\.\//, ''));
			}
		}
		state.attachCalls.push(names);

		let body = input;
		let failed = false;
		for (const name of names) {
			assert.ok(existsSync(join(cwd, name)), `${name} is staged in cwd`);
			if (state.failUploads.has(name)) {
				failed = true;
				continue;
			}
			const url = `https://github.com/user-attachments/assets/a${state.nextId++}`;
			state.content[url] = name;
			body = body.split(`](./${name})`).join(`](${url})`);
		}
		return { body, status: failed ? 1 : 0 };
	};

	const ok = (value) => ({
		status: 0,
		stdout: value === undefined ? '' : JSON.stringify(value),
		stderr: '',
	});

	const gh = (args, { input, cwd } = {}) => {
		state.calls.push(args);
		const [command, sub] = args;

		if (command === 'issue' && sub === 'edit') {
			const number = args[2];
			const { body, status } = upload(input, args, cwd);
			state.bodies[number] = body;
			return {
				status,
				stdout: `https://github.com/${REPO}/pull/${number}\n`,
				stderr: status ? 'upload failed' : '',
			};
		}

		if (command === 'issue' && sub === 'comment') {
			const { body, status } = upload(input, args, cwd);
			const id = state.nextId++;
			state.comments.push({ id, issue: args[2], body });
			return {
				status,
				stdout: `https://github.com/${REPO}/issues/${args[2]}#issuecomment-${id}\n`,
				stderr: status ? 'upload failed' : '',
			};
		}

		assert.equal(command, 'api', `unexpected gh ${args.join(' ')}`);
		const method = args.includes('-X')
			? args[args.indexOf('-X') + 1]
			: 'GET';
		const path = args.find((arg) => arg.startsWith('repos/'));
		const payload = input ? JSON.parse(input) : null;
		let match;

		if ((match = /^repos\/o\/r\/issues\/comments\/(\d+)$/.exec(path))) {
			const index = state.comments.findIndex(
				(comment) => comment.id === Number(match[1])
			);
			if (method === 'DELETE') {
				state.comments.splice(index, 1);
				return ok();
			}
			if (method === 'PATCH') {
				state.comments[index].body = payload.body;
			}
			return ok(state.comments[index]);
		}
		if ((match = /^repos\/o\/r\/issues\/(\d+)\/comments$/.exec(path))) {
			return ok([
				state.comments.filter((comment) => comment.issue === match[1]),
			]);
		}
		if ((match = /^repos\/o\/r\/issues\/(\d+)$/.exec(path))) {
			if (method === 'PATCH') {
				state.bodies[match[1]] = payload.body;
			}
			return ok({ body: state.bodies[match[1]] ?? '' });
		}
		if ((match = /^repos\/o\/r\/pulls\/(\d+)$/.exec(path))) {
			return ok(state.pulls[match[1]]);
		}
		if ((match = /^repos\/o\/r\/pulls\?state=open&head=(.+)$/.exec(path))) {
			const head = decodeURIComponent(match[1]).split(':')[1];
			return ok(
				Object.entries(state.pulls)
					.filter(([, pull]) => pull.head.ref === head)
					.map(([number]) => ({ number: Number(number) }))
			);
		}
		throw new Error(`unexpected gh ${args.join(' ')}`);
	};

	const fetchImpl = async (url) => {
		const found = url in state.content && !state.unresolved.has(url);
		return {
			ok: found,
			status: found ? 200 : 404,
			headers: new Headers({
				'content-type': found ? 'image/png' : 'text/html',
			}),
			arrayBuffer: async () =>
				Buffer.from(`png:${state.content[url]}`).buffer,
		};
	};

	return { state, gh, fetchImpl };
}

async function localPngs(...names) {
	const dir = await mkdtemp(join(tmpdir(), 'screenshots-test-'));
	for (const name of names) {
		await writeFile(join(dir, name), `png:${name}`);
	}
	return { dir, path: (name) => join(dir, name) };
}

const TABLE = [
	'Summary.',
	'',
	'| Viewport | Before | After |',
	'| - | - | - |',
	'| Desktop | ![before-desktop.png](./before-desktop.png) | ![after-desktop.png](./after-desktop.png) |',
].join('\n');

test('uploadIssueScreenshot posts a marked comment with a verified attachment and keeps the local PNG', async () => {
	const { state, gh, fetchImpl } = fakeGithub();
	const files = await localPngs('before-desktop.png');

	const result = await uploadIssueScreenshot({
		repo: REPO,
		issue: 12,
		branch: 'feature-12',
		file: files.path('before-desktop.png'),
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	assert.match(result.url, /user-attachments\/assets\/a\d+$/);
	assert.equal(result.superseded, 0);
	assert.equal(state.comments.length, 1);
	assert.match(
		state.comments[0].body,
		/<!-- screenshot-attachment branch="feature-12" file="before-desktop.png" -->/
	);
	assert.ok(existsSync(files.path('before-desktop.png')));
});

test('re-uploading a filename supersedes only the same branch’s earlier comment', async () => {
	const { state, gh, fetchImpl } = fakeGithub();
	const files = await localPngs('before-desktop.png');
	const upload = (branch) =>
		uploadIssueScreenshot({
			repo: REPO,
			issue: 12,
			branch,
			file: files.path('before-desktop.png'),
			gh,
			fetchImpl,
			verifyOptions: NO_WAIT,
		});

	const first = await upload('feature-12');
	const other = await upload('followup-12');
	const second = await upload('feature-12');

	assert.equal(second.superseded, 1);
	assert.match(state.comments[0].body, /screenshot-attachment-superseded/);
	assert.match(state.comments[0].body, /Superseded by .*#issuecomment-/);
	assert.doesNotMatch(state.comments[1].body, /superseded/);

	const lookup = (branch) =>
		findIssueScreenshot({
			repo: REPO,
			issue: 12,
			branch,
			filename: 'before-desktop.png',
			gh,
		});
	assert.equal(lookup('feature-12'), second.url);
	assert.notEqual(second.url, first.url);
	assert.equal(lookup('followup-12'), other.url);
});

test('uploadIssueScreenshot fails, keeping the PNG and earlier upload, when gh posts nothing', async () => {
	const { state, gh, fetchImpl } = fakeGithub();
	const files = await localPngs('before-desktop.png');
	const failing = (args, options) =>
		args[1] === 'comment'
			? { status: 1, stdout: '', stderr: 'HTTP 502' }
			: gh(args, options);

	await assert.rejects(
		uploadIssueScreenshot({
			repo: REPO,
			issue: 12,
			branch: 'feature-12',
			file: files.path('before-desktop.png'),
			gh: failing,
			fetchImpl,
			verifyOptions: NO_WAIT,
		}),
		/failed \(gh exit 1\): HTTP 502/
	);
	assert.equal(state.comments.length, 0);
	assert.ok(existsSync(files.path('before-desktop.png')));
});

test('uploadIssueScreenshot removes its comment when the attachment is missing or never resolves', async () => {
	const { state, gh, fetchImpl } = fakeGithub();
	const files = await localPngs('before-desktop.png');
	await uploadIssueScreenshot({
		repo: REPO,
		issue: 12,
		branch: 'feature-12',
		file: files.path('before-desktop.png'),
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	state.failUploads.add('before-desktop.png');
	await assert.rejects(
		uploadIssueScreenshot({
			repo: REPO,
			issue: 12,
			branch: 'feature-12',
			file: files.path('before-desktop.png'),
			gh,
			fetchImpl,
			verifyOptions: NO_WAIT,
		}),
		/did not produce a working attachment/
	);

	assert.equal(state.comments.length, 1, 'only the earlier comment remains');
	assert.doesNotMatch(state.comments[0].body, /superseded/);
});

test('attachPrScreenshots fills the Screenshots table and leaves no staging block', async () => {
	const { state, gh, fetchImpl } = fakeGithub({ bodies: { 20: TABLE } });
	const files = await localPngs('before-desktop.png', 'after-desktop.png');

	const attached = await attachPrScreenshots({
		repo: REPO,
		pr: 20,
		files: [
			files.path('before-desktop.png'),
			files.path('after-desktop.png'),
		],
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	const body = state.bodies[20];
	assert.ok(!body.includes(STAGING_START));
	assert.ok(body.startsWith('Summary.'));
	assert.ok(
		body.includes(
			`| Desktop | ![before-desktop.png](${attached['before-desktop.png']}) | ![after-desktop.png](${attached['after-desktop.png']}) |`
		)
	);
	assert.deepEqual(state.attachCalls, [
		['before-desktop.png', 'after-desktop.png'],
	]);
	assert.equal(
		await readFile(files.path('after-desktop.png'), 'utf8'),
		'png:after-desktop.png'
	);
});

test('a replacement updates only its own reference, and only once the new URL resolves', async () => {
	const old = 'https://github.com/user-attachments/assets/old-after';
	const body = TABLE.replace(
		'./before-desktop.png',
		'https://github.com/user-attachments/assets/old-before'
	).replace('./after-desktop.png', old);
	const { state, gh, fetchImpl } = fakeGithub({ bodies: { 20: body } });
	const files = await localPngs('after-desktop.png');

	// The new upload never resolves: the working reference must stay.
	const failingFetch = async (url, options) =>
		url === old || url.endsWith('old-before')
			? fetchImpl(url, options)
			: { ok: false, status: 404, headers: new Headers() };
	state.content[old] = 'after-desktop.png';
	await assert.rejects(
		attachPrScreenshots({
			repo: REPO,
			pr: 20,
			files: [files.path('after-desktop.png')],
			gh,
			fetchImpl: failingFetch,
			maxAttempts: 1,
			verifyOptions: NO_WAIT,
		}),
		/after-desktop.png: .* does not resolve/
	);
	assert.equal(state.bodies[20], body);

	const attached = await attachPrScreenshots({
		repo: REPO,
		pr: 20,
		files: [files.path('after-desktop.png')],
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});
	assert.equal(
		state.bodies[20],
		body.replace(old, attached['after-desktop.png'])
	);
	assert.ok(state.bodies[20].includes('old-before'));
});

test('partial success keeps the uploaded image and retries only the missing one', async () => {
	const { state, gh, fetchImpl } = fakeGithub({ bodies: { 20: TABLE } });
	const files = await localPngs('before-desktop.png', 'after-desktop.png');
	state.failUploads.add('after-desktop.png');

	let editCalls = 0;
	const flaky = (args, options) => {
		if (args[1] === 'edit' && ++editCalls === 2) {
			state.failUploads.clear();
		}
		return gh(args, options);
	};

	const attached = await attachPrScreenshots({
		repo: REPO,
		pr: 20,
		files: [
			files.path('before-desktop.png'),
			files.path('after-desktop.png'),
		],
		gh: flaky,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	assert.deepEqual(state.attachCalls, [
		['before-desktop.png', 'after-desktop.png'],
		['after-desktop.png'],
	]);
	assert.equal(Object.keys(attached).length, 2);
	const references = state.bodies[20].match(/!\[[^\]]+\]\([^)]+\)/g);
	assert.equal(references.length, 2, 'no image is duplicated');
	assert.ok(!state.bodies[20].includes('./'));
});

test('persistent failure reports the missing file, cleans up staging and keeps the local PNG', async () => {
	const { state, gh, fetchImpl } = fakeGithub({ bodies: { 20: TABLE } });
	const files = await localPngs('before-desktop.png', 'after-desktop.png');
	state.failUploads.add('after-desktop.png');

	const error = await attachPrScreenshots({
		repo: REPO,
		pr: 20,
		files: [
			files.path('before-desktop.png'),
			files.path('after-desktop.png'),
		],
		gh,
		fetchImpl,
		maxAttempts: 2,
		verifyOptions: NO_WAIT,
	}).catch((caught) => caught);

	assert.match(error.message, /incomplete/);
	assert.match(error.message, /after-desktop.png: not uploaded/);
	assert.deepEqual(error.missing, ['after-desktop.png']);
	assert.deepEqual(Object.keys(error.attached), ['before-desktop.png']);
	assert.ok(!state.bodies[20].includes(STAGING_START));
	assert.ok(existsSync(files.path('after-desktop.png')));
	assert.equal(state.attachCalls.length, 2);
});

test('a before image missing locally is retrieved from its issue attachment for the PR branch', async () => {
	const { state, gh, fetchImpl } = fakeGithub({
		bodies: { 20: TABLE },
		pulls: {
			20: { head: { ref: 'feature-12' }, body: `${TABLE}\n\nCloses #12` },
		},
	});
	const early = await localPngs('before-desktop.png');
	const { url } = await uploadIssueScreenshot({
		repo: REPO,
		issue: 12,
		branch: 'feature-12',
		file: early.path('before-desktop.png'),
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	const attached = await attachPrScreenshots({
		repo: REPO,
		pr: 20,
		files: ['/nowhere/before-desktop.png'],
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	assert.notEqual(attached['before-desktop.png'], url);
	assert.equal(
		state.content[attached['before-desktop.png']],
		'before-desktop.png'
	);
	assert.ok(state.bodies[20].includes(attached['before-desktop.png']));
});

test('a missing local file with no issue attachment fails before touching the PR', async () => {
	const { state, gh, fetchImpl } = fakeGithub({
		bodies: { 20: TABLE },
		pulls: { 20: { head: { ref: 'feature-12' }, body: 'Refs #12' } },
	});

	await assert.rejects(
		attachPrScreenshots({
			repo: REPO,
			pr: 20,
			files: ['/nowhere/before-desktop.png'],
			gh,
			fetchImpl,
			verifyOptions: NO_WAIT,
		}),
		/no issue attachment for branch feature-12 was found on #12/
	);
	assert.equal(state.bodies[20], TABLE);
	assert.equal(state.attachCalls.length, 0);
});

test('verifyPrScreenshots flags local paths, broken URLs, missing files and leftover staging', async () => {
	const good = 'https://github.com/user-attachments/assets/good';
	const broken = 'https://github.com/user-attachments/assets/broken';
	const body = [
		`![before-desktop.png](${good})`,
		`![after-desktop.png](${broken})`,
		'![after-mobile.png](./after-mobile.png)',
		STAGING_START,
	].join('\n');
	const { state, gh, fetchImpl } = fakeGithub({ bodies: { 20: body } });
	state.content[good] = 'before-desktop.png';

	const { checked, problems } = await verifyPrScreenshots({
		repo: REPO,
		pr: 20,
		expected: ['before-desktop.png', 'before-mobile.png'],
		gh,
		fetchImpl,
		verifyOptions: NO_WAIT,
	});

	assert.equal(checked, 3);
	assert.deepEqual(problems, [
		'the description still has an unfinished staging block',
		'before-mobile.png: not referenced',
		`after-desktop.png: ${broken} does not resolve`,
		'after-mobile.png: ./after-mobile.png is a local path, not an attachment',
	]);
});

test('verifyPrScreenshots passes when every referenced image resolves', async () => {
	const url = 'https://github.com/user-attachments/assets/good';
	const { state, gh, fetchImpl } = fakeGithub({
		bodies: { 20: `![after-desktop.png](${url})` },
	});
	state.content[url] = 'after-desktop.png';

	const result = await verifyPrScreenshots({
		repo: REPO,
		pr: 20,
		expected: ['after-desktop.png'],
		gh,
		fetchImpl,
	});

	assert.deepEqual(result, { checked: 1, problems: [] });
});

test('verifyImageUrl waits for a fresh attachment that briefly 404s', async () => {
	let requests = 0;
	const waits = [];
	const fetchImpl = async () => {
		requests++;
		const ready = requests === 3;
		return {
			ok: ready,
			status: ready ? 200 : 404,
			headers: new Headers({
				'content-type': ready ? 'image/png' : 'text/html',
			}),
		};
	};

	const resolved = await verifyImageUrl('https://x', fetchImpl, {
		delays: [5, 10, 20],
		wait: async (ms) => waits.push(ms),
	});

	assert.equal(resolved, true);
	assert.deepEqual(waits, [5, 10]);
});

test('verifyImageUrl rejects a URL that serves something other than an image', async () => {
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		headers: new Headers({ 'content-type': 'text/html' }),
	});

	assert.equal(await verifyImageUrl('https://x', fetchImpl, NO_WAIT), false);
});

test('findPullRequestForBranch returns the open PR for the branch, or null', () => {
	const { gh } = fakeGithub({
		pulls: { 20: { head: { ref: 'feature-12' }, body: '' } },
	});

	assert.equal(
		findPullRequestForBranch({ repo: REPO, branch: 'feature-12', gh }),
		20
	);
	assert.equal(
		findPullRequestForBranch({ repo: REPO, branch: 'other', gh }),
		null
	);
});
