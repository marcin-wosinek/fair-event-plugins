/**
 * Plugin Check reporting suite.
 *
 * Installs the official WordPress "Plugin Check" plugin
 * (https://wordpress.org/plugins/plugin-check/) on the wp-env `tests`
 * instance, runs it against each Fair Event plugin, and reports the issue
 * counts (errors / warnings) exactly as the plugin returns them.
 *
 * This is a *reporting* suite, not a gate: it does not fail on findings (the
 * plugins currently have known ones), only if Plugin Check itself can't run or
 * its output can't be parsed. To turn it into a CI gate later, assert on
 * `result.errors` (see the per-plugin test below).
 *
 * It lives in the e2e harness — rather than being a Jest test — because it
 * needs the booted wp-env `tests` instance and WP-CLI, exactly like the other
 * specs here. It does not drive a browser. Installing Plugin Check requires
 * network access (it is fetched from wordpress.org), and the full scan is slow,
 * hence the generous timeouts.
 *
 * Run: `npm run test:e2e -- plugin-check` (after `npm run test:e2e:setup`).
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

/** Plugin directory slugs (mirrors `.wp-env.json` `plugins`). */
const PLUGINS = [
	'fair-payment',
	'fair-events',
	'fair-audience',
	'fair-platform',
];

/**
 * Flags that make the scan as complete as possible: run every check
 * (no `--checks` filter), include experimental checks, and drop the severity
 * threshold to 0 so nothing is filtered out. `node_modules` and `vendor` are
 * excluded by Plugin Check's own defaults; `build/` is intentionally left in,
 * since that is what the plugin actually ships.
 */
const CHECK_FLAGS = '--include-experimental --severity=0 --format=json';

/**
 * Run a WP-CLI command against the wp-env `tests` instance and return stdout.
 *
 * @param {string}  args                 WP-CLI arguments (everything after `wp`).
 * @param {object}  [options]
 * @param {boolean} [options.allowFailure] Return stdout instead of throwing on
 *                                          a non-zero exit (Plugin Check exits
 *                                          non-zero when it finds errors).
 * @return {string} Command stdout.
 */
function wpCli(args, { allowFailure = false } = {}) {
	try {
		return execSync(`npx wp-env run tests-cli wp ${args}`, {
			cwd: process.cwd(),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (err) {
		if (allowFailure) {
			return `${err.stdout || ''}`;
		}
		throw err;
	}
}

/** Ensure the Plugin Check plugin is installed and active (idempotent). */
function ensurePluginCheck() {
	let installed = true;
	try {
		wpCli('plugin is-installed plugin-check');
	} catch {
		installed = false;
	}
	if (!installed) {
		wpCli('plugin install plugin-check');
	}
	try {
		wpCli('plugin activate plugin-check');
	} catch {
		// Already active — nothing to do.
	}
}

/**
 * Parse `wp plugin check … --format=json` output into counts by type.
 *
 * The command groups results per file: a `FILE: <path>` header line followed
 * by a single-line JSON array of that file's findings. We tally every finding
 * by its `type` ("ERROR" / "WARNING") across all files.
 *
 * @param {string} raw Raw command output.
 * @return {{byType: object, errors: number, warnings: number, other: number,
 *           total: number, filesWithFindings: number, ran: boolean}}
 */
function parseFindings(raw) {
	const byType = {};
	let filesWithFindings = 0;

	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('FILE:')) {
			filesWithFindings++;
			continue;
		}
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			let rows;
			try {
				rows = JSON.parse(trimmed);
			} catch {
				continue;
			}
			for (const row of rows) {
				byType[row.type] = (byType[row.type] || 0) + 1;
			}
		}
	}

	const errors = byType.ERROR || 0;
	const warnings = byType.WARNING || 0;
	const total = Object.values(byType).reduce((sum, n) => sum + n, 0);

	// We trust the run only if Plugin Check produced interpretable output:
	// either findings or an explicit completion/success message.
	const ran =
		total > 0 ||
		/FILE:|Success|Checks? complete|No errors|No issues/i.test(raw);

	return {
		byType,
		errors,
		warnings,
		other: total - errors - warnings,
		total,
		filesWithFindings,
		ran,
	};
}

/** Run the complete Plugin Check scan for one plugin and parse the result. */
function runPluginCheck(slug) {
	const raw = wpCli(`plugin check ${slug} ${CHECK_FLAGS}`, {
		allowFailure: true,
	});
	const { ran, byType, errors, warnings, other, total, filesWithFindings } =
		parseFindings(raw);
	return { ran, byType, errors, warnings, other, total, filesWithFindings };
}

/** Per-plugin counts, collected across the per-plugin tests for the summary. */
const summary = {};

test.describe('Plugin Check', () => {
	test.beforeAll(() => {
		test.setTimeout(300_000);
		ensurePluginCheck();
	});

	for (const slug of PLUGINS) {
		test(`reports Plugin Check issues for ${slug}`, async ({}, testInfo) => {
			test.setTimeout(240_000);

			const result = runPluginCheck(slug);
			summary[slug] = result;

			// eslint-disable-next-line no-console
			console.log(
				`[plugin-check] ${slug}: ${result.errors} errors, ` +
					`${result.warnings} warnings ` +
					`(${result.total} total across ${result.filesWithFindings} files) ` +
					`— byType ${JSON.stringify(result.byType)}`
			);

			await testInfo.attach(`plugin-check-${slug}.json`, {
				body: JSON.stringify({ slug, ...result }, null, 2),
				contentType: 'application/json',
			});

			// Reporting suite: pass as long as Plugin Check actually ran and we
			// could read its counts. Flip this to `expect(result.errors)` if you
			// want a hard gate on errors.
			expect(
				result.ran,
				`Plugin Check did not produce parseable output for ${slug}`
			).toBe(true);
		});
	}

	test.afterAll(() => {
		const rows = PLUGINS.map((slug) => ({
			plugin: slug,
			errors: summary[slug]?.errors ?? '—',
			warnings: summary[slug]?.warnings ?? '—',
			total: summary[slug]?.total ?? '—',
		}));

		const totals = rows.reduce(
			(acc, r) => {
				acc.errors += Number(r.errors) || 0;
				acc.warnings += Number(r.warnings) || 0;
				acc.total += Number(r.total) || 0;
				return acc;
			},
			{ errors: 0, warnings: 0, total: 0 }
		);

		const pad = (v, w) => String(v).padEnd(w);
		const padL = (v, w) => String(v).padStart(w);
		const lines = [
			'',
			'Plugin Check summary (complete scan):',
			`  ${pad('plugin', 16)}${padL('errors', 8)}${padL(
				'warnings',
				10
			)}${padL('total', 8)}`,
			`  ${'-'.repeat(42)}`,
			...rows.map(
				(r) =>
					`  ${pad(r.plugin, 16)}${padL(r.errors, 8)}${padL(
						r.warnings,
						10
					)}${padL(r.total, 8)}`
			),
			`  ${'-'.repeat(42)}`,
			`  ${pad('TOTAL', 16)}${padL(totals.errors, 8)}${padL(
				totals.warnings,
				10
			)}${padL(totals.total, 8)}`,
			'',
		];

		// eslint-disable-next-line no-console
		console.log(lines.join('\n'));
	});
});
