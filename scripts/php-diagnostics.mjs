/**
 * Opt-in PHP diagnostics sweep for the wp-env tests site (#2163).
 *
 * The lifecycle runner (scripts/api-test-runner.mjs) calls these helpers when
 * it runs with --php-diagnostics. They switch WordPress debug logging on in
 * the tests site's wp-config.php through WP-CLI, prove with a controlled
 * warning that a request's diagnostics reach the log without being displayed,
 * collect the log before the containers stop, and restore wp-config.php.
 *
 * Logging goes through wp-config.php rather than the `env.tests.config` option
 * of .wp-env.json: that option is deprecated, and editing .wp-env.json would
 * change every ordinary run. HTTP requests and WP-CLI commands log to separate
 * files, so WP-CLI noise stays apart from what requests to the site raise.
 */

import { randomUUID } from 'node:crypto';

export const PROBE_HEADER = 'X-Fair-PHP-Diagnostics-Probe';
export const TOKEN_CONSTANT = 'FAIR_E2E_PHP_DIAGNOSTICS_TOKEN';
export const CONTAINER_LOG_DIRECTORY =
	'/var/www/html/wp-content/fair-php-diagnostics';
export const CONTAINER_LOGS = {
	http: `${CONTAINER_LOG_DIRECTORY}/http.log`,
	cli: `${CONTAINER_LOG_DIRECTORY}/cli.log`,
};
const CONFIG_PATH = '/var/www/html/wp-config.php';
// Kept next to wp-config.php so it survives a container restart, with a .php
// extension so the web server never serves it as text.
const CONFIG_BACKUP = '/var/www/html/wp-config.fair-php-diagnostics-backup.php';
const PRESENT = 'fair-php-diagnostics-log:present';
const MISSING = 'fair-php-diagnostics-log:missing';

// Composer packages built from this repository and bundled into plugins'
// vendor directories. Their entries belong to us, not to a third party.
const REPOSITORY_COMPOSER_PACKAGES = ['fair-events/shared'];

export const OWNERS = [
	['repository', 'Repository plugins'],
	['test-support', 'Test support (e2e mu-plugins and drop-ins)'],
	['bundled', 'Bundled third-party dependencies'],
	['core', 'WordPress core'],
	['third-party', 'Other plugins and themes'],
	['wp-cli', 'WP-CLI'],
	['unknown', 'Unknown source'],
];

const PHP_SEVERITIES = [
	'Fatal error',
	'Parse error',
	'Recoverable fatal error',
	'Catchable fatal error',
	'Warning',
	'Notice',
	'Deprecated',
	'Strict Standards',
	'Core error',
	'Core warning',
	'Compile error',
	'Compile warning',
];

const ENTRY_START =
	/^\[(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}(?: [^\]]+)?)\] ?(.*)$/;
const PHP_ENTRY = new RegExp(`^PHP (${PHP_SEVERITIES.join('|')}):\\s+(.*)$`);
// Xdebug-style and PHP's own trace lines are logged as separate timestamped
// lines; they belong to the entry above them.
const PHP_TRACE_LINE = /^PHP (?:Stack trace:|\s+\d+\.\s)/;

export function createToken() {
	return randomUUID();
}

export function probeMarker(token) {
	return `fair-php-diagnostics-probe:${token}`;
}

function testsCli(args) {
	return ['wp-env', 'run', 'tests-cli', ...args];
}

function shell(script) {
	return testsCli(['sh', '-c', script]);
}

/**
 * wp-config.php constants of a diagnostics run, as raw PHP values.
 *
 * @param {string} token The run's probe token.
 * @return {Array<[string, string]>} Constant names and raw values.
 */
export function diagnosticsConstants(token) {
	if (!/^[A-Za-z0-9-]+$/.test(token)) {
		throw new Error('The diagnostics token must be alphanumeric.');
	}
	return [
		['WP_DEBUG', 'true'],
		['WP_DEBUG_DISPLAY', 'false'],
		[
			'WP_DEBUG_LOG',
			`'cli' === PHP_SAPI ? '${CONTAINER_LOGS.cli}' : '${CONTAINER_LOGS.http}'`,
		],
		[TOKEN_CONSTANT, `'${token}'`],
	];
}

