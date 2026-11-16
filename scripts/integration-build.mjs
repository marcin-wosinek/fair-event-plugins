/**
 * Package and restore the prepared integration-test build, so one CI job
 * compiles the plugins and installs production Composer dependencies, and
 * every API and E2E shard of the same workflow run consumes exactly those
 * outputs (#2326).
 *
 *   node scripts/integration-build.mjs pack --dir=integration-build \
 *       --run-id=<id> --run-attempt=<attempt>
 *   node scripts/integration-build.mjs restore --dir=integration-build \
 *       --run-id=<id> --run-attempt=<attempt>
 *
 * `pack` requires every runtime plugin workspace (see prepared-outputs.mjs)
 * to have its outputs, then writes `integration-build.tar` with each one's
 * `build/`, `block-docs/` (when generated) and `vendor/`, and a manifest,
 * `integration-build.json`, recording the checked-out commit, the workflow
 * run and attempt, the archive checksum and the included paths. A tar archive
 * keeps file modes, which the artifact service's zip would drop.
 *
 * `restore` refuses a missing manifest or archive, a manifest from another
 * commit, run or preparation attempt, a checksum mismatch, archive entries
 * outside the declared paths, and an archive that leaves a runtime plugin
 * without its outputs. It never rebuilds. Paths are relative to the
 * repository root (the current directory).
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
	findMissingOutputs,
	formatMissingOutputs,
	runtimePluginWorkspaces,
} from './prepared-outputs.mjs';

const execFileAsync = promisify(execFile);

export const ARCHIVE_NAME = 'integration-build.tar';
export const MANIFEST_NAME = 'integration-build.json';
export const MANIFEST_SCHEMA = 1;

const RECOVERY =
	"Re-run the 'Prepare integration build' job together with the shards (Re-run all jobs), or start a new run; shards never rebuild or borrow another run's build.";

export class IntegrationBuildError extends Error {}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

export async function sha256(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}

/**
 * The paths the archive holds: the required outputs of every runtime plugin
 * (`build/` and `vendor/`) plus generated `block-docs/` where present.
 *
 * @param {string} root Repository root.
 * @return {Promise<{required: string[], optional: string[]}>} Repository-relative paths.
 */
export async function buildPaths(root) {
	const required = [];
	const optional = [];
	for (const {
		workspace,
		builds,
		installsComposer,
	} of await runtimePluginWorkspaces(root)) {
		if (builds) {
			required.push(`${workspace}/build`);
			optional.push(`${workspace}/block-docs`);
		}
		if (installsComposer) {
			required.push(`${workspace}/vendor`);
		}
	}
	return { required, optional };
}

async function gitHead(root) {
	const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
		cwd: root,
	});
	return stdout.trim();
}

/**
 * Package the prepared outputs.
 *
 * @param {Object} options
 * @param {string} options.root       Repository root.
 * @param {string} options.dir        Output directory for archive and manifest.
 * @param {string} options.runId      Workflow run id.
 * @param {string} options.runAttempt Preparation attempt.
 * @param {string} [options.commit]   Checked-out commit; defaults to HEAD.
 * @return {Promise<Object>} The manifest.
 */
export async function pack({ root, dir, runId, runAttempt, commit }) {
	const missing = await findMissingOutputs(root);
	if (missing.length) {
		throw new IntegrationBuildError(
			formatMissingOutputs(missing).join('\n')
		);
	}
	const { required, optional } = await buildPaths(root);
	const paths = [...required];
	for (const path of optional) {
		if (await exists(join(root, path))) {
			paths.push(path);
		}
	}
	paths.sort();

	const output = resolve(root, dir);
	await mkdir(output, { recursive: true });
	const archive = join(output, ARCHIVE_NAME);
	await execFileAsync('tar', ['-cf', archive, '-C', root, ...paths], {
		maxBuffer: 64 * 1024 * 1024,
	});

	const manifest = {
		schema: MANIFEST_SCHEMA,
		commit: commit ?? (await gitHead(root)),
		runId: String(runId),
		runAttempt: String(runAttempt),
		archive: {
			name: ARCHIVE_NAME,
			sha256: await sha256(archive),
			bytes: (await stat(archive)).size,
		},
		paths,
	};
	await writeFile(
		join(output, MANIFEST_NAME),
		`${JSON.stringify(manifest, null, '\t')}\n`
	);
	return manifest;
}

