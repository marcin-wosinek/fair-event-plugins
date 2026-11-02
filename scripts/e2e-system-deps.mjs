#!/usr/bin/env node
/* eslint-disable no-console */

// Prepares Playwright's Linux system dependencies for the E2E workflow with a
// cache of downloaded Ubuntu package archives (.deb files). Only downloads are
// reused: APT refreshes its indexes and resolves, verifies and installs the
// current packages on every run, so security updates still arrive. No
// installed system directory or package database is ever restored.
//
//   node scripts/e2e-system-deps.mjs key       print `key=` and `path=` for
//                                              actions/cache (append to
//                                              $GITHUB_OUTPUT)
//   node scripts/e2e-system-deps.mjs install   verify restored archives against
//                                              the fresh index, run
//                                              `playwright install-deps`, keep
//                                              this run's archives for saving
//   node scripts/e2e-system-deps.mjs report    add save timing, write the job
//                                              summary and the JSON report
//
// TESTING.md § E2E system dependencies documents invalidation, recovery and
// the benchmark procedure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

/** Bump to invalidate every archive cache regardless of the script's hash. */
export const CACHE_SCHEMA = 'v1';
export const BROWSER = 'chromium';
export const SYSTEM_ARCHIVES = '/var/cache/apt/archives';

export function cacheDir(env = process.env) {
	return (
		env.E2E_DEPS_CACHE_DIR ||
		path.join(env.HOME || os.homedir(), '.cache', 'e2e-apt-archives')
	);
}

export function reportDir(env = process.env) {
	return (
		env.E2E_DEPS_REPORT_DIR ||
		path.join(env.RUNNER_TEMP || os.tmpdir(), 'e2e-system-deps')
	);
}

/** Parses /etc/os-release into a plain object. */
export function parseOsRelease(source) {
	const values = {};
	for (const line of source.split('\n')) {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
		}
	}
	return values;
}

/** Keeps key parts within the characters actions/cache handles cleanly. */
function keyPart(value) {
	return (
		String(value || 'unknown')
			.toLowerCase()
			.replace(/[^a-z0-9.]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'unknown'
	);
}

/**
 * Builds the cache key. Every input that can change which archives are valid
 * or which ones get installed is part of it, so a change starts a cold cache
 * instead of reusing a set prepared for another environment.
 */
export function cacheKey({
	osId,
	osVersion,
	arch,
	imageOs,
	imageVersion,
	playwrightVersion,
	scriptHash,
	schema = CACHE_SCHEMA,
}) {
	return [
		'e2e-apt',
		schema,
		`${keyPart(osId)}${keyPart(osVersion)}`,
		keyPart(arch),
		`${keyPart(imageOs)}-${keyPart(imageVersion)}`,
		`pw${keyPart(playwrightVersion)}`,
		keyPart(BROWSER),
		keyPart(scriptHash).slice(0, 12),
	].join('-');
}

export function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

export function playwrightVersion(root = ROOT) {
	const manifest = path.join(
		root,
		'node_modules',
		'playwright-core',
		'package.json'
	);
	return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

function defaultExec(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout || '',
		stderr: result.stderr || (result.error ? String(result.error) : ''),
	};
}

/** Collects every key input from the runner. */
export function environmentIdentity({
	env = process.env,
	exec = defaultExec,
	root = ROOT,
	readOsRelease = () => readFileSync('/etc/os-release', 'utf8'),
	scriptSource = () => readFileSync(SCRIPT_PATH),
} = {}) {
	const release = parseOsRelease(readOsRelease());
	const archResult = exec('dpkg', ['--print-architecture']);
	if (archResult.status !== 0) {
		throw new Error(
			`dpkg --print-architecture failed: ${archResult.stderr.trim()}`
		);
	}
	return {
		osId: release.ID,
		osVersion: release.VERSION_ID,
		osCodename: release.VERSION_CODENAME,
		arch: archResult.stdout.trim(),
		imageOs: env.ImageOS || 'local',
		imageVersion: env.ImageVersion || 'local',
		playwrightVersion: playwrightVersion(root),
		scriptHash: sha256(scriptSource()),
	};
}

/**
 * Reads what APT printed while installing: how much it had to fetch out of
 * the total, which archives it downloaded, and any errors or retries.
 */
export function parseAptOutput(output) {
	const lines = output.split(/\r?\n/);
	const result = {
		needToGet: null,
		totalArchiveBytes: null,
		downloadBytes: null,
		fetched: null,
		downloads: [],
		problems: [],
		upgraded: null,
		newlyInstalled: null,
	};
	let installing = false;
	for (const line of lines) {
		const need = line.match(
			/^Need to get ([\d.,]+ ?[kMG]?B)(?:\/([\d.,]+ ?[kMG]?B))? of archives\./
		);
		if (need) {
			installing = true;
			result.needToGet = need[0];
			result.downloadBytes = parseSize(need[1]);
			result.totalArchiveBytes = parseSize(need[2] || need[1]);
			continue;
		}
		const counts = line.match(
			/^(\d+) upgraded, (\d+) newly installed, \d+ to remove/
		);
		if (counts) {
			result.upgraded = Number(counts[1]);
			result.newlyInstalled = Number(counts[2]);
		}
		if (/^(Err|Ign):\d+ /.test(line) || /^(W|E): /.test(line)) {
			result.problems.push(line.trim());
		}
		if (!installing) {
			continue;
		}
		const fetched = line.match(/^Fetched .* in (.+) \((.+)\)$/);
		if (fetched) {
			result.fetched = line.trim();
			continue;
		}
		const get = line.match(
			/^Get:\d+ (https?:\/\/\S+) .*?(\S+) \S+ \S+ \[([^\]]+)\]$/
		);
		if (get) {
			result.downloads.push({
				host: new URL(get[1]).host,
				package: get[2],
				size: get[3],
			});
		}
	}
	return result;
}