/**
 * Back up wp-config.php, empty the log directory and set the debug constants.
 * A backup left by a run that was killed before it could restore is the
 * original configuration, so it is put back first.
 *
 * @param {Object}   root        Parameters.
 * @param {Function} root.run    Executor run(command, args, options).
 * @param {string}   root.token  The run's probe token.
 * @param {Function} root.logger Log sink.
 * @return {Promise<{ok: boolean, reason?: string}>} Result.
 */
export async function enableDiagnostics({ run, token, logger }) {
	const prepare = await run(
		'npx',
		shell(
			[
				'set -e',
				`if [ -f ${CONFIG_BACKUP} ]; then cp ${CONFIG_BACKUP} ${CONFIG_PATH}; echo restored-leftover; fi`,
				`cp ${CONFIG_PATH} ${CONFIG_BACKUP}`,
				`rm -rf ${CONTAINER_LOG_DIRECTORY}`,
				`mkdir -p ${CONTAINER_LOG_DIRECTORY}`,
			].join('; ')
		),
		{ capture: true }
	);
	if (prepare.code !== 0) {
		return {
			ok: false,
			reason: `could not back up wp-config.php or prepare ${CONTAINER_LOG_DIRECTORY} (exit ${prepare.code})`,
		};
	}
	if (prepare.stdout.includes('restored-leftover')) {
		logger(
			'Restored wp-config.php from the backup an earlier, interrupted diagnostics run left behind.'
		);
	}
	for (const [name, value] of diagnosticsConstants(token)) {
		const result = await run(
			'npx',
			testsCli(['wp', 'config', 'set', name, value, '--raw']),
			{ capture: true }
		);
		if (result.code !== 0) {
			return {
				ok: false,
				reason: `could not set ${name} in wp-config.php (exit ${result.code})`,
			};
		}
	}
	return { ok: true };
}

/**
 * Put the backed-up wp-config.php back and remove the container log copy.
 *
 * @param {Object}   root     Parameters.
 * @param {Function} root.run Executor run(command, args, options).
 * @return {Promise<{ok: boolean, reason?: string}>} Result.
 */
export async function restoreDiagnostics({ run }) {
	const result = await run(
		'npx',
		shell(
			`set -e; mv ${CONFIG_BACKUP} ${CONFIG_PATH}; rm -rf ${CONTAINER_LOG_DIRECTORY}`
		),
		{ capture: true }
	);
	return result.code === 0
		? { ok: true }
		: {
				ok: false,
				reason: `could not restore wp-config.php from ${CONFIG_BACKUP} (exit ${result.code})`,
			};
}

/**
 * Read one container log. A missing file is reported separately from a
 * failed read: PHP creates the file with its first entry. `wp-env run` does
 * not pass the container's exit status through, so the shell prints whether
 * the file exists on the first line instead.
 *
 * @param {Function} run  Executor run(command, args, options).
 * @param {string}   path Container path.
 * @return {Promise<{ok: boolean, missing?: boolean, text?: string}>} Result.
 */
async function readContainerLog(run, path) {
	const result = await run(
		'npx',
		shell(
			`if [ -f ${path} ]; then echo ${PRESENT}; cat ${path}; else echo ${MISSING}; fi`
		),
		{ capture: true }
	);
	if (result.code !== 0) {
		return { ok: false, missing: false };
	}
	const newline = result.stdout.indexOf('\n');
	const status = (
		newline === -1 ? result.stdout : result.stdout.slice(0, newline)
	).trim();
	if (status === MISSING) {
		return { ok: false, missing: true };
	}
	if (status !== PRESENT) {
		return { ok: false, missing: false };
	}
	return { ok: true, text: result.stdout.slice(newline + 1) };
}

/**
 * Read both logs. The HTTP log must exist, since the probe wrote to it; a
 * missing WP-CLI log only means WP-CLI logged nothing.
 *
 * @param {Object}   root     Parameters.
 * @param {Function} root.run Executor run(command, args, options).
 * @return {Promise<{ok: boolean, reason?: string, logs?: Object}>} Result.
 */
export async function collectLogs({ run }) {
	const http = await readContainerLog(run, CONTAINER_LOGS.http);
	if (!http.ok) {
		return {
			ok: false,
			reason: http.missing
				? `${CONTAINER_LOGS.http} does not exist`
				: `${CONTAINER_LOGS.http} could not be read`,
		};
	}
	const cli = await readContainerLog(run, CONTAINER_LOGS.cli);
	if (!cli.ok && !cli.missing) {
		return {
			ok: false,
			reason: `${CONTAINER_LOGS.cli} could not be read`,
		};
	}
	return { ok: true, logs: { http: http.text, cli: cli.text ?? '' } };
}

