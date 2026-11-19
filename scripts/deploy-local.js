#!/usr/bin/env node

/**
 * Local build & deploy.
 *
 * Mirrors `.github/workflows/deploy-to-environment.yml` but runs entirely on the
 * developer's machine. Reads SSH/target config from `.deploy/<env>.env`,
 * (re)builds plugin ZIPs via `npm run dist-archive`, extracts them, then rsyncs
 * each plugin over SSH and reactivates it via WP-CLI.
 *
 * Usage:
 *   npm run deploy:local -- --env=staging
 *   npm run deploy:local -- --env=staging --plugins=fair-events,fair-payments-connector
 *   npm run deploy:local -- --env=staging --dry-run
 *   npm run deploy:local -- --env=staging --skip-build --skip-reactivate
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	readdirSync,
	writeFileSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { discoverPlugins } from './plugin-workspaces.mjs';
import { withStampedHeaders } from './version-stamp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Deployment eligibility for --plugins=all. Header stamping is not limited to
// this list: every selected plugin is resolved through discoverPlugins().
const ALL_PLUGINS = [
	'fair-events',
	'fair-payments-connector',
	'fair-audience',
	'fair-timetable',
	'fair-finance',
	'fair-events-experimental',
	'fair-audience-experimental',
];
const MAX_ATTEMPTS = 2;

function parseArgs(argv) {
	const args = {
		env: null,
		plugins: null,
		dryRun: false,
		skipBuild: false,
		skipReactivate: false,
		skipChecks: false,
	};
	for (const a of argv.slice(2)) {
		if (a.startsWith('--env=')) args.env = a.slice('--env='.length);
		else if (a.startsWith('--plugins='))
			args.plugins = a.slice('--plugins='.length);
		else if (a === '--dry-run') args.dryRun = true;
		else if (a === '--skip-build') args.skipBuild = true;
		else if (a === '--skip-reactivate') args.skipReactivate = true;
		else if (a === '--skip-checks') args.skipChecks = true;
		else if (a === '--help' || a === '-h') {
			printHelp();
			process.exit(0);
		} else {
			console.error(`Unknown argument: ${a}`);
			printHelp();
			process.exit(2);
		}
	}
	return args;
}

function printHelp() {
	console.log(`Usage: node scripts/deploy-local.js --env=<name> [options]

Options:
  --env=<name>            Required. Loads .deploy/<name>.env
  --plugins=<csv|all>     Override PLUGINS_TO_DEPLOY from config
  --dry-run               rsync --dry-run; skip WP-CLI reactivation
  --skip-build            Reuse existing dist/*.zip; do not run dist-archive
  --skip-reactivate       Skip WP-CLI deactivate/activate after rsync
  --skip-checks           Skip pre-deploy checks (already bypassed by default)
  -h, --help              Show this help

Warning: local deploys skip CI checks (lint, tests). Run them yourself
before deploying to a shared environment.`);
}

function fail(msg) {
	console.error(`ERROR: ${msg}`);
	process.exit(1);
}

function loadEnv(envName) {
	const path = join(rootDir, '.deploy', `${envName}.env`);
	if (!existsSync(path)) {
		fail(
			`Config not found: ${path}\nCopy .deploy/example.env to .deploy/${envName}.env and fill in values.`
		);
	}
	const parsed = dotenv.parse(readFileSync(path));
	const required = [
		'SSH_HOST',
		'SSH_PORT',
		'SSH_USER',
		'WORDPRESS_PLUGINS_PATH',
		'PLUGINS_TO_DEPLOY',
	];
	const missing = required.filter((k) => !parsed[k]);
	if (missing.length) fail(`Missing keys in ${path}: ${missing.join(', ')}`);
	return parsed;
}

function resolvePlugins(override, configured) {
	const raw = override ?? configured;
	if (raw === 'all') return [...ALL_PLUGINS];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function gitDescribe() {
	// Unlike CI (scripts/stamp-build-version.js, per-plugin `<plugin>@*`
	// tags), local builds stamp one repo-wide description, plus --dirty.
	const result = spawnSync(
		'git',
		['describe', '--tags', '--match=[0-9]*', '--dirty', '--always'],
		{ cwd: rootDir, encoding: 'utf8' }
	);
	if (result.status !== 0) {
		console.warn(
			'⚠ git describe failed; version will be marked "unknown".'
		);
		return 'unknown';
	}
	return result.stdout.trim();
}

/**
 * Resolve the selected plugins to discovered plugin workspaces, failing on
 * any name that isn't one, so no selected plugin ships unstamped.
 */
