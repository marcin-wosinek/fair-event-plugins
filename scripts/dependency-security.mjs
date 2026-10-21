#!/usr/bin/env node

/**
 * Dependency security checks for every maintained dependency set
 * (DEPENDENCY_SECURITY.md).
 *
 * Commands:
 * - `audit-npm`: `npm audit` against every tracked package-lock.json.
 * - `audit-composer`: `composer audit --locked` against every tracked
 *   composer.lock.
 * - `policy`: every direct dependency in a tracked manifest must be listed
 *   in the dependency policy.
 * - `seed-policy`: rewrite the policy to approve the current direct
 *   dependencies (keeps existing exceptions).
 *
 * `--policy-file <path>` reads the policy from somewhere other than
 * `.github/dependency-policy.json`. CI passes the base branch's copy, so a
 * pull request can't approve its own additions or vulnerability exceptions.
 *
 * Dependency sets are discovered from `git ls-files`, so a newly committed
 * lockfile is audited without editing this script. Audits include
 * development dependencies, never install anything, and treat command
 * errors, unparsable reports and unreachable advisory services as failures.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLICY_PATH = '.github/dependency-policy.json';

const NPM_DEPENDENCY_SECTIONS = [
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies',
];

const COMPOSER_DEPENDENCY_SECTIONS = ['require', 'require-dev'];

const UNSUPPORTED_LOCKFILES = new Set([
	'yarn.lock',
	'pnpm-lock.yaml',
	'npm-shrinkwrap.json',
]);

const EXCEPTION_FIELDS = [
	'advisory',
	'package',
	'dependencySet',
	'rationale',
	'owner',
	'issue',
	'expires',
];

/**
 * Tracked files, as repository-relative POSIX paths.
 *
 * @param {string} root Repository root.
 * @return {string[]} Paths.
 */
