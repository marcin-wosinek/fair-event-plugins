/**
 * Shared helpers for the Fair Platform connection log API specs: the
 * test-site URL, admin Basic Auth, and the platform-connections.php WP-CLI
 * fixture (e2e/mu-plugins/scripts/platform-connections.php).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

export const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
export const admin = basic( ADMIN_USER, ADMIN_PASSWORD );

// Non-blocking, so idle keep-alive sockets are not closed under a long
// synchronous fixture run ("socket hang up").
export async function fixture( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/platform-connections.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_PLATFORM_CONNECTIONS:(.*)$/m );
	if ( ! match ) {
		throw new Error(
			`Expected platform connections output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}