/** Converts APT's human sizes ("24.9 MB", "0 B") to bytes. */
export function parseSize(text) {
	if (!text) {
		return null;
	}
	const match = text.replace(/,/g, '').match(/^([\d.]+) ?([kMG]?)B$/);
	if (!match) {
		return null;
	}
	const scale = { '': 1, k: 1e3, M: 1e6, G: 1e9 }[match[2]];
	return Math.round(Number(match[1]) * scale);
}

/** Reads `apt-cache show` records into Package/Version/Architecture/SHA256. */
export function parseAptCacheShow(output) {
	return output
		.split(/\n\s*\n/)
		.map((block) => {
			const record = {};
			for (const line of block.split('\n')) {
				const match = line.match(/^([A-Za-z0-9-]+): (.*)$/);
				if (match) {
					record[match[1]] = match[2].trim();
				}
			}
			return record;
		})
		.filter((record) => record.Package);
}

/**
 * Decides whether a restored archive can be reused. Only an archive whose
 * contents match the SHA256 that the freshly refreshed, signed index lists
 * for that exact package version is kept.
 */
export function classifyArchive({ fields, hash, records }) {
	if (!fields) {
		return { keep: false, reason: 'unreadable' };
	}
	const candidates = records.filter(
		(record) =>
			record.Package === fields.package &&
			record.Version === fields.version &&
			record.Architecture === fields.arch
	);
	if (candidates.length === 0) {
		return { keep: false, reason: 'not-in-index' };
	}
	if (!candidates.some((record) => record.SHA256 === hash)) {
		return { keep: false, reason: 'checksum-mismatch' };
	}
	return { keep: true, reason: 'verified' };
}

function listDebs(directory) {
	if (!existsSync(directory)) {
		return [];
	}
	return readdirSync(directory)
		.filter((name) => name.endsWith('.deb'))
		.sort();
}

function debFields(exec, file) {
	const result = exec('dpkg-deb', [
		'--show',
		'--showformat=${Package}\t${Version}\t${Architecture}',
		file,
	]);
	if (result.status !== 0) {
		return null;
	}
	const [pkg, version, arch] = result.stdout.trim().split('\t');
	return pkg && version && arch ? { package: pkg, version, arch } : null;
}

/** `apt-cache show` spec; arch-independent packages take no `:all`. */
export function aptVersionSpec({ package: pkg, version, arch }) {
	return arch === 'all' ? `${pkg}=${version}` : `${pkg}:${arch}=${version}`;
}

/**
 * Runs `playwright install-deps` with its output streamed to the job log and
 * kept in a file for parsing and the report artifact.
 */