export function listTrackedFiles(root) {
	return execFileSync('git', ['ls-files', '-z'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\0')
		.filter(Boolean);
}

function readJson(root, relative) {
	return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
}

function directoryOf(relative) {
	const directory = path.posix.dirname(relative);
	return directory === '.' ? '' : directory;
}

function siblingPath(relative, name) {
	const directory = directoryOf(relative);
	return directory ? `${directory}/${name}` : name;
}

/**
 * Composer requirements that aren't packages (PHP, extensions, libraries).
 *
 * @param {string} name Requirement name.
 * @return {boolean} Whether it is a platform requirement.
 */
export function isComposerPlatformPackage(name) {
	return (
		/^(php|php-64bit|php-ipv6|php-zts|php-debug|hhvm|composer|composer-plugin-api|composer-runtime-api)$/.test(
			name
		) || /^(ext|lib)-/.test(name)
	);
}

/**
 * Workspace directories declared by a root package.json. Supports literal
 * directories and a trailing `/*`.
 *
 * @param {Object}   manifest Root package.json.
 * @param {string[]} files    Tracked files.
 * @return {Set<string>} Workspace directories.
 */
function npmWorkspaceDirectories(manifest, files) {
	const patterns = Array.isArray(manifest.workspaces)
		? manifest.workspaces
		: (manifest.workspaces?.packages ?? []);
	const directories = new Set();
	for (const pattern of patterns) {
		const clean = pattern.replace(/\/$/, '');
		if (clean.endsWith('/*')) {
			const parent = clean.slice(0, -2);
			for (const file of files) {
				if (
					file.startsWith(`${parent}/`) &&
					file.split('/').length === parent.split('/').length + 2 &&
					file.endsWith('/package.json')
				) {
					directories.add(directoryOf(file));
				}
			}
		} else {
			directories.add(clean);
		}
	}
	return directories;
}

/**
 * Packages a composer.json gets from `path` repositories inside the
 * repository, keyed by package name.
 *
 * @param {string} root     Repository root.
 * @param {string} relative composer.json path.
 * @param {Object} manifest Parsed composer.json.
 * @return {Set<string>} Package names.
 */
function composerPathPackages(root, relative, manifest) {
	const names = new Set();
	for (const repository of composerRepositories(manifest)) {
		if (repository.type !== 'path' || typeof repository.url !== 'string') {
			continue;
		}
		const target = path.posix.normalize(
			path.posix.join(directoryOf(relative) || '.', repository.url)
		);
		if (target.startsWith('..') || target.includes('*')) {
			continue;
		}
		const targetManifest = path.join(root, target, 'composer.json');
		if (existsSync(targetManifest)) {
			const { name } = JSON.parse(readFileSync(targetManifest, 'utf8'));
			if (name) {
				names.add(name);
			}
		}
	}
	return names;
}

function composerRepositories(manifest) {
	const repositories = manifest.repositories ?? [];
	return Array.isArray(repositories)
		? repositories
		: Object.entries(repositories).map(([key, value]) =>
				value === false
					? { type: 'disabled', url: key }
					: { ...value, url: value.url ?? key }
			);
}

/**
 * Identity of an npm dependency for the policy. Version-range changes keep
 * the identity; changing where the package comes from does not.
 *
 * @param {string}      name           Declared name.
 * @param {string}      spec           Version spec.
 * @param {Set<string>} workspaceNames Names of the root's workspaces.
 * @return {string} Identity.
 */
export function npmIdentity(name, spec, workspaceNames) {
	const value = String(spec).trim();
	if (value.startsWith('npm:')) {
		const target = value.slice(4).replace(/(.)@.*$/, '$1');
		return `${name}@npm:${target}`;
	}
	if (
		/^(file|link|git|git\+[a-z]+|https?|github|gitlab|bitbucket|gist):/.test(
			value
		) ||
		/^[^@./\s][^\s:]*\/[^\s]+$/.test(value)
	) {
		if (value.startsWith('file:') || value.startsWith('link:')) {
			return `${name}@${value}`;
		}
		return `${name}@${value.replace(/#.*$/, '')}`;
	}
	if (workspaceNames.has(name)) {
		return `workspace:${name}`;
	}
	return name;
}

/**
 * Every direct dependency in tracked manifests, with its policy identity.
 *
 * @param {string}   root  Repository root.
 * @param {string[]} files Tracked files.
 * @return {{ecosystem: string, manifest: string, identity: string}[]} Dependencies.
 */
export function collectDirectDependencies(root, files) {
	const dependencies = [];
	const workspaceNames = new Set();
	if (files.includes('package.json')) {
		for (const directory of npmWorkspaceDirectories(
			readJson(root, 'package.json'),
			files
		)) {
			const manifest = `${directory}/package.json`;
			if (files.includes(manifest)) {
				const { name } = readJson(root, manifest);
				if (name) {
					workspaceNames.add(name);
				}
			}
		}
	}
	for (const file of files) {
		const base = path.posix.basename(file);
		if (base === 'package.json') {
			const manifest = readJson(root, file);
			for (const section of NPM_DEPENDENCY_SECTIONS) {
				for (const [name, spec] of Object.entries(
					manifest[section] ?? {}
				)) {
					dependencies.push({
						ecosystem: 'npm',
						manifest: file,
						identity: npmIdentity(name, spec, workspaceNames),
					});
				}
			}
		} else if (base === 'composer.json') {
			const manifest = readJson(root, file);
			const pathPackages = composerPathPackages(root, file, manifest);
			for (const repository of composerRepositories(manifest)) {
				dependencies.push({
					ecosystem: 'composer',
					manifest: file,
					identity: `repository:${repository.type}:${repository.url}`,
				});
			}
			for (const section of COMPOSER_DEPENDENCY_SECTIONS) {
				for (const name of Object.keys(manifest[section] ?? {})) {
					if (isComposerPlatformPackage(name)) {
						continue;
					}
					dependencies.push({
						ecosystem: 'composer',
						manifest: file,
						identity: pathPackages.has(name)
							? `path:${name}`
							: name,
					});
				}
			}
		}
	}
	return dependencies;
}

/**
 * Lockfiles to audit, plus manifests whose dependencies no lockfile covers.
 *
 * @param {string}   root  Repository root.
 * @param {string[]} files Tracked files.
 * @return {{npm: string[], composer: string[], errors: string[]}} Sets.
 */
export function discoverDependencySets(root, files) {
	const tracked = new Set(files);
	const errors = [];
	const npm = files.filter(
		(file) => path.posix.basename(file) === 'package-lock.json'
	);
	const composer = files.filter(
		(file) => path.posix.basename(file) === 'composer.lock'
	);

	for (const file of files) {
		if (UNSUPPORTED_LOCKFILES.has(path.posix.basename(file))) {
			errors.push(
				`${file}: unsupported lockfile; only package-lock.json and composer.lock are audited.`
			);
		}
	}

	const workspaces = tracked.has('package.json')
		? npmWorkspaceDirectories(readJson(root, 'package.json'), files)
		: new Set();
	for (const directory of workspaces) {
		if (!tracked.has(`${directory}/package.json`)) {
			errors.push(
				`package.json: workspace "${directory}" has no tracked package.json.`
			);
		}
	}

	for (const file of files) {
		const base = path.posix.basename(file);
		if (base === 'package.json') {
			if (workspaces.has(directoryOf(file))) {
				if (!tracked.has('package-lock.json')) {
					errors.push(
						`${file}: workspace dependencies need the root package-lock.json.`
					);
				}
				continue;
			}
			const manifest = readJson(root, file);
			const hasDependencies = NPM_DEPENDENCY_SECTIONS.some(
				(section) => Object.keys(manifest[section] ?? {}).length > 0
			);
			if (
				hasDependencies &&
				!tracked.has(siblingPath(file, 'package-lock.json'))
			) {
				errors.push(
					`${file}: dependencies without a tracked package-lock.json.`
				);
			}
		} else if (base === 'composer.json') {
			const manifest = readJson(root, file);
			const pathPackages = composerPathPackages(root, file, manifest);
			const external = COMPOSER_DEPENDENCY_SECTIONS.flatMap((section) =>
				Object.keys(manifest[section] ?? {})
			).filter(
				(name) =>
					!isComposerPlatformPackage(name) && !pathPackages.has(name)
			);
			if (
				external.length > 0 &&
				!tracked.has(siblingPath(file, 'composer.lock'))
			) {
				errors.push(
					`${file}: requires ${external.join(', ')} without a tracked composer.lock.`
				);
			}
			const audit = manifest.config?.audit ?? {};
			for (const key of [
				'ignore',
				'ignore-severity',
				'ignore-abandoned',
			]) {
				const value = audit[key];
				if (
					value !== undefined &&
					!(Array.isArray(value) && value.length === 0) &&
					!(
						typeof value === 'object' &&
						value !== null &&
						Object.keys(value).length === 0
					)
				) {
					errors.push(
						`${file}: config.audit.${key} would hide findings; use a policy exception instead.`
					);
				}
			}
		}
	}

	return { npm, composer, errors };
}

function isDate(value) {
	return (
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		!Number.isNaN(Date.parse(`${value}T00:00:00Z`))
	);
}

/**
 * Parse and validate the dependency policy.
 *
 * @param {string} text  Policy JSON.
 * @param {string} today Current date, YYYY-MM-DD.
 * @param {string} label Policy file name for messages.
 * @return {{policy: Object|null, errors: string[]}} Result.
 */
export function parsePolicy(text, today, label = POLICY_PATH) {
	let policy;
	try {
		policy = JSON.parse(text);
	} catch (error) {
		return {
			policy: null,
			errors: [`${label}: invalid JSON: ${error.message}`],
		};
	}
	const errors = [];
	if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
		return { policy: null, errors: [`${label}: must be an object.`] };
	}
	for (const ecosystem of ['npm', 'composer']) {
		const manifests = policy[ecosystem];
		if (
			!manifests ||
			typeof manifests !== 'object' ||
			Array.isArray(manifests)
		) {
			errors.push(
				`${label}: "${ecosystem}" must map manifest paths to package lists.`
			);
			continue;
		}
		for (const [manifest, packages] of Object.entries(manifests)) {
			if (
				!Array.isArray(packages) ||
				packages.some((entry) => typeof entry !== 'string')
			) {
				errors.push(
					`${label}: ${ecosystem} "${manifest}" must list package names as strings.`
				);
			}
		}
	}
	if (!Array.isArray(policy.exceptions)) {
		errors.push(`${label}: "exceptions" must be an array.`);
	} else {
		policy.exceptions.forEach((exception, index) => {
			const where = `${label}: exceptions[${index}]`;
			if (!exception || typeof exception !== 'object') {
				errors.push(`${where} must be an object.`);
				return;
			}
			for (const field of EXCEPTION_FIELDS) {
				if (
					typeof exception[field] !== 'string' ||
					exception[field].trim() === ''
				) {
					errors.push(`${where} needs a non-empty "${field}".`);
				}
			}
			if (exception.expires !== undefined && !isDate(exception.expires)) {
				errors.push(`${where} "expires" must be a YYYY-MM-DD date.`);
			} else if (isDate(exception.expires) && exception.expires < today) {
				errors.push(
					`${where} (${exception.advisory} in ${exception.package}) expired on ${exception.expires}.`
				);
			}
		});
	}
	return { policy: errors.length === 0 ? policy : null, errors };
}

/**
 * Read the policy, or report why it can't be used.
 *
 * @param {string}  file     Policy path.
 * @param {string}  today    Current date, YYYY-MM-DD.
 * @param {boolean} optional Treat a missing file as "no exceptions".
 * @return {{policy: Object|null, errors: string[]}} Result.
 */
export function loadPolicy(file, today, optional = false) {
	if (!existsSync(file)) {
		if (optional) {
			return {
				policy: { npm: {}, composer: {}, exceptions: [] },
				errors: [],
			};
		}
		return {
			policy: null,
			errors: [
				`${file}: dependency policy not found. CI reads it from the base branch, so it must be merged before it can approve anything.`,
			],
		};
	}
	return parsePolicy(
		readFileSync(file, 'utf8'),
		today,
		path.relative(process.cwd(), file) || file
	);
}

/**
 * Direct dependencies the policy doesn't approve.
 *
 * @param {{ecosystem: string, manifest: string, identity: string}[]} dependencies Dependencies.
 * @param {Object} policy Parsed policy.
 * @return {string[]} Errors.
 */
export function checkPolicy(dependencies, policy) {
	const errors = [];
	for (const { ecosystem, manifest, identity } of dependencies) {
		const approved = policy[ecosystem]?.[manifest] ?? [];
		if (!approved.includes(identity)) {
			errors.push(
				`${manifest}: ${ecosystem} dependency "${identity}" is not approved in the base branch's ${POLICY_PATH}.`
			);
		}
	}
	return errors;
}

/**
 * Policy approving exactly the given dependencies.
 *
 * @param {{ecosystem: string, manifest: string, identity: string}[]} dependencies Dependencies.
 * @param {Object[]} exceptions Exceptions to keep.
 * @return {Object} Policy.
 */
export function seedPolicy(dependencies, exceptions = []) {
	const policy = { npm: {}, composer: {}, exceptions };
	for (const { ecosystem, manifest, identity } of dependencies) {
		const list = (policy[ecosystem][manifest] ??= []);
		if (!list.includes(identity)) {
			list.push(identity);
		}
	}
	for (const ecosystem of ['npm', 'composer']) {
		policy[ecosystem] = Object.fromEntries(
			Object.entries(policy[ecosystem])
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([manifest, list]) => [manifest, list.sort()])
		);
	}
	return policy;
}

