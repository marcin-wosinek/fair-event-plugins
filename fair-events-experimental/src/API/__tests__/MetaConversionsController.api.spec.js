/**
 * Playwright API tests for MetaConversionsController (#1639): authorization,
 * event_name validation on POST /meta-conversions/test, and the safe
 * fail-closed path when the Test Events code isn't configured yet.
 *
 * These tests never reach the point of calling out to graph.facebook.com —
 * every case here is rejected by permission checks, schema validation, or
 * the missing-configuration guard in Conversions::send_test() before any
 * network request is attempted, so no Meta credentials are needed to run
 * this suite.
 *
 * The `meta-conversions` feature bundle is off by default (Features.php), so
 * MetaConversionsController::register_routes() never runs and every route
 * below 404s until the suite flips it on via the `fair_events_experimental_features`
 * setting — restored to whatever this instance had once the suite finishes.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/meta-conversions';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const TOKEN_OPTION = 'fair_events_experimental_meta_access_token';

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

test.describe( 'MetaConversionsController', () => {
	let api;
	let originalConfig;
	let originalFeatureEnabled;
	let subscriberId;
	let subscriberHeaders;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// The route only registers once the meta-conversions feature bundle is
		// on (off by default) — enable it for this suite and restore whatever
		// this instance had afterward.
		const settingsRes = await api.get( SETTINGS_PATH, {
			headers: adminHeaders,
		} );
		const settings = await settingsRes.json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: { 'meta-conversions': true },
			},
		} );

		const configRes = await api.get( PATH, { headers: adminHeaders } );
		originalConfig = await configRes.json();

		const userLogin = `meta-conversions-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1460!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1460!` ).toString(
					'base64'
				),
		};
	} );

	test.afterAll( async () => {
		// Restore the dataset ID and Test Events code the suite found on
		// entry; the access token is write-only and untouched by any test
		// here, so there's nothing to restore for it.
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: originalConfig.dataset_id,
				test_event_code: originalConfig.test_event_code,
			},
		} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: {
					'meta-conversions': originalFeatureEnabled,
				},
			},
		} );
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'rejects an unauthenticated read', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const res = await anon.get( PATH );
		expect( res.status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'rejects a non-admin read', async () => {
		const res = await api.get( PATH, { headers: subscriberHeaders } );
		expect( res.status() ).toBe( 403 );
	} );

	test( 'an admin reads the configuration and diagnostics shape', async () => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body ).toHaveProperty( 'dataset_id' );
		expect( body ).toHaveProperty( 'token_configured' );
		expect( body ).toHaveProperty( 'token_source' );
		expect( body.connectors_url ).toMatch( /options-connectors\.php$/ );
		expect( body ).not.toHaveProperty( 'access_token' );
		expect( body ).toHaveProperty( 'test_event_code' );
		expect( body ).toHaveProperty( 'diagnostics' );
		expect( body ).toHaveProperty( 'test_history' );
		expect( body ).toHaveProperty( 'consent_api_available' );
	} );

	test( 'rejects an unauthenticated test-event send', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const res = await anon.post( `${ PATH }/test`, {
			data: { event_name: 'PageView' },
		} );
		expect( res.status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'rejects a non-admin test-event send', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: subscriberHeaders,
			data: { event_name: 'PageView' },
		} );
		expect( res.status() ).toBe( 403 );
	} );

	test( 'rejects an event_name outside the supported events', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { event_name: 'NotARealEvent' },
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects a missing event_name', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: {},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	for ( const eventName of [ 'PageView', 'InitiateCheckout', 'Purchase' ] ) {
		test( `fails closed for ${ eventName } without a configured Test Events code and names the event in the response`, async () => {
			// Clear the Test Events code so this case is deterministic
			// regardless of what the suite found configured on entry.
			await api.post( PATH, {
				headers: adminHeaders,
				data: { dataset_id: '', test_event_code: '' },
			} );

			const res = await api.post( `${ PATH }/test`, {
				headers: adminHeaders,
				data: { event_name: eventName },
			} );

			expect( res.status() ).toBe( 400 );
			const body = await res.json();
			expect( body.data.code ).toBe( 'missing_test_code' );
			expect( body.data.category ).toBe( 'configuration' );
			expect( body.message ).toContain( eventName );
		} );
	}
} );

/**
 * The administrator-triggered FairEventCalendarClick test (#1838): it needs
 * marketing consent, a valid Meta identifier and a date of a public event,
 * and reports Meta's diagnostics on success and failure. The E2E Graph API
 * double (e2e/mu-plugins/lib/meta-http-double.php) answers every request;
 * the `fair_e2e_meta_response` option switches its answer. Sending needs
 * credentials, so those cases are skipped when this instance already has a
 * write-only access token the suite could not restore.
 */