/**
 * Send the probe request: the tests site's probe mu-plugin raises a warning
 * carrying the token and answers with its runtime versions.
 *
 * @param {Object}   root           Parameters.
 * @param {string}   root.baseUrl   Tests site URL.
 * @param {string}   root.token     The run's probe token.
 * @param {Function} root.fetchImpl fetch().
 * @return {Promise<{ok: boolean, reason?: string, runtime?: Object}>} Result.
 */
export async function sendProbe({ baseUrl, token, fetchImpl = fetch }) {
	let response;
	let body;
	try {
		response = await fetchImpl(`${baseUrl}/`, {
			headers: { [PROBE_HEADER]: token },
			redirect: 'manual',
		});
		body = await response.text();
	} catch (error) {
		return {
			ok: false,
			reason: `the probe request failed: ${error.message}`,
		};
	}
	if (body.includes(probeMarker(token))) {
		return {
			ok: false,
			reason: 'the probe warning was displayed in the response; debug display must stay off',
		};
	}
	let answer;
	try {
		answer = JSON.parse(body);
	} catch {
		answer = undefined;
	}
	if (response.status !== 200 || answer?.probe !== 'sent') {
		return {
			ok: false,
			reason: `the probe mu-plugin did not answer (HTTP ${response.status}); check that e2e/mu-plugins/fair-e2e-php-diagnostics.php is mounted and ${TOKEN_CONSTANT} is set`,
		};
	}
	return {
		ok: true,
		runtime: { php: answer.php, wordpress: answer.wordpress },
	};
}

/**
 * Send the probe and require its warning in the HTTP log.
 *
 * @param {Object}   root           Parameters.
 * @param {Function} root.run       Executor run(command, args, options).
 * @param {string}   root.baseUrl   Tests site URL.
 * @param {string}   root.token     The run's probe token.
 * @param {Function} root.fetchImpl fetch().
 * @return {Promise<{ok: boolean, reason?: string, runtime?: Object}>} Result.
 */
export async function verifyLogging({ run, baseUrl, token, fetchImpl }) {
	const probe = await sendProbe({ baseUrl, token, fetchImpl });
	if (!probe.ok) {
		return probe;
	}
	const collected = await collectLogs({ run });
	if (!collected.ok) {
		return {
			ok: false,
			reason: `the probe warning did not reach the log: ${collected.reason}`,
		};
	}
	const found = parseLog(collected.logs.http, 'http').some((entry) =>
		entry.text.includes(probeMarker(token))
	);
	if (!found) {
		return {
			ok: false,
			reason: `the probe warning is missing from ${CONTAINER_LOGS.http}`,
		};
	}
	return probe;
}

function locate(message, continuation) {
	const uncaught = message.match(/^(Uncaught .*?) in (\S+?):(\d+)$/);
	if (uncaught) {
		return {
			message: uncaught[1],
			file: uncaught[2],
			line: Number(uncaught[3]),
		};
	}
	const located = message.match(/^(.*) in (.+?) on line (\d+)$/);
	if (located) {
		return {
			message: located[1],
			file: located[2],
			line: Number(located[3]),
		};
	}
	const thrown = continuation
		.map((text) => text.match(/^\s*thrown in (.+?) on line (\d+)$/))
		.find(Boolean);
	if (thrown) {
		return { message, file: thrown[1], line: Number(thrown[2]) };
	}
	return { message, file: undefined, line: undefined };
}

/**
 * Split a PHP error log into entries. An entry starts at a timestamped line
 * and keeps the untimestamped lines (and PHP trace lines) after it.
 *
 * @param {string} text    Log text.
 * @param {string} runtime "http" or "cli".
 * @return {Object[]} Entries: kind ("php", "log" or "unparsed"), severity,
 *   message, file, line and the full text.
 */