/**
 * Locate the manifest in the download directory, or one level below it
 * (download-artifact may nest an artifact in a folder named after it).
 *
 * @param {string} dir Download directory.
 * @return {Promise<string|undefined>} Directory holding the manifest.
 */
async function findManifestDirectory(dir) {
	if (await exists(join(dir, MANIFEST_NAME))) {
		return dir;
	}
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
			return undefined;
		}
		throw error;
	}
	for (const entry of entries) {
		if (
			entry.isDirectory() &&
			(await exists(join(dir, entry.name, MANIFEST_NAME)))
		) {
			return join(dir, entry.name);
		}
	}
	return undefined;
}

function isSafeRelative(path) {
	return (
		typeof path === 'string' &&
		path !== '' &&
		!isAbsolute(path) &&
		!path.split('/').some((part) => part === '..' || part === '')
	);
}

/**
 * Check a manifest against the expected revision and preparation job.
 *
 * @param {Object} manifest Parsed manifest.
 * @param {Object} expected
 * @param {string} expected.commit     Commit the shard checked out.
 * @param {string} expected.runId      This workflow run.
 * @param {string} expected.runAttempt Attempt of the preparation job.
 * @param {string[]} expected.required Paths the checkout's plugins need.
 * @return {string[]} Problems; empty when the manifest matches.
 */
export function manifestProblems(manifest, expected) {
	const problems = [];
	if (manifest?.schema !== MANIFEST_SCHEMA) {
		problems.push(
			`Unsupported manifest schema ${JSON.stringify(manifest?.schema)} (expected ${MANIFEST_SCHEMA}).`
		);
		return problems;
	}
	if (manifest.commit !== expected.commit) {
		problems.push(
			`Prepared for commit ${manifest.commit}, but this job checked out ${expected.commit}.`
		);
	}
	if (manifest.runId !== String(expected.runId)) {
		problems.push(
			`Prepared by workflow run ${manifest.runId}, not this run (${expected.runId}).`
		);
	}
	if (manifest.runAttempt !== String(expected.runAttempt)) {
		problems.push(
			`Prepared by attempt ${manifest.runAttempt}, but the preparation job's output names attempt ${expected.runAttempt}.`
		);
	}
	if (
		manifest.archive?.name !== ARCHIVE_NAME ||
		!/^[0-9a-f]{64}$/.test(manifest.archive?.sha256 ?? '')
	) {
		problems.push('The manifest does not describe a checksummed archive.');
	}
	const paths = Array.isArray(manifest.paths) ? manifest.paths : [];
	const unsafe = paths.filter((path) => !isSafeRelative(path));
	if (unsafe.length || !paths.length) {
		problems.push(
			`The manifest lists no paths or unsafe ones: ${JSON.stringify(unsafe)}.`
		);
	}
	const absent = expected.required.filter((path) => !paths.includes(path));
	if (absent.length) {
		problems.push(
			`The archive is incomplete; missing ${absent.join(', ')}.`
		);
	}
	return problems;
}

/**
 * Archive entries that fall outside the manifest's paths.
 *
 * @param {string[]} entries `tar -tf` output lines.
 * @param {string[]} paths   Manifest paths.
 * @return {string[]} Offending entries.
 */
