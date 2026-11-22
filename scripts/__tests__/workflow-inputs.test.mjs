/**
 * Script-injection regression checks for the performance, WordPress.org
 * publishing and release deployment workflows (#2383).
 *
 * Each test extracts a step's `run:` script from the workflow file and runs it
 * under the same bash options GitHub Actions uses, with the step's inputs in
 * environment variables and stub `npm`, `gh`, `svn` and `ssh` commands that
 * only record their arguments. Nothing here needs credentials or the network,
 * and no stub publishes, deploys or contacts a server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArguments } from '../performance-runner.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const WORKFLOWS = [
	'performance',
	'publish-to-svn',
	'deploy-from-release',
	'deploy-to-environment',
];

const MARKER = 'PWNED';
const HOSTILE = [
	`$(touch ${MARKER})`,
	`\`touch ${MARKER}\``,
	`; touch ${MARKER}`,
	`x && touch ${MARKER}`,
	`x | touch ${MARKER}`,
	`x\ntouch ${MARKER}`,
	`x'; touch ${MARKER}; echo '`,
	`x"; touch ${MARKER}; echo "`,
];

function workflowText(name) {
	return readFileSync(join(ROOT, `.github/workflows/${name}.yml`), 'utf8');
}

/** Returns the lines of the step whose `- name:` is exactly `stepName`. */
function stepLines(workflow, stepName) {
	const lines = workflowText(workflow).split('\n');
	const start = lines.findIndex(
		(line) => line.trim() === `- name: ${stepName}`
	);
	assert.notEqual(start, -1, `${workflow}: no step named "${stepName}"`);
	const indent = lines[start].indexOf('-');
	let end = start + 1;
	while (end < lines.length) {
		const line = lines[end];
		const lineIndent = line.length - line.trimStart().length;
		if (line.trim() !== '' && lineIndent <= indent) {
			break;
		}
		end++;
	}
	return lines.slice(start, end);
}

/** Extracts the block-literal `run: |` scripts from lines of a workflow. */
function runBlocks(lines) {
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(\s*)run: \|\s*$/);
		if (!match) {
			continue;
		}
		const runIndent = match[1].length;
		const body = [];
		let j = i + 1;
		for (; j < lines.length; j++) {
			const line = lines[j];
			const lineIndent = line.length - line.trimStart().length;
			if (line.trim() !== '' && lineIndent <= runIndent) {
				break;
			}
			body.push(line);
		}
		const bodyIndent = Math.min(
			...body
				.filter((line) => line.trim() !== '')
				.map((line) => line.length - line.trimStart().length)
		);
		blocks.push(body.map((line) => line.slice(bodyIndent)).join('\n'));
		i = j - 1;
	}
	return blocks;
}

function stepScript(workflow, stepName) {
	const lines = stepLines(workflow, stepName);
	const inline = lines.find((line) => /^\s*run: [^|]/.test(line));
	if (inline) {
		return inline.replace(/^\s*run: /, '');
	}
	const [script] = runBlocks(lines);
	assert.ok(script, `${workflow}: step "${stepName}" has no run script`);
	return script;
}

function stepText(workflow, stepName) {
	return stepLines(workflow, stepName).join('\n');
}

const STUB = `#!/bin/bash
{
	printf '%s' "$(basename "$0")"
	for arg in "$@"; do printf '\\037%s' "$arg"; done
	printf '\\036'
} >> "$STUB_LOG"
exit "\${STUB_EXIT:-0}"
`;

/**
 * Runs a workflow step's script in a fresh directory and returns its exit
 * status, output, recorded stub calls and GITHUB_OUTPUT contents.
 */
