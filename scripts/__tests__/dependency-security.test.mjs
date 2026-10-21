import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	applyExceptions,
	checkPolicy,
	collectDirectDependencies,
	discoverDependencySets,
	listTrackedFiles,
	loadPolicy,
	npmIdentity,
	parseComposerAudit,
	parseNpmAudit,
	parsePolicy,
	seedPolicy,
} from '../dependency-security.mjs';

const TODAY = '2026-10-21';

function withRepo(files, callback) {
	const root = mkdtempSync(path.join(tmpdir(), 'dependency-security-'));
	try {
		for (const [relative, contents] of Object.entries(files)) {
			const full = path.join(root, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(
				full,
				typeof contents === 'string'
					? contents
					: JSON.stringify(contents)
			);
		}
		callback(root, Object.keys(files));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const MONOREPO = {
	'package.json': {
		workspaces: ['plugin-a', 'shared'],
		devDependencies: { '@wordpress/scripts': '^30.0.0' },
	},
	'package-lock.json': {},
	'plugin-a/package.json': {
		name: 'plugin-a',
		dependencies: { shared: '*', lodash: '^4.17.0' },
	},
	'shared/package.json': { name: 'shared' },
	'plugin-a/composer.json': {
		require: {
			php: '^8.0',
			'ext-json': '*',
			'mollie/mollie-api-php': '^3',
		},
		'require-dev': { 'phpunit/phpunit': '^13' },
	},
	'plugin-a/composer.lock': { packages: [], 'packages-dev': [] },
	'shared/php/composer.json': { name: 'fair/shared', require: { php: '^8' } },
	'plugin-b/composer.json': {
		repositories: [{ type: 'path', url: '../shared/php' }],
		require: { php: '^8.0', 'fair/shared': '^0.2' },
	},
	'tools/php-tests/composer.json': {
		require: { 'phpunit/phpunit': '^13' },
	},
	'tools/php-tests/composer.lock': { packages: [], 'packages-dev': [] },
};

function npmReport(vulnerabilities) {
	return JSON.stringify({
		vulnerabilities,
		metadata: { vulnerabilities: { total: 0 } },
	});
}

const NPM_VULNERABLE = npmReport({
	braces: {
		name: 'braces',
		severity: 'high',
		via: [
			{
				source: 1098094,
				name: 'braces',
				title: 'Uncontrolled resource consumption',
				url: 'https://github.com/advisories/GHSA-grv7-fg5c-xmjg',
				severity: 'high',
				range: '<3.0.3',
			},
		],
	},
	micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
});

const COMPOSER_VULNERABLE = JSON.stringify({
	advisories: {
		'guzzlehttp/guzzle': [
			{
				advisoryId: 'PKSA-1234',
				packageName: 'guzzlehttp/guzzle',
				affectedVersions: '<7.4.5',
				title: 'Cookie leak',
				cve: 'CVE-2022-31090',
				severity: 'medium',
				sources: [{ name: 'GitHub', remoteId: 'GHSA-25mq-v84q-4j7r' }],
			},
		],
	},
	abandoned: [],
});

const EXCEPTION = {
	advisory: 'GHSA-grv7-fg5c-xmjg',
	package: 'braces',
	dependencySet: 'package-lock.json',
	rationale: 'Build-time only; fixed upstream next release.',
	owner: '@marcin-wosinek',
	issue: '#1811',
	expires: '2026-12-31',
};

test('audits the root lockfile for workspaces and every Composer lockfile', () => {
	withRepo(MONOREPO, (root, files) => {
		assert.deepEqual(discoverDependencySets(root, files), {
			npm: ['package-lock.json'],
			composer: [
				'plugin-a/composer.lock',
				'tools/php-tests/composer.lock',
			],
			errors: [],
		});
	});
});

test('discovers newly added dependency sets without configuration', () => {
	withRepo(
		{
			...MONOREPO,
			'website/package.json': { dependencies: { astro: '^5' } },
			'website/package-lock.json': {},
			'website/composer.json': { require: { 'vendor/lib': '^1' } },
			'website/composer.lock': { packages: [] },
		},
		(root, files) => {
			const sets = discoverDependencySets(root, files);
			assert.deepEqual(sets.npm, [
				'package-lock.json',
				'website/package-lock.json',
			]);
			assert.ok(sets.composer.includes('website/composer.lock'));
			assert.deepEqual(sets.errors, []);
		}
	);
});

test('reports manifests whose dependencies no lockfile covers', () => {
	const files = { ...MONOREPO };
	delete files['plugin-a/composer.lock'];
	files['website/package.json'] = { dependencies: { astro: '^5' } };
	files['docs/yarn.lock'] = '';
	withRepo(files, (root, tracked) => {
		assert.deepEqual(discoverDependencySets(root, tracked).errors, [
			'docs/yarn.lock: unsupported lockfile; only package-lock.json and composer.lock are audited.',
			'plugin-a/composer.json: requires mollie/mollie-api-php, phpunit/phpunit without a tracked composer.lock.',
			'website/package.json: dependencies without a tracked package-lock.json.',
		]);
	});
});

test('requires the root lockfile for workspace dependencies', () => {
	const files = { ...MONOREPO };
	delete files['package-lock.json'];
	withRepo(files, (root, tracked) => {
		assert.deepEqual(
			discoverDependencySets(root, tracked).errors.filter((error) =>
				error.includes('root package-lock.json')
			),
			[
				'plugin-a/package.json: workspace dependencies need the root package-lock.json.',
				'shared/package.json: workspace dependencies need the root package-lock.json.',
			]
		);
	});
});

test('rejects Composer audit ignores in manifests', () => {
	withRepo(
		{
			...MONOREPO,
			'tools/php-tests/composer.json': {
				require: { 'phpunit/phpunit': '^13' },
				config: { audit: { ignore: ['CVE-2022-31090'] } },
			},
		},
		(root, files) => {
			assert.deepEqual(discoverDependencySets(root, files).errors, [
				'tools/php-tests/composer.json: config.audit.ignore would hide findings; use a policy exception instead.',
			]);
		}
	);
});

test('identifies internal, aliased and non-registry npm dependencies', () => {
	const workspaces = new Set(['shared']);
	assert.equal(npmIdentity('lodash', '^4.17.0', workspaces), 'lodash');
	assert.equal(npmIdentity('shared', '*', workspaces), 'workspace:shared');
	assert.equal(
		npmIdentity('lodash', 'npm:evil-lodash@^1.0.0', workspaces),
		'lodash@npm:evil-lodash'
	);
	assert.equal(
		npmIdentity('scoped', 'npm:@evil/pkg@2', workspaces),
		'scoped@npm:@evil/pkg'
	);
	assert.equal(
		npmIdentity('shared', 'github:evil/shared#main', workspaces),
		'shared@github:evil/shared'
	);
	assert.equal(
		npmIdentity('lodash', 'evil/lodash#v1', workspaces),
		'lodash@evil/lodash'
	);
	assert.equal(
		npmIdentity('local', 'file:../local', workspaces),
		'local@file:../local'
	);
});

test('collects direct npm and Composer dependencies with their identities', () => {
	withRepo(MONOREPO, (root, files) => {
		const policy = seedPolicy(collectDirectDependencies(root, files));
		assert.deepEqual(policy, {
			npm: {
				'package.json': ['@wordpress/scripts'],
				'plugin-a/package.json': ['lodash', 'workspace:shared'],
			},
			composer: {
				'plugin-a/composer.json': [
					'mollie/mollie-api-php',
					'phpunit/phpunit',
				],
				'plugin-b/composer.json': [
					'path:fair/shared',
					'repository:path:../shared/php',
				],
				'tools/php-tests/composer.json': ['phpunit/phpunit'],
			},
			exceptions: [],
		});
	});
});

test('approved dependencies and version updates pass the policy', () => {
	withRepo(MONOREPO, (root, files) => {
		const policy = seedPolicy(collectDirectDependencies(root, files));
		writeFileSync(
			path.join(root, 'plugin-a/package.json'),
			JSON.stringify({
				name: 'plugin-a',
				dependencies: { shared: '*', lodash: '^5.0.0' },
			})
		);
		assert.deepEqual(
			checkPolicy(collectDirectDependencies(root, files), policy),
			[]
		);
	});
});

test('unapproved packages, aliases and sources fail the policy', () => {
	withRepo(MONOREPO, (root, files) => {
		const policy = seedPolicy(collectDirectDependencies(root, files));
		writeFileSync(
			path.join(root, 'plugin-a/package.json'),
			JSON.stringify({
				name: 'plugin-a',
				dependencies: {
					shared: 'github:evil/shared',
					lodash: 'npm:evil-lodash@1',
				},
				devDependencies: { 'left-pad': '^1.3.0' },
			})
		);
		writeFileSync(
			path.join(root, 'plugin-b/composer.json'),
			JSON.stringify({
				repositories: [
					{ type: 'path', url: '../shared/php' },
					{ type: 'vcs', url: 'https://github.com/evil/repo' },
				],
				require: { 'fair/shared': '^0.2' },
			})
		);
		assert.deepEqual(
			checkPolicy(collectDirectDependencies(root, files), policy),
			[
				'plugin-a/package.json: npm dependency "shared@github:evil/shared" is not approved in the base branch\'s .github/dependency-policy.json.',
				'plugin-a/package.json: npm dependency "lodash@npm:evil-lodash" is not approved in the base branch\'s .github/dependency-policy.json.',
				'plugin-a/package.json: npm dependency "left-pad" is not approved in the base branch\'s .github/dependency-policy.json.',
				'plugin-b/composer.json: composer dependency "repository:vcs:https://github.com/evil/repo" is not approved in the base branch\'s .github/dependency-policy.json.',
			]
		);
	});
});

test('a manifest the base policy has never seen fails the policy', () => {
	withRepo(
		{
			...MONOREPO,
			'website/package.json': { dependencies: { astro: '^5' } },
		},
		(root, files) => {
			const base = files.filter((file) => !file.startsWith('website/'));
			const policy = seedPolicy(collectDirectDependencies(root, base));
			assert.deepEqual(
				checkPolicy(collectDirectDependencies(root, files), policy),
				[
					'website/package.json: npm dependency "astro" is not approved in the base branch\'s .github/dependency-policy.json.',
				]
			);
		}
	);
});

test('a policy edit in the pull request cannot approve its own addition', () => {
	withRepo(MONOREPO, (root, files) => {
		const base = seedPolicy(collectDirectDependencies(root, files));
		mkdirSync(path.join(root, 'base/.github'), { recursive: true });
		writeFileSync(
			path.join(root, 'base/.github/dependency-policy.json'),
			JSON.stringify(base)
		);
		// The pull request adds a package and approves it in its own copy.
		writeFileSync(
			path.join(root, 'package.json'),
			JSON.stringify({
				...MONOREPO['package.json'],
				devDependencies: { '@wordpress/scripts': '^30', evil: '^1' },
			})
		);
		const head = seedPolicy(collectDirectDependencies(root, files));
		mkdirSync(path.join(root, '.github'), { recursive: true });
		writeFileSync(
			path.join(root, '.github/dependency-policy.json'),
			JSON.stringify(head)
		);
		const { policy } = loadPolicy(
			path.join(root, 'base/.github/dependency-policy.json'),
			TODAY
		);
		assert.deepEqual(
			checkPolicy(collectDirectDependencies(root, files), policy),
			[
				'package.json: npm dependency "evil" is not approved in the base branch\'s .github/dependency-policy.json.',
			]
		);
	});
});

test('a missing base policy fails the policy check but not audits', () => {
	const missing = path.join(tmpdir(), 'no-such-dependency-policy.json');
	assert.equal(loadPolicy(missing, TODAY).policy, null);
	assert.match(loadPolicy(missing, TODAY).errors[0], /not found/);
	assert.deepEqual(loadPolicy(missing, TODAY, true), {
		policy: { npm: {}, composer: {}, exceptions: [] },
		errors: [],
	});
});

test('rejects malformed policies', () => {
	assert.deepEqual(parsePolicy('{', TODAY).errors.length, 1);
	assert.deepEqual(
		parsePolicy(JSON.stringify({ npm: [], composer: {} }), TODAY).errors,
		[
			'.github/dependency-policy.json: "npm" must map manifest paths to package lists.',
			'.github/dependency-policy.json: "exceptions" must be an array.',
		]
	);
	assert.deepEqual(
		parsePolicy(
			JSON.stringify({
				npm: { 'package.json': [1] },
				composer: {},
				exceptions: [],
			}),
			TODAY
		).errors,
		[
			'.github/dependency-policy.json: npm "package.json" must list package names as strings.',
		]
	);
});

test('rejects incomplete and expired exceptions', () => {
	const policy = (exceptions) =>
		JSON.stringify({ npm: {}, composer: {}, exceptions });
	assert.deepEqual(parsePolicy(policy([EXCEPTION]), TODAY).errors, []);
	assert.deepEqual(
		parsePolicy(
			policy([{ ...EXCEPTION, owner: '', expires: 'soon' }]),
			TODAY
		).errors,
		[
			'.github/dependency-policy.json: exceptions[0] needs a non-empty "owner".',
			'.github/dependency-policy.json: exceptions[0] "expires" must be a YYYY-MM-DD date.',
		]
	);
	assert.deepEqual(
		parsePolicy(policy([{ ...EXCEPTION, expires: '2026-10-20' }]), TODAY)
			.errors,
		[
			'.github/dependency-policy.json: exceptions[0] (GHSA-grv7-fg5c-xmjg in braces) expired on 2026-10-20.',
		]
	);
});

test('a clean npm report passes', () => {
	assert.deepEqual(parseNpmAudit(npmReport({}), 0, 'package-lock.json'), {
		findings: [],
	});
});

test('reports each npm advisory once, including transitive development packages', () => {
	const { findings, error } = parseNpmAudit(
		NPM_VULNERABLE,
		1,
		'package-lock.json'
	);
	assert.equal(error, undefined);
	assert.deepEqual(
		findings.map(({ package: name, advisory, severity }) => [
			name,
			advisory,
			severity,
		]),
		[['braces', 'GHSA-grv7-fg5c-xmjg', 'high']]
	);
});

test('npm audit errors and unavailable advisory data fail', () => {
	const lockfile = 'package-lock.json';
	assert.match(
		parseNpmAudit(
			JSON.stringify({
				error: {
					code: 'ENOAUDIT',
					summary: 'Audit endpoint returned 503',
				},
			}),
			1,
			lockfile
		).error,
		/Audit endpoint returned 503/
	);
	assert.match(
		parseNpmAudit(
			JSON.stringify({
				message: 'request to registry failed, reason: ECONNREFUSED',
				error: { summary: '', detail: '' },
			}),
			1,
			lockfile
		).error,
		/ECONNREFUSED/
	);
	assert.match(
		parseNpmAudit('npm ERR! network', 1, lockfile).error,
		/not JSON/
	);
	assert.match(parseNpmAudit('', 1, lockfile).error, /empty output/);
	assert.match(
		parseNpmAudit(JSON.stringify({ auditReportVersion: 2 }), 0, lockfile)
			.error,
		/no vulnerability data/
	);
	assert.match(
		parseNpmAudit(npmReport({}), 1, lockfile).error,
		/exited with 1/
	);
});

test('a clean Composer report passes', () => {
	assert.deepEqual(
		parseComposerAudit(
			JSON.stringify({ advisories: [], abandoned: [] }),
			0,
			'composer.lock'
		),
		{ findings: [] }
	);
});

test('reports Composer advisories with every identifier', () => {
	const { findings, error } = parseComposerAudit(
		COMPOSER_VULNERABLE,
		1,
		'composer.lock'
	);
	assert.equal(error, undefined);
	assert.deepEqual(findings[0].identifiers, [
		'PKSA-1234',
		'CVE-2022-31090',
		'GHSA-25mq-v84q-4j7r',
	]);
	assert.equal(findings[0].advisory, 'GHSA-25mq-v84q-4j7r');
});

test('Composer errors and unavailable advisory data fail', () => {
	assert.match(
		parseComposerAudit('', 100, 'composer.lock').error,
		/empty output/
	);
	assert.match(
		parseComposerAudit(
			'The "https://packagist.org/api/security-advisories/" file could not be downloaded',
			1,
			'composer.lock'
		).error,
		/not JSON/
	);
	assert.match(
		parseComposerAudit(
			JSON.stringify({ abandoned: [] }),
			0,
			'composer.lock'
		).error,
		/no advisory data/
	);
	assert.match(
		parseComposerAudit(
			JSON.stringify({ advisories: [] }),
			1,
			'composer.lock'
		).error,
		/exited with 1/
	);
});

test('exceptions only cover their exact advisory, package and dependency set', () => {
	const { findings } = parseNpmAudit(NPM_VULNERABLE, 1, 'package-lock.json');
	assert.deepEqual(applyExceptions(findings, [EXCEPTION]).blocking, []);
	for (const mismatch of [
		{ advisory: 'GHSA-xxxx-xxxx-xxxx' },
		{ package: 'micromatch' },
		{ dependencySet: 'website/package-lock.json' },
	]) {
		const result = applyExceptions(findings, [
			{ ...EXCEPTION, ...mismatch },
		]);
		assert.equal(result.blocking.length, 1);
		assert.equal(result.unused.length, 1);
	}
	const composer = parseComposerAudit(
		COMPOSER_VULNERABLE,
		1,
		'composer.lock'
	).findings;
	assert.deepEqual(
		applyExceptions(composer, [
			{
				...EXCEPTION,
				advisory: 'CVE-2022-31090',
				package: 'guzzlehttp/guzzle',
				dependencySet: 'composer.lock',
			},
		]).blocking,
		[]
	);
});

test('the repository policy approves every current direct dependency', () => {
	const root = path.resolve(import.meta.dirname, '../..');
	const files = listTrackedFiles(root);
	const { policy, errors } = loadPolicy(
		path.join(root, '.github/dependency-policy.json'),
		TODAY
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(discoverDependencySets(root, files).errors, []);
	assert.deepEqual(
		checkPolicy(collectDirectDependencies(root, files), policy),
		[]
	);
});
