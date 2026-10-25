#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Report-only scan for duplicated JS and PHP across the workspaces (#1457).
 * One jscpd pass covers every workspace's production source, so a block
 * copied between plugins is found as readily as one repeated in a file.
 * Findings are grouped by who would own the cleanup:
 *
 *   cross-plugin        two plugins share code; a shared-package candidate
 *   plugin-to-shared    a plugin repeats code the shared package already has
 *   within-workspace    one workspace (or one file) repeats itself
 *
 *   npm run duplication [-- --min-tokens=100 --min-lines=10 --output=dir]
 *
 * Findings never fail the command. Discovery, detector or report errors
 * exit 1. README.md ("Duplication report") explains how to read the output.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);

const require = createRequire(import.meta.url);

export const DEFAULTS = {
	minTokens: 100,
	minLines: 10,
	output: 'reports/duplication',
};

// `weak` drops comments from the token stream; whitespace never counts.
export const MODE = 'weak';

// Workspaces whose code is meant to be reused by the plugins.
export const SHARED_WORKSPACES = new Set(['fair-events-shared']);

// Directories, relative to a workspace, that hold maintained production code.
// Top-level `*.php` plugin bootstrap files are added separately.
export const SOURCE_DIRS = ['src', 'php/src', 'templates'];

// Directory names never scanned, at any depth.
export const EXCLUDED_DIRS = new Set([
	'node_modules',
	'vendor',
	'build',
	'dist',
	'svn',
	'languages',
	'__tests__',
	'__mocks__',
	'__fixtures__',
	'fixtures',
	'e2e',
	'test-results',
	'playwright-report',
]);

export const LANGUAGES = {
	javascript: ['js', 'jsx', 'mjs', 'cjs'],
	php: ['php'],
};

const EXTENSIONS = new Map(
	Object.entries(LANGUAGES).flatMap(([language, exts]) =>
		exts.map((ext) => [`.${ext}`, language])
	)
);

// Tests and generated files that can sit next to production code.
const EXCLUDED_FILE = /\.(test|spec)\.[cm]?jsx?$|\.asset\.php$|\.min\.js$/;

// jscpd silently skips files above its size limit (1 MB by default). The
// scan passes this limit and refuses larger files instead of dropping them.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const CATEGORIES = [
	{
		id: 'cross-plugin',
		title: 'Cross-plugin duplication',
		hint: 'Code copied between plugins: candidates for the shared package.',
	},
	{
		id: 'plugin-to-shared',
		title: 'Plugin-to-shared-package duplication',
		hint: 'A plugin repeats code the shared package already has: reuse it.',
	},
	{
		id: 'within-workspace',
		title: 'Within-workspace duplication',
		hint: 'Repeated code inside one workspace or one file: a local cleanup.',
	},
];

function toPosix(relative) {
	return relative.split(path.sep).join('/');
}

/**
 * Workspace directories, from the root `package.json` `workspaces` list.
 */
export function readWorkspaces(root) {
	let manifest;
	try {
		manifest = JSON.parse(
			readFileSync(path.join(root, 'package.json'), 'utf8')
		);
	} catch (error) {
		throw new Error(`Cannot read package.json: ${error.message}`);
	}
	const { workspaces } = manifest;
	if (!Array.isArray(workspaces) || workspaces.length === 0) {
		throw new Error('package.json lists no workspaces.');
	}
	return workspaces;
}

function walk(root, relative, files) {
	for (const entry of readdirSync(path.join(root, relative), {
		withFileTypes: true,
	})) {
		const child = path.join(relative, entry.name);
		// Dirent types come from lstat, so symlinks are neither entered nor read.
		if (entry.isDirectory()) {
			if (!EXCLUDED_DIRS.has(entry.name)) {
				walk(root, child, files);
			}
		} else if (entry.isFile() && isSourceFile(entry.name)) {
			files.push(toPosix(child));
		}
	}
}

function isSourceFile(name) {
	return EXTENSIONS.has(path.extname(name)) && !EXCLUDED_FILE.test(name);
}

function isDirectory(full) {
	const stat = lstatSync(full, { throwIfNoEntry: false });
	return stat?.isDirectory() ?? false;
}

/**
 * Production JS/PHP files of every workspace, as sorted repo-relative paths.
 */
