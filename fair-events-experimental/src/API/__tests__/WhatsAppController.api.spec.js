/**
 * Playwright API tests for WhatsAppController (#1923): administrator-only
 * access, saving and removing the IDs, connection validation (pagination,
 * account mismatch, invalid tokens), invalidation when the IDs or token
 * change, template filtering and the explicit test send.
 *
 * Nothing reaches Meta: e2e/mu-plugins/lib/whatsapp-http-double.php answers
 * graph.facebook.com for the synthetic account it documents and logs each
 * request (without the token) to the `fair_e2e_whatsapp_requests` option.
 *
 * The suite saves its own token through the Connectors setting and removes
 * it, the IDs and the double's log afterwards.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/whatsapp';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const TOKEN_OPTION = 'fair_events_experimental_whatsapp_access_token';
const TOKEN = 'e2e-whatsapp-api-token-0123456789';
const OTHER_TOKEN = 'e2e-whatsapp-api-other-token-9876543210';
const EXPIRED_TOKEN = 'e2e-whatsapp-expired-token-0123456789';
const WABA = '100000000000001';
const PHONE = '200000000000002';
const OTHER_ACCOUNT_PHONE = '300000000000003';
const RECIPIENT = '+34 600 000 123';

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

/** Requests the double received, oldest first. */
async function doubleRequests() {
	const out = await wp(
		'option',
		'get',
		'fair_e2e_whatsapp_requests',
		'--format=json'
	).catch( () => '[]' );
	const start = out.indexOf( '[' );
	return start < 0 ? [] : JSON.parse( out.slice( start ) );
}

async function clearDoubleRequests() {
	await wp( 'option', 'delete', 'fair_e2e_whatsapp_requests' ).catch(
		() => {}
	);
}

