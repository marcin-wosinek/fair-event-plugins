import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { parseArguments, runTests } from '../api-test-runner.mjs';
import {
	buildReport,
	classifySource,
	collectLogs,
	CONTAINER_LOGS,
	diagnosticsConstants,
	formatSummary,
	parseLog,
	PROBE_HEADER,
	probeMarker,
	sendProbe,
} from '../php-diagnostics.mjs';

const TOKEN = 'token-1234';
const WORKSPACES = ['fair-events', 'fair-audience', 'fair-events-shared'];
const PROBE_LINE = `[11-Nov-2026 08:14:23 UTC] PHP Warning:  ${probeMarker(
	TOKEN
)} in /var/www/html/wp-content/mu-plugins/fair-e2e-php-diagnostics.php on line 38`;

function present(text) {
	return { code: 0, stdout: `fair-php-diagnostics-log:present\n${text}` };
}

const MISSING = { code: 0, stdout: 'fair-php-diagnostics-log:missing\n' };

function probeResponse(body, status = 200) {
	return async () => ({ status, text: async () => body });
}

const goodProbe = probeResponse(
	JSON.stringify({ probe: 'sent', php: '8.5.12', wordpress: '7.1.4' })
);

/**
 * Fake executor. `handler(commandLine, args)` may return a result; reading a
 * log answers from `logs` (undefined: missing file).
 *
 * @param {Object}   root          Parameters.
 * @param {Object}   root.logs     Log text per runtime.
 * @param {Function} root.handler  Overrides per command.
 * @param {Function} root.onRun    Called for every command.
 * @return {Object} Executor.
 */
function createExecutor({ logs = {}, handler, onRun } = {}) {
	const calls = [];
	return {
		calls,
		lines: () => calls.map((call) => call.line),
		async run(command, args, options) {
			const line = `${command} ${args.join(' ')}`;
			calls.push({ line, args, options });
			onRun?.(line);
			const override = handler?.(line, args);
			if (override) {
				return override;
			}
			if (line === 'npx wp-env status --json') {
				return {
					code: 0,
					stdout: JSON.stringify({ status: 'stopped' }),
				};
			}
			for (const [runtime, path] of Object.entries(CONTAINER_LOGS)) {
				if (line.includes(`if [ -f ${path} ]`)) {
					return logs[runtime] === undefined
						? MISSING
						: present(logs[runtime]);
				}
			}
			return { code: 0, stdout: '' };
		},
		terminate() {},
	};
}

const workspaceConfig = {
	workspaces: WORKSPACES,
	suiteWorkspaces: { api: ['fair-events'], e2e: [] },
};

async function sweep(executor, overrides = {}) {
	const reports = [];
	const status = await runTests({
		options: {
			reuse: false,
			suite: 'api',
			workspace: undefined,
			forwarded: [],
			phpDiagnostics: true,
			...overrides.options,
		},
		executor,
		workspaceConfig,
		logger() {},
		signalSource: overrides.signalSource ?? new EventEmitter(),
		diagnostics: {
			baseUrl: 'http://localhost:8889',
			fetchImpl: overrides.fetchImpl ?? goodProbe,
			tokenFactory: () => TOKEN,
			writeReport: async (written) => reports.push(written),
		},
	});
	return { status, reports };
}

test('--php-diagnostics is parsed and refused with --reuse', () => {
	assert.equal(parseArguments(['--php-diagnostics']).phpDiagnostics, true);
	assert.equal(parseArguments([]).phpDiagnostics, false);
	assert.throws(
		() => parseArguments(['--reuse', '--php-diagnostics']),
		/owned environment/
	);
});

test('the debug constants split HTTP and WP-CLI logs and keep display off', () => {
	const constants = Object.fromEntries(diagnosticsConstants(TOKEN));
	assert.equal(constants.WP_DEBUG, 'true');
	assert.equal(constants.WP_DEBUG_DISPLAY, 'false');
	assert.match(constants.WP_DEBUG_LOG, /PHP_SAPI/);
	assert.match(constants.WP_DEBUG_LOG, /http\.log/);
	assert.match(constants.WP_DEBUG_LOG, /cli\.log/);
	assert.equal(constants.FAIR_E2E_PHP_DIAGNOSTICS_TOKEN, `'${TOKEN}'`);
	assert.throws(() => diagnosticsConstants("x'; evil"), /alphanumeric/);
});

