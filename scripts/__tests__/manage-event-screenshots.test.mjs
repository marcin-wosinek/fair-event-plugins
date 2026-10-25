import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	OUTPUT_DIR,
	assertLocalTarget,
	buildIndex,
	renderContactSheet,
	runManageEventScreenshots,
} from '../manage-event-screenshots.mjs';
import {
	MANAGE_EVENT_TABS,
	TAB_SOURCES,
	checkTabCoverage,
	describeCoverage,
	screenshotFilename,
} from '../../e2e/screenshots/manage-event-tabs.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const revision = { commit: 'abc1234', dirty: false };

/** Tab names registered by `{ name: '…', title: __( … ) }` descriptors. */
function registeredTabNames() {
	const names = [];
	for (const source of TAB_SOURCES) {
		const code = readFileSync(join(ROOT, source), 'utf8');
		for (const match of code.matchAll(
			/name:\s*'([a-z-]+)',\s*title:\s*__\(/g
		)) {
			names.push(match[1]);
		}
	}
	return names;
}

function tempRoot() {
	return mkdtempSync(join(tmpdir(), 'manage-event-screenshots-'));
}

/** Write what a spec run leaves behind: records and images. */
function writeRun(runDirectory, { failTab, skipTab, coverage } = {}) {
	mkdirSync(join(runDirectory, 'results'), { recursive: true });
	writeFileSync(
		join(runDirectory, 'context.json'),
		JSON.stringify({ wordpress: '7.1', plugins: [] })
	);
	writeFileSync(
		join(runDirectory, 'results', '_coverage.json'),
		JSON.stringify(
			coverage ?? { ok: true, missing: [], unexpected: [], disabled: [] }
		)
	);
	for (const tab of MANAGE_EVENT_TABS) {
		if (tab.name === skipTab) {
			continue;
		}
		const passed = tab.name !== failTab;
		if (passed) {
			writeFileSync(join(runDirectory, screenshotFilename(tab)), 'png');
		}
		writeFileSync(
			join(runDirectory, 'results', `${tab.name}.json`),
			JSON.stringify({
				tab: tab.name,
				status: passed ? 'passed' : 'failed',
				error: passed ? undefined : 'Timed out waiting for data',
			})
		);
	}
}

test('the manifest covers exactly the registered Manage Event tabs', () => {
	const registered = registeredTabNames();
	assert.deepEqual(
		[...registered].sort(),
		MANAGE_EVENT_TABS.map((tab) => tab.name).sort()
	);
	assert.equal(MANAGE_EVENT_TABS.length, 10);
});

test('every tab has a stable, ordered filename', () => {
	assert.deepEqual(
		MANAGE_EVENT_TABS.map(screenshotFilename).slice(0, 3),
		['01-event-details.png', '02-prices.png', '03-schedule.png']
	);
});

test('coverage reports missing, disabled and unknown tabs by name', () => {
	const manifest = [{ name: 'prices' }, { name: 'groups' }];
	assert.equal(
		checkTabCoverage(manifest, [
			{ name: 'prices', disabled: false },
			{ name: 'groups', disabled: false },
		]).ok,
		true
	);

	const coverage = checkTabCoverage(manifest, [
		{ name: 'prices', disabled: true },
		{ name: 'tickets-v2', disabled: false },
	]);
	assert.equal(coverage.ok, false);
	assert.deepEqual(coverage.missing, ['groups']);
	assert.deepEqual(coverage.disabled, ['prices']);
	assert.deepEqual(coverage.unexpected, ['tickets-v2']);
	assert.match(describeCoverage(coverage), /missing tabs: groups/);
	assert.match(describeCoverage(coverage), /tickets-v2 \(add them/);
});

test('only local targets are accepted', () => {
	for (const url of [
		'http://localhost:8889',
		'http://127.0.0.1:8891/',
		'http://[::1]:8889',
	]) {
		assert.equal(assertLocalTarget(url), url);
	}
	for (const url of [
		'https://example.com',
		'http://localhost.example.com:8889',
		'not a url',
	]) {
		assert.throws(() => assertLocalTarget(url));
	}
});

test('a complete run indexes every tab with its capture context', () => {
	const root = tempRoot();
	try {
		writeRun(root);
		const index = buildIndex({ runDirectory: root, revision });
		assert.equal(index.status, 'complete');
		assert.deepEqual(index.failures, []);
		assert.equal(index.images.length, 10);
		assert.deepEqual(index.images[2], {
			...index.images[2],
			tab: 'schedule',
			file: '03-schedule.png',
			scenario: 'standalone-event',
			locale: 'en_US',
			status: 'passed',
		});
		assert.equal(index.images[0].viewport.width, 1280);
		assert.equal(index.revision.commit, 'abc1234');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('failed, missing and empty captures each name their tab', () => {
	const root = tempRoot();
	try {
		writeRun(root, { failTab: 'statistics', skipTab: 'admin' });
		writeFileSync(join(root, '02-prices.png'), '');
		const index = buildIndex({ runDirectory: root, revision });
		assert.equal(index.status, 'failed');
		assert.deepEqual(
			index.failures.map((failure) => [failure.tab, failure.reason]),
			[
				['prices', 'Screenshot file is missing or empty.'],
				['statistics', 'Timed out waiting for data'],
				['admin', 'Not captured.'],
			]
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a setup failure and a coverage failure fail the index', () => {
	const root = tempRoot();
	try {
		const empty = buildIndex({ runDirectory: root, revision });
		assert.equal(empty.status, 'failed');
		assert.match(empty.failures[0].reason, /setup failed/);

		mkdirSync(join(root, 'results'), { recursive: true });
		writeFileSync(
			join(root, 'results', '_setup.json'),
			JSON.stringify({ status: 'failed', error: 'fair-finance inactive' })
		);
		assert.equal(
			buildIndex({ runDirectory: root, revision }).failures[0].reason,
			'Setup failed: fair-finance inactive'
		);

		writeRun(root, {
			coverage: {
				ok: false,
				missing: ['mailings'],
				unexpected: [],
				disabled: [],
			},
		});
		const index = buildIndex({ runDirectory: root, revision });
		assert.deepEqual(index.failures, [
			{
				tab: 'mailings',
				scenario: 'standalone-event',
				reason: 'Tab missing from Manage Event.',
			},
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the contact sheet escapes text and marks missing images', () => {
	const html = renderContactSheet({
		status: 'failed',
		scenario: 'standalone-event',
		locale: 'en_US',
		viewport: { name: 'desktop', width: 1280, height: 900 },
		revision,
		wordpress: '7.1',
		generatedAt: 'now',
		plugins: [{ name: '<b>x</b>', version: '1' }],
		images: [
			{ tab: 'list', title: 'List', plugin: 'fair-events', file: null },
		],
	});
	assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
	assert.match(html, /Not captured/);
});

test('a complete run replaces latest and drops earlier runs', async () => {
	const root = tempRoot();
	try {
		const output = join(root, OUTPUT_DIR);
		mkdirSync(join(output, 'runs', 'old'), { recursive: true });
		mkdirSync(join(output, 'latest'), { recursive: true });
		writeFileSync(join(output, 'latest', 'stale.png'), 'old');

		const status = await runManageEventScreenshots({
			rootDirectory: root,
			baseUrl: 'http://localhost:8889',
			revision,
			logger: () => {},
			runId: 'new',
			runSpec: async (runDirectory) => {
				writeRun(runDirectory);
				return 0;
			},
		});

		assert.equal(status, 0);
		assert.equal(existsSync(join(output, 'runs', 'old')), false);
		assert.equal(existsSync(join(output, 'latest', 'stale.png')), false);
		assert.equal(existsSync(join(output, 'latest', '10-admin.png')), true);
		assert.equal(existsSync(join(output, 'latest', 'results')), false);
		const index = JSON.parse(
			readFileSync(join(output, 'latest', 'index.json'), 'utf8')
		);
		assert.equal(index.status, 'complete');
		assert.equal(existsSync(join(output, 'latest', 'index.html')), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a failed run exits non-zero, reports the tab and keeps latest', async () => {
	const root = tempRoot();
	try {
		const output = join(root, OUTPUT_DIR);
		mkdirSync(join(output, 'latest'), { recursive: true });
		writeFileSync(join(output, 'latest', 'kept.png'), 'old');
		const lines = [];

		const status = await runManageEventScreenshots({
			rootDirectory: root,
			baseUrl: 'http://localhost:8889',
			revision,
			logger: (line) => lines.push(line),
			runId: 'new',
			runSpec: async (runDirectory) => {
				writeRun(runDirectory, { failTab: 'finance' });
				return 1;
			},
		});

		assert.equal(status, 1);
		assert.equal(existsSync(join(output, 'latest', 'kept.png')), true);
		assert.ok(
			lines.some((line) =>
				line.includes('tab "finance": Timed out waiting for data')
			)
		);
		const index = JSON.parse(
			readFileSync(join(output, 'runs', 'new', 'index.json'), 'utf8')
		);
		assert.equal(index.status, 'failed');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a non-zero exit fails the run even when every record passed', async () => {
	const root = tempRoot();
	try {
		const status = await runManageEventScreenshots({
			rootDirectory: root,
			baseUrl: 'http://localhost:8889',
			revision,
			logger: () => {},
			runId: 'new',
			runSpec: async (runDirectory) => {
				writeRun(runDirectory);
				return 130;
			},
		});
		assert.equal(status, 130);
		assert.equal(existsSync(join(root, OUTPUT_DIR, 'latest')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a remote target is refused before anything runs', async () => {
	const root = tempRoot();
	try {
		let ran = false;
		const status = await runManageEventScreenshots({
			rootDirectory: root,
			baseUrl: 'https://fair-event-plugins.com',
			revision,
			logger: () => {},
			runSpec: async () => {
				ran = true;
				return 0;
			},
		});
		assert.equal(status, 2);
		assert.equal(ran, false);
		assert.equal(existsSync(join(root, OUTPUT_DIR)), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