test.describe( 'WhatsAppController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let subscriberId;
	let subscriberHeaders;

	const saveToken = ( token ) =>
		api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: token },
		} );
	const saveIds = ( waba_id, phone_number_id ) =>
		api.post( PATH, {
			headers: adminHeaders,
			data: { waba_id, phone_number_id },
		} );
	const validate = () =>
		api.post( `${ PATH }/validate`, { headers: adminHeaders } );
	const sendTest = ( data ) =>
		api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: {
				recipient: RECIPIENT,
				template_name: 'hello_world',
				template_language: 'en_US',
				authorized: true,
				...data,
			},
		} );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const userLogin = `whatsapp-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1923!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1923!` ).toString(
					'base64'
				),
		};
		await saveToken( '' );
		await saveIds( '', '' );
	} );

	test.afterAll( async () => {
		await saveToken( '' );
		await saveIds( '', '' );
		await wp(
			'option',
			'delete',
			'fair_events_experimental_whatsapp_validation',
			'fair_e2e_whatsapp_response'
		).catch( () => {} );
		await clearDoubleRequests();
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'every route is restricted to administrators', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const calls = [
			[ 'get', PATH, undefined ],
			[ 'post', PATH, { waba_id: WABA, phone_number_id: PHONE } ],
			[ 'post', `${ PATH }/validate`, undefined ],
			[ 'get', `${ PATH }/templates`, undefined ],
			[
				'post',
				`${ PATH }/test`,
				{
					recipient: RECIPIENT,
					template_name: 'hello_world',
					template_language: 'en_US',
					authorized: true,
				},
			],
		];
		for ( const [ method, path, data ] of calls ) {
			expect(
				( await anon[ method ]( path, { data } ) ).status(),
				`${ method } ${ path } anonymous`
			).toBe( 401 );
			expect(
				(
					await api[ method ]( path, {
						data,
						headers: subscriberHeaders,
					} )
				).status(),
				`${ method } ${ path } subscriber`
			).toBe( 403 );
		}
		await anon.dispose();

		// A subscriber cannot read or write the token through settings.
		const settings = await api.post( SETTINGS_PATH, {
			headers: subscriberHeaders,
			data: { [ TOKEN_OPTION ]: TOKEN },
		} );
		expect( settings.status() ).toBe( 403 );
	} );

	test( 'saves, replaces and removes the IDs without contacting Meta', async () => {
		await clearDoubleRequests();

		let res = await saveIds( WABA, PHONE );
		expect( res.status() ).toBe( 200 );
		let body = await res.json();
		expect( body ).toMatchObject( {
			waba_id: WABA,
			phone_number_id: PHONE,
			token_configured: false,
			token_source: 'none',
			validation: null,
		} );
		expect( body.connectors_url ).toMatch( /options-connectors\.php$/ );

		res = await saveIds( ` ${ WABA } `, OTHER_ACCOUNT_PHONE );
		body = await res.json();
		expect( body.phone_number_id ).toBe( OTHER_ACCOUNT_PHONE );
		expect( body.waba_id ).toBe( WABA );

		res = await saveIds( '', '' );
		body = await res.json();
		expect( body ).toMatchObject( { waba_id: '', phone_number_id: '' } );

		expect( await doubleRequests() ).toEqual( [] );
	} );

	test( 'refuses IDs that are not digits, and the token', async () => {
		for ( const ids of [
			[ '+34 600 000 002', PHONE ],
			[ WABA, 'abc' ],
			[ WABA, '1'.repeat( 33 ) ],
		] ) {
			const res = await saveIds( ...ids );
			expect( res.status(), JSON.stringify( ids ) ).toBe( 400 );
		}
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: {
				waba_id: WABA,
				phone_number_id: PHONE,
				access_token: TOKEN,
			},
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe(
			'token_managed_in_connectors'
		);
	} );

	test( 'validation needs a token and saved IDs', async () => {
		let res = await validate();
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'missing_token' );

		await saveToken( TOKEN );
		res = await validate();
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'missing_configuration' );
	} );

	test( 'a malformed token is refused in Connectors', async () => {
		const res = await saveToken( 'not a token' );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'invalid_access_token' );
		// The previously saved token is kept.
		const config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config.token_source ).toBe( 'database' );
	} );

	test( 'validation identifies the sender across pages, without exposing the token', async () => {
		await saveIds( WABA, PHONE );
		await clearDoubleRequests();

		const res = await validate();
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		expect( text ).not.toContain( TOKEN );
		const body = JSON.parse( text );
		expect( body.validation.sender ).toEqual( {
			display_phone_number: '+34 600 000 002',
			verified_name: 'Fair Events E2E',
			quality_rating: 'GREEN',
		} );
		expect( body.validation.validated_at_local ).toBeTruthy();
		expect( body ).not.toHaveProperty( TOKEN_OPTION );

		const requests = await doubleRequests();
		expect( requests.map( ( r ) => r.path ) ).toEqual( [
			WABA,
			`${ WABA }/phone_numbers`,
			`${ WABA }/phone_numbers`,
		] );
		expect( requests[ 0 ].token_suffix ).toBe( TOKEN.slice( -4 ) );

		const read = await (
			await api.get( PATH, { headers: adminHeaders } )
		).text();
		expect( read ).not.toContain( TOKEN );
		expect( JSON.parse( read ).validation ).not.toBeNull();
	} );

	test( 'templates list only approved ones without parameters', async () => {
		const res = await api.get( `${ PATH }/templates`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toEqual( [
			{ name: 'event_ready', language: 'es_ES', category: 'UTILITY' },
			{ name: 'hello_world', language: 'en_US', category: 'UTILITY' },
		] );
	} );

	test( 'a test send needs the recipient authorization and valid input', async () => {
		await clearDoubleRequests();
		let res = await sendTest( { authorized: false } );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'authorization_required' );

		res = await sendTest( { recipient: 'call me' } );
		expect( res.status() ).toBe( 400 );
		expect( await res.text() ).not.toContain( 'call me' );

		res = await sendTest( { template_name: 'event_reminder' } );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'template_not_offered' );

		const sends = ( await doubleRequests() ).filter(
			( r ) => 'POST' === r.method
		);
		expect( sends ).toEqual( [] );
	} );

	test( 'an accepted test send reports acceptance with a masked recipient', async () => {
		await clearDoubleRequests();
		const res = await sendTest();
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		expect( text ).not.toContain( '34600000123' );
		expect( JSON.parse( text ) ).toEqual( {
			outcome: 'accepted',
			message_status: 'accepted',
			recipient: '••••••••123',
			template: { name: 'hello_world', language: 'en_US' },
		} );
		const sends = ( await doubleRequests() ).filter(
			( r ) => 'POST' === r.method
		);
		expect( sends ).toEqual( [
			{
				method: 'POST',
				path: `${ PHONE }/messages`,
				token_suffix: TOKEN.slice( -4 ),
				to: '34600000123',
				template: 'hello_world',
				language: 'en_US',
			},
		] );
	} );

	test( 'a refused test send says why', async () => {
		const res = await sendTest( { recipient: '+34 600 131030' } );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'whatsapp_recipient_not_allowed' );
		expect( body.data ).toMatchObject( {
			outcome: 'not_accepted',
			meta_code: 131030,
			trace_id: 'E2Ewhatsapptrace',
			recipient: '••••••••030',
		} );
		expect( JSON.stringify( body ) ).not.toContain(
			'secret-should-not-leak'
		);
	} );

	test( 'a timed-out test send is reported as uncertain and not retried', async () => {
		await wp(
			'option',
			'update',
			'fair_e2e_whatsapp_response',
			'{"transport":true}',
			'--format=json'
		);
		await clearDoubleRequests();
		try {
			const res = await sendTest();
			expect( res.status() ).toBe( 502 );
			const body = await res.json();
			expect( body.data.outcome ).toBe( 'uncertain' );
			expect( body.message ).toMatch( /may or may not have been sent/ );
		} finally {
			await wp( 'option', 'delete', 'fair_e2e_whatsapp_response' );
		}
		const sends = ( await doubleRequests() ).filter(
			( r ) => 'POST' === r.method
		);
		expect( sends ).toHaveLength( 1 );
	} );

	test( 'replacing the token invalidates the validation', async () => {
		await saveToken( OTHER_TOKEN );
		let config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config.validation ).toBeNull();

		const res = await sendTest();
		expect( res.status() ).toBe( 409 );
		expect( ( await res.json() ).code ).toBe( 'not_validated' );

		expect( ( await validate() ).status() ).toBe( 200 );
		await saveIds( WABA, OTHER_ACCOUNT_PHONE );
		config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config.validation ).toBeNull();
	} );

	test( 'validation reports account mismatches and unknown numbers', async () => {
		await saveIds( WABA, OTHER_ACCOUNT_PHONE );
		let res = await validate();
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe(
			'whatsapp_phone_number_mismatch'
		);

		await saveIds( WABA, '200000000000777' );
		res = await validate();
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'whatsapp_phone_number_not_found' );
		expect( body.message ).toMatch( /not the telephone number/ );

		await saveIds( '100000000000777', PHONE );
		res = await validate();
		expect( ( await res.json() ).code ).toBe( 'whatsapp_waba_not_found' );
	} );

	test( 'an expired token gets an actionable error that does not echo it', async () => {
		await saveIds( WABA, PHONE );
		await saveToken( TOKEN );
		expect( ( await validate() ).status() ).toBe( 200 );

		await saveToken( EXPIRED_TOKEN );
		const res = await validate();
		expect( res.status() ).toBe( 400 );
		const text = await res.text();
		expect( text ).not.toContain( EXPIRED_TOKEN );
		expect( text ).not.toContain( 'secret-should-not-leak' );
		const body = JSON.parse( text );
		expect( body.code ).toBe( 'whatsapp_invalid_token' );
		expect( body.data.meta_code ).toBe( 190 );

		// The failed validation also cleared the earlier one.
		await saveToken( TOKEN );
		const config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config.validation ).toBeNull();
	} );

	test( 'removing the token in Connectors blocks validation and sending', async () => {
		await saveToken( '' );
		const config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config ).toMatchObject( {
			token_configured: false,
			token_source: 'none',
			validation: null,
			waba_id: WABA,
			phone_number_id: PHONE,
		} );
		expect( ( await ( await validate() ).json() ).code ).toBe(
			'missing_token'
		);
		expect( ( await ( await sendTest() ).json() ).code ).toBe(
			'missing_token'
		);
	} );
} );