export function discoverSources(root, workspaces) {
	const files = [];
	for (const workspace of workspaces) {
		if (!isDirectory(path.join(root, workspace))) {
			throw new Error(`Workspace directory not found: ${workspace}`);
		}
		for (const entry of readdirSync(path.join(root, workspace), {
			withFileTypes: true,
		})) {
			if (entry.isFile() && entry.name.endsWith('.php')) {
				files.push(`${workspace}/${entry.name}`);
			}
		}
		for (const dir of SOURCE_DIRS) {
			const relative = path.join(workspace, dir);
			if (isDirectory(path.join(root, relative))) {
				walk(root, relative, files);
			}
		}
	}
	if (files.length === 0) {
		throw new Error('No JS or PHP source files found to scan.');
	}
	for (const file of files) {
		const { size } = lstatSync(path.join(root, file));
		if (size > MAX_FILE_BYTES) {
			throw new Error(
				`${file} is ${size} bytes, above the ${MAX_FILE_BYTES}-byte scan limit; raise MAX_FILE_BYTES rather than skip it.`
			);
		}
	}
	return files.sort();
}

export function languageOf(file) {
	return EXTENSIONS.get(path.extname(file));
}

export function workspaceOf(file, workspaces) {
	return (
		workspaces
			.filter((workspace) => file.startsWith(`${workspace}/`))
			.sort((a, b) => b.length - a.length)[0] ?? null
	);
}

export function classify(first, second) {
	if (first === second) {
		return 'within-workspace';
	}
	if (SHARED_WORKSPACES.has(first) || SHARED_WORKSPACES.has(second)) {
		return 'plugin-to-shared';
	}
	return 'cross-plugin';
}

function compareLocations(a, b) {
	return a.file.localeCompare(b.file) || a.start - b.start || a.end - b.end;
}

/**
 * Run jscpd once over every file and return the clones of its JSON report,
 * with repo-relative file names.
 */
