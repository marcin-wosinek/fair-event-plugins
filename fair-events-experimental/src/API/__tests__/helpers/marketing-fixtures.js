/**
 * Shared fixtures of the marketing asset API specs (#2396, #2430): WP-CLI
 * on the tests instance, Basic Auth headers and the bundle switch.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
export const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
export const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

export const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
export const FEATURES_OPTION = 'fair_events_experimental_features';

export const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
export const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

export const assetsPath = ( id ) =>
	`${ EVENT_DATES_PATH }/${ id }/marketing-assets`;

/**
 * Run WP-CLI on the tests instance without blocking the event loop.
 *
 * @param {...string} args WP-CLI arguments.
 * @return {Promise<string>} Standard output.
 */
export async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{
			cwd: new URL( '../../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	return stdout;
}

/**
 * Evaluate PHP and parse the JSON it echoes after `JSON:`.
 *
 * @param {string} php PHP code.
 * @return {Promise<*>} Parsed value.
 */
export async function evalJson( php ) {
	const out = await wp( 'eval', php );
	return JSON.parse( out.slice( out.indexOf( 'JSON:' ) + 5 ).trim() );
}

/**
 * Store the experimental bundles. Omitted keys keep their stored value.
 *
 * @param {Object} bundles Bundle → enabled.
 * @return {Promise<string>} WP-CLI output.
 */
export const setBundles = ( bundles ) =>
	wp(
		'option',
		'update',
		FEATURES_OPTION,
		JSON.stringify( bundles ),
		'--format=json'
	);