test.describe( 'MetaConversionsController calendar test', () => {
	test.describe.configure( { mode: 'serial' } );

	const FBP = 'fb.1.1712345678901.apicalendartest';
	let api;
	let originalConfig;
	let originalFeatureEnabled;
	let event;
	let otherEvent;
	const events = [];

	async function metaAnswers( status, body ) {
		await wp(
			'option',
			'update',
			'fair_e2e_meta_response',
			JSON.stringify( { status, body } ),
			'--format=json'
		);
	}

	async function lastMetaRequest() {
		const out = await wp(
			'option',
			'get',
			'fair_e2e_meta_last_request',
			'--format=json'
		);
		return JSON.parse( out.slice( out.indexOf( '{' ) ) );
	}

	async function createEvent( title ) {
		const res = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `${ title } ${ Date.now() }`, status: 'publish' },
		} );
		expect( res.ok() ).toBeTruthy();
		const id = ( await res.json() ).id;
		events.push( id );
		const dates = await (
			await api.get( '/wp-json/fair-events/v1/event-dates', {
				headers: adminHeaders,
				params: { event_id: id },
			} )
		).json();
		expect( dates.length, 'event-date row for test event' ).toBeTruthy();
		return { id, eventDateId: dates[ 0 ].id };
	}

	function body( overrides = {} ) {
		return {
			event_name: 'FairEventCalendarClick',
			post_id: event.id,
			event_date_id: event.eventDateId,
			marketing_consent: true,
			meta_fbp: FBP,
			...overrides,
		};
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: { 'meta-conversions': true },
			},
		} );
		originalConfig = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		event = await createEvent( 'Meta calendar test' );
		otherEvent = await createEvent( 'Meta calendar test other' );
	} );

	test.afterAll( async () => {
		await wp( 'option', 'delete', 'fair_e2e_meta_response' ).catch(
			() => {}
		);
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: originalConfig.dataset_id,
				test_event_code: originalConfig.test_event_code,
			},
		} );
		if ( ! originalConfig.token_configured ) {
			await api.post( SETTINGS_PATH, {
				headers: adminHeaders,
				data: { [ TOKEN_OPTION ]: '' },
			} );
		}
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: {
					'meta-conversions': originalFeatureEnabled,
				},
			},
		} );
		for ( const id of events ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
	} );

	test( 'is for administrators only', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect(
			( await anon.post( `${ PATH }/test`, { data: body() } ) ).status()
		).toBe( 401 );
		await anon.dispose();
	} );

	test( 'requires consent, a valid identifier and a date of the public event', async () => {
		const noConsent = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body( { marketing_consent: false } ),
		} );
		expect( noConsent.status() ).toBe( 400 );
		expect( ( await noConsent.json() ).code ).toBe(
			'marketing_consent_required'
		);

		const noIdentifier = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body( { meta_fbp: '' } ),
		} );
		expect( noIdentifier.status() ).toBe( 400 );
		expect( ( await noIdentifier.json() ).code ).toBe(
			'meta_identifier_required'
		);

		const badIdentifier = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body( { meta_fbp: 'invalid' } ),
		} );
		expect( badIdentifier.status() ).toBe( 400 );

		const foreignDate = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body( { event_date_id: otherEvent.eventDateId } ),
		} );
		expect( foreignDate.status() ).toBe( 404 );
		expect( ( await foreignDate.json() ).code ).toBe( 'invalid_event' );
	} );

	test( 'sends the production calendar payload with the test code and reports Meta’s diagnostics', async () => {
		test.skip(
			originalConfig.token_configured,
			'Would overwrite this instance’s write-only access token.'
		);
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: '1234567890123456',
				test_event_code: 'TEST12345',
			},
		} );
		// The credential is written the way Settings → Connectors writes it.
		expect(
			(
				await api.post( SETTINGS_PATH, {
					headers: adminHeaders,
					data: { [ TOKEN_OPTION ]: 'e2e-meta-access-token' },
				} )
			).ok()
		).toBeTruthy();

		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body(),
		} );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toEqual( {
			accepted: true,
			event_name: 'FairEventCalendarClick',
			outcome: 'received',
			diagnostics: {
				http_status: 200,
				events_received: 1,
				messages: [],
				fbtrace_id: 'E2Efbtrace00000',
			},
		} );

		const sent = await lastMetaRequest();
		expect( sent.test_event_code ).toBe( 'TEST12345' );
		expect( sent.data[ 0 ] ).toMatchObject( {
			event_name: 'FairEventCalendarClick',
			action_source: 'website',
			user_data: { fbp: FBP },
			custom_data: {
				post_id: event.id,
				event_date_id: event.eventDateId,
				action: 'calendar',
			},
		} );
		expect( sent.data[ 0 ].event_source_url ).toContain( BASE_URL );

		const config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( config.test_history[ 0 ] ).toMatchObject( {
			event_name: 'FairEventCalendarClick',
			accepted: true,
			outcome: 'received',
			events_received: 1,
			fbtrace_id: 'E2Efbtrace00000',
		} );
	} );

	test( 'does not report zero received events as success', async () => {
		test.skip( originalConfig.token_configured, 'Needs test credentials.' );
		await metaAnswers( 200, {
			events_received: 0,
			messages: [ 'Event was not processed' ],
			fbtrace_id: 'ZeroTrace1',
		} );
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body(),
		} );
		expect( res.status() ).toBe( 503 );
		const error = await res.json();
		expect( error.data ).toMatchObject( {
			outcome: 'unconfirmed',
			code: 'events_received_0',
			diagnostics: {
				http_status: 200,
				events_received: 0,
				messages: [ 'Event was not processed' ],
				fbtrace_id: 'ZeroTrace1',
			},
		} );
	} );

	test( 'reports a rejection with its trace ID and a redacted message', async () => {
		test.skip( originalConfig.token_configured, 'Needs test credentials.' );
		await metaAnswers( 400, {
			error: {
				message: 'Invalid OAuth access token e2e-meta-access-token',
				type: 'OAuthException',
				code: 190,
				fbtrace_id: 'RejectTrace1',
			},
		} );
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body(),
		} );
		expect( res.status() ).toBe( 400 );
		const error = await res.json();
		expect( error.data ).toMatchObject( {
			outcome: 'rejected',
			code: '190',
			category: 'oauthexception',
			diagnostics: {
				http_status: 400,
				events_received: null,
				messages: [ 'Invalid OAuth access token [redacted]' ],
				fbtrace_id: 'RejectTrace1',
			},
		} );
		expect( JSON.stringify( error ) ).not.toContain(
			'e2e-meta-access-token'
		);
		await wp( 'option', 'delete', 'fair_e2e_meta_response' );
	} );
} );