test('log entries keep multiline traces and separate PHP, log and unparsed lines', () => {
	const entries = parseLog(
		[
			'stray text before any entry',
			'[11-Nov-2026 08:00:00 UTC] PHP Deprecated:  Old thing in /var/www/html/wp-content/plugins/fair-events/src/A.php on line 12',
			'[11-Nov-2026 08:00:01 UTC] PHP Fatal error:  Uncaught Exception: boom in /var/www/html/wp-content/plugins/fair-audience/src/B.php:7',
			'Stack trace:',
			'#0 {main}',
			'  thrown in /var/www/html/wp-content/plugins/fair-audience/src/B.php on line 7',
			'[11-Nov-2026 08:00:02 UTC] PHP Warning:  Xdebug-style in /var/www/html/wp-includes/x.php on line 3',
			'[11-Nov-2026 08:00:02 UTC] PHP Stack trace:',
			'[11-Nov-2026 08:00:02 UTC] PHP   1. {main}() /var/www/html/index.php:0',
			'[11-Nov-2026 08:00:03 UTC] Fair Audience: could not link participant',
			'',
		].join('\n'),
		'http'
	);
	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.severity]),
		[
			['unparsed', 'Unparsed'],
			['php', 'Deprecated'],
			['php', 'Fatal error'],
			['php', 'Warning'],
			['log', 'Log message'],
		]
	);
	assert.deepEqual(
		[entries[1].message, entries[1].file, entries[1].line],
		[
			'Old thing',
			'/var/www/html/wp-content/plugins/fair-events/src/A.php',
			12,
		]
	);
	assert.equal(entries[2].message, 'Uncaught Exception: boom');
	assert.equal(entries[2].line, 7);
	assert.match(entries[2].text, /thrown in/);
	assert.match(entries[3].text, /PHP {3}1\. \{main\}/);
});

test('sources are classified by owner using the workspace list', () => {
	const cases = [
		[
			'/var/www/html/wp-content/plugins/fair-events/src/A.php',
			'repository',
		],
		[
			'/var/www/html/wp-content/plugins/fair-events/vendor/fair-events/shared/src/A.php',
			'repository',
		],
		[
			'/var/www/html/wp-content/plugins/fair-events/vendor/sabre/vobject/lib/A.php',
			'bundled',
		],
		[
			'/var/www/html/wp-content/mu-plugins/fair-e2e-support.php',
			'test-support',
		],
		['/var/www/html/wp-content/db.php', 'test-support'],
		['/var/www/html/wp-content/plugins/akismet/akismet.php', 'third-party'],
		[
			'/var/www/html/wp-content/themes/twentytwentyfive/functions.php',
			'third-party',
		],
		['/var/www/html/wp-includes/class-wp.php', 'core'],
		['/var/www/html/wp-settings.php', 'core'],
		[
			'phar:///usr/local/bin/wp/vendor/wp-cli/php-cli-tools/lib/cli/Colors.php',
			'wp-cli',
		],
		[undefined, 'unknown'],
	];
	for (const [file, owner] of cases) {
		assert.equal(classifySource(file, WORKSPACES), owner, file);
	}
});