export function streamedInstallDeps(exec, logFile) {
	mkdirSync(path.dirname(logFile), { recursive: true });
	const result = exec(
		'bash',
		[
			'-o',
			'pipefail',
			'-c',
			'npx playwright install-deps "$1" 2>&1 | tee "$2"',
			'bash',
			BROWSER,
			logFile,
		],
		{ cwd: ROOT, stdio: 'inherit' }
	);
	return {
		status: result.status,
		stdout: existsSync(logFile) ? readFileSync(logFile, 'utf8') : '',
		stderr: '',
		streamed: true,
	};
}

function asRoot(exec, isRoot, command, args) {
	return isRoot ? exec(command, args) : exec('sudo', [command, ...args]);
}

/**
 * Runs the preparation. Returns the report; `status` is non-zero when the
 * dependencies could not be installed, even after recovery.
 */
export function install({
	env = process.env,
	exec = defaultExec,
	now = () => Date.now(),
	log = console.log,
	isRoot = typeof process.getuid === 'function' && process.getuid() === 0,
	systemArchives = env.E2E_DEPS_SYSTEM_ARCHIVES || SYSTEM_ARCHIVES,
	identity = environmentIdentity({ env, exec }),
	installDeps = (attempt) =>
		streamedInstallDeps(
			exec,
			path.join(reportDir(env), `install-deps-${attempt}.log`)
		),
} = {}) {
	const startedAt = now();
	const cache = cacheDir(env);
	const report = {
		schema: 1,
		key: cacheKey(identity),
		identity,
		cacheHit: env.E2E_DEPS_CACHE_HIT === 'true',
		startedAt: Number(env.E2E_DEPS_STARTED_AT) || startedAt,
		durations: {},
		restored: [],
		dropped: [],
		attempts: [],
		recovery: [],
		saved: [],
		status: 1,
	};
	report.durations.restoreMs = startedAt - report.startedAt;
	mkdirSync(cache, { recursive: true });

	const preexisting = new Set(listDebs(systemArchives));
	const restoredNames = listDebs(cache);

	// Verify restored archives against the fresh index before APT sees them.
	const validateStart = now();
	if (restoredNames.length > 0) {
		const update = asRoot(exec, isRoot, 'apt-get', ['update', '-qq']);
		if (update.status !== 0) {
			report.recovery.push({
				event: 'index-refresh-failed',
				detail: update.stderr.trim().split('\n').slice(-3).join(' '),
			});
		}
		const archives = restoredNames.map((name) => {
			const file = path.join(cache, name);
			return { name, file, fields: debFields(exec, file) };
		});
		// One lookup for every archive: apt-cache prints the records it finds
		// and exits non-zero for the versions it doesn't, which then simply
		// have no matching record.
		const specs = archives
			.filter((archive) => archive.fields)
			.map((archive) => aptVersionSpec(archive.fields));
		const records =
			update.status === 0 && specs.length > 0
				? parseAptCacheShow(
						exec('apt-cache', ['show', ...specs]).stdout
					)
				: [];
		for (const { name, file, fields } of archives) {
			const hash = sha256(readFileSync(file));
			const verdict =
				update.status === 0
					? classifyArchive({ fields, hash, records })
					: { keep: false, reason: 'index-unavailable' };
			const entry = {
				file: name,
				...(fields || {}),
				bytes: statSync(file).size,
			};
			if (verdict.keep) {
				report.restored.push(entry);
			} else {
				report.dropped.push({ ...entry, reason: verdict.reason });
				rmSync(file, { force: true });
			}
		}
		if (report.restored.length > 0) {
			const copy = asRoot(exec, isRoot, 'cp', [
				'--',
				...report.restored.map((entry) => path.join(cache, entry.file)),
				`${systemArchives}/`,
			]);
			if (copy.status !== 0) {
				report.recovery.push({
					event: 'copy-in-failed',
					detail: copy.stderr.trim(),
				});
				report.restored = [];
			}
		}
	}
	if (report.dropped.length > 0) {
		report.recovery.push({
			event: 'archives-dropped',
			detail: `${report.dropped.length} restored archive(s) failed verification and will be downloaded again`,
		});
	}
	report.durations.validateMs = now() - validateStart;

	// Install. A failure with reused archives is retried once from a clean
	// archive set; a failure without them is a real failure.
	const installStart = now();
	let result = runAttempt(report, installDeps, now, log, 'normal');
	if (result.status !== 0 && report.restored.length > 0) {
		report.recovery.push({
			event: 'install-retry-without-cache',
			detail: `install-deps exited ${result.status} with reused archives; retrying after discarding them`,
		});
		asRoot(exec, isRoot, 'rm', [
			'-f',
			'--',
			...report.restored
				.filter((entry) => !preexisting.has(entry.file))
				.map((entry) => path.join(systemArchives, entry.file)),
		]);
		for (const entry of report.restored) {
			rmSync(path.join(cache, entry.file), { force: true });
		}
		report.restored = [];
		result = runAttempt(report, installDeps, now, log, 'without-cache');
	}
	report.durations.installMs = now() - installStart;
	report.status = result.status;

	// Keep exactly this run's archives (verified reuse plus fresh downloads)
	// for saving; anything else in the cache directory is removed.
	const keepStart = now();
	if (result.status === 0) {
		const used = new Set(report.restored.map((entry) => entry.file));
		for (const name of listDebs(systemArchives)) {
			if (preexisting.has(name) && !used.has(name)) {
				continue;
			}
			const target = path.join(cache, name);
			if (!existsSync(target)) {
				copyFileSync(path.join(systemArchives, name), target);
			}
			used.add(name);
		}
		for (const name of listDebs(cache)) {
			if (!used.has(name)) {
				rmSync(path.join(cache, name), { force: true });
			}
		}
		const restoredFiles = new Map(
			report.restored.map((entry) => [entry.file, entry])
		);
		report.saved = [...used].sort().map((name) => {
			const known = restoredFiles.get(name);
			if (known) {
				return { ...known, source: 'restored' };
			}
			const file = path.join(cache, name);
			return {
				file: name,
				...(debFields(exec, file) || {}),
				bytes: statSync(file).size,
				source: 'downloaded',
			};
		});
	}
	report.durations.keepMs = now() - keepStart;
	report.finishedAt = now();
	return report;
}

