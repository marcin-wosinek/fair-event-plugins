/**
 * Instagram access token encrypted at rest (#1319), against a live WordPress.
 *
 * e2e/mu-plugins/fair-e2e-protected-credentials.php seeds the stored token
 * raw, toggles encryption support and the experimental Instagram bundle,
 * stands in for the Instagram APIs and records the token each request sent.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CONTROL = '/wp-json/fair-e2e/v1/protected-credentials';
const CREDENTIALS = '/wp-json/fair-audience/v1/instagram/credentials';
const TEST_CONNECTION = '/wp-json/fair-audience/v1/instagram/test-connection';
const POSTS = '/wp-json/fair-audience/v1/instagram/posts';
const SETTINGS = '/wp-json/wp/v2/settings';

const TOKEN_KEY = 'fair_audience_instagram_access_token';
const ENVELOPE = /^fes-enc:v1:/;
const DAY = 86400;

function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASS }` ).toString(
				'base64'
			),
	};
}

test.describe.configure( { mode: 'serial' } );

test.describe( 'Instagram access token encrypted at rest (#1319)', () => {
	let api;

	async function control( data ) {
		const res = await api.post( CONTROL, { headers: adminAuth(), data } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function stored() {
		const res = await api.get( CONTROL, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function credentials() {
		const res = await api.get( CREDENTIALS, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	function saveSettings( data ) {
		return api.post( SETTINGS, { headers: adminAuth(), data } );
	}

	async function connect( token ) {
		const res = await saveSettings( {
			[ TOKEN_KEY ]: token,
			fair_audience_instagram_user_id: '17840000000000001',
			fair_audience_instagram_username: 'e2e_demo_account',
			fair_audience_instagram_connected: true,
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res;
	}

	function instagramRequests( after ) {
		return after.requests.filter( ( r ) =>
			r.service.startsWith( 'instagram' )
		);
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await control( { supported: true, reset_requests: true } );
	} );

	test.afterAll( async () => {
		await control( {
			supported: true,
			instagram_feature: true,
			reset_requests: true,
		} );
		await saveSettings( {
			[ TOKEN_KEY ]: '',
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: false,
		} );
		await api.dispose();
	} );

	test( 'the credential status is for administrators only', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymous.get( CREDENTIALS );
		expect( res.status() ).toBe( 401 );
		await anonymous.dispose();
	} );

	test( 'converts a plaintext token on upgrade, with the Instagram bundle switched off', async () => {
		await control( { instagram_feature: false } );
		await connect( 'instagram_e2e_plain' );
		await control( { instagram: { plaintext: 'instagram_e2e_plain' } } );

		// The conversion runs on the next request's init.
		const after = await stored();
		expect( after.instagram_converted ).toBe( true );
		expect( after.instagram ).toMatch( ENVELOPE );
		expect( after.instagram ).not.toContain( 'instagram_e2e_plain' );
		expect( after.instagram_decrypted ).toBe( 'instagram_e2e_plain' );

		expect( await credentials() ).toEqual( {
			connected: true,
			usable: true,
			credential_status: 'available',
			credentials_encrypted: true,
			message: '',
		} );

		await control( { instagram_feature: true } );
	} );

	test( 'settings responses never carry the token, and new tokens are stored encrypted', async () => {
		const saved = await connect( 'instagram_e2e_manual' );
		expect( await saved.json() ).not.toHaveProperty( TOKEN_KEY );
		expect( await saved.text() ).not.toContain( 'instagram_e2e_manual' );

		const read = await api.get( SETTINGS, { headers: adminAuth() } );
		expect( read.status() ).toBe( 200 );
		const text = await read.text();
		expect( JSON.parse( text ) ).not.toHaveProperty( TOKEN_KEY );
		expect( text ).not.toContain( 'instagram_e2e_manual' );
		expect( text ).not.toContain( 'fes-enc:' );
		expect( JSON.parse( text ).fair_audience_instagram_connected ).toBe(
			true
		);

		const status = await api.get( CREDENTIALS, { headers: adminAuth() } );
		expect( await status.text() ).not.toContain( 'instagram_e2e_manual' );

		const after = await stored();
		expect( after.instagram ).toMatch( ENVELOPE );
		expect( after.instagram_decrypted ).toBe( 'instagram_e2e_manual' );
	} );

	test( 'testing the connection sends the decrypted token to Instagram', async () => {
		await control( { reset_requests: true } );

		const res = await api.post( TEST_CONNECTION, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await res.json() ).success ).toBe( true );

		expect( instagramRequests( await stored() ) ).toEqual( [
			{ service: 'instagram', token: 'instagram_e2e_manual' },
		] );
	} );

	test( 'publishing a post sends the decrypted token to Instagram', async () => {
		test.setTimeout( 60_000 );
		await control( { reset_requests: true } );

		const res = await api.post( POSTS, {
			headers: adminAuth(),
			data: {
				image_url: 'https://example.org/e2e-1319.jpg',
				caption: 'E2E credential encryption',
			},
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		const { post } = await res.json();
		expect( post.status ).toBe( 'published' );
		await api.delete( `${ POSTS }/${ post.id }`, { headers: adminAuth() } );

		const requests = instagramRequests( await stored() );
		expect( requests.length ).toBeGreaterThan( 0 );
		for ( const sent of requests ) {
			expect( sent.token ).toBe( 'instagram_e2e_manual' );
		}
	} );

	test( 'the daily refresh sends the decrypted token and stores the new one encrypted', async () => {
		const soon = Math.floor( Date.now() / 1000 ) + DAY;
		await control( {
			reset_requests: true,
			instagram_expires: soon,
			refresh_instagram: true,
		} );

		const after = await stored();
		expect( instagramRequests( after ) ).toEqual( [
			{ service: 'instagram_refresh', token: 'instagram_e2e_manual' },
		] );
		expect( after.instagram ).toMatch( ENVELOPE );
		expect( after.instagram_decrypted ).toBe( 'instagram_e2e_refreshed_1' );
		expect( after.instagram_expires ).toBeGreaterThan( soon + 30 * DAY );
	} );

	test( 'a token from changed security keys asks for reconnection and is left in place', async () => {
		const { instagram: envelope } = await control( {
			instagram: { foreign_key: 'instagram_e2e_foreign' },
			reset_requests: true,
		} );

		expect( await credentials() ).toMatchObject( {
			connected: true,
			usable: false,
			credential_status: 'unrecoverable',
			message: expect.stringContaining(
				'Instagram needs to be reconnected'
			),
		} );

		const tested = await api.post( TEST_CONNECTION, {
			headers: adminAuth(),
		} );
		expect( tested.status() ).toBe( 409 );
		expect( ( await tested.json() ).code ).toBe(
			'instagram_credentials_unavailable'
		);

		const posted = await api.post( POSTS, {
			headers: adminAuth(),
			data: {
				image_url: 'https://example.org/e2e-1319.jpg',
				caption: 'E2E credential encryption',
			},
		} );
		expect( posted.status() ).toBe( 400 );
		expect( ( await posted.json() ).code ).toBe(
			'instagram_credentials_unavailable'
		);

		const soon = Math.floor( Date.now() / 1000 ) + DAY;
		await control( { instagram_expires: soon, refresh_instagram: true } );

		const after = await stored();
		expect( instagramRequests( after ) ).toEqual( [] );
		expect( after.instagram ).toBe( envelope );
		expect( after.instagram_status ).toBe( 'unrecoverable' );
		expect( after.instagram_connected ).toBe( true );
		// The skipped refresh leaves the expiry as it was.
		expect( after.instagram_expires ).toBe( soon );
	} );

	test( 'entering a new token replaces an unrecoverable one', async () => {
		await connect( 'instagram_e2e_reconnected' );

		const after = await stored();
		expect( after.instagram ).toMatch( ENVELOPE );
		expect( after.instagram_decrypted ).toBe( 'instagram_e2e_reconnected' );
		expect( ( await credentials() ).credential_status ).toBe( 'available' );
	} );

	test( 'disconnecting removes an unreadable token', async () => {
		await control( {
			instagram: { foreign_key: 'instagram_e2e_foreign' },
		} );

		const res = await saveSettings( {
			[ TOKEN_KEY ]: '',
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: false,
		} );
		expect( res.status(), await res.text() ).toBe( 200 );

		const after = await stored();
		expect( after.instagram_option_rows ).toBe( false );
		expect( await credentials() ).toMatchObject( {
			connected: false,
			usable: false,
			credential_status: 'available',
		} );
	} );

	test( 'losing encryption support pauses Instagram until it returns', async () => {
		await connect( 'instagram_e2e_paused' );
		const { instagram: envelope } = await control( { supported: false } );

		expect( await credentials() ).toMatchObject( {
			connected: true,
			usable: false,
			credential_status: 'encryption_unavailable',
			message: expect.stringContaining( 'Instagram is paused' ),
		} );

		// A replacement would have to be stored as plaintext: refused, and
		// nothing else in the request is written.
		const replaced = await saveSettings( {
			[ TOKEN_KEY ]: 'instagram_e2e_plain_replacement',
			fair_audience_instagram_username: 'e2e_replaced',
		} );
		expect( replaced.status() ).toBe( 409 );
		expect( ( await replaced.json() ).code ).toBe(
			'fair_audience_instagram_token_not_stored'
		);

		const after = await stored();
		expect( after.instagram ).toBe( envelope );
		expect( after.instagram_status ).toBe( 'unsupported' );
		const settings = await (
			await api.get( SETTINGS, { headers: adminAuth() } )
		).json();
		expect( settings.fair_audience_instagram_username ).toBe(
			'e2e_demo_account'
		);

		await control( { supported: true } );
		expect( await credentials() ).toMatchObject( {
			usable: true,
			credential_status: 'available',
		} );
		expect( ( await stored() ).instagram_decrypted ).toBe(
			'instagram_e2e_paused'
		);
	} );

	test( 'without encryption support a plaintext token keeps working, and converts once support returns', async () => {
		await control( {
			supported: false,
			instagram: { plaintext: 'instagram_e2e_unsupported' },
		} );

		const deferred = await stored();
		expect( deferred.instagram ).toBe( 'instagram_e2e_unsupported' );
		expect( deferred.instagram_converted ).toBe( false );
		expect( ( await credentials() ).credential_status ).toBe( 'available' );

		await control( { supported: true } );

		const converted = await stored();
		expect( converted.instagram ).toMatch( ENVELOPE );
		expect( converted.instagram_decrypted ).toBe(
			'instagram_e2e_unsupported'
		);
		expect( converted.instagram_converted ).toBe( true );
	} );
} );