function parseJsonReport(stdout, label) {
	try {
		return { report: JSON.parse(stdout) };
	} catch {
		const excerpt = String(stdout).trim().slice(0, 300);
		return {
			error: `${label}: audit output is not JSON${excerpt ? `: ${excerpt}` : ' (empty output)'}.`,
		};
	}
}

/**
 * Findings from `npm audit --json`. Only advisories are reported; packages
 * that are vulnerable through a dependency show up under that dependency.
 *
 * @param {string} stdout     Command output.
 * @param {number} exitCode   Command exit code.
 * @param {string} lockfile   Dependency set.
 * @return {{findings: Object[], error?: string}} Result.
 */
export function parseNpmAudit(stdout, exitCode, lockfile) {
	const { report, error } = parseJsonReport(stdout, lockfile);
	if (error) {
		return { findings: [], error };
	}
	if (report.error) {
		const detail =
			report.error.summary ||
			report.message ||
			report.error.code ||
			'unknown error';
		return {
			findings: [],
			error: `${lockfile}: npm audit failed: ${detail}.`,
		};
	}
	if (
		!report.vulnerabilities ||
		typeof report.metadata?.vulnerabilities !== 'object'
	) {
		return {
			findings: [],
			error: `${lockfile}: npm audit report has no vulnerability data.`,
		};
	}
	const findings = [];
	for (const entry of Object.values(report.vulnerabilities)) {
		for (const via of entry.via ?? []) {
			if (typeof via !== 'object' || via === null) {
				continue;
			}
			const url = via.url ?? '';
			findings.push({
				dependencySet: lockfile,
				package: via.name ?? entry.name,
				severity: via.severity ?? entry.severity,
				advisory: url.split('/').pop() || String(via.source),
				identifiers: [url.split('/').pop(), String(via.source)].filter(
					Boolean
				),
				title: via.title ?? '',
				range: via.range ?? '',
			});
		}
	}
	if (exitCode !== 0 && findings.length === 0) {
		return {
			findings,
			error: `${lockfile}: npm audit exited with ${exitCode} without reporting an advisory.`,
		};
	}
	if (exitCode === 0 && findings.length > 0) {
		return {
			findings,
			error: `${lockfile}: npm audit reported advisories but exited successfully.`,
		};
	}
	return { findings };
}

