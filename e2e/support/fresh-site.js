/**
 * Fresh-install sites inside the wp-env tests instance (#2112).
 *
 * The `wp-content/db.php` test drop-in (e2e/drop-ins/db.php) switches the
 * table prefix for requests carrying `X-Fair-E2E-Site: <name>` and for
 * WP-CLI runs with `FAIR_E2E_SITE=<name>`. `installFreshSite()` drops that
 * site's tables, installs WordPress there and activates only the plugins it
 * is given, so every other plugin has never been activated on it: no
 * tables, no options, no history. The default site is untouched.
 *
 * Every call is asynchronous: long synchronous WP-CLI runs leave the API
 * specs' keep-alive sockets dead ("socket hang up"). Await each call before
 * the next; concurrent `wp-env run` calls break the environment.
 *
 * Usage:
 *   const site = await installFreshSite( 'events-only', [ 'fair-events' ] );
 *   const context = await request.newContext( { baseURL, extraHTTPHeaders: site.headers } );
 *   await site.wp( [ 'option', 'get', 'siteurl' ] );
 *   await dropFreshSite( 'events-only' );
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);

/** Header that selects a fresh site over HTTP. */
export const FRESH_SITE_HEADER = 'X-Fair-E2E-Site';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';
const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';

/**
 * Run WP-CLI on the tests instance, on a fresh site when `site` is set.
 *
 * @param {string[]}    args WP-CLI arguments (after `wp`).
 * @param {string|null} site Fresh site name, or null for the default site.
 * @return {Promise<string>} Command stdout.
 */
async function wp(args, site = null) {
	const command = site
		? ['env', `FAIR_E2E_SITE=${site}`, 'wp', ...args]
		: ['wp', ...args];
	const { stdout } = await run(
		'npx',
		['wp-env', 'run', 'tests-cli', ...command],
		{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	return stdout;
}

/**
 * Run an eval-file script and parse its `MARKER:{json}` line.
 *
 * @param {string}      script Script under mu-plugins/scripts/.
 * @param {string}      marker Output marker.
 * @param {string}      action First script argument.
 * @param {Object}      data   JSON second argument.
 * @param {string|null} site   Fresh site name, or null for the default site.
 * @return {Promise<Object>} Parsed payload.
 */
async function evalScript(script, marker, action, data, site) {
	const stdout = await wp(
		[
			'eval-file',
			`wp-content/mu-plugins/scripts/${script}`,
			action,
			JSON.stringify(data),
		],
		site
	);
	const match = stdout.match(new RegExp(`${marker}:(\\{.*\\})`));
	if (!match) {
		throw new Error(`Expected ${marker} output, got:\n${stdout}`);
	}
	return JSON.parse(match[1]);
}

/**
 * Drop every table of a fresh site.
 *
 * @param {string} site Fresh site name.
 * @return {Promise<Object>} `{ prefix, dropped }`.
 */
export function dropFreshSite(site) {
	return evalScript(
		'fresh-install.php',
		'E2E_FRESH_INSTALL',
		'drop',
		{ site },
		null
	);
}

/**
 * Install a fresh site with only the given plugins ever activated.
 *
 * @param {string}   site    Fresh site name (see e2e/drop-ins/db.php).
 * @param {string[]} plugins Plugin slugs to activate, in order.
 * @return {Promise<Object>} Helpers bound to the site: `headers`, `wp()`,
 *                           `script()`, `state()`, `seedEvent()`, `seed()`.
 */
export async function installFreshSite(site, plugins) {
	await dropFreshSite(site);
	await wp(
		[
			'core',
			'install',
			`--url=${BASE_URL}`,
			'--title=Fresh install',
			`--admin_user=${ADMIN_USER}`,
			`--admin_password=${ADMIN_PASSWORD}`,
			'--admin_email=fresh-install@example.test',
			'--skip-email',
		],
		site
	);
	for (const plugin of plugins) {
		await wp(['plugin', 'activate', plugin], site);
	}
	await wp(['rewrite', 'structure', '/%postname%/', '--hard'], site);

	const helpers = {
		site,
		headers: { [FRESH_SITE_HEADER]: site },
		wp: (args) => wp(args, site),
		script: (script, marker, action, data = {}) =>
			evalScript(script, marker, action, data, site),
		state: () =>
			evalScript(
				'fresh-install.php',
				'E2E_FRESH_INSTALL',
				'state',
				{},
				site
			),
		seed: (data) =>
			evalScript(
				'fresh-install.php',
				'E2E_FRESH_INSTALL',
				'seed',
				data,
				site
			),
		/**
		 * Seed an event through the plugin-independent seed-event.php.
		 *
		 * @param {string} flavour seed-event.php flavour.
		 * @return {Promise<Object>} Its E2E_SEED payload.
		 */
		seedEvent: async (flavour = 'paid') => {
			const stdout = await wp(
				[
					'eval-file',
					'wp-content/mu-plugins/scripts/seed-event.php',
					flavour,
				],
				site
			);
			const match = stdout.match(/E2E_SEED:(\{.*\})/);
			if (!match) {
				throw new Error(`Expected E2E_SEED output, got:\n${stdout}`);
			}
			return JSON.parse(match[1]);
		},
	};
	return helpers;
}