function resolveStampTargets(plugins) {
	const discovered = new Map(
		discoverPlugins(rootDir).map((plugin) => [plugin.name, plugin])
	);
	const unknown = plugins.filter((plugin) => !discovered.has(plugin));
	if (unknown.length) {
		throw new Error(
			`Not a plugin workspace (see root package.json workspaces): ${unknown.join(
				', '
			)}`
		);
	}
	return plugins.map((plugin) => discovered.get(plugin));
}

function writeVersionFile(plugin, extractDir, version) {
	const pluginDir = join(extractDir, plugin);
	if (!existsSync(pluginDir)) return;
	const payload = `${version}\n${new Date().toISOString()}\n`;
	writeFileSync(join(pluginDir, '.deploy-version'), payload);
}

function build(plugins, version) {
	const distDir = join(rootDir, 'dist');
	if (existsSync(distDir)) {
		for (const f of readdirSync(distDir)) {
			if (f.endsWith('.zip')) rmSync(join(distDir, f));
		}
	}
	const targets = resolveStampTargets(plugins);
	console.log(
		`▶ Stamping plugin Version headers (${targets
			.map((plugin) => plugin.name)
			.join(', ')}): ${version}`
	);
	// withStampedHeaders restores the headers even when dist-archive fails,
	// so the failure is thrown here and reported by main() afterwards.
	const restored = withStampedHeaders({
		rootDir,
		plugins: targets,
		version,
		callback: () => {
			console.log('▶ Building plugin ZIPs (npm run dist-archive)...');
			const result = spawnSync('npm', ['run', 'dist-archive'], {
				stdio: 'inherit',
				cwd: rootDir,
			});
			if (result.status !== 0) {
				throw new Error(
					`Command failed (${result.status}): npm run dist-archive`
				);
			}
		},
	});
	if (restored) {
		console.log(
			`▶ Restored ${restored} plugin file(s) to pre-stamp state.`
		);
	}
}

function extractZips(plugins, extractDir) {
	if (existsSync(extractDir))
		rmSync(extractDir, { recursive: true, force: true });
	mkdirSync(extractDir, { recursive: true });

	const distDir = join(rootDir, 'dist');
	if (!existsSync(distDir))
		fail(`dist/ directory not found. Run without --skip-build first.`);

	const zips = readdirSync(distDir).filter((f) => f.endsWith('.zip'));
	if (zips.length === 0) fail('No ZIPs found in dist/.');

	for (const plugin of plugins) {
		const zip = zips.find((f) => {
			if (f === `${plugin}.zip`) return true;
			// The slug must be followed by a version separator, never another
			// slug segment — otherwise `fair-payments-connector` would also
			// match a sibling like `fair-payments-connector-experimental`.
			if (f.startsWith(`${plugin}.`)) return true;
			if (f.startsWith(`${plugin}-`))
				return /^\d/.test(f.slice(plugin.length + 1));
			return false;
		});
		if (!zip) {
			console.warn(
				`⚠ No ZIP found for ${plugin} in dist/, will be skipped during deploy.`
			);
			continue;
		}
		console.log(`▶ Extracting ${zip}...`);
		execFileSync(
			'unzip',
			['-q', '-o', join(distDir, zip), '-d', extractDir],
			{ stdio: 'inherit' }
		);
	}
}

function sshOpts(env) {
	const opts = [
		'-p',
		env.SSH_PORT,
		'-o',
		'ConnectTimeout=15',
		'-o',
		'ServerAliveInterval=30',
		'-o',
		'ServerAliveCountMax=3',
	];
	if (env.SSH_KEY_PATH)
		opts.push('-i', env.SSH_KEY_PATH.replace(/^~/, process.env.HOME || ''));
	return opts;
}

