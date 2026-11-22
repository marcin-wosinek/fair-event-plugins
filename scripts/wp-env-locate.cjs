'use strict';
/**
 * Locate the installed @wordpress/env for the scripts that adapt it:
 * scripts/wp-env-image-adapter.cjs and scripts/wp-env-pinned-core.cjs.
 *
 * Both of those install themselves when preloaded, so this module holds what
 * they share and runs nothing when it loads. Requiring it never loads a
 * wp-env module, which keeps the preload order safe (#2393).
 */

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_MAJOR_VERSIONS = ['12'];

class UnsupportedWpEnvError extends Error {
	constructor(
		message,
		adapter = 'CI image adapter (scripts/wp-env-image-adapter.cjs)'
	) {
		super(
			`${message} The ${adapter} supports @wordpress/env ${SUPPORTED_MAJOR_VERSIONS.join(
				', '
			)}.x; update it for the installed version.`
		);
		this.name = 'UnsupportedWpEnvError';
	}
}

/**
 * Find the installed wp-env and the modules this adapter depends on.
 *
 * @param {string} root Directory wp-env is resolved from.
 * @return {Object} Version, directory and module paths.
 */
function locateWpEnv(root) {
	let packagePath;
	try {
		packagePath = require.resolve('@wordpress/env/package.json', {
			paths: [root],
		});
	} catch {
		throw new UnsupportedWpEnvError(
			`@wordpress/env is not installed under ${root}.`
		);
	}
	const directory = path.dirname(packagePath);
	const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
	if (!SUPPORTED_MAJOR_VERSIONS.includes(String(version).split('.')[0])) {
		throw new UnsupportedWpEnvError(
			`Installed @wordpress/env is ${version}.`
		);
	}
	const modules = {
		config: path.join(directory, 'lib/config/index.js'),
		buildCompose: path.join(
			directory,
			'lib/runtime/docker/build-docker-compose-config.js'
		),
		dockerConfig: path.join(
			directory,
			'lib/runtime/docker/docker-config.js'
		),
		// Used by scripts/wp-env-pinned-core.cjs.
		wordpress: path.join(directory, 'lib/wordpress.js'),
		parseConfig: path.join(directory, 'lib/config/parse-config.js'),
	};
	for (const [name, file] of Object.entries(modules)) {
		if (!fs.existsSync(file)) {
			throw new UnsupportedWpEnvError(
				`@wordpress/env ${version} has no ${name} module at ${path.relative(
					directory,
					file
				)}.`
			);
		}
	}
	return { version, directory, modules };
}

module.exports = {
	SUPPORTED_MAJOR_VERSIONS,
	UnsupportedWpEnvError,
	locateWpEnv,
};
