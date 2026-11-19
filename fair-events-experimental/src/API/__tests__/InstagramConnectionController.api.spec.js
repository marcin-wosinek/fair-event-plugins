/**
 * Playwright API tests for InstagramConnectionController (#2076): the
 * Instagram connection moves from Fair Audience to Fair Events → Instagram
 * without re-entering credentials.
 *
 * Covers administrator-only access, reading a connection Fair Audience
 * stored, the token never appearing in a response, encryption at rest,
 * validation, the connection test (e2e/mu-plugins/fair-e2e-protected-credentials.php
 * answers graph.instagram.com), disconnecting, and Fair Audience's
 * /wp/v2/settings surface stepping aside while the connection is managed
 * here and coming back when the feature is off. The feature stays off until
 * an administrator turns it on: a stored connection alone never does.
 *
 * The suite restores the feature option and removes every Instagram option
 * it wrote afterwards.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/instagram/connection';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const CREDENTIALS_PATH = '/wp-json/fair-audience/v1/instagram/credentials';
const LEGACY_TOKEN = 'e2e-ig-legacy-token-0123456789';
const NEW_TOKEN = 'e2e-ig-new-token-9876543210';
const REVOKED_TOKEN = 'e2e-ig-revoked-token-555';
const POSTS_PATH = '/wp-json/fair-audience/v1/instagram/posts';
const INSTAGRAM_OPTIONS = [
	'fair_audience_instagram_access_token',
	'fair_audience_instagram_user_id',
	'fair_audience_instagram_username',
	'fair_audience_instagram_connected',
	'fair_audience_instagram_token_expires',
];

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

/** Run WP-CLI on the tests instance without blocking the event loop. */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	return stdout;
}

/** Run PHP on the tests instance and return what it echoed. */
async function php( code ) {
	return ( await wp( 'eval', code ) ).trim();
}

/** Turn this plugin's Instagram feature on or off. */
async function setFeature( enabled ) {
	await php(
		`$f = get_option( 'fair_events_experimental_features', array() ); $f = is_array( $f ) ? $f : array(); $f['instagram'] = ${
			enabled ? 'true' : 'false'
		}; update_option( 'fair_events_experimental_features', $f );`
	);
}

/**
 * Remove this plugin's stored Instagram choice, so its default applies. The
 * option is rewritten because its sanitizer keeps keys a write leaves out.
 */
async function unsetFeature() {
	await php(
		"$f = get_option( 'fair_events_experimental_features', array() ); $f = is_array( $f ) ? $f : array(); unset( $f['instagram'] ); delete_option( 'fair_events_experimental_features' ); if ( $f ) { add_option( 'fair_events_experimental_features', $f ); }"
	);
}

/** The stored token exactly as it is in the database. */
async function rawToken() {
	return php(
		"global $wpdb; echo (string) $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, 'fair_audience_instagram_access_token' ) );"
	);
}

