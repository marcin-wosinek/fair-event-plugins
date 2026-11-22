'use strict';
/**
 * Keep @wordpress/env from asking WordPress.org for the latest release when
 * the configuration already pins an exact one (#2393). It never edits files
 * in node_modules.
 *
 * wp-env 12.x parses its built-in default config (`core: null`) before it
 * merges .wp-env.json, so every `wp-env start` and `wp-env run` resolves the
 * latest release through `getLatestWordPressVersion()`: a DNS lookup and a
 * stable-check request whose answer the pin then discards. When that request
 * drops, the command fails. This shim replaces the function with one that
 * returns the pinned version, before wp-env's config parser imports it.
 *
 * Two uses:
 *
 * - Preloaded (NODE_OPTIONS=--require=<this file>) by the test runners for
 *   every child process. It acts only inside the wp-env process itself, so
 *   npx, npm and Playwright are untouched while the `wp-env` commands they
 *   start are covered.
 * - scripts/wp-env-image-adapter.cjs `createBuildPlan()` calls
 *   `installPinnedCore()` in-process before it loads wp-env's config module.
 *
 * Only an exact `WordPress/WordPress#<version>` root `core` counts, resolved
 * the way wp-env does: WP_ENV_CORE, then .wp-env.override.json, then
 * .wp-env.json. Without one, wp-env keeps its own lookup. `canAccessWPORG()`
 * stays as it is: `wp-env start` uses it to decide whether to reconfigure.
 *
 * A wp-env upgrade that changes these modules fails with
 * UnsupportedWpEnvError instead of silently doing the lookup again.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
	locateWpEnv,
	UnsupportedWpEnvError,
} = require('./wp-env-image-adapter.cjs');

const ADAPTER = 'pinned-core shim (scripts/wp-env-pinned-core.cjs)';
const EXACT_PIN = /^WordPress\/WordPress#(\d+\.\d+(?:\.\d+)?)$/;
const PATCHED = Symbol.for('fair-event-plugins.wp-env-pinned-core');

function readCore(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
	try {
		return JSON.parse(raw)?.core;
	} catch {
		// wp-env reports the broken file itself.
		return undefined;
	}
}

/**
 * The exact WordPress version the effective root `core` pins, if any.
 *
 * @param {string} root Directory holding .wp-env.json.
 * @param {Object} env  Process environment.
 * @return {string|null} The pinned version, or null without an exact pin.
 */
function resolvePinnedVersion(root, env = process.env) {
	let core;
	if (env.WP_ENV_CORE) {
		core = env.WP_ENV_CORE;
	} else {
		const override = readCore(path.join(root, '.wp-env.override.json'));
		core =
			override !== undefined
				? override
				: readCore(path.join(root, '.wp-env.json'));
	}
	const match = typeof core === 'string' ? core.match(EXACT_PIN) : null;
	return match ? match[1] : null;
}

/**
 * Make wp-env's latest-release lookup return the pinned version.
 *
 * @param {Object} options
 * @param {string} options.root          Directory holding .wp-env.json.
 * @param {string} [options.resolveFrom] Directory wp-env is resolved from.
 * @param {Object} [options.env]         Process environment.
 * @return {string|null} The pinned version now returned, or null when wp-env
 *                       keeps its own lookup.
 */
function installPinnedCore({ root, resolveFrom = root, env = process.env }) {
	const wpEnv = locateWpEnv(resolveFrom);
	const version = resolvePinnedVersion(root, env);
	const loaded = require.cache[wpEnv.modules.wordpress];
	const current = loaded?.exports?.getLatestWordPressVersion;
	if (current?.[PATCHED]) {
		// Installed earlier in this process: follow this root's pin.
		current[PATCHED].version = version;
		return version;
	}
	if (!version) {
		return null;
	}
	if (require.cache[wpEnv.modules.parseConfig]) {
		throw new UnsupportedWpEnvError(
			"wp-env's parse-config module loaded before the shim, so it already holds the original lookup.",
			ADAPTER
		);
	}
	const wordpress = require(wpEnv.modules.wordpress);
	const original = wordpress?.getLatestWordPressVersion;
	if (
		typeof original !== 'function' ||
		typeof wordpress.canAccessWPORG !== 'function'
	) {
		throw new UnsupportedWpEnvError(
			"wp-env's getLatestWordPressVersion() changed shape.",
			ADAPTER
		);
	}
	const state = { version };
	async function getPinnedWordPressVersion(...args) {
		return state.version ?? original(...args);
	}
	getPinnedWordPressVersion[PATCHED] = state;
	wordpress.getLatestWordPressVersion = getPinnedWordPressVersion;
	return version;
}

/**
 * Preload entry: install only in the wp-env process itself.
 *
 * @param {Object} env Process environment.
 * @return {string|null} The pinned version, or null when nothing changed.
 */
function install(env = process.env) {
	let script;
	try {
		script = fs.realpathSync(process.argv[1] ?? '');
	} catch {
		return null;
	}
	// Cheap test first: NODE_OPTIONS reaches every Node process the runners
	// start, from any working directory.
	const marker = `${path.sep}@wordpress${path.sep}env${path.sep}`;
	if (!script.includes(marker)) {
		return null;
	}
	const wpEnv = locateWpEnv(process.cwd());
	if (!script.startsWith(wpEnv.directory + path.sep)) {
		return null;
	}
	return installPinnedCore({ root: process.cwd(), env });
}

/**
 * Add this shim to a NODE_OPTIONS value, keeping what is already there.
 *
 * @param {string} [nodeOptions] Existing NODE_OPTIONS.
 * @return {string} NODE_OPTIONS that also preloads the shim.
 */
function withPinnedCoreNodeOptions(nodeOptions) {
	const flag = `--require=${__filename}`;
	const existing = nodeOptions?.trim() ?? '';
	if (existing.split(/\s+/).includes(flag)) {
		return existing;
	}
	return [existing, flag].filter(Boolean).join(' ');
}

module.exports = {
	EXACT_PIN,
	SHIM_PATH: __filename,
	install,
	installPinnedCore,
	resolvePinnedVersion,
	withPinnedCoreNodeOptions,
};

if (require.main !== module) {
	install();
}