export function detect(root, files, { minTokens, minLines }) {
	const output = mkdtempSync(path.join(tmpdir(), 'duplication-'));
	try {
		const result = spawnSync(
			process.execPath,
			[
				require.resolve('jscpd/run-jscpd.js'),
				`--min-tokens=${minTokens}`,
				`--min-lines=${minLines}`,
				`--mode=${MODE}`,
				`--format=${Object.keys(LANGUAGES).join(',')}`,
				`--formats-exts=${Object.entries(LANGUAGES)
					.map(([language, exts]) => `${language}:${exts.join(',')}`)
					.join(';')}`,
				`--max-size=${MAX_FILE_BYTES}b`,
				'--reporters=json',
				`--output=${output}`,
				'--no-gitignore',
				'--no-colors',
				'--absolute',
				'--silent',
				...files.map((file) => path.join(root, file)),
			],
			{ cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
		);
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(
				`jscpd exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`
			);
		}
		const reportFile = path.join(output, 'jscpd-report.json');
		let report;
		try {
			report = JSON.parse(readFileSync(reportFile, 'utf8'));
		} catch (error) {
			throw new Error(`Cannot read the jscpd report: ${error.message}`);
		}
		if (!Array.isArray(report.duplicates)) {
			throw new Error('The jscpd report has no duplicates list.');
		}
		// jscpd reports canonical paths (macOS temp dirs resolve via /private).
		const base = realpathSync(root);
		const relative = (location) => ({
			...location,
			name: toPosix(path.relative(base, location.name)),
		});
		return report.duplicates.map((clone) => ({
			...clone,
			firstFile: relative(clone.firstFile),
			secondFile: relative(clone.secondFile),
		}));
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
}

/**
 * Normalize raw clones into sorted, classified findings.
 */
export function toFindings(clones, workspaces) {
	const locate = ({ name, start, end }) => ({
		file: name,
		start,
		end,
		workspace: workspaceOf(name, workspaces),
	});
	const findings = clones.map((clone) => {
		const [first, second] = [
			locate(clone.firstFile),
			locate(clone.secondFile),
		].sort(compareLocations);
		return {
			category: classify(first.workspace, second.workspace),
			language: clone.format,
			lines: Math.max(
				first.end - first.start + 1,
				second.end - second.start + 1
			),
			tokens: clone.tokens,
			first,
			second,
		};
	});
	const order = CATEGORIES.map(({ id }) => id);
	return findings.sort(
		(a, b) =>
			order.indexOf(a.category) - order.indexOf(b.category) ||
			b.lines - a.lines ||
			compareLocations(a.first, b.first) ||
			compareLocations(a.second, b.second)
	);
}

function countBy(items, key) {
	const counts = {};
	for (const item of items) {
		counts[key(item)] = (counts[key(item)] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
	);
}

/**
 * Assemble the JSON report. `run` carries the non-deterministic metadata
 * (commit, timing, versions), kept apart from the findings.
 */
export function buildReport({ files, findings, workspaces, settings, run }) {
	return {
		run,
		settings,
		files: {
			total: files.length,
			byLanguage: countBy(files, languageOf),
			byWorkspace: countBy(files, (file) =>
				workspaceOf(file, workspaces)
			),
		},
		totals: Object.fromEntries(
			CATEGORIES.map(({ id }) => [
				id,
				findings.filter(({ category }) => category === id).length,
			])
		),
		findings,
	};
}

function formatLocation({ file, start, end }) {
	return `\`${file}:${start}-${end}\``;
}

export function renderMarkdown(report) {
	const { run, settings, files, totals, findings } = report;
	const lines = [
		'# Duplication report',
		'',
		`- Commit: \`${run.commit}\``,
		`- Detector: jscpd ${run.detectorVersion}`,
		`- Settings: min ${settings.minTokens} tokens, min ${settings.minLines} lines, comments and whitespace ignored`,
		`- Files scanned: ${files.total} (${Object.entries(files.byLanguage)
			.map(([language, count]) => `${count} ${language}`)
			.join(', ')})`,
		`- Duration: ${(run.durationMs / 1000).toFixed(1)} s`,
		'',
		'| Category | Findings |',
		'| --- | ---: |',
		...CATEGORIES.map(({ id, title }) => `| ${title} | ${totals[id]} |`),
	];
	for (const { id, title, hint } of CATEGORIES) {
		const rows = findings.filter(({ category }) => category === id);
		lines.push('', `## ${title}`, '', hint, '');
		if (rows.length === 0) {
			lines.push('None.');
			continue;
		}
		lines.push(
			'| Lines | Tokens | Language | First | Second |',
			'| ---: | ---: | --- | --- | --- |',
			...rows.map(
				(row) =>
					`| ${row.lines} | ${row.tokens} | ${row.language} | ${formatLocation(row.first)} | ${formatLocation(row.second)} |`
			)
		);
	}
	return `${lines.join('\n')}\n`;
}

export function renderSummary(report, outputDir) {
	const { files, totals, run } = report;
	return [
		`Scanned ${files.total} files in ${(run.durationMs / 1000).toFixed(1)} s.`,
		...CATEGORIES.map(({ id, title }) => `  ${title}: ${totals[id]}`),
		`Reports: ${outputDir}/duplication.md, ${outputDir}/duplication.json`,
	].join('\n');
}

function gitCommit(root) {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return 'unknown';
	}
}

function parseArgs(argv) {
	const options = { ...DEFAULTS, root: ROOT };
	for (const arg of argv) {
		const match = /^--(min-tokens|min-lines|output|root)=(.+)$/.exec(arg);
		if (!match) {
			throw new Error(`Unknown argument: ${arg}`);
		}
		const [, name, value] = match;
		if (name === 'min-tokens' || name === 'min-lines') {
			const number = Number(value);
			if (!Number.isInteger(number) || number < 1) {
				throw new Error(`--${name} must be a positive integer.`);
			}
			options[name === 'min-tokens' ? 'minTokens' : 'minLines'] = number;
		} else {
			options[name] = value;
		}
	}
	return options;
}

/**
 * Scan, write the reports and return the report object.
 */
export function runDuplication({ root, minTokens, minLines, output }) {
	const started = Date.now();
	const workspaces = readWorkspaces(root);
	const files = discoverSources(root, workspaces);
	const clones = detect(root, files, { minTokens, minLines });
	const findings = toFindings(clones, workspaces);
	const report = buildReport({
		files,
		findings,
		workspaces,
		settings: { minTokens, minLines, mode: MODE },
		run: {
			commit: gitCommit(root),
			detectorVersion: require('jscpd/package.json').version,
			generatedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
		},
	});
	const outputDir = path.resolve(root, output);
	mkdirSync(outputDir, { recursive: true });
	writeFileSync(
		path.join(outputDir, 'duplication.json'),
		`${JSON.stringify(report, null, '\t')}\n`
	);
	writeFileSync(
		path.join(outputDir, 'duplication.md'),
		renderMarkdown(report)
	);
	return { report, outputDir: toPosix(path.relative(root, outputDir)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const { report, outputDir } = runDuplication(
			parseArgs(process.argv.slice(2))
		);
		console.log(renderSummary(report, outputDir));
	} catch (error) {
		console.error(`Duplication scan failed: ${error.message}`);
		process.exit(1);
	}
}