test.describe( 'InstagramConnectionController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let previousFeatures;
	let subscriberId;
	let subscriberHeaders;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		previousFeatures = await php(
			"echo wp_json_encode( get_option( 'fair_events_experimental_features', null ) );"
		);

		const login = `e2e_ig_subscriber_${ Date.now() }`;
		subscriberId = (
			await wp(
				'user',
				'create',
				login,
				`${ login }@example.test`,
				'--role=subscriber',
				'--user_pass=password',
				'--porcelain'
			)
		).trim();
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ login }:password` ).toString( 'base64' ),
		};

		// A connection as Fair Audience stored it, before the move.
		await setFeature( false );
		await php(
			`update_option( 'fair_audience_instagram_access_token', '${ LEGACY_TOKEN }' ); update_option( 'fair_audience_instagram_user_id', '17841400000000009' ); update_option( 'fair_audience_instagram_username', 'e2e_legacy' ); update_option( 'fair_audience_instagram_connected', true ); update_option( 'fair_audience_instagram_token_expires', 1900000000 );`
		);
		await setFeature( true );
	} );

	test.afterAll( async () => {
		await php(
			INSTAGRAM_OPTIONS.map( ( o ) => `delete_option( '${ o }' );` ).join(
				' '
			) + " delete_option( 'fair_e2e_credential_requests' );"
		);
		const previous = JSON.parse( previousFeatures || 'null' );
		if ( previous === null ) {
			await wp(
				'option',
				'delete',
				'fair_events_experimental_features'
			).catch( () => {} );
		} else {
			await php(
				`update_option( 'fair_events_experimental_features', json_decode( '${ JSON.stringify(
					previous
				) }', true ) );`
			);
		}
		if ( subscriberId ) {
			await wp( 'user', 'delete', subscriberId, '--yes' );
		}
		await api.dispose();
	} );

	test( 'a stored connection does not turn the feature on', async () => {
		await unsetFeature();

		// Several requests: nothing turns the feature on along the way.
		for ( let i = 0; i < 2; i++ ) {
			expect(
				( await api.get( PATH, { headers: adminHeaders } ) ).status()
			).toBe( 404 );
		}
		expect(
			await php(
				"$f = get_option( 'fair_events_experimental_features', array() ); echo is_array( $f ) && array_key_exists( 'instagram', $f ) ? 'stored' : 'unset';"
			)
		).toBe( 'unset' );
		// Fair Audience keeps managing the connection meanwhile.
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		expect( settings ).toHaveProperty(
			'fair_audience_instagram_connected'
		);

		// An explicit choice turns it on.
		await setFeature( true );
		expect(
			( await api.get( PATH, { headers: adminHeaders } ) ).status()
		).toBe( 200 );
	} );

	test( 'refuses anonymous visitors and non-administrators', async () => {
		expect( ( await api.get( PATH ) ).status() ).toBe( 401 );
		for ( const call of [
			() => api.get( PATH, { headers: subscriberHeaders } ),
			() =>
				api.post( PATH, {
					headers: subscriberHeaders,
					data: { access_token: NEW_TOKEN },
				} ),
			() => api.delete( PATH, { headers: subscriberHeaders } ),
			() => api.post( `${ PATH }/test`, { headers: subscriberHeaders } ),
		] ) {
			expect( ( await call() ).status() ).toBe( 403 );
		}
	} );

	test( 'reads the connection Fair Audience stored, without the token', async () => {
		const response = await api.get( PATH, { headers: adminHeaders } );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();

		expect( body ).toMatchObject( {
			managed_here: true,
			ownership_reason: 'managed_here',
			legacy_manage_url: null,
			connected: true,
			usable: true,
			credential_status: 'available',
			user_id: '17841400000000009',
			username: 'e2e_legacy',
			token_expires: 1900000000,
		} );
		expect( JSON.stringify( body ) ).not.toContain( LEGACY_TOKEN );

		// Encrypted at rest once this plugin protects it.
		const raw = await rawToken();
		expect( raw ).not.toBe( '' );
		expect( raw ).not.toContain( LEGACY_TOKEN );
		expect( body.credentials_encrypted ).toBe( true );
	} );

	test( 'Fair Audience no longer offers the connection in /wp/v2/settings', async () => {
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		for ( const option of INSTAGRAM_OPTIONS ) {
			expect( settings ).not.toHaveProperty( option );
		}

		// Its credential status keeps answering for older callers.
		const credentials = await api.get( CREDENTIALS_PATH, {
			headers: adminHeaders,
		} );
		expect( credentials.status() ).toBe( 200 );
		expect( await credentials.json() ).toMatchObject( {
			usable: true,
		} );
	} );

	test( 'rejects malformed tokens and user IDs', async () => {
		for ( const accessToken of [ '', '   ', 'has space' ] ) {
			const response = await api.post( PATH, {
				headers: adminHeaders,
				data: { access_token: accessToken },
			} );
			expect( response.status() ).toBe( 400 );
		}
		const userId = await api.post( `${ PATH }/user-id`, {
			headers: adminHeaders,
			data: { user_id: '12ab' },
		} );
		expect( userId.status() ).toBe( 400 );
	} );

	test( 'tests the connection and stores the account Instagram names', async () => {
		const response = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();
		// The page replaces its connection state with this response, so it
		// carries the ownership fields too (#2425).
		expect( body ).toMatchObject( {
			success: true,
			message:
				'The connection works: Instagram confirmed the account @e2e_demo_account.',
			connected: true,
			usable: true,
			credential_status: 'available',
			credentials_encrypted: true,
			user_id: '17840000000000001',
			username: 'e2e_demo_account',
			managed_here: true,
			ownership_reason: 'managed_here',
			legacy_manage_url: null,
		} );
		expect( body ).not.toHaveProperty( 'access_token' );
		expect( JSON.stringify( body ) ).not.toContain( LEGACY_TOKEN );
	} );

	test( 'connects a new token, stored encrypted, replacing the account', async () => {
		const response = await api.post( PATH, {
			headers: adminHeaders,
			data: {
				access_token: NEW_TOKEN,
				user_id: '17841400000000002',
				username: '@e2e_new',
				expires_in: 5184000,
			},
		} );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();
		expect( body ).toMatchObject( {
			connected: true,
			usable: true,
			user_id: '17841400000000002',
			username: 'e2e_new',
		} );
		expect( body.token_expires ).toBeGreaterThan( Date.now() / 1000 );
		expect( JSON.stringify( body ) ).not.toContain( NEW_TOKEN );
		expect( await rawToken() ).not.toContain( NEW_TOKEN );

		const userId = await api.post( `${ PATH }/user-id`, {
			headers: adminHeaders,
			data: { user_id: '17841400000000003' },
		} );
		expect( ( await userId.json() ).user_id ).toBe( '17841400000000003' );
	} );

	test( 'manual posting in Fair Audience publishes with the shared connection', async () => {
		await php( "delete_option( 'fair_e2e_credential_requests' );" );
		const response = await api.post( POSTS_PATH, {
			headers: adminHeaders,
			data: {
				image_url: 'https://example.com/e2e-2076.png',
				caption: 'E2E manual post through the shared connection',
			},
		} );
		expect( response.status() ).toBe( 200 );
		const { post } = await response.json();
		expect( post.status ).toBe( 'published' );

		// The decrypted token this plugin stores was the one sent.
		const sent = JSON.parse(
			await php(
				"echo wp_json_encode( get_option( 'fair_e2e_credential_requests', array() ) );"
			)
		);
		expect( sent.length ).toBeGreaterThan( 0 );
		expect(
			sent.every(
				( entry ) =>
					entry.service === 'instagram' && entry.token === NEW_TOKEN
			)
		).toBe( true );

		await api.delete( `${ POSTS_PATH }/${ post.id }`, {
			headers: adminHeaders,
		} );
	} );

	test( 'reports a refused token without echoing it', async () => {
		await api.post( PATH, {
			headers: adminHeaders,
			data: { access_token: REVOKED_TOKEN },
		} );
		const response = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( response.status() ).toBe( 401 );
		const text = await response.text();
		expect( text ).toContain( 'instagram_token_invalid' );
		expect( text ).not.toContain( REVOKED_TOKEN );
	} );

	test( 'disconnects and removes the token', async () => {
		const response = await api.delete( PATH, { headers: adminHeaders } );
		expect( response.status() ).toBe( 200 );
		expect( await response.json() ).toMatchObject( {
			connected: false,
			usable: false,
			user_id: '',
			username: '',
		} );
		expect( await rawToken() ).toBe( '' );
	} );

	test( 'manual posting says where to reconnect once disconnected', async () => {
		const response = await api.post( POSTS_PATH, {
			headers: adminHeaders,
			data: {
				image_url: 'https://example.com/e2e-2076.png',
				caption: 'E2E manual post without a connection',
			},
		} );
		expect( response.status() ).toBe( 400 );
		const body = await response.json();
		expect( body.code ).toBe( 'instagram_not_connected' );
		expect( body.message ).toContain( 'Fair Events → Instagram' );
	} );

	test( 'with the feature off, the routes are gone and Fair Audience manages the connection again', async () => {
		await setFeature( false );

		expect(
			( await api.get( PATH, { headers: adminHeaders } ) ).status()
		).toBe( 404 );
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		expect( settings ).toHaveProperty(
			'fair_audience_instagram_connected'
		);

		await setFeature( true );
	} );
} );