/**
 * Findings from `composer audit --format=json`.
 *
 * @param {string} stdout   Command output.
 * @param {number} exitCode Command exit code.
 * @param {string} lockfile Dependency set.
 * @return {{findings: Object[], error?: string}} Result.
 */
export function parseComposerAudit(stdout, exitCode, lockfile) {
	const { report, error } = parseJsonReport(stdout, lockfile);
	if (error) {
		return { findings: [], error };
	}
	if (!report || report.advisories === undefined) {
		return {
			findings: [],
			error: `${lockfile}: composer audit report has no advisory data.`,
		};
	}
	const groups = Array.isArray(report.advisories)
		? report.advisories
		: Object.values(report.advisories);
	const findings = groups.flat().map((advisory) => {
		const identifiers = [
			advisory.advisoryId,
			advisory.cve,
			...(advisory.sources ?? []).map((source) => source.remoteId),
		].filter(Boolean);
		return {
			dependencySet: lockfile,
			package: advisory.packageName,
			severity: advisory.severity ?? 'unknown',
			advisory:
				identifiers.find((id) => /^GHSA-/.test(id)) ??
				identifiers[0] ??
				'unknown',
			identifiers,
			title: advisory.title ?? '',
			range: advisory.affectedVersions ?? '',
		};
	});
	// Bit 1 = vulnerable packages; abandoned packages are reported only.
	if ((exitCode & ~3) !== 0 || (exitCode & 1 && findings.length === 0)) {
		return {
			findings,
			error: `${lockfile}: composer audit exited with ${exitCode}.`,
		};
	}
	return { findings };
}

