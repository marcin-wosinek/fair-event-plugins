import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	MAX_FILE_BYTES,
	buildReport,
	classify,
	detect,
	discoverSources,
	readWorkspaces,
	renderMarkdown,
	runDuplication,
	toFindings,
	workspaceOf,
} from '../duplication.mjs';

const SCRIPT = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'duplication.mjs'
);

const WORKSPACES = ['plugin-a', 'plugin-b', 'fair-events-shared'];

// Low thresholds keep fixtures short; each block below clears them.
const THRESHOLDS = { minTokens: 30, minLines: 5 };

function withRepo(files, callback, workspaces = WORKSPACES) {
	const root = mkdtempSync(path.join(tmpdir(), 'duplication-'));
	try {
		writeFileSync(
			path.join(root, 'package.json'),
			JSON.stringify({ workspaces })
		);
		for (const workspace of workspaces) {
			mkdirSync(path.join(root, workspace), { recursive: true });
		}
		for (const [relative, contents] of Object.entries(files)) {
			const full = path.join(root, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, contents);
		}
		return callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// Same tokens wherever it is pasted; `name` only changes the declaration line.
function jsBlock(name) {
	return `export function ${name}( items, tax ) {
	let total = 0;
	for ( const item of items ) {
		const price = Number( item.price );
		const quantity = Number( item.quantity );
		if ( quantity <= 0 ) {
			continue;
		}
		const line = price * quantity;
		total += line + line * tax;
	}
	return { total: total.toFixed( 2 ), count: items.length };
}
`;
}

function phpBlock(name) {
	return `function ${name}( $rows ) {
	$result = array();
	foreach ( $rows as $row ) {
		if ( empty( $row['id'] ) ) {
			continue;
		}
		$result[] = array(
			'id'    => (int) $row['id'],
			'name'  => sanitize_text_field( $row['name'] ),
			'email' => sanitize_email( $row['email'] ),
		);
	}
	return $result;
}
`;
}

function phpOptionsBlock(name) {
	return `function ${name}( $key ) {
	$options = get_option( 'demo_options', array() );
	if ( ! is_array( $options ) || ! isset( $options[ $key ] ) ) {
		return null;
	}
	$value = $options[ $key ];
	if ( is_string( $value ) ) {
		$value = trim( wp_unslash( $value ) );
	}
	update_option( 'demo_last_read', $key );
	return apply_filters( 'demo_option_value', $value, $key );
}
`;
}

function scan(root, thresholds = THRESHOLDS) {
	const workspaces = readWorkspaces(root);
	const files = discoverSources(root, workspaces);
	return toFindings(detect(root, files, thresholds), workspaces);
}

function pairs(findings) {
	return findings.map(({ category, language, first, second }) => [
		category,
		language,
		first.file,
		second.file,
	]);
}

test('reads workspaces from package.json and rejects an empty list', () => {
	withRepo({}, (root) => {
		assert.deepEqual(readWorkspaces(root), WORKSPACES);
	});
	withRepo({}, (root) => assert.throws(() => readWorkspaces(root)), []);
});

test('discovers production source and skips tests, builds and tooling', () => {
	const files = {
		'plugin-a/plugin-a.php': '<?php',
		'plugin-a/webpack.config.js': '',
		'plugin-a/src/index.js': '',
		'plugin-a/src/Admin/App.jsx': '',
		'plugin-a/src/API/Controller.php': '<?php',
		'plugin-a/src/API/__tests__/Controller.api.spec.js': '',
		'plugin-a/src/Admin/App.test.jsx': '',
		'plugin-a/src/blocks/x/index.asset.php': '<?php',
		'plugin-a/src/styles.css': '',
		'plugin-a/templates/email.php': '<?php',
		'plugin-a/build/index.js': '',
		'plugin-a/vendor/autoload.php': '<?php',
		'plugin-a/node_modules/dep/index.js': '',
		'plugin-a/svn/trunk/plugin-a.php': '<?php',
		'plugin-a/e2e/flow.spec.js': '',
		'plugin-a/__tests__/plugin.test.js': '',
		'plugin-a/src/vendor/lib.js': '',
		'fair-events-shared/src/index.js': '',
		'fair-events-shared/php/src/Helper.php': '<?php',
		'fair-events-shared/php/vendor/autoload.php': '<?php',
	};
	withRepo(files, (root) => {
		assert.deepEqual(discoverSources(root, WORKSPACES), [
			'fair-events-shared/php/src/Helper.php',
			'fair-events-shared/src/index.js',
			'plugin-a/plugin-a.php',
			'plugin-a/src/API/Controller.php',
			'plugin-a/src/Admin/App.jsx',
			'plugin-a/src/index.js',
			'plugin-a/templates/email.php',
		]);
	});
});

test('does not follow symlinked directories or files', () => {
	withRepo({ 'plugin-a/src/a.js': '', 'outside/lib/b.js': '' }, (root) => {
		symlinkSync(
			path.join(root, 'outside/lib'),
			path.join(root, 'plugin-a/src/linked')
		);
		symlinkSync(
			path.join(root, 'outside/lib/b.js'),
			path.join(root, 'plugin-a/src/b.js')
		);
		assert.deepEqual(discoverSources(root, WORKSPACES), [
			'plugin-a/src/a.js',
		]);
	});
});

test('fails instead of silently skipping', () => {
	withRepo({ 'plugin-a/src/a.js': '' }, (root) => {
		assert.throws(
			() => discoverSources(root, [...WORKSPACES, 'missing']),
			/Workspace directory not found: missing/
		);
	});
	withRepo({ 'plugin-a/src/a.css': '' }, (root) => {
		assert.throws(
			() => discoverSources(root, WORKSPACES),
			/No JS or PHP source files/
		);
	});
	withRepo(
		{ 'plugin-a/src/big.js': 'x'.repeat(MAX_FILE_BYTES + 1) },
		(root) => {
			assert.throws(
				() => discoverSources(root, WORKSPACES),
				/above the \d+-byte scan limit/
			);
		}
	);
});

test('assigns files to workspaces and classifies pairs', () => {
	const workspaces = ['fair-events', 'fair-events-shared'];
	assert.equal(
		workspaceOf('fair-events/src/a.js', workspaces),
		'fair-events'
	);
	assert.equal(
		workspaceOf('fair-events-shared/src/a.js', workspaces),
		'fair-events-shared'
	);
	assert.equal(classify('plugin-a', 'plugin-a'), 'within-workspace');
	assert.equal(classify('plugin-a', 'plugin-b'), 'cross-plugin');
	assert.equal(
		classify('fair-events-shared', 'plugin-a'),
		'plugin-to-shared'
	);
	assert.equal(
		classify('fair-events-shared', 'fair-events-shared'),
		'within-workspace'
	);
});

test('detects JS, JSX and PHP duplication and groups it by owner', () => {
	const files = {
		'plugin-a/src/totals.js': jsBlock('totalsA'),
		'plugin-b/src/Totals.jsx': jsBlock('totalsB'),
		'plugin-a/src/Rows.php': `<?php\n${phpBlock('rows_a')}`,
		'fair-events-shared/php/src/Rows.php': `<?php\n${phpBlock('rows_shared')}`,
		'plugin-b/src/Twice.php': `<?php\n${phpOptionsBlock('first')}\n${phpOptionsBlock('second')}`,
		'plugin-b/src/unique.js': 'export const unique = 1;\n',
	};
	withRepo(files, (root) => {
		const findings = scan(root);
		assert.deepEqual(pairs(findings), [
			[
				'cross-plugin',
				'javascript',
				'plugin-a/src/totals.js',
				'plugin-b/src/Totals.jsx',
			],
			[
				'plugin-to-shared',
				'php',
				'fair-events-shared/php/src/Rows.php',
				'plugin-a/src/Rows.php',
			],
			[
				'within-workspace',
				'php',
				'plugin-b/src/Twice.php',
				'plugin-b/src/Twice.php',
			],
		]);
		const { first, second } = findings[2];
		assert.ok(
			first.end < second.start,
			'same-file copies keep both ranges'
		);
	});
});

test('ignores comments when matching', () => {
	const commented = jsBlock('totalsB').replace(
		'\tlet total = 0;\n',
		'\t// Running sum.\n\tlet total = 0;\n\t/* Each line adds tax. */\n'
	);
	withRepo(
		{
			'plugin-a/src/totals.js': jsBlock('totalsA'),
			'plugin-b/src/totals.js': commented,
		},
		(root) => {
			assert.equal(scan(root).length, 1);
		}
	);
});

test('applies both thresholds at their boundaries', () => {
	const files = {
		'plugin-a/src/totals.js': jsBlock('totalsA'),
		'plugin-b/src/totals.js': jsBlock('totalsB'),
	};
	withRepo(files, (root) => {
		const [finding] = scan(root);
		const count = (thresholds) => scan(root, thresholds).length;
		// jscpd compares the span (end - start) with --min-lines, so a
		// reported 13-line match passes --min-lines=12 but not 13.
		assert.equal(count({ minTokens: 30, minLines: finding.lines - 1 }), 1);
		assert.equal(count({ minTokens: 30, minLines: finding.lines }), 0);
		assert.equal(count({ minTokens: finding.tokens, minLines: 5 }), 1);
		assert.equal(count({ minTokens: finding.tokens + 1, minLines: 5 }), 0);
	});
});

test('orders findings deterministically regardless of detector order', () => {
	const clone = (a, b, lines) => ({
		format: 'php',
		tokens: lines * 10,
		firstFile: { name: a, start: 1, end: lines },
		secondFile: { name: b, start: 20, end: 19 + lines },
	});
	const clones = [
		clone('plugin-b/src/X.php', 'plugin-a/src/X.php', 12),
		clone('plugin-a/src/Y.php', 'plugin-a/src/Z.php', 30),
		clone('plugin-b/src/W.php', 'fair-events-shared/php/src/W.php', 15),
		clone('plugin-a/src/V.php', 'plugin-b/src/V.php', 40),
	];
	const expected = toFindings(clones, WORKSPACES);
	assert.deepEqual(toFindings([...clones].reverse(), WORKSPACES), expected);
	assert.deepEqual(
		expected.map(({ category, first }) => [category, first.file]),
		[
			['cross-plugin', 'plugin-a/src/V.php'],
			['cross-plugin', 'plugin-a/src/X.php'],
			['plugin-to-shared', 'fair-events-shared/php/src/W.php'],
			['within-workspace', 'plugin-a/src/Y.php'],
		]
	);
	// Pair order is normalized, so the swapped clone keeps its own lines.
	assert.deepEqual(expected[1].first, {
		file: 'plugin-a/src/X.php',
		start: 20,
		end: 31,
		workspace: 'plugin-a',
	});
});

test('writes identical reports for identical input', () => {
	const files = {
		'plugin-a/src/totals.js': jsBlock('totalsA'),
		'plugin-b/src/totals.js': jsBlock('totalsB'),
	};
	withRepo(files, (root) => {
		const workspaces = readWorkspaces(root);
		const sources = discoverSources(root, workspaces);
		const run = {
			commit: 'abc123',
			detectorVersion: 'test',
			generatedAt: '2026-01-01T00:00:00.000Z',
			durationMs: 1000,
		};
		const render = () =>
			renderMarkdown(
				buildReport({
					files: sources,
					findings: scan(root),
					workspaces,
					settings: { ...THRESHOLDS, mode: 'weak' },
					run,
				})
			);
		const markdown = render();
		assert.equal(render(), markdown);
		assert.match(markdown, /\| Cross-plugin duplication \| 1 \|/);
		assert.match(markdown, /`plugin-a\/src\/totals\.js:\d+-\d+`/);
		assert.match(
			markdown,
			/## Within-workspace duplication\n\n.*\n\nNone\./
		);
	});
});

test('runDuplication writes JSON and Markdown reports', () => {
	withRepo(
		{
			'plugin-a/src/totals.js': jsBlock('totalsA'),
			'plugin-b/src/totals.js': jsBlock('totalsB'),
		},
		(root) => {
			const { report, outputDir } = runDuplication({
				root,
				...THRESHOLDS,
				output: 'out',
			});
			assert.equal(outputDir, 'out');
			assert.deepEqual(report.totals, {
				'cross-plugin': 1,
				'plugin-to-shared': 0,
				'within-workspace': 0,
			});
			assert.deepEqual(report.files.byWorkspace, {
				'plugin-a': 1,
				'plugin-b': 1,
			});
			const json = JSON.parse(
				readFileSync(path.join(root, 'out/duplication.json'), 'utf8')
			);
			assert.deepEqual(json.findings, report.findings);
			assert.ok(existsSync(path.join(root, 'out/duplication.md')));
		}
	);
});

test('exits 0 with findings and 1 on failures', () => {
	const run = (...args) =>
		spawnSync(process.execPath, [SCRIPT, ...args], {
			encoding: 'utf8',
		});
	withRepo(
		{
			'plugin-a/src/totals.js': jsBlock('totalsA'),
			'plugin-b/src/totals.js': jsBlock('totalsB'),
		},
		(root) => {
			const ok = run(
				`--root=${root}`,
				'--min-tokens=30',
				'--min-lines=5',
				'--output=out'
			);
			assert.equal(ok.status, 0, ok.stderr);
			assert.match(ok.stdout, /Cross-plugin duplication: 1/);

			const missing = run(`--root=${path.join(root, 'nope')}`);
			assert.equal(missing.status, 1);
			assert.match(missing.stderr, /Cannot read package\.json/);

			const badArg = run(`--root=${root}`, '--min-lines=0');
			assert.equal(badArg.status, 1);
			assert.match(badArg.stderr, /positive integer/);
		}
	);
});