test('the probe is excluded, findings are grouped and counted, and clean needs zero diagnostics', () => {
	const deprecation =
		'[11-Nov-2026 08:00:00 UTC] PHP Deprecated:  Old thing in /var/www/html/wp-content/plugins/fair-events/src/A.php on line 12';
	const context = {
		suite: 'api',
		tests: 'passed',
		runtime: { php: '8.5.12', wordpress: '7.1.4' },
	};

	const clean = buildReport({
		logs: { http: `${PROBE_LINE}\n`, cli: '' },
		token: TOKEN,
		context,
		logging: true,
		workspaces: WORKSPACES,
	});
	assert.equal(clean.probeEntries, 1);
	assert.equal(clean.groups.length, 0);
	assert.equal(clean.clean, true);
	assert.match(formatSummary(clean), /\*\*Clean:\*\*/);

	const dirty = buildReport({
		logs: {
			http: [PROBE_LINE, deprecation, deprecation].join('\n'),
			cli: '[11-Nov-2026 08:00:00 UTC] PHP Deprecated:  CLI thing in phar:///usr/local/bin/wp/x.php on line 1\n',
		},
		token: TOKEN,
		context,
		logging: true,
		workspaces: WORKSPACES,
	});
	assert.equal(dirty.clean, false);
	assert.equal(dirty.counts.diagnostics, 3);
	assert.equal(dirty.counts.byOwner.repository, 2);
	assert.equal(dirty.counts.byOwner['wp-cli'], 1);
	assert.deepEqual(
		dirty.groups.map((group) => [group.count, group.runtime, group.owner]),
		[
			[2, 'http', 'repository'],
			[1, 'cli', 'wp-cli'],
		]
	);
	const summary = formatSummary(dirty);
	assert.match(summary, /#### Repository plugins/);
	assert.match(
		summary,
		/\| 2 \| HTTP \| Deprecated \| Old thing \| `fair-events\/src\/A\.php:12` \|/
	);
	assert.doesNotMatch(summary, new RegExp(TOKEN));
});

test('failed logging or tests are never reported as clean', () => {
	const base = {
		logs: { http: `${PROBE_LINE}\n` },
		token: TOKEN,
		workspaces: WORKSPACES,
	};
	const noLogging = buildReport({
		...base,
		context: { suite: 'e2e', tests: 'passed' },
		logging: false,
		failure: 'the probe warning is missing',
	});
	assert.equal(noLogging.clean, false);
	assert.match(
		formatSummary(noLogging),
		/\*\*Logging failed:\*\* the probe warning is missing/
	);

	const failedTests = buildReport({
		...base,
		context: { suite: 'e2e', tests: 'failed' },
		logging: true,
	});
	assert.equal(failedTests.clean, false);
	assert.match(formatSummary(failedTests), /tests failed/);

	const unparsed = buildReport({
		...base,
		logs: { http: `garbage\n${PROBE_LINE}\n` },
		context: { suite: 'e2e', tests: 'passed' },
		logging: true,
	});
	assert.equal(unparsed.counts.unparsed, 1);
	assert.equal(unparsed.clean, false);
});

test('the probe fails on a displayed warning, a missing answer, or a failed request', async () => {
	let sent;
	const ok = await sendProbe({
		baseUrl: 'http://site',
		token: TOKEN,
		fetchImpl: async (url, init) => {
			sent = { url, init };
			return goodProbe();
		},
	});
	assert.deepEqual(ok, {
		ok: true,
		runtime: { php: '8.5.12', wordpress: '7.1.4' },
	});
	assert.equal(sent.url, 'http://site/');
	assert.equal(sent.init.headers[PROBE_HEADER], TOKEN);

	const displayed = await sendProbe({
		baseUrl: 'http://site',
		token: TOKEN,
		fetchImpl: probeResponse(
			`<b>Warning</b>: ${probeMarker(TOKEN)}{"probe":"sent"}`
		),
	});
	assert.match(displayed.reason, /displayed in the response/);

	const page = await sendProbe({
		baseUrl: 'http://site',
		token: TOKEN,
		fetchImpl: probeResponse('<html>home</html>'),
	});
	assert.match(page.reason, /did not answer/);

	const down = await sendProbe({
		baseUrl: 'http://site',
		token: TOKEN,
		fetchImpl: async () => {
			throw new Error('ECONNREFUSED');
		},
	});
	assert.match(down.reason, /ECONNREFUSED/);
});

test('a missing HTTP log fails collection; a missing WP-CLI log is empty', async () => {
	const run = (logs) => createExecutor({ logs }).run;
	assert.deepEqual(await collectLogs({ run: run({ http: 'a\n' }) }), {
		ok: true,
		logs: { http: 'a\n', cli: '' },
	});
	assert.match(
		(await collectLogs({ run: run({ cli: 'x' }) })).reason,
		/http\.log does not exist/
	);

	const unreadable = createExecutor({
		handler: (line) =>
			line.includes('http.log') ? { code: 1, stdout: '' } : undefined,
	});
	assert.match(
		(await collectLogs({ run: unreadable.run })).reason,
		/could not be read/
	);
});

test('a sweep enables logging, verifies the probe, runs the tests, then collects, restores and stops', async () => {
	const executor = createExecutor({ logs: { http: `${PROBE_LINE}\n` } });
	const { status, reports } = await sweep(executor);
	assert.equal(status, 0);
	const lines = executor.lines();
	const index = (pattern) => lines.findIndex((line) => pattern.test(line));
	const order = [
		/wp core is-installed/,
		/cp \/var\/www\/html\/wp-config\.php/,
		/wp config set WP_DEBUG true --raw/,
		/wp config set FAIR_E2E_PHP_DIAGNOSTICS_TOKEN/,
		/npm run test:api/,
		/mv \/var\/www\/html\/wp-config\.fair-php-diagnostics-backup\.php/,
		/wp-env stop/,
	].map(index);
	assert.ok(
		order.every((value) => value >= 0),
		lines.join('\n')
	);
	assert.deepEqual(
		[...order].sort((a, b) => a - b),
		order
	);
	assert.equal(reports.length, 1);
	assert.equal(reports[0].report.clean, true);
	assert.equal(reports[0].report.tests, 'passed');
});

test('a failed probe runs no tests, still restores and stops, and fails the run', async () => {
	const executor = createExecutor({ logs: {} });
	const { status, reports } = await sweep(executor);
	assert.equal(status, 1);
	const lines = executor.lines();
	assert.ok(!lines.some((line) => line.includes('npm run test:api')));
	assert.ok(
		lines.some((line) =>
			line.includes(
				'mv /var/www/html/wp-config.fair-php-diagnostics-backup.php'
			)
		)
	);
	assert.equal(lines.at(-1), 'npx wp-env stop');
	assert.equal(reports[0].report.logging, 'failed');
	assert.equal(reports[0].report.tests, 'not run');
	assert.match(reports[0].summary, /Logging failed/);
});

test('a displayed probe warning fails the run before any test', async () => {
	const executor = createExecutor({ logs: { http: `${PROBE_LINE}\n` } });
	const { status } = await sweep(executor, {
		fetchImpl: probeResponse(`Warning: ${probeMarker(TOKEN)}`),
	});
	assert.equal(status, 1);
	assert.ok(
		!executor.lines().some((line) => line.includes('npm run test:api'))
	);
});

test('a failing test keeps its status and the log is still collected and restored', async () => {
	const executor = createExecutor({
		logs: { http: `${PROBE_LINE}\n` },
		handler: (line) =>
			line.startsWith('npm run test:api') ? { code: 7 } : undefined,
	});
	const { status, reports } = await sweep(executor);
	assert.equal(status, 7);
	assert.equal(reports[0].report.tests, 'failed');
	assert.equal(reports[0].report.logging, 'verified');
	assert.ok(
		executor
			.lines()
			.some((line) => line.includes('mv /var/www/html/wp-config'))
	);
});

test('an unreadable log after passing tests, or a failed restore, fails the run', async () => {
	let reads = 0;
	const collectionFails = createExecutor({
		logs: { http: `${PROBE_LINE}\n` },
		handler: (line) => {
			if (
				line.includes(`if [ -f ${CONTAINER_LOGS.http} ]`) &&
				++reads > 1
			) {
				return { code: 1, stdout: '' };
			}
			return undefined;
		},
	});
	const collected = await sweep(collectionFails);
	assert.equal(collected.status, 1);
	assert.equal(collected.reports[0].report.logging, 'failed');
	assert.equal(collected.reports[0].report.clean, false);

	const restoreFails = createExecutor({
		logs: { http: `${PROBE_LINE}\n` },
		handler: (line) =>
			line.includes('mv /var/www/html/wp-config')
				? { code: 1, stdout: '' }
				: undefined,
	});
	const restored = await sweep(restoreFails);
	assert.equal(restored.status, 1);
	assert.equal(restoreFails.lines().at(-1), 'npx wp-env stop');
});

test('an interrupt during the tests still collects, restores and stops', async () => {
	const signalSource = new EventEmitter();
	const executor = createExecutor({
		logs: { http: `${PROBE_LINE}\n` },
		handler: (line) => {
			if (line.startsWith('npm run test:api')) {
				signalSource.emit('SIGINT');
				return { code: 130 };
			}
			return undefined;
		},
	});
	const { status, reports } = await sweep(executor, { signalSource });
	assert.equal(status, 130);
	assert.equal(reports[0].report.tests, 'interrupted');
	const lines = executor.lines();
	assert.ok(
		lines.some((line) => line.includes('mv /var/www/html/wp-config'))
	);
	assert.equal(lines.at(-1), 'npx wp-env stop');
});

test('an ordinary run never touches wp-config.php or the probe', async () => {
	const executor = createExecutor();
	let fetched = false;
	const { status, reports } = await sweep(executor, {
		options: { phpDiagnostics: false },
		fetchImpl: async () => {
			fetched = true;
			return goodProbe();
		},
	});
	assert.equal(status, 0);
	assert.equal(fetched, false);
	assert.equal(reports.length, 0);
	assert.ok(
		!executor
			.lines()
			.some((line) =>
				/wp-config|fair-php-diagnostics|config set/.test(line)
			)
	);
});
