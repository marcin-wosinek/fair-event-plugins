import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	PinError,
	STABLE_CHECK_URL,
	VERSION_HISTORY_URL,
	compareVersions,
	decideAction,
	findAnnouncement,
	parseArgs,
	parseStableCheck,
	pinnedVersion,
	prBody,
	run,
	setCoreInConfig,
} from '../wordpress-pin.mjs';

const CONFIG = `{
\t"$schema": "https://schemas.wp.org/trunk/wp-env.json",
\t"core": "WordPress/WordPress#7.1.5",
\t"phpVersion": "8.5"
}
`;

const HISTORY = `<table><tr><th>Version</th></tr><tr><td><a href="https://wordpress.org/documentation/wordpress-version/version-7-1-6/">7.1.6</a></td><td>December 2, 2026</td><td><a href="https://wordpress.org/documentation/wordpress-version/version-7-1-6/">Changelog</a></td><td><a href="https://wordpress.org/news/2026/12/wordpress-7-1-6-release/">Blog</a></td><td></td></tr><tr><td><a href="https://wordpress.org/documentation/wordpress-version/version-7-1-5/">7.1.5</a></td><td>November 18, 2026</td><td><a href="https://wordpress.org/documentation/wordpress-version/version-7-1-5/">Changelog</a></td><td><a href="https://wordpress.org/news/2026/11/wordpress-7-1-5-release/">Blog</a></td><td></td></tr></table>`;

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
		text: async () => body,
	};
}

function fakeFetch(routes) {
	const calls = [];
	const impl = async (url) => {
		calls.push(url);
		const route = routes[url];
		if (route instanceof Error) {
			throw route;
		}
		if (!route) {
			throw new Error(`unexpected request ${url}`);
		}
		return route();
	};
	impl.calls = calls;
	return impl;
}

