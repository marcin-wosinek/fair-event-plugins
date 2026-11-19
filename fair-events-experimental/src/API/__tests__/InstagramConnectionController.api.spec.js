/**
 * Playwright API tests for InstagramConnectionController: the connection
 * managed in Fair Events → Instagram (#2076), connected through Meta's
 * Unified Login (#2427).
 *
 * The tests site is its own Fair Platform OAuth service
 * (e2e/mu-plugins/fair-e2e-instagram-unified-login.php answers Meta's OAuth
 * calls by authorization code), so each connection runs the real flow:
 * start here, the platform's authorize and callback endpoints, the return
 * with a handoff code, and server-side redemption with the verifier.
 * e2e/mu-plugins/fair-e2e-protected-credentials.php answers the connection
 * test and publishing on graph.facebook.com and records each token sent.
 *
 * Covers administrator-only access, the mandatory reconnection of a
 * connection stored before Unified Login, authorization parameters, state
 * and handoff validation and single use, cancellation and every failure,
 * paged account lists and the administrator's choice between several shared
 * accounts (#2429), the token lifecycle, publishing, disconnecting, and Fair Audience's
 * /wp/v2/settings surface stepping aside while the connection is managed
 * here. The feature stays off until an administrator turns it on.
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
const UNIFIED_TOKEN = 'e2e-ig-unified-ok';
const REVOKED_TOKEN = 'e2e-ig-revoked-token-555';
const REDEEM_PATH = '/wp-json/fair-platform/v1/instagram/redeem';
const POSTS_PATH = '/wp-json/fair-audience/v1/instagram/posts';
const INSTAGRAM_OPTIONS = [
	'fair_audience_instagram_access_token',
	'fair_audience_instagram_user_id',
	'fair_audience_instagram_username',
	'fair_audience_instagram_connected',
	'fair_audience_instagram_token_expires',
	'fair_audience_instagram_connection_format',
	'fair_audience_instagram_token_type',
	'fair_audience_instagram_scopes',
	'fair_audience_instagram_token_expiry',
	'fair_audience_instagram_graph_version',
];
const METADATA_OPTIONS = INSTAGRAM_OPTIONS.slice( 5 );

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
	let otherAdminId;
	let otherAdminHeaders;

	/** The tokens sent to graph.facebook.com since the last reset. */
	async function graphRequests() {
		return JSON.parse(
			await php(
				"echo wp_json_encode( get_option( 'fair_e2e_credential_requests', array() ) );"
			)
		);
	}

	/**
	 * GET a platform URL without following its own redirect. WordPress's
	 * canonical 301 (adding the permalink's trailing slash) is followed, as
	 * a browser would.
	 *
	 * @param {string} url URL.
	 * @return {Promise<import('@playwright/test').APIResponse>} Response.
	 */
	async function platformGet( url ) {
		let response = await api.get( url, { maxRedirects: 0 } );
		for ( let i = 0; i < 2 && response.status() === 301; i++ ) {
			response = await api.get(
				new URL( response.headers().location, BASE_URL ).toString(),
				{ maxRedirects: 0 }
			);
		}
		return response;
	}

	/**
	 * Start connecting here and follow the platform until it returns to
	 * Fair Events → Instagram, answering Meta's dialog with `meta`.
	 *
	 * @param {Object}  meta                Query Meta's dialog sends back (code or error).
	 * @param {Object}  [options]           Options.
	 * @param {boolean} [options.olderSite] Leave out `account_choice`, as a site from before #2429 does.
	 * @param {Object}  [options.headers]   Who starts the attempt.
	 * @return {Promise<Object>} The URLs and the return parameters.
	 */
	async function authorize(
		meta,
		{ olderSite = false, headers = adminHeaders } = {}
	) {
		const start = await api.post( `${ PATH }/authorize`, { headers } );
		expect( start.status(), await start.text() ).toBe( 200 );
		const authorizeUrl = new URL( ( await start.json() ).authorize_url );
		if ( olderSite ) {
			authorizeUrl.searchParams.delete( 'account_choice' );
		}

		const toMeta = await platformGet( authorizeUrl.toString() );
		expect( toMeta.status(), await toMeta.text() ).toBe( 302 );
		const dialog = new URL( toMeta.headers().location );

		const callback = new URL( '/oauth/instagram/callback', BASE_URL );
		callback.searchParams.set(
			'state',
			dialog.searchParams.get( 'state' )
		);
		for ( const [ key, value ] of Object.entries( meta ) ) {
			callback.searchParams.set( key, value );
		}
		const back = await platformGet( callback.toString() );
		expect( back.status(), await back.text() ).toBe( 302 );
		const returned = new URL( back.headers().location );

		return {
			authorizeUrl,
			dialog,
			callback,
			returned,
			state: returned.searchParams.get( 'state' ),
			handoff: returned.searchParams.get( 'instagram_handoff' ) || '',
			error: returned.searchParams.get( 'instagram_error' ) || '',
		};
	}

	/** Complete a return the way the page does. */
	function complete(
		{ state, handoff = '', error = '' },
		headers = adminHeaders
	) {
		return api.post( `${ PATH }/complete`, {
			headers,
			data: { state, handoff, error },
		} );
	}

	/** Confirm an account of a pending choice. */
	function confirmChoice( choice, accountId, headers = adminHeaders ) {
		return api.post( `${ PATH }/choice`, {
			headers,
			data: { choice, account_id: accountId },
		} );
	}

	/** Cancel a pending choice. */
	function cancelChoice( choice, headers = adminHeaders ) {
		return api.delete(
			`${ PATH }/choice?choice=${ encodeURIComponent( choice ) }`,
			{ headers }
		);
	}

	/** Return from Meta with several accounts and get the pending choice. */
	async function startChoice( code = 'e2e-code-multiple' ) {
		const response = await complete( await authorize( { code } ) );
		expect( response.status(), await response.text() ).toBe( 200 );
		const body = await response.json();
		expect( body.pending_choice, code ).toBeTruthy();
		return body;
	}

	/** The connection as the administrator sees it. */
	async function current( headers = adminHeaders ) {
		return ( await api.get( PATH, { headers } ) ).json();
	}

	/** Connect with an authorization code scenario. */
	async function connect( code ) {
		const result = await authorize( { code } );
		const response = await complete( result );
		expect( response.status(), await response.text() ).toBe( 200 );
		return response.json();
	}

	/** Seed a connection stored before Unified Login (Instagram Login). */
	async function seedLegacy() {
		await php(
			METADATA_OPTIONS.map( ( o ) => `delete_option( '${ o }' );` ).join(
				' '
			) +
				` update_option( 'fair_audience_instagram_access_token', '${ LEGACY_TOKEN }' ); update_option( 'fair_audience_instagram_user_id', '17841400000000009' ); update_option( 'fair_audience_instagram_username', 'e2e_legacy' ); update_option( 'fair_audience_instagram_connected', true ); update_option( 'fair_audience_instagram_token_expires', 1900000000 );`
		);
	}

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

		const otherLogin = `e2e_ig_admin_${ Date.now() }`;
		otherAdminId = (
			await wp(
				'user',
				'create',
				otherLogin,
				`${ otherLogin }@example.test`,
				'--role=administrator',
				'--user_pass=password',
				'--porcelain'
			)
		).trim();
		otherAdminHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ otherLogin }:password` ).toString( 'base64' ),
		};

		// A connection as Fair Audience stored it, before the move and
		// before Unified Login.
		await setFeature( false );
		await seedLegacy();
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
		if ( otherAdminId ) {
			await wp( 'user', 'delete', otherAdminId, '--yes' );
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
		// Fair Audience keeps holding the connection meanwhile.
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
				api.post( `${ PATH }/authorize`, {
					headers: subscriberHeaders,
				} ),
			() =>
				api.post( `${ PATH }/complete`, {
					headers: subscriberHeaders,
					data: { state: 'x'.repeat( 32 ) },
				} ),
			() => api.delete( PATH, { headers: subscriberHeaders } ),
			() => api.post( `${ PATH }/test`, { headers: subscriberHeaders } ),
			() =>
				confirmChoice(
					'c'.repeat( 32 ),
					'17841400000000001',
					subscriberHeaders
				),
			() => cancelChoice( 'c'.repeat( 32 ), subscriberHeaders ),
		] ) {
			expect( ( await call() ).status() ).toBe( 403 );
		}
		for ( const call of [
			() =>
				api.post( `${ PATH }/choice`, {
					data: {
						choice: 'c'.repeat( 32 ),
						account_id: '17841400000000001',
					},
				} ),
			() => api.delete( `${ PATH }/choice?choice=${ 'c'.repeat( 32 ) }` ),
		] ) {
			expect( ( await call() ).status() ).toBe( 401 );
		}
	} );

	test( 'manual token entry is gone', async () => {
		for ( const call of [
			() =>
				api.post( PATH, {
					headers: adminHeaders,
					data: { access_token: 'e2e-ig-typed' },
				} ),
			() =>
				api.post( `${ PATH }/user-id`, {
					headers: adminHeaders,
					data: { user_id: '17841400000000003' },
				} ),
		] ) {
			expect( ( await call() ).status() ).toBe( 404 );
		}
	} );

	test( 'a connection from before Unified Login must be reconnected, and is never used', async () => {
		const response = await api.get( PATH, { headers: adminHeaders } );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();

		expect( body ).toMatchObject( {
			managed_here: true,
			ownership_reason: 'managed_here',
			connected: true,
			usable: false,
			credential_status: 'reconnect_required',
			connection_format: null,
			user_id: '17841400000000009',
			username: 'e2e_legacy',
		} );
		expect( body.message ).toContain( 'Instagram needs to be reconnected' );
		expect( JSON.stringify( body ) ).not.toContain( LEGACY_TOKEN );

		// Still stored, and encrypted at rest once this plugin protects it.
		const raw = await rawToken();
		expect( raw ).not.toBe( '' );
		expect( raw ).not.toContain( LEGACY_TOKEN );
		expect( body.credentials_encrypted ).toBe( true );

		await php( "delete_option( 'fair_e2e_credential_requests' );" );
		const tested = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( tested.status() ).toBe( 409 );
		const posted = await api.post( POSTS_PATH, {
			headers: adminHeaders,
			data: {
				image_url: 'https://example.com/e2e-2427.png',
				caption: 'E2E legacy connection',
			},
		} );
		expect( posted.status() ).toBe( 400 );
		expect( await graphRequests() ).toEqual( [] );

		// Nothing renews it: the retired renewal endpoint is gone.
		const refresh = await api.post( '/oauth/instagram/refresh/', {
			form: { access_token: 'e2e-ig-anything' },
		} );
		expect( refresh.status() ).toBe( 410 );
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
			usable: false,
			reconnect_required: true,
		} );
	} );

	test( 'starts Unified Login with the configuration, the code grant and only a challenge', async () => {
		const { authorizeUrl, dialog } = await authorize( {
			error: 'access_denied',
			error_reason: 'user_denied',
		} );

		expect( authorizeUrl.pathname ).toBe( '/oauth/instagram/authorize' );
		expect( authorizeUrl.searchParams.get( 'protocol' ) ).toBe( '2' );
		expect( authorizeUrl.searchParams.get( 'return_url' ) ).toBe(
			`${ BASE_URL }/wp-admin/admin.php?page=fair-events-instagram`
		);
		expect( authorizeUrl.searchParams.get( 'code_challenge' ) ).toMatch(
			/^[A-Za-z0-9_-]{43}$/
		);
		expect( authorizeUrl.searchParams.has( 'code_verifier' ) ).toBe(
			false
		);

		expect( dialog.origin ).toBe( 'https://www.facebook.com' );
		expect( dialog.pathname ).toBe( '/v27.0/dialog/oauth' );
		expect( Object.fromEntries( dialog.searchParams ) ).toMatchObject( {
			client_id: '880000000000001',
			config_id: '880000000000002',
			redirect_uri: `${ BASE_URL }/oauth/instagram/callback`,
			response_type: 'code',
			override_default_response_type: 'true',
		} );
		expect( dialog.searchParams.has( 'scope' ) ).toBe( false );
		expect( dialog.toString() ).not.toContain( 'e2e-meta-app-secret' );
	} );

	test( 'the platform refuses outdated clients and unapproved return destinations', async () => {
		const outdated = await platformGet(
			`/oauth/instagram/authorize?site_id=ZTJl&return_url=${ encodeURIComponent(
				`${ BASE_URL }/wp-admin/admin.php?page=fair-events-instagram`
			) }`
		);
		expect( outdated.status() ).toBe( 400 );
		expect( await outdated.text() ).toContain(
			'Update Fair Events Experimental'
		);

		const start = await api.post( `${ PATH }/authorize`, {
			headers: adminHeaders,
		} );
		const tampered = new URL( ( await start.json() ).authorize_url );
		for ( const returnUrl of [
			'https://evil.example/wp-admin/admin.php?page=fair-events-instagram',
			`${ BASE_URL }/wp-admin/admin.php?page=fair-events-instagram&next=https://evil.example`,
			`${ BASE_URL }/wp-admin/admin.php?page=other`,
		] ) {
			tampered.searchParams.set( 'return_url', returnUrl );
			const refused = await platformGet( tampered.toString() );
			expect( refused.status(), returnUrl ).toBe( 400 );
		}
	} );

	test( 'the callback consumes its state before anything else', async () => {
		const unknown = await platformGet(
			`/oauth/instagram/callback?code=e2e-code-ok&state=${ 'u'.repeat(
				43
			) }`
		);
		expect( unknown.status() ).toBe( 400 );

		const { callback } = await authorize( {
			error: 'access_denied',
			error_reason: 'user_denied',
		} );
		// The same state again, now with a code: already used.
		callback.searchParams.delete( 'error' );
		callback.searchParams.delete( 'error_reason' );
		callback.searchParams.set( 'code', 'e2e-code-ok' );
		const replayed = await platformGet( callback.toString() );
		expect( replayed.status() ).toBe( 400 );
	} );

	test( 'a cancelled authorization changes nothing', async () => {
		const result = await authorize( {
			error: 'access_denied',
			error_reason: 'user_denied',
		} );
		expect( result.error ).toBe( 'cancelled' );
		expect( result.handoff ).toBe( '' );

		const response = await complete( result );
		expect( response.status() ).toBe( 400 );
		expect( await response.json() ).toMatchObject( {
			code: 'instagram_authorization_failed',
			message:
				'Instagram authorization was cancelled. Nothing was changed.',
			data: { reason: 'cancelled' },
		} );

		// The earlier connection is kept, and still not usable.
		const body = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( body.credential_status ).toBe( 'reconnect_required' );
		expect( body.username ).toBe( 'e2e_legacy' );
	} );

	test( 'failed exchanges, a failed later page of accounts, missing permission, and zero accounts store nothing', async () => {
		const raw = await rawToken();
		for ( const [ code, reason, message ] of [
			[ 'e2e-code-bad', 'failed', 'Instagram authorization failed' ],
			[
				'e2e-code-noperm',
				'insufficient_permissions',
				'permission to publish',
			],
			[
				'e2e-code-none',
				'no_account',
				'No Instagram professional account',
			],
			[ 'e2e-code-pagefail', 'failed', 'Instagram authorization failed' ],
		] ) {
			const result = await authorize( { code } );
			expect( result.handoff, code ).toBe( '' );

			const response = await complete( result );
			expect( response.status(), code ).toBe( 400 );
			const error = await response.json();
			expect( error.data.reason, code ).toBe( reason );
			expect( error.message, code ).toContain( message );
		}
		expect( await rawToken() ).toBe( raw );
	} );

	test( 'a return that does not belong to this administrator’s attempt is refused', async () => {
		const result = await authorize( { code: 'e2e-code-ok' } );

		const response = await complete( {
			...result,
			state: 's'.repeat( 32 ),
		} );
		expect( response.status() ).toBe( 400 );
		expect( ( await response.json() ).code ).toBe(
			'instagram_authorization_unknown'
		);

		// The mismatch used the attempt up, and the earlier connection stays.
		const retried = await complete( result );
		expect( retried.status() ).toBe( 400 );
		expect(
			(
				await (
					await api.get( PATH, { headers: adminHeaders } )
				).json()
			).credential_status
		).toBe( 'reconnect_required' );
	} );

	test( 'a handoff code works once, and only with the verifier', async () => {
		const result = await authorize( { code: 'e2e-code-ok' } );

		// Anyone holding the return URL but not the verifier gets nothing,
		// and the attempt burns the code.
		const guessed = await api.post( REDEEM_PATH, {
			form: {
				handoff: result.handoff,
				code_verifier: 'v'.repeat( 64 ),
				site_url: BASE_URL,
			},
		} );
		expect( guessed.status() ).toBe( 400 );
		expect( await guessed.text() ).not.toContain( UNIFIED_TOKEN );

		const response = await complete( result );
		expect( response.status() ).toBe( 502 );
		expect( ( await response.json() ).code ).toBe(
			'instagram_handoff_failed'
		);
		expect(
			(
				await (
					await api.get( PATH, { headers: adminHeaders } )
				).json()
			).credential_status
		).toBe( 'reconnect_required' );
	} );

	test( 'connects through Unified Login, replacing the earlier connection, without the token in any URL or response', async () => {
		const result = await authorize( { code: 'e2e-code-ok' } );
		expect( result.returned.toString() ).not.toContain( UNIFIED_TOKEN );
		expect( result.returned.pathname ).toBe( '/wp-admin/admin.php' );
		expect( result.handoff ).toMatch( /^[A-Za-z0-9_-]{43}$/ );

		const response = await complete( result );
		expect( response.status(), await response.text() ).toBe( 200 );
		const body = await response.json();
		expect( body ).toMatchObject( {
			managed_here: true,
			connected: true,
			usable: true,
			credential_status: 'available',
			credentials_encrypted: true,
			connection_format: 'unified_login',
			token_type: 'system_user',
			token_expiry: 'never',
			token_expires: null,
			user_id: '17841400000000001',
			username: 'e2e_unified_club',
		} );
		expect( JSON.stringify( body ) ).not.toContain( UNIFIED_TOKEN );
		expect( await rawToken() ).not.toContain( UNIFIED_TOKEN );

		// The redeemed handoff cannot be redeemed again.
		const again = await api.post( REDEEM_PATH, {
			form: {
				handoff: result.handoff,
				code_verifier: 'v'.repeat( 64 ),
				site_url: BASE_URL,
			},
		} );
		expect( again.status() ).toBe( 400 );
	} );

	test( 'an account listed on several pages connects automatically', async () => {
		const body = await connect( 'e2e-code-paged' );
		expect( body ).toMatchObject( {
			connected: true,
			user_id: '17841400000000001',
			username: 'e2e_unified_club',
			pending_choice: null,
		} );
	} );

	test( 'a site from before account choice keeps the several-accounts outcome', async () => {
		const raw = await rawToken();
		const result = await authorize(
			{ code: 'e2e-code-multiple' },
			{ olderSite: true }
		);
		expect( result.handoff ).toBe( '' );
		expect( result.error ).toBe( 'multiple_accounts' );

		const response = await complete( result );
		expect( response.status() ).toBe( 400 );
		expect( ( await response.json() ).data.reason ).toBe(
			'multiple_accounts'
		);
		expect( await rawToken() ).toBe( raw );
	} );

	test( 'several accounts over several pages become this administrator’s choice, with the token kept on the server', async () => {
		const raw = await rawToken();
		const body = await startChoice();

		// Each account once, in Meta's order, by ID and username only.
		expect( body.pending_choice.accounts ).toEqual( [
			{ id: '17841400000000001', username: 'e2e_unified_club' },
			{ id: '17841400000000002', username: 'e2e_other_club' },
		] );
		expect( body.pending_choice.id ).toMatch( /^[A-Za-z0-9_-]{32}$/ );
		expect( JSON.stringify( body ) ).not.toContain(
			'e2e-ig-unified-multiple'
		);
		// Nothing is connected until the administrator confirms.
		expect( body ).toMatchObject( {
			connected: true,
			user_id: '17841400000000001',
		} );
		expect( await rawToken() ).toBe( raw );
		expect(
			await php(
				"global $wpdb; echo (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE option_value LIKE %s', $wpdb->options, '%e2e-ig-unified-multiple%' ) );"
			)
		).toBe( '0' );

		// The choice is the administrator's own, and survives a reload.
		expect( ( await current() ).pending_choice ).toEqual(
			body.pending_choice
		);
		expect( ( await current( otherAdminHeaders ) ).pending_choice ).toBe(
			null
		);

		// The platform did not record a candidate as the connected account.
		expect(
			await php(
				"global $wpdb; $row = $wpdb->get_row( $wpdb->prepare( 'SELECT status, instagram_user_id FROM %i ORDER BY id DESC LIMIT 1', $wpdb->prefix . 'fair_platform_instagram_connections' ), ARRAY_A ); echo wp_json_encode( $row );"
			)
		).toBe( '{"status":"choice_pending","instagram_user_id":""}' );

		await cancelChoice( body.pending_choice.id );
	} );

	test( 'only the administrator’s current choice and one of its accounts can be confirmed', async () => {
		const raw = await rawToken();
		const { pending_choice: choice } = await startChoice();

		for ( const [ label, call, status, code ] of [
			[
				'unlisted account',
				() => confirmChoice( choice.id, '17841400000000003' ),
				400,
				'instagram_choice_invalid',
			],
			[
				'malformed account',
				() => confirmChoice( choice.id, '1784 or 1=1' ),
				400,
				'rest_invalid_param',
			],
			[
				'stale choice ID',
				() => confirmChoice( 'stale'.repeat( 7 ), '17841400000000002' ),
				409,
				'instagram_choice_unknown',
			],
			[
				'another administrator',
				() =>
					confirmChoice(
						choice.id,
						'17841400000000002',
						otherAdminHeaders
					),
				409,
				'instagram_choice_unknown',
			],
			[
				'stale cancel',
				() => cancelChoice( 'stale'.repeat( 7 ) ),
				409,
				'instagram_choice_unknown',
			],
		] ) {
			const response = await call();
			expect( response.status(), label ).toBe( status );
			expect( ( await response.json() ).code, label ).toBe( code );
		}

		// None of those changed the connection or used up the choice.
		expect( await rawToken() ).toBe( raw );
		expect( ( await current() ).pending_choice ).toEqual( choice );

		const confirmed = await confirmChoice( choice.id, '17841400000000002' );
		expect( confirmed.status(), await confirmed.text() ).toBe( 200 );
		const body = await confirmed.json();
		expect( body ).toMatchObject( {
			connected: true,
			usable: true,
			credential_status: 'available',
			user_id: '17841400000000002',
			username: 'e2e_other_club',
			pending_choice: null,
		} );
		expect( JSON.stringify( body ) ).not.toContain(
			'e2e-ig-unified-multiple'
		);
		expect( await rawToken() ).not.toBe( raw );
		expect( await rawToken() ).not.toContain( 'e2e-ig-unified-multiple' );

		// A repeat, as from a second tab, finds nothing to confirm.
		const raw2 = await rawToken();
		const again = await confirmChoice( choice.id, '17841400000000001' );
		expect( again.status() ).toBe( 409 );
		expect( ( await again.json() ).code ).toBe(
			'instagram_choice_unknown'
		);
		expect( await rawToken() ).toBe( raw2 );
		expect( ( await current() ).user_id ).toBe( '17841400000000002' );
	} );

	test( 'a cancelled or superseded choice cannot replace the connection', async () => {
		const raw = await rawToken();

		const { pending_choice: cancelled } = await startChoice();
		const cancel = await cancelChoice( cancelled.id );
		expect( cancel.status(), await cancel.text() ).toBe( 200 );
		expect( ( await cancel.json() ).pending_choice ).toBe( null );
		expect(
			(
				await confirmChoice( cancelled.id, '17841400000000001' )
			).status()
		).toBe( 409 );

		// A new attempt replaces a choice still open in another tab.
		const { pending_choice: superseded } = await startChoice();
		const start = await api.post( `${ PATH }/authorize`, {
			headers: adminHeaders,
		} );
		expect( start.status() ).toBe( 200 );
		expect( ( await current() ).pending_choice ).toBe( null );
		expect(
			(
				await confirmChoice( superseded.id, '17841400000000001' )
			).status()
		).toBe( 409 );

		// Cancelling when nothing is pending changes nothing.
		expect( ( await cancelChoice( superseded.id ) ).status() ).toBe( 200 );

		expect( await rawToken() ).toBe( raw );
		expect( ( await current() ).user_id ).toBe( '17841400000000002' );
	} );

	test( 'an account without a username in the list is identified before the choice', async () => {
		const { pending_choice: choice } =
			await startChoice( 'e2e-code-unnamed' );
		expect( choice.accounts ).toEqual( [
			{ id: '17841400000000001', username: 'e2e_unified_club' },
			{ id: '17841400000000002', username: 'e2e_other_club' },
		] );
		await cancelChoice( choice.id );

		// Back to the connection the following tests use.
		await connect( 'e2e-code-ok' );
	} );

	test( 'tests the connection on graph.facebook.com', async () => {
		await php( "delete_option( 'fair_e2e_credential_requests' );" );
		const response = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( response.status(), await response.text() ).toBe( 200 );
		const body = await response.json();
		// The page replaces its connection state with this response, so it
		// carries the ownership fields too (#2425).
		expect( body ).toMatchObject( {
			success: true,
			message:
				'The connection works: Meta confirmed the account @e2e_demo_account.',
			usable: true,
			user_id: '17841400000000001',
			username: 'e2e_demo_account',
			managed_here: true,
			ownership_reason: 'managed_here',
		} );
		expect( JSON.stringify( body ) ).not.toContain( UNIFIED_TOKEN );
		expect( await graphRequests() ).toEqual( [
			{ service: 'instagram_graph', token: UNIFIED_TOKEN },
		] );
	} );

	test( 'manual posting in Fair Audience publishes on graph.facebook.com with the new connection', async () => {
		test.setTimeout( 90_000 );
		await php( "delete_option( 'fair_e2e_credential_requests' );" );
		const response = await api.post( POSTS_PATH, {
			headers: adminHeaders,
			data: {
				image_url: 'https://example.com/e2e-2427.png',
				caption: 'E2E manual post through Unified Login',
			},
		} );
		expect( response.status(), await response.text() ).toBe( 200 );
		const { post } = await response.json();
		expect( post.status ).toBe( 'published' );

		const sent = await graphRequests();
		expect( sent.length ).toBeGreaterThan( 0 );
		expect(
			sent.every(
				( entry ) =>
					entry.service === 'instagram_graph' &&
					entry.token === UNIFIED_TOKEN
			)
		).toBe( true );

		await api.delete( `${ POSTS_PATH }/${ post.id }`, {
			headers: adminHeaders,
		} );
	} );

	test( 'a token with a finite expiry is stored with it, and not renewed', async () => {
		const body = await connect( 'e2e-code-expiring' );
		expect( body.token_expiry ).toBe( 'expires' );
		expect( body.token_expires ).toBeGreaterThan(
			Date.now() / 1000 + 29 * 86400
		);
		expect(
			await php(
				"echo (int) wp_next_scheduled( 'fair_events_experimental_instagram_token_refresh' );"
			)
		).toBe( '0' );
	} );

	test( 'reports a revoked token without echoing it', async () => {
		await php(
			`update_option( 'fair_audience_instagram_access_token', '${ REVOKED_TOKEN }' );`
		);
		const response = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( response.status() ).toBe( 401 );
		const text = await response.text();
		expect( text ).toContain( 'instagram_token_invalid' );
		expect( text ).not.toContain( REVOKED_TOKEN );
	} );

	test( 'disconnects locally and removes the token and its metadata', async () => {
		const response = await api.delete( PATH, { headers: adminHeaders } );
		expect( response.status() ).toBe( 200 );
		expect( await response.json() ).toMatchObject( {
			connected: false,
			usable: false,
			user_id: '',
			username: '',
			connection_format: null,
		} );
		expect( await rawToken() ).toBe( '' );
		const metadata = await php(
			`$names = explode( ',', '${ METADATA_OPTIONS.join(
				','
			) }' ); echo wp_json_encode( array_map( function ( $o ) { return get_option( $o, null ); }, $names ) );`
		);
		expect( JSON.parse( metadata ) ).toEqual(
			METADATA_OPTIONS.map( () => null )
		);
	} );

	test( 'manual posting says where to reconnect once disconnected', async () => {
		const response = await api.post( POSTS_PATH, {
			headers: adminHeaders,
			data: {
				image_url: 'https://example.com/e2e-2427.png',
				caption: 'E2E manual post without a connection',
			},
		} );
		expect( response.status() ).toBe( 400 );
		const body = await response.json();
		expect( body.code ).toBe( 'instagram_not_connected' );
		expect( body.message ).toContain( 'Fair Events → Instagram' );
	} );

	test( 'with the feature off, the routes are gone and Fair Audience holds the connection again', async () => {
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