function runAttempt(report, installDeps, now, log, mode) {
	const start = now();
	const result = installDeps(report.attempts.length + 1);
	const output = `${result.stdout}\n${result.stderr}`;
	if (!result.streamed) {
		log(output);
	}
	report.attempts.push({
		mode,
		status: result.status,
		durationMs: now() - start,
		apt: parseAptOutput(output),
	});
	return result;
}

function formatSeconds(ms) {
	return ms === undefined || ms === null
		? '—'
		: `${(ms / 1000).toFixed(1)} s`;
}

function formatBytes(bytes) {
	if (bytes === null || bytes === undefined) {
		return '—';
	}
	if (bytes >= 1e6) {
		return `${(bytes / 1e6).toFixed(1)} MB`;
	}
	if (bytes >= 1e3) {
		return `${(bytes / 1e3).toFixed(1)} kB`;
	}
	return `${bytes} B`;
}

/** Fresh = nothing reused; reuse = every needed archive came from the cache. */
export function preparationState(report) {
	const apt = report.attempts.at(-1)?.apt;
	if (report.recovery.some((event) => event.event !== 'archives-dropped')) {
		return 'recovered';
	}
	if (report.restored.length === 0) {
		return report.cacheHit ? 'reuse-empty' : 'fresh';
	}
	return apt && apt.downloadBytes === 0 ? 'reuse' : 'partial-reuse';
}

/** Completes the report after the save step and renders the job summary. */
export function finishReport(report, { now = Date.now(), saveOutcome }) {
	const finished = { ...report, durations: { ...report.durations } };
	finished.durations.saveMs =
		report.finishedAt !== undefined ? now - report.finishedAt : null;
	finished.durations.totalMs = now - report.startedAt;
	finished.saveOutcome = saveOutcome || 'unknown';
	finished.state = preparationState(report);
	return finished;
}