async function withConfig(fn) {
	const dir = await mkdtemp(join(tmpdir(), 'wordpress-pin-'));
	const configPath = join(dir, '.wp-env.json');
	const bodyFile = join(dir, 'body.md');
	await writeFile(configPath, CONFIG);
	try {
		await fn({ configPath, bodyFile });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function quiet() {
	const lines = [];
	const warnings = [];
	return {
		lines,
		warnings,
		log: (line) => lines.push(line),
		warn: (line) => warnings.push(line),
	};
}

test('compareVersions compares numerically and treats x.y as x.y.0', () => {
	assert.ok(compareVersions('7.10', '7.9.9') > 0);
	assert.ok(compareVersions('7.1.5', '7.1.6') < 0);
	assert.equal(compareVersions('7.1', '7.1.0'), 0);
	assert.throws(() => compareVersions('7.2-RC1', '7.1'), PinError);
});

test('parseStableCheck needs exactly one numeric latest release', () => {
	assert.equal(
		parseStableCheck({ '7.0.9': 'outdated', '7.1.5': 'latest' }),
		'7.1.5'
	);
	assert.throws(
		() => parseStableCheck({ '7.1.5': 'outdated' }),
		/0 releases/
	);
	assert.throws(
		() => parseStableCheck({ '7.1.5': 'latest', 7.2: 'latest' }),
		/2 releases/
	);
	assert.throws(() => parseStableCheck({ '7.2-RC1': 'latest' }), /numeric/);
	assert.throws(() => parseStableCheck([]), /JSON object/);
	assert.throws(() => parseStableCheck(null), /JSON object/);
});

test('pinnedVersion accepts only an exact WordPress/WordPress tag', () => {
	assert.equal(pinnedVersion('WordPress/WordPress#7.1.5'), '7.1.5');
	assert.throws(() => pinnedVersion(null), PinError);
	assert.throws(() => pinnedVersion('WordPress/WordPress#trunk'), PinError);
	assert.throws(
		() => pinnedVersion('https://wordpress.org/latest.zip'),
		PinError
	);
});

test('decideAction covers newer, equal, older and open-PR cases', () => {
	const pr = (version) => `WordPress/WordPress#${version}`;
	assert.equal(decideAction({ current: '7.1.5', latest: '7.1.5' }), 'none');
	assert.equal(decideAction({ current: '7.1.5', latest: '7.1.4' }), 'none');
	assert.equal(decideAction({ current: '7.1.5', latest: '7.1.6' }), 'create');
	assert.equal(
		decideAction({
			current: '7.1.5',
			latest: '7.1.6',
			openPrCore: pr('7.1.6'),
		}),
		'skip'
	);
	// A later release replaces the proposal on the same PR.
	assert.equal(
		decideAction({
			current: '7.1.5',
			latest: '7.2',
			openPrCore: pr('7.1.6'),
		}),
		'update'
	);
	assert.equal(
		decideAction({
			current: '7.1.5',
			latest: '7.1.6',
			openPrCore: 'broken',
		}),
		'update'
	);
	// A stale PR left open after main moved on proposes nothing new.
	assert.equal(
		decideAction({
			current: '7.1.6',
			latest: '7.1.6',
			openPrCore: pr('7.1.6'),
		}),
		'none'
	);
});

test('setCoreInConfig changes only the core value', () => {
	assert.equal(
		setCoreInConfig(CONFIG, '7.1.6'),
		CONFIG.replace('#7.1.5', '#7.1.6')
	);
	assert.throws(() => setCoreInConfig('{}', '7.1.6'), /no string "core"/);
});

test('findAnnouncement reads the Blog link from the version history row', () => {
	assert.equal(
		findAnnouncement(HISTORY, '7.1.5'),
		'https://wordpress.org/news/2026/11/wordpress-7-1-5-release/'
	);
	assert.equal(
		findAnnouncement(HISTORY, '7.1.6'),
		'https://wordpress.org/news/2026/12/wordpress-7-1-6-release/'
	);
	assert.equal(findAnnouncement(HISTORY, '7.1'), null);
	assert.equal(findAnnouncement(HISTORY, '7.2'), null);
});

test('prBody names both versions and the announcement or a fallback', () => {
	const withLink = prBody({
		current: '7.1.5',
		latest: '7.1.6',
		announcement: 'https://wordpress.org/news/x/',
	});
	assert.match(withLink, /\*\*7\.1\.5\*\* to \*\*7\.1\.6\*\*/);
	assert.match(
		withLink,
		/Release announcement: https:\/\/wordpress\.org\/news\/x\//
	);
	assert.match(
		prBody({ current: '7.1.5', latest: '7.1.6', announcement: null }),
		/release archive/
	);
});

test('parseArgs validates the command line', () => {
	assert.deepEqual(parseArgs(['check']), {
		write: false,
		openPrCore: null,
		bodyFile: null,
	});
	assert.deepEqual(
		parseArgs(['check', '--write', '--body-file=b.md', '--open-pr-core=']),
		{ write: true, openPrCore: null, bodyFile: 'b.md' }
	);
	assert.throws(() => parseArgs([]), /Usage/);
	assert.throws(() => parseArgs(['check', '--write']), /body-file/);
	assert.throws(() => parseArgs(['check', '--nope']), /Unknown/);
});

test('run writes the new pin and PR body for a newer release', async () => {
	await withConfig(async ({ configPath, bodyFile }) => {
		const out = quiet();
		const fetch = fakeFetch({
			[STABLE_CHECK_URL]: () =>
				jsonResponse({ '7.1.5': 'outdated', '7.1.6': 'latest' }),
			[VERSION_HISTORY_URL]: () => jsonResponse(HISTORY),
		});
		const result = await run(
			{ write: true, bodyFile, openPrCore: null },
			{ fetch, configPath, ...out }
		);
		assert.equal(result.action, 'create');
		assert.deepEqual(out.lines, [
			'current=7.1.5',
			'latest=7.1.6',
			'action=create',
		]);
		assert.equal(
			await readFile(configPath, 'utf8'),
			CONFIG.replace('#7.1.5', '#7.1.6')
		);
		assert.match(
			await readFile(bodyFile, 'utf8'),
			/wordpress-7-1-6-release/
		);
	});
});

test('run leaves the pin alone when current or already proposed', async () => {
	await withConfig(async ({ configPath, bodyFile }) => {
		for (const [latest, openPrCore, action] of [
			['7.1.5', null, 'none'],
			['7.1.6', 'WordPress/WordPress#7.1.6', 'skip'],
		]) {
			const fetch = fakeFetch({
				[STABLE_CHECK_URL]: () => jsonResponse({ [latest]: 'latest' }),
			});
			const result = await run(
				{ write: true, bodyFile, openPrCore },
				{ fetch, configPath, ...quiet() }
			);
			assert.equal(result.action, action);
			assert.deepEqual(fetch.calls, [STABLE_CHECK_URL]);
		}
		assert.equal(await readFile(configPath, 'utf8'), CONFIG);
	});
});

test('run warns but changes nothing when the pin is ahead of WordPress.org', async () => {
	await withConfig(async ({ configPath, bodyFile }) => {
		const out = quiet();
		const fetch = fakeFetch({
			[STABLE_CHECK_URL]: () => jsonResponse({ '7.1.4': 'latest' }),
		});
		const result = await run(
			{ write: true, bodyFile, openPrCore: null },
			{ fetch, configPath, ...out }
		);
		assert.equal(result.action, 'none');
		assert.match(out.warnings[0], /newer than the latest/);
		assert.equal(await readFile(configPath, 'utf8'), CONFIG);
	});
});

test('run fails without writing on lookup failures and bad responses', async () => {
	await withConfig(async ({ configPath, bodyFile }) => {
		for (const [route, pattern] of [
			[new Error('Socket closed'), /failed: Socket closed/],
			[() => jsonResponse({}, 503), /HTTP 503/],
			[() => jsonResponse('<html>'), /invalid JSON/],
			[() => jsonResponse({ '7.2-beta1': 'latest' }), /numeric/],
		]) {
			const fetch = fakeFetch({ [STABLE_CHECK_URL]: route });
			await assert.rejects(
				run(
					{ write: true, bodyFile, openPrCore: null },
					{ fetch, configPath, ...quiet() }
				),
				pattern
			);
		}
		assert.equal(await readFile(configPath, 'utf8'), CONFIG);
		await assert.rejects(readFile(bodyFile, 'utf8'), { code: 'ENOENT' });
	});
});

test('run still proposes the update when the version history is unreachable', async () => {
	await withConfig(async ({ configPath, bodyFile }) => {
		const out = quiet();
		const fetch = fakeFetch({
			[STABLE_CHECK_URL]: () => jsonResponse({ '7.1.6': 'latest' }),
			[VERSION_HISTORY_URL]: new Error('timeout'),
		});
		await run(
			{ write: true, bodyFile, openPrCore: null },
			{ fetch, configPath, ...out }
		);
		assert.match(out.warnings[0], /version history/);
		assert.match(await readFile(bodyFile, 'utf8'), /release archive/);
	});
});

test('.wp-env.json pins an exact WordPress release', async () => {
	const config = JSON.parse(
		await readFile(new URL('../../.wp-env.json', import.meta.url), 'utf8')
	);
	assert.match(pinnedVersion(config.core), /^\d+\.\d+(\.\d+)?$/);
});