export function entriesOutside(entries, paths) {
	return entries.filter((entry) => {
		const normalized = posix.normalize(entry.replace(/^\.\//, ''));
		const trimmed = normalized.replace(/\/$/, '');
		if (!isSafeRelative(trimmed)) {
			return true;
		}
		return !paths.some(
			(path) => trimmed === path || trimmed.startsWith(`${path}/`)
		);
	});
}

/**
 * Verify and extract the prepared outputs into the checkout.
 *
 * @param {Object} options
 * @param {string} options.root       Repository root.
 * @param {string} options.dir        Download directory.
 * @param {string} options.runId      This workflow run.
 * @param {string} options.runAttempt Attempt of the preparation job.
 * @param {string} [options.commit]   Checked-out commit; defaults to HEAD.
 * @return {Promise<Object>} The verified manifest.
 */
export async function restore({ root, dir, runId, runAttempt, commit }) {
	const location = await findManifestDirectory(resolve(root, dir));
	if (!location) {
		throw new IntegrationBuildError(
			`No prepared integration build found in ${dir} (${MANIFEST_NAME} is missing). ${RECOVERY}`
		);
	}
	let manifest;
	try {
		manifest = JSON.parse(
			await readFile(join(location, MANIFEST_NAME), 'utf8')
		);
	} catch (error) {
		throw new IntegrationBuildError(
			`The prepared build manifest is unreadable: ${error.message}. ${RECOVERY}`
		);
	}
	const { required } = await buildPaths(root);
	const problems = manifestProblems(manifest, {
		commit: commit ?? (await gitHead(root)),
		runId,
		runAttempt,
		required,
	});
	if (problems.length) {
		throw new IntegrationBuildError(
			[
				'The prepared integration build does not belong to this job:',
				...problems.map((problem) => `  - ${problem}`),
				RECOVERY,
			].join('\n')
		);
	}

	const archive = join(location, ARCHIVE_NAME);
	if (!(await exists(archive))) {
		throw new IntegrationBuildError(
			`The prepared build archive ${ARCHIVE_NAME} is missing next to its manifest. ${RECOVERY}`
		);
	}
	const checksum = await sha256(archive);
	if (checksum !== manifest.archive.sha256) {
		throw new IntegrationBuildError(
			`The prepared build archive is corrupt: sha256 ${checksum}, manifest says ${manifest.archive.sha256}. ${RECOVERY}`
		);
	}

	let listing;
	try {
		({ stdout: listing } = await execFileAsync('tar', ['-tf', archive], {
			maxBuffer: 256 * 1024 * 1024,
		}));
	} catch (error) {
		throw new IntegrationBuildError(
			`The prepared build archive cannot be read: ${error.message}. ${RECOVERY}`
		);
	}
	const outside = entriesOutside(
		listing.split('\n').filter(Boolean),
		manifest.paths
	);
	if (outside.length) {
		throw new IntegrationBuildError(
			`The prepared build archive holds entries outside its declared paths: ${outside.slice(0, 5).join(', ')}. ${RECOVERY}`
		);
	}

	await execFileAsync('tar', ['-xpf', archive, '-C', root], {
		maxBuffer: 64 * 1024 * 1024,
	});

	const missing = await findMissingOutputs(root);
	if (missing.length) {
		throw new IntegrationBuildError(
			[...formatMissingOutputs(missing), RECOVERY].join('\n')
		);
	}
	return manifest;
}

function parseArguments(argv) {
	const [command, ...rest] = argv;
	const options = {};
	for (const argument of rest) {
		const match = /^--([a-z-]+)=(.*)$/.exec(argument);
		if (!match) {
			throw new IntegrationBuildError(`Unknown argument: ${argument}`);
		}
		options[match[1]] = match[2];
	}
	for (const name of ['dir', 'run-id', 'run-attempt']) {
		if (!options[name]) {
			throw new IntegrationBuildError(`Missing --${name}=<value>.`);
		}
	}
	if (command !== 'pack' && command !== 'restore') {
		throw new IntegrationBuildError(
			'Usage: integration-build.mjs pack|restore --dir=<dir> --run-id=<id> --run-attempt=<attempt>'
		);
	}
	return {
		command,
		dir: options.dir,
		runId: options['run-id'],
		runAttempt: options['run-attempt'],
	};
}

async function writeSummary(lines) {
	if (process.env.GITHUB_STEP_SUMMARY) {
		await appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`${lines.join('\n')}\n`
		);
	}
}

async function main() {
	const { command, dir, runId, runAttempt } = parseArguments(
		process.argv.slice(2)
	);
	const root = process.cwd();
	const started = Date.now();
	const manifest = await (command === 'pack' ? pack : restore)({
		root,
		dir,
		runId,
		runAttempt,
	});
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const megabytes = (manifest.archive.bytes / 1024 / 1024).toFixed(1);
	const verb = command === 'pack' ? 'Packed' : 'Verified and restored';
	console.log(
		`${verb} ${manifest.paths.length} paths (${megabytes} MiB, sha256 ${manifest.archive.sha256}) for commit ${manifest.commit}, run ${manifest.runId} attempt ${manifest.runAttempt} in ${seconds}s.`
	);
	await writeSummary([
		`### Prepared integration build (${command})`,
		'',
		`- Commit \`${manifest.commit}\`, run ${manifest.runId}, preparation attempt ${manifest.runAttempt}`,
		`- Archive: ${megabytes} MiB, sha256 \`${manifest.archive.sha256}\``,
		`- ${verb} ${manifest.paths.length} paths in ${seconds}s`,
	]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		if (error instanceof IntegrationBuildError) {
			for (const line of error.message.split('\n')) {
				console.error(
					process.env.GITHUB_ACTIONS ? `::error::${line}` : line
				);
			}
			process.exit(2);
		}
		throw error;
	});
}