function runStep(workflow, stepName, env = {}, { stubs = [], ssh } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'workflow-inputs-'));
	try {
		const bin = join(dir, 'bin');
		mkdirSync(bin);
		for (const name of stubs) {
			writeFileSync(join(bin, name), STUB);
			chmodSync(join(bin, name), 0o755);
		}
		if (ssh) {
			writeFileSync(join(bin, 'ssh'), ssh);
			chmodSync(join(bin, 'ssh'), 0o755);
		}
		const work = join(dir, 'work');
		mkdirSync(work);
		const scriptFile = join(dir, 'step.sh');
		writeFileSync(scriptFile, stepScript(workflow, stepName));
		const output = join(dir, 'github-output');
		const log = join(dir, 'stub-log');
		writeFileSync(output, '');
		writeFileSync(log, '');
		const result = spawnSync(
			'bash',
			['--noprofile', '--norc', '-eo', 'pipefail', scriptFile],
			{
				cwd: work,
				encoding: 'utf8',
				env: {
					PATH: `${bin}:${process.env.PATH}`,
					HOME: dir,
					GITHUB_OUTPUT: output,
					GITHUB_STEP_SUMMARY: join(dir, 'summary'),
					GITHUB_REPOSITORY: 'example/repo',
					STUB_LOG: log,
					...env,
				},
			}
		);
		const calls = readFileSync(log, 'utf8')
			.split('\x1e')
			.filter(Boolean)
			.map((record) => record.split('\x1f'));
		return {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
			calls,
			outputs: readFileSync(output, 'utf8'),
			pwned: existsSync(join(work, MARKER)),
			dir,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function outputsOf(text) {
	return Object.fromEntries(
		text
			.split('\n')
			.filter(Boolean)
			.map((line) => line.split(/=(.*)/s).slice(0, 2))
	);
}

// --- Every workflow ---------------------------------------------------------

test('no run script interpolates an expression into shell source', () => {
	for (const workflow of WORKFLOWS) {
		const lines = workflowText(workflow).split('\n');
		const scripts = [
			...runBlocks(lines),
			...lines
				.filter((line) => /^\s*run: [^|]/.test(line))
				.map((line) => line.replace(/^\s*run: /, '')),
		];
		assert.ok(scripts.length > 0, workflow);
		for (const script of scripts) {
			assert.doesNotMatch(script, /\$\{\{/, `${workflow}:\n${script}`);
		}
	}
});

// --- Performance ------------------------------------------------------------

const PERF_STEP = 'Run performance audit';
const REPORT_ARGS = [
	'--out=performance-report.md',
	'--json-out=performance-report.json',
];

test('performance: the inputs reach the step through the environment', () => {
	const text = stepText('performance', PERF_STEP);
	assert.match(text, /SAMPLES: \$\{\{ inputs\.samples \}\}/);
	assert.match(text, /SCENARIO: \$\{\{ inputs\.scenario \}\}/);
});

test('performance: the default dispatch runs five samples of the full sweep', () => {
	const run = runStep(
		'performance',
		PERF_STEP,
		{ SAMPLES: '5', SCENARIO: '' },
		{ stubs: ['npm'] }
	);
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(run.calls, [
		['npm', 'run', 'performance', '--', ...REPORT_ARGS, '--samples=5'],
	]);
	assert.equal(parseArguments(run.calls[0].slice(4)).samples, 5);
	assert.equal(parseArguments(run.calls[0].slice(4)).scenario, undefined);
});

test('performance: a blank sample count keeps the runner default of five', () => {
	const run = runStep(
		'performance',
		PERF_STEP,
		{ SAMPLES: '', SCENARIO: '' },
		{ stubs: ['npm'] }
	);
	assert.deepEqual(run.calls, [
		['npm', 'run', 'performance', '--', ...REPORT_ARGS],
	]);
	assert.equal(parseArguments(run.calls[0].slice(4)).samples, 5);
});

test('performance: a focused run passes the scenario as one argument', () => {
	const run = runStep(
		'performance',
		PERF_STEP,
		{ SAMPLES: '3', SCENARIO: 'fair-events' },
		{ stubs: ['npm'] }
	);
	assert.deepEqual(run.calls, [
		[
			'npm',
			'run',
			'performance',
			'--',
			...REPORT_ARGS,
			'--samples=3',
			'--scenario=fair-events',
		],
	]);
	const options = parseArguments(run.calls[0].slice(4));
	assert.equal(options.samples, 3);
	assert.equal(options.scenario, 'fair-events');
});

test('performance: hostile inputs stay single arguments and never execute', () => {
	for (const value of HOSTILE) {
		const run = runStep(
			'performance',
			PERF_STEP,
			{ SAMPLES: value, SCENARIO: value },
			{ stubs: ['npm'] }
		);
		assert.equal(run.status, 0, run.stderr);
		assert.equal(run.pwned, false, value);
		assert.deepEqual(run.calls, [
			[
				'npm',
				'run',
				'performance',
				'--',
				...REPORT_ARGS,
				`--samples=${value}`,
				`--scenario=${value}`,
			],
		]);
		// The runner rejects the value before measuring anything, so the
		// step fails and the history publish never runs.
		assert.throws(() => parseArguments(run.calls[0].slice(4)), value);
	}
});

test('performance: a failed audit skips the history publish', () => {
	const text = stepText(
		'performance',
		'Publish to performance-history branch'
	);
	assert.doesNotMatch(text, /if:/);
});

// --- WordPress.org publishing ----------------------------------------------

const PUBLISH_PLUGINS = [
	'fair-events',
	'fair-audience',
	'fair-timetable',
	'fair-payments-connector',
	'fair-calendar-button',
];

test('publish: validation runs first and covers every dispatch choice', () => {
	const text = workflowText('publish-to-svn');
	const choices = text
		.slice(text.indexOf('options:'), text.indexOf('version:'))
		.match(/- [a-z-]+/g)
		.map((option) => option.slice(2));
	assert.deepEqual(choices, PUBLISH_PLUGINS);
	const steps = [...text.matchAll(/^ {12}- name: (.+)$/gm)].map((m) => m[1]);
	assert.equal(steps[0], 'Validate inputs');
	assert.match(text, /PLUGIN: \$\{\{ inputs\.plugin \}\}/);
	assert.match(text, /VERSION: \$\{\{ inputs\.version \}\}/);
	// The DEPLOYMENT.md list matches the workflow's.
	const docs = readFileSync(join(ROOT, 'DEPLOYMENT.md'), 'utf8');
	const line = docs.split('\n').find((l) => l.startsWith('- `plugin` —'));
	assert.deepEqual(
		[...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).slice(1),
		PUBLISH_PLUGINS
	);
});

test('publish: valid plugins and versions pass validation', () => {
	for (const plugin of PUBLISH_PLUGINS) {
		for (const version of ['1.2.3', '0.0.1', '10.20.30']) {
			const run = runStep('publish-to-svn', 'Validate inputs', {
				PLUGIN: plugin,
				VERSION: version,
			});
			assert.equal(run.status, 0, `${plugin} ${version}: ${run.stdout}`);
		}
	}
});

test('publish: invalid or hostile inputs fail validation without echoing them', () => {
	const badVersions = [
		...HOSTILE.map((value) => `1.2.3${value}`),
		'1.2.3\n',
		'1.2',
		'v1.2.3',
		'1.2.3-beta',
		'',
	];
	for (const version of badVersions) {
		const run = runStep('publish-to-svn', 'Validate inputs', {
			PLUGIN: 'fair-events',
			VERSION: version,
		});
		assert.equal(run.status, 1, JSON.stringify(version));
		assert.equal(run.pwned, false);
		assert.match(run.stdout, /^::error::The version input must be/m);
		if (version.includes(MARKER)) {
			assert.ok(!run.stdout.includes(MARKER), JSON.stringify(version));
		}
	}
	for (const plugin of [...HOSTILE, 'fair-finance', '', 'fair-events ']) {
		const run = runStep('publish-to-svn', 'Validate inputs', {
			PLUGIN: plugin,
			VERSION: '1.2.3',
		});
		assert.equal(run.status, 1, JSON.stringify(plugin));
		assert.equal(run.pwned, false);
		assert.match(run.stdout, /^::error::The plugin input must be/m);
	}
});

test('publish: release asset reuse passes the inputs as data', () => {
	for (const exit of ['0', '1']) {
		const run = runStep(
			'publish-to-svn',
			'Try to reuse pre-built release artifact',
			{ PLUGIN: 'fair-events', VERSION: '1.2.3', STUB_EXIT: exit },
			{ stubs: ['gh'] }
		);
		assert.equal(run.status, 0, run.stderr);
		assert.deepEqual(run.calls, [
			[
				'gh',
				'release',
				'download',
				'build-1.2.3',
				'--repo',
				'example/repo',
				'--pattern',
				'fair-events.1.2.3.zip',
				'--dir',
				'dist',
			],
		]);
		assert.equal(
			outputsOf(run.outputs).reuse,
			exit === '0' ? 'true' : 'false'
		);
	}
});

test('publish: later steps quote every input even past validation', () => {
	const value = HOSTILE[0];
	const cases = [
		['Build plugin assets', ['npm', 'run', 'build', '-w', value]],
		[
			'Checkout WordPress.org SVN repo',
			['npm', 'run', 'svn:checkout', '-w', value],
		],
		[
			'Create SVN tag from dist archive',
			['npm', 'run', `svn:tag:${value}`],
		],
		['Refresh trunk and assets', ['npm', 'run', 'svn:copy', '-w', value]],
	];
	for (const [step, expected] of cases) {
		const run = runStep(
			'publish-to-svn',
			step,
			{ PLUGIN: value, VERSION: value },
			{ stubs: ['npm'] }
		);
		assert.equal(run.pwned, false, step);
		assert.deepEqual(run.calls, [expected], step);
	}
	const stage = runStep(
		'publish-to-svn',
		'Stage SVN changes',
		{ PLUGIN: value, VERSION: value },
		{ stubs: ['svn'] }
	);
	assert.equal(stage.pwned, false);
	assert.deepEqual(stage.calls[0], [
		'svn',
		'add',
		'--force',
		'trunk',
		'assets',
		`tags/${value}`,
	]);
	const commit = runStep(
		'publish-to-svn',
		'Commit to WordPress.org SVN',
		{ PLUGIN: value, VERSION: value, SVN_USER: 'u', SVN_PASS: 'p' },
		{ stubs: ['svn'] }
	);
	assert.equal(commit.pwned, false);
	assert.equal(commit.calls[0][3], `Release ${value} ${value}`);
});

test('publish: dry run stays the default and gates the SVN commit', () => {
	const text = workflowText('publish-to-svn');
	assert.match(
		text,
		/dry_run:\n\s+description: .+\n\s+required: true\n\s+type: boolean\n\s+default: true/
	);
	assert.match(
		stepText('publish-to-svn', 'Commit to WordPress.org SVN'),
		/if: \$\{\{ inputs\.dry_run == false \}\}/
	);
	const commits = runBlocks(text.split('\n')).filter((script) =>
		/^\s*svn ci\b/m.test(script)
	);
	assert.deepEqual(
		commits,
		[stepScript('publish-to-svn', 'Commit to WordPress.org SVN')],
		'only the dry-run-gated step runs svn ci'
	);
});

// --- Release deployment -----------------------------------------------------

const RESOLVE = 'Resolve release tag and version type';

test('deploy: the resolve step reads both tags from the environment', () => {
	const text = stepText('deploy-from-release', RESOLVE);
	assert.match(
		text,
		/RELEASE_EVENT_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/
	);
	assert.match(text, /DISPATCH_TAG: \$\{\{ inputs\.release_tag \}\}/);
});

test('deploy: clean and commit-suffixed build tags resolve', () => {
	const cases = [
		['release', 'build-1.2.3', 'true'],
		['release', 'build-1.2.3-4-gabc1234', 'false'],
		['workflow_dispatch', 'build-10.0.0', 'true'],
		['workflow_dispatch', 'build-1.2.3-12-g0f9e8d7c', 'false'],
	];
	for (const [event, tag, clean] of cases) {
		const env =
			event === 'release'
				? {
						EVENT_NAME: event,
						RELEASE_EVENT_TAG: tag,
						DISPATCH_TAG: '',
					}
				: {
						EVENT_NAME: event,
						RELEASE_EVENT_TAG: '',
						DISPATCH_TAG: tag,
					};
		const run = runStep('deploy-from-release', RESOLVE, env);
		assert.equal(run.status, 0, run.stdout);
		assert.deepEqual(outputsOf(run.outputs), {
			release_tag: tag,
			is_clean_version: clean,
		});
	}
});

test('deploy: an unrelated published release deploys nothing', () => {
	for (const tag of ['fair-events@1.2.3', 'v1.0.0', ...HOSTILE]) {
		const run = runStep('deploy-from-release', RESOLVE, {
			EVENT_NAME: 'release',
			RELEASE_EVENT_TAG: tag,
			DISPATCH_TAG: '',
		});
		assert.equal(run.status, 0, JSON.stringify(tag));
		assert.equal(run.pwned, false);
		assert.deepEqual(outputsOf(run.outputs), { is_clean_version: 'false' });
	}
});

test('deploy: invalid manual tags fail before writing any output', () => {
	const bad = [
		...HOSTILE.map((value) => `build-1.2.3${value}`),
		'build-1.2.3\nis_clean_version=true',
		'build-1.2.3-4-gXYZ',
		'build-1.2',
		'1.2.3',
		'',
	];
	for (const tag of bad) {
		const run = runStep('deploy-from-release', RESOLVE, {
			EVENT_NAME: 'workflow_dispatch',
			RELEASE_EVENT_TAG: '',
			DISPATCH_TAG: tag,
		});
		assert.equal(run.status, 1, JSON.stringify(tag));
		assert.equal(run.pwned, false);
		assert.equal(run.outputs, '');
		assert.match(run.stdout, /^::error::The release_tag input must be/m);
	}
});

test('deploy: the auto-deploy gate keeps its decisions', () => {
	const cases = [
		[{ IS_MANUAL_DEPLOY: 'true', IS_CLEAN_VERSION: 'false' }, 'true'],
		[{ IS_MANUAL_DEPLOY: 'false', IS_CLEAN_VERSION: 'true' }, 'false'],
		[
			{
				IS_MANUAL_DEPLOY: 'false',
				IS_CLEAN_VERSION: 'true',
				AUTO_DEPLOY_ON_RELEASE: 'true',
			},
			'true',
		],
	];
	for (const [env, expected] of cases) {
		const run = runStep(
			'deploy-to-environment',
			'Check AUTO_DEPLOY_ON_RELEASE',
			{
				TARGET_ENVIRONMENT: `site ${HOSTILE[0]}`,
				...env,
			}
		);
		assert.equal(run.status, 0);
		assert.equal(run.pwned, false);
		assert.deepEqual(outputsOf(run.outputs), { should_deploy: expected });
	}
});

test('deploy: the reusable workflow downloads only valid build tags', () => {
	const good = runStep(
		'deploy-to-environment',
		'Download release assets',
		{ RELEASE_TAG: 'build-1.2.3-4-gabc1234' },
		{ stubs: ['gh'] }
	);
	assert.equal(good.status, 0, good.stderr);
	assert.deepEqual(good.calls, [
		[
			'gh',
			'release',
			'download',
			'build-1.2.3-4-gabc1234',
			'--repo',
			'example/repo',
			'--pattern',
			'*.zip',
			'--dir',
			'./dist',
		],
	]);
	for (const value of HOSTILE) {
		const run = runStep(
			'deploy-to-environment',
			'Download release assets',
			{ RELEASE_TAG: `build-1.2.3${value}` },
			{ stubs: ['gh'] }
		);
		assert.equal(run.status, 1, value);
		assert.equal(run.pwned, false);
		assert.deepEqual(run.calls, []);
	}
});

test('deploy: the remote reactivation command quotes each value', () => {
	// The ssh stub runs the remote command in a local shell, the way the
	// server would, with a stub `wp`.
	const dir = mkdtempSync(join(tmpdir(), 'workflow-remote-'));
	try {
		const site = join(dir, `site ${HOSTILE[0]}`);
		mkdirSync(join(site, 'wp-content', 'plugins'), { recursive: true });
		const wpBin = join(dir, 'wp-bin');
		mkdirSync(wpBin);
		const wpLog = join(dir, 'wp-log');
		writeFileSync(
			join(wpBin, 'wp'),
			`#!/bin/bash\nprintf '%s|%s\\n' "$PWD" "$*" >> "${wpLog}"\n`
		);
		chmodSync(join(wpBin, 'wp'), 0o755);
		const ssh = `#!/bin/bash
cd "${dir}"
PATH="${wpBin}:$PATH" bash -c "\${@: -1}"
`;
		const run = runStep(
			'deploy-to-environment',
			'Reactivate plugins via WP-CLI',
			{
				DEPLOYED_PLUGINS: ' fair-events fair-audience',
				SSH_PORT: '22',
				SSH_USER: 'deploy',
				SSH_HOST: 'example.test',
				WORDPRESS_PLUGINS_PATH: join(site, 'wp-content', 'plugins'),
			},
			{ ssh }
		);
		assert.equal(run.status, 0, run.stderr);
		assert.equal(existsSync(join(dir, MARKER)), false);
		const calls = readFileSync(wpLog, 'utf8').trim().split('\n');
		assert.equal(calls.length, 4);
		for (const call of calls) {
			assert.ok(call.startsWith(`${site}|plugin `), call);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('deploy: known hosts are written verbatim', () => {
	const value = `example.test ssh-ed25519 AAAA ${HOSTILE[0]}`;
	const text = stepScript('deploy-to-environment', 'Add SSH host key');
	assert.match(text, /printf '%s\\n' "\$SSH_KNOWN_HOSTS"/);
	const run = runStep('deploy-to-environment', 'Add SSH host key', {
		SSH_KNOWN_HOSTS: value,
	});
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.pwned, false);
});