function deployPlugin(plugin, extractDir, env, dryRun) {
	const src = join(extractDir, plugin) + '/';
	if (!existsSync(join(extractDir, plugin))) {
		console.warn(`⚠ ${plugin} not in extracted dir, skipping.`);
		return false;
	}
	const dest = `${env.SSH_USER}@${env.SSH_HOST}:${env.WORDPRESS_PLUGINS_PATH}/${plugin}/`;
	const sshCmd = ['ssh', ...sshOpts(env)].join(' ');

	const rsyncArgs = ['-avz', '--delete', '-e', sshCmd, src, dest];
	if (dryRun) rsyncArgs.unshift('--dry-run');

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		console.log(
			`▶ Deploying ${plugin} (attempt ${attempt}/${MAX_ATTEMPTS})${
				dryRun ? ' [dry-run]' : ''
			}...`
		);
		const result = spawnSync('rsync', rsyncArgs, { stdio: 'inherit' });
		if (result.status === 0) {
			console.log(`✓ ${plugin} deployed`);
			return true;
		}
		if (attempt === MAX_ATTEMPTS)
			fail(`Failed to deploy ${plugin} after ${MAX_ATTEMPTS} attempts.`);
		console.log('Retrying in 10s...');
		execFileSync('sleep', ['10']);
	}
	return false;
}

function reactivate(plugin, env) {
	const wpPath = `${env.WORDPRESS_PLUGINS_PATH}/../..`;
	const remote = `${env.SSH_USER}@${env.SSH_HOST}`;
	const remoteCmd = `cd ${wpPath} && wp plugin deactivate ${plugin} && wp plugin activate ${plugin}`;
	console.log(`▶ Reactivating ${plugin}...`);
	const result = spawnSync('ssh', [...sshOpts(env), remote, remoteCmd], {
		stdio: 'inherit',
	});
	if (result.status === 0) console.log(`✓ ${plugin} reactivated`);
	else
		console.warn(
			`⚠ Failed to reactivate ${plugin} (may not have been active)`
		);
}

function main() {
	const args = parseArgs(process.argv);
	if (!args.env) {
		console.error('ERROR: --env=<name> is required.');
		printHelp();
		process.exit(2);
	}

	const env = loadEnv(args.env);
	const plugins = resolvePlugins(args.plugins, env.PLUGINS_TO_DEPLOY);
	const version = gitDescribe();

	console.log('========================================');
	console.log(`Local deploy → ${args.env}`);
	console.log(`  Host:    ${env.SSH_USER}@${env.SSH_HOST}:${env.SSH_PORT}`);
	console.log(`  Target:  ${env.WORDPRESS_PLUGINS_PATH}`);
	console.log(`  Plugins: ${plugins.join(', ')}`);
	console.log(`  Version: ${version}`);
	console.log(`  Dry run: ${args.dryRun ? 'yes' : 'no'}`);
	console.log('========================================');
	if (version.endsWith('-dirty')) {
		console.log(
			'⚠  Working tree is dirty — deploying uncommitted changes.'
		);
	}
	console.log('⚠  Local deploys skip CI checks (lint, tests).');
	console.log('');

	if (!args.skipBuild) {
		try {
			build(plugins, version);
		} catch (error) {
			fail(error.message);
		}
	} else console.log('▶ Skipping build (--skip-build).');

	const extractDir = join(rootDir, 'dist', 'extracted');
	extractZips(plugins, extractDir);

	for (const plugin of plugins) writeVersionFile(plugin, extractDir, version);

	const deployed = [];
	for (const plugin of plugins) {
		if (deployPlugin(plugin, extractDir, env, args.dryRun))
			deployed.push(plugin);
	}

	if (!args.dryRun && !args.skipReactivate) {
		for (const plugin of deployed) reactivate(plugin, env);
	} else if (args.dryRun) {
		console.log('▶ Skipping reactivation (--dry-run).');
	} else {
		console.log('▶ Skipping reactivation (--skip-reactivate).');
	}

	console.log('========================================');
	console.log('Deployment Summary');
	console.log(
		`  Deployed: ${deployed.length} plugin(s) — ${
			deployed.join(', ') || '(none)'
		}`
	);
	console.log(`  Skipped:  ${plugins.length - deployed.length}`);
	console.log(`  Target:   ${env.SSH_HOST}`);
	console.log(`  Version:  ${version}`);
	console.log('========================================');
}

main();