/**
 * The access token moved to Settings → Connectors (#1953). Connectors writes
 * it through `/wp/v2/settings`; the Meta settings route no longer accepts it.
 * The suite saves whatever raw token the instance had on entry and restores
 * it afterwards, reading and writing it only through WP-CLI.
 */
test.describe( 'Meta access token in Connectors', () => {
	test.describe.configure( { mode: 'serial' } );

	const TOKEN = 'e2e-meta-connector-token-0123456789';
	const REPLACEMENT = 'e2e-meta-connector-replacement-9876543210';
	let api;
	let originalToken;
	let originalFeatureEnabled;
	let subscriberId;
	let subscriberHeaders;

	async function storedToken() {
		const out = await wp( 'option', 'get', TOKEN_OPTION ).catch( () => '' );
		return out.trim();
	}

	async function saveToken( value ) {
		// `option update` fails when the value is unchanged.
		await wp( 'option', 'delete', TOKEN_OPTION ).catch( () => {} );
		await wp( 'option', 'add', TOKEN_OPTION, value, '--autoload=no' );
	}

	async function config() {
		return ( await api.get( PATH, { headers: adminHeaders } ) ).json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: { 'meta-conversions': true },
			},
		} );
		originalToken = await storedToken();

		const userLogin = `meta-connector-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1953!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1953!` ).toString(
					'base64'
				),
		};
	} );

	test.beforeEach( async () => {
		// A token saved before the move, exactly as the old screen stored it.
		await saveToken( TOKEN );
	} );

	test.afterAll( async () => {
		if ( originalToken ) {
			await saveToken( originalToken );
		} else {
			await wp( 'option', 'delete', TOKEN_OPTION ).catch( () => {} );
		}
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: {
					'meta-conversions': originalFeatureEnabled,
				},
			},
		} );
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'reports a pre-upgrade token as configured without exposing it', async () => {
		const body = await config();
		expect( body.token_configured ).toBe( true );
		expect( JSON.stringify( body ) ).not.toContain( TOKEN );

		const settingsRes = await api.get( SETTINGS_PATH, {
			headers: adminHeaders,
		} );
		const settings = await settingsRes.json();
		expect( settings ).toHaveProperty( TOKEN_OPTION );
		expect( JSON.stringify( settings ) ).not.toContain( TOKEN );
	} );

	test( 'refuses a token on the Meta settings route and changes nothing', async () => {
		const before = await config();
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: '999999',
				test_event_code: 'CHANGED',
				access_token: REPLACEMENT,
			},
		} );
		expect( res.status() ).toBe( 400 );
		const error = await res.json();
		expect( error.code ).toBe( 'token_managed_in_connectors' );
		expect( JSON.stringify( error ) ).not.toContain( REPLACEMENT );
		expect( await storedToken() ).toBe( TOKEN );

		const after = await config();
		expect( after.dataset_id ).toBe( before.dataset_id );
		expect( after.test_event_code ).toBe( before.test_event_code );
	} );

	test( 'no longer offers the token removal route', async () => {
		const res = await api.delete( `${ PATH }/token`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 404 );
		expect( await storedToken() ).toBe( TOKEN );
	} );

	test( 'saving other Meta settings keeps the token', async () => {
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: { dataset_id: '', test_event_code: '' },
		} );
		expect( res.status() ).toBe( 200 );
		expect( ( await res.json() ).token_configured ).toBe( true );
		expect( await storedToken() ).toBe( TOKEN );
	} );

	test( 'refuses token changes from anyone but an administrator', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const anonRes = await anon.post( SETTINGS_PATH, {
			data: { [ TOKEN_OPTION ]: REPLACEMENT },
		} );
		expect( anonRes.status() ).toBe( 401 );
		await anon.dispose();

		const subscriberRes = await api.post( SETTINGS_PATH, {
			headers: subscriberHeaders,
			data: { [ TOKEN_OPTION ]: '' },
		} );
		expect( subscriberRes.status() ).toBe( 403 );
		expect( await storedToken() ).toBe( TOKEN );
	} );

	test( 'refuses a malformed token and keeps the saved one', async () => {
		const res = await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: 'not a token' },
		} );
		expect( res.status() ).toBe( 400 );
		const error = await res.json();
		expect( error.code ).toBe( 'invalid_access_token' );
		expect( JSON.stringify( error ) ).not.toContain( 'not a token' );
		expect( await storedToken() ).toBe( TOKEN );
	} );

	test( 'an administrator replaces and removes the token', async () => {
		const replaced = await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: REPLACEMENT },
		} );
		expect( replaced.status() ).toBe( 200 );
		expect( await replaced.text() ).not.toContain( REPLACEMENT );
		expect( await storedToken() ).toBe( REPLACEMENT );
		expect( ( await config() ).token_source ).toBe( 'database' );

		const removed = await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: '' },
		} );
		expect( removed.status() ).toBe( 200 );
		expect( await storedToken() ).toBe( '' );
		const body = await config();
		expect( body.token_configured ).toBe( false );
		expect( body.token_source ).toBe( 'none' );
	} );
} );
