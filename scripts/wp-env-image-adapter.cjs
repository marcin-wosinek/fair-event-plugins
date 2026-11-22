'use strict';
/**
 * Narrow adapter around @wordpress/env's Docker configuration generator
 * (#2359). It never edits files in node_modules.
 *
 * Two uses:
 *
 * - scripts/wp-env-images.mjs calls `createBuildPlan()` to get the exact
 *   Dockerfiles and build arguments `wp-env start` would generate, so CI can
 *   build, tag and cache those images itself (with retries).
 * - Preloaded into `wp-env start` (NODE_OPTIONS=--require=<this file>, with
 *   FAIR_WP_ENV_IMAGE_MANIFEST naming the prepared manifest), it rewrites the
 *   generated Compose services to use the prepared images: no `build:`
 *   section and `pull_policy: never`. A reused start then runs no Dockerfile
 *   step and downloads nothing.
 *
 * Each generated Dockerfile is hashed together with its build arguments. A
 * prepared image is used only when its hash matches what this start would
 * build, so a stale image can never be reused after its inputs change.
 *
 * An upgraded wp-env whose generator no longer matches the interface below
 * fails with UnsupportedWpEnvError instead of silently building something
 * else.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { UnsupportedWpEnvError, locateWpEnv } = require('./wp-env-locate.cjs');

const MANIFEST_ENV = 'FAIR_WP_ENV_IMAGE_MANIFEST';
const KEY_LABEL = 'org.fair-event-plugins.wp-env-images.key';

// How wp-env's writeDockerFiles() names the four Dockerfiles it writes.
const DOCKERFILES = {
	'WordPress.Dockerfile': { image: 'WordPress', env: 'development' },
	'Tests-WordPress.Dockerfile': { image: 'WordPress', env: 'tests' },
	'CLI.Dockerfile': { image: 'CLI', env: 'development' },
	'Tests-CLI.Dockerfile': { image: 'CLI', env: 'tests' },
};

class StaleImageError extends Error {
	constructor(message) {
		super(message);
		this.name = 'StaleImageError';
	}
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Describe every service wp-env builds from a generated Dockerfile.
 *
 * @param {Object} composeConfig Compose config from buildDockerComposeConfig().
 * @param {Object} config        The resolved wp-env config it was built from.
 * @param {Object} dockerConfig  wp-env's docker-config module.
 * @return {Array<Object>} One entry per built service.
 */
function describeBuilds(composeConfig, config, dockerConfig) {
	for (const name of [
		'wordpressDockerFileContents',
		'cliDockerFileContents',
	]) {
		if (typeof dockerConfig[name] !== 'function') {
			throw new UnsupportedWpEnvError(
				`wp-env's docker-config module no longer exports ${name}().`
			);
		}
	}
	const builds = [];
	for (const [service, definition] of Object.entries(
		composeConfig.services ?? {}
	)) {
		if (!definition.build) {
			continue;
		}
		const { context, dockerfile, args = {} } = definition.build;
		const source = DOCKERFILES[dockerfile];
		if (!source || context !== '.') {
			throw new UnsupportedWpEnvError(
				`Service "${service}" builds ${dockerfile} from context "${context}", which the adapter does not know.`
			);
		}
		const contents =
			source.image === 'WordPress'
				? dockerConfig.wordpressDockerFileContents(source.env, config)
				: dockerConfig.cliDockerFileContents(source.env, config);
		builds.push({
			service,
			dockerfile,
			contents,
			args,
			hash: sha256(JSON.stringify({ dockerfile, contents, args })),
		});
	}
	if (!builds.length) {
		throw new UnsupportedWpEnvError(
			'The generated Compose config builds no services.'
		);
	}
	return builds;
}

/**
 * Images wp-env pulls (services with an `image` and no `build`) and the base
 * images the generated Dockerfiles start FROM.
 *
 * @param {Object}        composeConfig Compose config.
 * @param {Array<Object>} builds        Result of describeBuilds().
 * @return {string[]} Sorted, unique image references.
 */
function upstreamImages(composeConfig, builds) {
	const images = new Set();
	for (const definition of Object.values(composeConfig.services ?? {})) {
		if (definition.image && !definition.build) {
			images.add(definition.image);
		}
	}
	for (const { contents, service } of builds) {
		const from = contents.match(/^FROM\s+(\S+)/m);
		if (!from) {
			throw new UnsupportedWpEnvError(
				`The generated Dockerfile for "${service}" has no FROM line.`
			);
		}
		images.add(from[1]);
	}
	return [...images].sort((a, b) => a.localeCompare(b));
}

/**
 * Point the built services at prepared images. Mutates and returns the config.
 *
 * @param {Object} composeConfig Compose config from buildDockerComposeConfig().
 * @param {Object} config        The resolved wp-env config.
 * @param {Object} dockerConfig  wp-env's docker-config module.
 * @param {Object} manifest      Prepared manifest (services, upstream).
 * @return {Object} The rewritten Compose config.
 */