export function parseLog(text, runtime) {
	const entries = [];
	let current;
	for (const raw of text.split('\n')) {
		const lineText = raw.replace(/\r$/, '');
		const start = lineText.match(ENTRY_START);
		if (start && !(current && PHP_TRACE_LINE.test(start[2]))) {
			current = { runtime, first: start[2], continuation: [] };
			entries.push(current);
		} else if (current) {
			current.continuation.push(start ? start[2] : lineText);
		} else if (lineText.trim() !== '') {
			entries.push({
				runtime,
				kind: 'unparsed',
				severity: 'Unparsed',
				message: lineText,
				text: lineText,
			});
		}
	}
	return entries.map((entry) => {
		if (entry.kind === 'unparsed') {
			return entry;
		}
		const continuation = entry.continuation.filter(
			(value) => value.trim() !== ''
		);
		const textValue = [entry.first, ...continuation].join('\n');
		const php = entry.first.match(PHP_ENTRY);
		if (!php) {
			return {
				runtime,
				kind: 'log',
				severity: 'Log message',
				message: entry.first,
				file: undefined,
				line: undefined,
				text: textValue,
			};
		}
		return {
			runtime,
			kind: 'php',
			severity: php[1],
			...locate(php[2], continuation),
			text: textValue,
		};
	});
}

/**
 * Who owns the code an entry points at.
 *
 * @param {string|undefined} file       File from the entry.
 * @param {string[]}         workspaces Repository workspaces (plugin slugs).
 * @return {string} One of the OWNERS keys.
 */