/**
 * Split findings into blocking and excepted ones.
 *
 * @param {Object[]} findings   Findings.
 * @param {Object[]} exceptions Valid, unexpired policy exceptions.
 * @return {{blocking: Object[], excepted: Object[], unused: Object[]}} Result.
 */
export function applyExceptions(findings, exceptions) {
	const used = new Set();
	const blocking = [];
	const excepted = [];
	for (const finding of findings) {
		const match = exceptions.find(
			(exception) =>
				exception.dependencySet === finding.dependencySet &&
				exception.package === finding.package &&
				finding.identifiers.includes(exception.advisory)
		);
		if (match) {
			used.add(match);
			excepted.push(finding);
		} else {
			blocking.push(finding);
		}
	}
	return {
		blocking,
		excepted,
		unused: exceptions.filter((exception) => !used.has(exception)),
	};
}

function auditEnvironment() {
	const env = { ...process.env, npm_config_ignore_scripts: 'true' };
	delete env.COMPOSER_NO_DEV;
	delete env.NODE_ENV;
	delete env.npm_config_omit;
	delete env.npm_config_production;
	return env;
}

function runNpmAudit(root, lockfile) {
	const result = spawnSync(
		'npm',
		[
			'audit',
			'--package-lock-only',
			'--ignore-scripts',
			'--include=dev',
			'--include=optional',
			'--include=peer',
			'--audit-level=info',
			'--json',
		],
		{
			cwd: path.join(root, directoryOf(lockfile)),
			encoding: 'utf8',
			env: auditEnvironment(),
			maxBuffer: 64 * 1024 * 1024,
		}
	);
	if (result.error) {
		return {
			findings: [],
			error: `${lockfile}: ${result.error.message}`,
		};
	}
	return parseNpmAudit(result.stdout, result.status ?? 1, lockfile);
}

