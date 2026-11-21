import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyMain,
	classifyPullRequest,
	UnavailableError,
	waitForAnalysis,
	WAIT_LIMIT_MS,
} from '../sonar-review.mjs';

const SHA = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

const appSuite = (status, conclusion = null) => ({
	app: { slug: 'sonarqubecloud' },
	status,
	conclusion,
});
const appRun = (status, conclusion = null) => ({
	app: { slug: 'sonarqubecloud' },
	name: 'SonarCloud Code Analysis',
	status,
	conclusion,
	details_url: 'https://sonarcloud.io/dashboard?pullRequest=1',
	output: { title: `Quality Gate ${conclusion}` },
});
const actionsJob = (status, conclusion = null) => ({
	app: { slug: 'github-actions' },
	name: 'SonarQube analysis',
	status,
	conclusion,
	html_url: 'https://github.com/actions/job/1',
});
const findings = (overrides = {}) => ({
	commitSha: SHA,
	gate: { status: 'OK', failedConditions: [] },
	issues: [],
	hotspots: [],
	...overrides,
});

function classify({ suites = [], runs = [], found = null, headSha = SHA }) {
	return classifyPullRequest({
		sha: SHA,
		headSha,
		suites,
		runs,
		findings: found,
	}).state;
}

test('a passed gate for the exact revision is success', () => {
	assert.equal(
		classify({ runs: [appRun('completed', 'success')], found: findings() }),
		'passed'
	);
});

test('a failed gate with published findings is a result to review', () => {
	const gate = {
		status: 'ERROR',
		failedConditions: [{ metricKey: 'new_duplicated_lines_density' }],
	};
	const report = classifyPullRequest({
		sha: SHA,
		headSha: SHA,
		suites: [],
		runs: [
			appRun('completed', 'failure'),
			actionsJob('completed', 'failure'),
		],
		findings: findings({ gate }),
	});
	assert.equal(report.state, 'gate-failed');
	assert.deepEqual(report.gate, gate);
	assert.match(report.notes[0], /concluded failure/);
});

test('findings from an earlier commit never verify the revision', () => {
	assert.equal(
		classify({
			runs: [appRun('completed', 'success')],
			found: findings({ commitSha: NEXT }),
		}),
		'pending'
	);
});

test('a moved PR head supersedes the target revision', () => {
	assert.equal(classify({ headSha: NEXT }), 'superseded');
});

test('distinguishes pending, skipped, failed and unavailable', () => {
	assert.equal(classify({ suites: [appSuite('queued')] }), 'pending');
	assert.equal(classify({ runs: [appRun('in_progress')] }), 'pending');
	assert.equal(classify({ runs: [actionsJob('in_progress')] }), 'pending');
	assert.equal(
		classify({ runs: [appRun('completed', 'skipped')] }),
		'skipped'
	);
	assert.equal(
		classify({ runs: [actionsJob('completed', 'skipped')] }),
		'skipped'
	);
	assert.equal(
		classify({ suites: [appSuite('completed', 'neutral')] }),
		'skipped'
	);
	assert.equal(
		classify({ runs: [actionsJob('completed', 'failure')] }),
		'failed'
	);
	assert.equal(
		classify({ runs: [appRun('completed', 'timed_out')] }),
		'failed'
	);
	assert.equal(classify({}), 'unavailable');
});

test('main needs an analysis that contains the merged change', () => {
	const analyses = [
		{ key: 'new', revision: NEXT, date: '2026-11-21' },
		{ key: 'old', revision: SHA, date: '2026-11-20' },
	];
	const gates = { new: { status: 'OK', failedConditions: [] } };
	assert.equal(
		classifyMain({
			analyses,
			contains: () => false,
			gateFor: (key) => gates[key],
		}).state,
		'pending'
	);
	const report = classifyMain({
		analyses,
		contains: (revision) => revision === NEXT,
		gateFor: (key) => gates[key],
	});
	assert.equal(report.state, 'passed');
	assert.equal(report.analyzedSha, NEXT);
	assert.equal(
		classifyMain({
			analyses,
			contains: () => true,
			gateFor: () => ({ status: 'ERROR', failedConditions: [] }),
		}).state,
		'gate-failed'
	);
});

function clock() {
	let time = Date.parse('2026-11-21T12:00:00Z');
	return {
		now: () => time,
		sleep: async (ms) => {
			time += ms;
		},
		advance: (ms) => {
			time += ms;
		},
	};
}

test('repeated polling stops at the fixed 15-minute deadline', async () => {
	const fake = clock();
	const remaining = [];
	const report = await waitForAnalysis({
		...fake,
		observe: async ({ remainingMs }) => {
			remaining.push(remainingMs);
			fake.advance(5000);
			return { state: 'pending', reason: 'Check queued.' };
		},
	});
	assert.equal(report.state, 'pending-timeout');
	assert.equal(report.reason, 'analysis pending — wait limit reached');
	assert.equal(report.lastStatus, 'Check queued.');
	assert.equal(report.startedAt, '2026-11-21T12:00:00.000Z');
	assert.equal(report.expiredAt, '2026-11-21T12:15:00.000Z');
	assert.equal(remaining[0], WAIT_LIMIT_MS);
	assert.ok(remaining.every((ms, i) => i === 0 || ms < remaining[i - 1]));
	assert.ok(fake.now() <= Date.parse(report.expiredAt));
});

test('a recheck of the same revision gets its own deadline', async () => {
	const fake = clock();
	const pending = async () => ({ state: 'pending', reason: 'queued' });
	const first = await waitForAnalysis({ ...fake, observe: pending });
	const second = await waitForAnalysis({ ...fake, observe: pending });
	assert.equal(second.startedAt, first.expiredAt);
	assert.equal(second.expiredAt, '2026-11-21T12:30:00.000Z');
});

test('a terminal result ends the wait immediately', async () => {
	const fake = clock();
	let calls = 0;
	const report = await waitForAnalysis({
		...fake,
		observe: async () => {
			calls += 1;
			return calls < 3
				? { state: 'pending', reason: 'queued' }
				: { state: 'gate-failed', reason: 'Quality Gate failed' };
		},
	});
	assert.equal(report.state, 'gate-failed');
	assert.equal(report.polls, 3);
	assert.equal(report.finishedAt, '2026-11-21T12:01:00.000Z');
});

test('a 4xx is unavailable at once; transient errors keep polling', async () => {
	const fake = clock();
	const unavailable = await waitForAnalysis({
		...fake,
		observe: async () => {
			throw new UnavailableError('HTTP 403');
		},
	});
	assert.equal(unavailable.state, 'unavailable');
	assert.equal(unavailable.polls, 1);

	let calls = 0;
	const recovered = await waitForAnalysis({
		...fake,
		observe: async () => {
			calls += 1;
			if (calls === 1) {
				throw new Error('socket hang up');
			}
			return { state: 'passed', reason: 'ok' };
		},
	});
	assert.equal(recovered.state, 'passed');
	assert.equal(recovered.polls, 2);
});