export function classifySource(file, workspaces) {
	if (!file) {
		return 'unknown';
	}
	if (file.startsWith('phar://') || /\/wp-cli\//.test(file)) {
		return 'wp-cli';
	}
	const plugin = file.match(/\/wp-content\/plugins\/([^/]+)\/(.*)$/);
	if (plugin) {
		if (!workspaces.includes(plugin[1])) {
			return 'third-party';
		}
		const vendored = plugin[2].match(/(?:^|\/)vendor\/([^/]+\/[^/]+)\//);
		if (vendored) {
			return REPOSITORY_COMPOSER_PACKAGES.includes(vendored[1])
				? 'repository'
				: 'bundled';
		}
		return /(?:^|\/)node_modules\//.test(plugin[2])
			? 'bundled'
			: 'repository';
	}
	if (/\/wp-content\/(?:mu-plugins\/|db\.php)/.test(file)) {
		return 'test-support';
	}
	if (/\/wp-content\//.test(file)) {
		return 'third-party';
	}
	if (/^\/var\/www\/html\//.test(file)) {
		return 'core';
	}
	return 'unknown';
}

function groupEntries(entries, workspaces) {
	const groups = new Map();
	for (const entry of entries) {
		const key = [
			entry.runtime,
			entry.kind,
			entry.severity,
			entry.message,
			entry.file ?? '',
			entry.line ?? '',
		].join('\u0000');
		const group = groups.get(key);
		if (group) {
			group.count++;
		} else {
			groups.set(key, {
				runtime: entry.runtime,
				kind: entry.kind,
				owner: classifySource(entry.file, workspaces),
				severity: entry.severity,
				message: entry.message,
				file: entry.file ?? null,
				line: entry.line ?? null,
				count: 1,
				example: entry.text,
			});
		}
	}
	return [...groups.values()].sort(
		(a, b) =>
			b.count - a.count ||
			a.severity.localeCompare(b.severity) ||
			a.message.localeCompare(b.message)
	);
}

/**
 * Machine-readable report of one sweep.
 *
 * @param {Object}  root            Parameters.
 * @param {Object}  root.logs       Raw logs: { http, cli }.
 * @param {string}  root.token      The run's probe token.
 * @param {Object}  root.context    Suite, shard, runtime and test status.
 * @param {boolean} root.logging    Whether the probe was verified.
 * @param {string}  [root.failure]  Why logging verification or collection failed.
 * @param {string[]} root.workspaces Repository workspaces.
 * @return {Object} Report.
 */
export function buildReport({
	logs,
	token,
	context,
	logging,
	failure,
	workspaces,
}) {
	const marker = probeMarker(token);
	const entries = [
		...parseLog(logs?.http ?? '', 'http'),
		...parseLog(logs?.cli ?? '', 'cli'),
	];
	const probeEntries = entries.filter((entry) => entry.text.includes(marker));
	const findings = entries.filter((entry) => !entry.text.includes(marker));
	const groups = groupEntries(findings, workspaces);
	const count = (predicate) => findings.filter(predicate).length;
	const diagnostics = count((entry) => entry.kind === 'php');
	const unparsed = count((entry) => entry.kind === 'unparsed');
	const testsPassed = context.tests === 'passed';
	return {
		suite: context.suite,
		shard: context.shard ?? null,
		runtime: context.runtime ?? null,
		tests: context.tests,
		logging: logging ? 'verified' : 'failed',
		loggingFailure: failure ?? null,
		probeEntries: probeEntries.length,
		counts: {
			diagnostics,
			logMessages: count((entry) => entry.kind === 'log'),
			unparsed,
			byOwner: Object.fromEntries(
				OWNERS.map(([owner]) => [
					owner,
					groups
						.filter(
							(group) =>
								group.owner === owner && group.kind === 'php'
						)
						.reduce((sum, group) => sum + group.count, 0),
				])
			),
		},
		clean: logging && testsPassed && diagnostics === 0 && unparsed === 0,
		groups,
	};
}

function cell(value) {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.replace(/\|/g, '\\|')
		.slice(0, 300);
}

function location(group) {
	if (!group.file) {
		return '';
	}
	const file = group.file
		.replace(/^\/var\/www\/html\/wp-content\/plugins\//, '')
		.replace(/^\/var\/www\/html\//, '');
	return `\`${cell(file)}${group.line ? `:${group.line}` : ''}\``;
}

function groupTable(groups, limit = 50) {
	const rows = groups
		.slice(0, limit)
		.map(
			(group) =>
				`| ${group.count} | ${group.runtime === 'cli' ? 'WP-CLI' : 'HTTP'} | ${cell(group.severity)} | ${cell(group.message)} | ${location(group)} |`
		);
	const lines = [
		'| Count | Runtime | Severity | Message | Location |',
		'| ---: | --- | --- | --- | --- |',
		...rows,
	];
	if (groups.length > limit) {
		lines.push(
			'',
			`${groups.length - limit} more groups are in report.json.`
		);
	}
	return lines;
}

/**
 * Markdown summary of a report, for the job summary and the job log.
 *
 * @param {Object} report Report from buildReport().
 * @return {string} Markdown.
 */
export function formatSummary(report) {
	const suite = report.suite === 'e2e' ? 'E2E' : 'API';
	const label = report.shard
		? `${suite} shard ${report.shard.current}/${report.shard.total}`
		: `${suite} tests`;
	let verdict;
	if (report.logging !== 'verified') {
		verdict = `**Logging failed:** ${report.loggingFailure}. Nothing below can be read as clean.`;
	} else if (report.clean) {
		verdict =
			'**Clean:** logging was verified with the probe and no PHP diagnostics were recorded.';
	} else if (report.tests !== 'passed') {
		verdict = `**Not clean:** the tests ${report.tests === 'failed' ? 'failed' : 'did not run to completion'}, so not every code path was exercised.`;
	} else {
		verdict = '**Not clean:** PHP diagnostics were recorded.';
	}
	const runtime = report.runtime
		? `PHP ${report.runtime.php}, WordPress ${report.runtime.wordpress}`
		: 'unknown';
	const lines = [
		`### PHP diagnostics: ${label}`,
		'',
		verdict,
		'',
		`- Runtime (tests site): ${runtime}`,
		`- Tests: ${report.tests}`,
		`- Logging: ${report.logging} (${report.probeEntries} probe ${report.probeEntries === 1 ? 'entry' : 'entries'}, excluded below)`,
		`- PHP diagnostics: ${report.counts.diagnostics}${
			report.counts.diagnostics
				? ` (${OWNERS.filter(([owner]) => report.counts.byOwner[owner])
						.map(
							([owner, title]) =>
								`${title}: ${report.counts.byOwner[owner]}`
						)
						.join('; ')})`
				: ''
		}`,
		`- Application log messages: ${report.counts.logMessages}`,
		`- Unparsed lines: ${report.counts.unparsed}`,
		'',
	];
	for (const [owner, title] of OWNERS) {
		const groups = report.groups.filter(
			(group) => group.kind === 'php' && group.owner === owner
		);
		if (groups.length) {
			lines.push(`#### ${title}`, '', ...groupTable(groups), '');
		}
	}
	const other = report.groups.filter((group) => group.kind !== 'php');
	if (other.length) {
		lines.push(
			'#### Application log messages and unparsed lines',
			'',
			...groupTable(other),
			''
		);
	}
	return lines.join('\n');
}