function runComposerAudit(root, lockfile) {
	const lock = readJson(root, lockfile);
	if (
		(lock.packages ?? []).length === 0 &&
		(lock['packages-dev'] ?? []).length === 0
	) {
		// Composer prints "No packages - skipping audit." instead of JSON.
		return { findings: [], empty: true };
	}
	const result = spawnSync(
		'composer',
		[
			'audit',
			'--locked',
			'--no-plugins',
			'--no-scripts',
			'--no-interaction',
			'--abandoned=report',
			'--format=json',
			`--working-dir=${path.join(root, directoryOf(lockfile))}`,
		],
		{
			encoding: 'utf8',
			env: auditEnvironment(),
			maxBuffer: 64 * 1024 * 1024,
		}
	);
	if (result.error) {
		return {
			findings: [],
			error: `${lockfile}: ${result.error.message}`,
		};
	}
	const parsed = parseComposerAudit(
		result.stdout,
		result.status ?? 1,
		lockfile
	);
	if (parsed.error && result.stderr.trim()) {
		parsed.error += `\n${result.stderr.trim()}`;
	}
	return parsed;
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function describe(finding) {
	return `  ${finding.severity.padEnd(8)} ${finding.package} ${finding.range} — ${finding.advisory} ${finding.title}`.trimEnd();
}

/**
 * Run one audit command across its dependency sets.
 *
 * @param {'npm'|'composer'} ecosystem  Ecosystem.
 * @param {string}           root       Repository root.
 * @param {string}           policyFile Policy path.
 * @return {number} Exit code.
 */
function runAudit(ecosystem, root, policyFile) {
	const files = listTrackedFiles(root);
	const sets = discoverDependencySets(root, files);
	const { policy, errors } = loadPolicy(policyFile, today(), true);
	errors.push(...sets.errors);
	const lockfiles = sets[ecosystem];
	if (lockfiles.length === 0) {
		errors.push(`No tracked ${ecosystem} lockfiles found.`);
	}
	const exceptions = policy?.exceptions ?? [];
	const allFindings = [];
	for (const lockfile of lockfiles) {
		const result =
			ecosystem === 'npm'
				? runNpmAudit(root, lockfile)
				: runComposerAudit(root, lockfile);
		const { blocking, excepted } = applyExceptions(
			result.findings,
			exceptions
		);
		allFindings.push(...result.findings);
		const status = result.error
			? 'ERROR'
			: blocking.length > 0
				? `${blocking.length} advisor${blocking.length === 1 ? 'y' : 'ies'}`
				: result.empty
					? 'no packages'
					: 'clean';
		console.log(`${lockfile}: ${status}`);
		blocking.forEach((finding) => console.log(describe(finding)));
		excepted.forEach((finding) =>
			console.log(`${describe(finding)} (policy exception)`)
		);
		if (result.error) {
			errors.push(result.error);
		}
		if (blocking.length > 0) {
			errors.push(
				`${lockfile}: ${blocking.length} unresolved advisor${blocking.length === 1 ? 'y' : 'ies'}.`
			);
		}
	}
	const { unused } = applyExceptions(allFindings, exceptions);
	for (const exception of unused.filter((e) =>
		lockfiles.includes(e.dependencySet)
	)) {
		console.log(
			`Note: exception ${exception.advisory} for ${exception.package} in ${exception.dependencySet} no longer matches a finding; remove it.`
		);
	}
	if (errors.length > 0) {
		console.error(`\n${errors.join('\n')}`);
		console.error(
			`\n${ecosystem} audit failed (DEPENDENCY_SECURITY.md § Failing checks).`
		);
		return 1;
	}
	console.log(
		`\n${ecosystem} audit passed for ${lockfiles.length} lockfile(s).`
	);
	return 0;
}

function runPolicy(root, policyFile) {
	const files = listTrackedFiles(root);
	const { policy, errors } = loadPolicy(policyFile, today());
	errors.push(...discoverDependencySets(root, files).errors);
	if (policy) {
		errors.push(
			...checkPolicy(collectDirectDependencies(root, files), policy)
		);
	}
	if (errors.length > 0) {
		console.error(errors.join('\n'));
		console.error(
			`\nDependency policy failed (DEPENDENCY_SECURITY.md § Package approval).`
		);
		return 1;
	}
	console.log('Every direct dependency is approved.');
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'..'
	);
	const [command, ...rest] = process.argv.slice(2);
	const policyIndex = rest.indexOf('--policy-file');
	const policyFile =
		policyIndex === -1
			? path.join(root, POLICY_PATH)
			: path.resolve(rest[policyIndex + 1]);

	if (command === 'audit-npm') {
		process.exit(runAudit('npm', root, policyFile));
	} else if (command === 'audit-composer') {
		process.exit(runAudit('composer', root, policyFile));
	} else if (command === 'policy') {
		process.exit(runPolicy(root, policyFile));
	} else if (command === 'seed-policy') {
		let exceptions = [];
		if (existsSync(policyFile)) {
			try {
				exceptions =
					JSON.parse(readFileSync(policyFile, 'utf8')).exceptions ??
					[];
			} catch (error) {
				console.error(
					`${policyFile}: invalid JSON, not overwriting it: ${error.message}`
				);
				process.exit(1);
			}
		}
		const policy = seedPolicy(
			collectDirectDependencies(root, listTrackedFiles(root)),
			exceptions
		);
		writeFileSync(policyFile, `${JSON.stringify(policy, null, '\t')}\n`);
		console.log(
			`Wrote ${path.relative(root, policyFile)}; review the diff and commit only the approvals you intend.`
		);
	} else {
		console.error(
			'Usage: dependency-security.mjs <audit-npm|audit-composer|policy|seed-policy> [--policy-file <path>]'
		);
		process.exit(2);
	}
}