export function renderSummary(report) {
	const apt = report.attempts.at(-1)?.apt || {};
	const problems = report.attempts.flatMap((attempt) => attempt.apt.problems);
	const rows = [
		['State', `\`${report.state}\``],
		['Cache key', `\`${report.key}\``],
		['Cache hit', report.cacheHit ? 'yes' : 'no'],
		['Save step', report.saveOutcome],
		['Restore', formatSeconds(report.durations.restoreMs)],
		[
			'Verify restored archives',
			formatSeconds(report.durations.validateMs),
		],
		[
			'Install (`playwright install-deps`)',
			formatSeconds(report.durations.installMs),
		],
		['Keep archives', formatSeconds(report.durations.keepMs)],
		['Save', formatSeconds(report.durations.saveMs)],
		[
			'**Preparation total**',
			`**${formatSeconds(report.durations.totalMs)}**`,
		],
		['APT', apt.needToGet || 'nothing to fetch'],
		['Fetched', apt.fetched || '—'],
		['Downloaded archives', String(apt.downloads?.length ?? 0)],
		[
			'Reused archives',
			`${report.restored.length} (${formatBytes(
				report.restored.reduce((sum, entry) => sum + entry.bytes, 0)
			)})`,
		],
		['Dropped archives', String(report.dropped.length)],
		['Install attempts', String(report.attempts.length)],
		['Download errors/retries', String(problems.length)],
		[
			'Runner',
			`${report.identity.osId} ${report.identity.osVersion} ${report.identity.arch}, image ${report.identity.imageOs} ${report.identity.imageVersion}`,
		],
		['Playwright', report.identity.playwrightVersion],
	];
	const lines = [
		'### E2E system dependencies',
		'',
		'| | |',
		'| --- | --- |',
		...rows.map(([label, value]) => `| ${label} | ${value} |`),
	];
	if (report.recovery.length > 0) {
		lines.push('', '**Recovery events**', '');
		for (const event of report.recovery) {
			lines.push(`- \`${event.event}\`: ${event.detail}`);
		}
	}
	if (report.dropped.length > 0) {
		lines.push('', '**Dropped archives**', '');
		for (const entry of report.dropped) {
			lines.push(`- \`${entry.file}\`: ${entry.reason}`);
		}
	}
	if (problems.length > 0) {
		lines.push('', '**APT errors and retries**', '', '```');
		lines.push(...problems, '```');
	}
	if (report.saved.length > 0) {
		lines.push('', '<details><summary>Archives</summary>', '');
		lines.push('| Package | Version | Arch | Size | Source |');
		lines.push('| --- | --- | --- | --- | --- |');
		for (const entry of report.saved) {
			lines.push(
				`| ${entry.package} | ${entry.version} | ${entry.arch} | ${formatBytes(
					entry.bytes
				)} | ${entry.source} |`
			);
		}
		lines.push('', '</details>');
	}
	return `${lines.join('\n')}\n`;
}

export function main(args = process.argv.slice(2), env = process.env) {
	const [command] = args;
	const reportFile = path.join(reportDir(env), 'report.json');
	if (command === 'key') {
		const identity = environmentIdentity({ env });
		console.log(`key=${cacheKey(identity)}`);
		console.log(`path=${cacheDir(env)}`);
		return 0;
	}
	if (command === 'install') {
		const report = install({ env });
		mkdirSync(path.dirname(reportFile), { recursive: true });
		writeFileSync(reportFile, `${JSON.stringify(report, null, '\t')}\n`);
		const apt = report.attempts.at(-1)?.apt || {};
		console.log(
			`\nE2E system dependencies: ${report.restored.length} archive(s) reused, ${
				apt.downloads?.length ?? 0
			} downloaded, ${report.dropped.length} dropped; ${
				apt.needToGet || 'nothing to fetch'
			}`
		);
		if (report.status !== 0) {
			console.error(
				`playwright install-deps failed with exit ${report.status}.`
			);
		}
		return report.status === 0 ? 0 : 1;
	}
	if (command === 'report') {
		if (!existsSync(reportFile)) {
			console.error(`No preparation report at ${reportFile}.`);
			return 1;
		}
		const report = finishReport(
			JSON.parse(readFileSync(reportFile, 'utf8')),
			{
				saveOutcome: env.E2E_DEPS_SAVE_OUTCOME,
			}
		);
		writeFileSync(reportFile, `${JSON.stringify(report, null, '\t')}\n`);
		const summary = renderSummary(report);
		if (env.GITHUB_STEP_SUMMARY) {
			appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
		}
		console.log(summary);
		return 0;
	}
	console.error('Usage: node scripts/e2e-system-deps.mjs key|install|report');
	return 2;
}

if (process.argv[1] === SCRIPT_PATH) {
	process.exitCode = main();
}