function applyPreparedImages(composeConfig, config, dockerConfig, manifest) {
	const builds = describeBuilds(composeConfig, config, dockerConfig);
	for (const build of builds) {
		const prepared = manifest.services?.[build.service];
		if (!prepared) {
			throw new StaleImageError(
				`No prepared image for the "${build.service}" service; rerun image preparation.`
			);
		}
		if (prepared.hash !== build.hash) {
			throw new StaleImageError(
				`The prepared "${build.service}" image was built from a different Dockerfile or build arguments than this start generates; rerun image preparation.`
			);
		}
		const service = composeConfig.services[build.service];
		delete service.build;
		service.image = prepared.image;
		service.pull_policy = 'never';
	}
	const upstream = new Set(manifest.upstream ?? []);
	for (const service of Object.values(composeConfig.services)) {
		if (service.image && upstream.has(service.image)) {
			service.pull_policy = 'never';
		}
	}
	return composeConfig;
}

const QUIET_SPINNER = {
	text: '',
	info() {},
	warn() {},
	fail() {},
	succeed() {},
	start() {},
	stop() {},
};

/**
 * The Dockerfiles, build arguments and upstream images `wp-env start` would
 * use for the configuration in `root`, generated by wp-env itself.
 *
 * @param {string} root          Directory holding .wp-env.json.
 * @param {string} [resolveFrom] Directory wp-env is resolved from.
 * @return {Promise<Object>} The build plan.
 */
async function createBuildPlan(root, resolveFrom = root) {
	const wpEnv = locateWpEnv(resolveFrom);
	// Before wp-env's config module loads, so an exact pin skips the
	// WordPress.org latest-release lookup (#2393). Required here because the
	// shim requires this module.
	require('./wp-env-pinned-core.cjs').installPinnedCore({
		root,
		resolveFrom,
	});
	const { loadConfig } = require(wpEnv.modules.config);
	const buildDockerComposeConfig = require(wpEnv.modules.buildCompose);
	const dockerConfig = require(wpEnv.modules.dockerConfig);
	if (
		typeof loadConfig !== 'function' ||
		typeof buildDockerComposeConfig !== 'function'
	) {
		throw new UnsupportedWpEnvError(
			"wp-env's loadConfig() or buildDockerComposeConfig() changed shape."
		);
	}
	// The same options `wp-env start` uses in the runners: no --xdebug,
	// --spx or --debug, and CI=1, which turns automatic ports off.
	const config = await loadConfig(root, null, {
		resolvePorts: true,
		autoPort: false,
		spinner: QUIET_SPINNER,
	});
	config.debug = false;
	config.xdebug = 'off';
	config.spx = 'off';
	const composeConfig = buildDockerComposeConfig(config);
	const builds = describeBuilds(composeConfig, config, dockerConfig);
	return {
		wpEnvVersion: wpEnv.version,
		builds,
		upstream: upstreamImages(composeConfig, builds),
	};
}

/**
 * Install the start-time rewrite when a manifest is configured. Runs only in
 * the wp-env process itself: NODE_OPTIONS also reaches `npx`.
 *
 * @param {Object} env Process environment.
 * @return {boolean} Whether the rewrite was installed.
 */
function install(env = process.env) {
	const manifestPath = env[MANIFEST_ENV];
	if (!manifestPath) {
		return false;
	}
	const wpEnv = locateWpEnv(process.cwd());
	let script;
	try {
		script = fs.realpathSync(process.argv[1] ?? '');
	} catch {
		return false;
	}
	if (!script.startsWith(wpEnv.directory + path.sep)) {
		return false;
	}
	if (require.cache[wpEnv.modules.dockerConfig]) {
		throw new UnsupportedWpEnvError(
			"wp-env's docker-config module loaded before the adapter."
		);
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	if (manifest.wpEnvVersion !== wpEnv.version) {
		throw new StaleImageError(
			`Images were prepared for @wordpress/env ${manifest.wpEnvVersion}, but ${wpEnv.version} is installed; rerun image preparation.`
		);
	}
	const original = require(wpEnv.modules.buildCompose);
	if (typeof original !== 'function') {
		throw new UnsupportedWpEnvError(
			"wp-env's buildDockerComposeConfig() changed shape."
		);
	}
	function buildWithPreparedImages(config) {
		const composeConfig = original(config);
		return applyPreparedImages(
			composeConfig,
			config,
			require(wpEnv.modules.dockerConfig),
			manifest
		);
	}
	require.cache[wpEnv.modules.buildCompose].exports = buildWithPreparedImages;
	process.stderr.write(
		`wp-env image adapter: starting from prepared images (${manifest.key}); no image is built or pulled.\n`
	);
	return true;
}

module.exports = {
	DOCKERFILES,
	KEY_LABEL,
	MANIFEST_ENV,
	StaleImageError,
	UnsupportedWpEnvError,
	applyPreparedImages,
	createBuildPlan,
	describeBuilds,
	install,
	locateWpEnv,
	upstreamImages,
};

if (require.main !== module) {
	install();
}
