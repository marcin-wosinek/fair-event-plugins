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

	test( 'restricts the sent-request log to administrators', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await anon.get( `${ PATH }/attempts` ) ).status() ).toBe(
			401
		);
		await anon.dispose();
		expect(
			(
				await api.get( `${ PATH }/attempts`, {
					headers: subscriberHeaders,
				} )
			).status()
		).toBe( 403 );
		const res = await api.get( `${ PATH }/attempts`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( Array.isArray( body.items ) ).toBe( true );
		expect( typeof body.total ).toBe( 'number' );
		expect( body.total_pages ).toBeGreaterThanOrEqual( 1 );
	} );

	test( 'rejects out-of-range paging and unknown filters on the sent-request log', async () => {
		for ( const params of [
			{ per_page: 51 },
			{ page: 0 },
			{ origin: 'everyone' },
			{ event_name: 'Purchase; DROP' },
		] ) {
			const res = await api.get( `${ PATH }/attempts`, {
				headers: adminHeaders,
				params,
			} );
			expect( res.status(), JSON.stringify( params ) ).toBe( 400 );
		}
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
	// The administrator's browser, sent on as `client_user_agent`.
	const USER_AGENT =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 E2ECalendarTest';
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

	async function lastMetaTimeout() {
		return Number(
			( await wp( 'option', 'get', 'fair_e2e_meta_last_timeout' ) ).trim()
		);
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
			headers: { ...adminHeaders, 'User-Agent': USER_AGENT },
			data: body(),
		} );
		expect( res.status() ).toBe( 200 );
		const answer = await res.json();
		expect( JSON.stringify( answer ) ).not.toContain( USER_AGENT );
		expect( answer ).toEqual( {
			accepted: true,
			event_name: 'FairEventCalendarClick',
			outcome: 'received',
			diagnostics: {
				http_status: 200,
				events_received: 1,
				messages: [],
				fbtrace_id: 'E2Efbtrace00000',
			},
			request: expect.objectContaining( {
				method: 'POST',
				dataset_id: '1234567890123456',
				test_events_code: true,
			} ),
		} );

		const sent = await lastMetaRequest();
		expect( sent.test_event_code ).toBe( 'TEST12345' );
		// Same user_data as a production click: identifiers and the browser.
		expect( sent.data[ 0 ].user_data ).toEqual( {
			fbp: FBP,
			client_user_agent: USER_AGENT,
		} );
		expect( await lastMetaTimeout() ).toBe( 10 );
		expect( sent.data[ 0 ] ).toMatchObject( {
			event_name: 'FairEventCalendarClick',
			action_source: 'website',
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
		expect( JSON.stringify( config ) ).not.toContain( USER_AGENT );
		expect( config.test_history[ 0 ] ).toMatchObject( {
			event_name: 'FairEventCalendarClick',
			accepted: true,
			outcome: 'received',
			events_received: 1,
			fbtrace_id: 'E2Efbtrace00000',
		} );
	} );

	test( 'logs the sanitized request paired with Meta’s answer', async () => {
		test.skip( originalConfig.token_configured, 'Needs test credentials.' );
		const res = await api.post( `${ PATH }/test`, {
			headers: { ...adminHeaders, 'User-Agent': USER_AGENT },
			data: body(),
		} );
		expect( res.status() ).toBe( 200 );
		const sent = await lastMetaRequest();

		const log = await (
			await api.get( `${ PATH }/attempts`, {
				headers: adminHeaders,
				params: { origin: 'admin_test', per_page: 1 },
			} )
		).json();
		const [ attempt ] = log.items;
		expect( attempt ).toMatchObject( {
			origin: 'admin_test',
			delivery_path: 'test',
			event_name: 'FairEventCalendarClick',
			test_events: true,
			outcome: 'received',
			response: { http_status: 200, fbtrace_id: 'E2Efbtrace00000' },
			request: {
				dataset_id: '1234567890123456',
				api_version: expect.stringMatching( /^v\d+\.\d+$/ ),
				test_events_code: true,
			},
		} );
		const fields = Object.fromEntries(
			attempt.request.fields.map( ( field ) => [ field.path, field ] )
		);
		// Every field that was sent is listed, with safe values intact.
		expect( fields[ 'data[0].custom_data.post_id' ] ).toMatchObject( {
			state: 'value',
			value: sent.data[ 0 ].custom_data.post_id,
		} );
		expect( fields[ 'data[0].user_data.fbp' ] ).toMatchObject( {
			state: 'redacted',
			check: 'valid',
		} );
		expect( fields[ 'data[0].user_data.fbc' ] ).toBeUndefined();
		expect( fields[ 'data[0].event_source_url' ].url.same_site ).toBe(
			true
		);

		const json = JSON.stringify( log );
		for ( const secret of [
			'e2e-meta-access-token',
			'TEST12345',
			FBP,
			USER_AGENT,
			sent.data[ 0 ].event_id,
			sent.data[ 0 ].event_source_url,
		] ) {
			expect( json ).not.toContain( secret );
		}
	} );

	test( 'keeps the request when Meta cannot be reached', async () => {
		test.skip( originalConfig.token_configured, 'Needs test credentials.' );
		await wp(
			'option',
			'update',
			'fair_e2e_meta_response',
			JSON.stringify( { transport: true } ),
			'--format=json'
		);
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: body(),
		} );
		await wp( 'option', 'delete', 'fair_e2e_meta_response' );
		expect( res.status() ).toBe( 503 );
		const error = await res.json();
		expect( error.data.outcome ).toBe( 'transport' );
		expect( error.data.request.fields.length ).toBeGreaterThan( 0 );
		const [ attempt ] = (
			await (
				await api.get( `${ PATH }/attempts`, {
					headers: adminHeaders,
					params: { per_page: 1 },
				} )
			).json()
		).items;
		expect( attempt.outcome ).toBe( 'transport' );
		expect( attempt.response.http_status ).toBeNull();
		expect( attempt.request.fields.length ).toBeGreaterThan( 0 );
	} );

	test( 'reports entries without a stored request or result as unavailable', async () => {
		await wp(
			'eval',
			`global $wpdb; $wpdb->insert( \\FairEventsExperimental\\Meta\\DeliveryAttempts::table_name(), array( 'origin' => 'production', 'delivery_path' => 'immediate', 'event_name' => 'FairEventTicketClick', 'created_at' => gmdate( 'Y-m-d H:i:s' ) ) );`
		);
		const [ attempt ] = (
			await (
				await api.get( `${ PATH }/attempts`, {
					headers: adminHeaders,
					params: { per_page: 1 },
				} )
			).json()
		).items;
		expect( attempt ).toMatchObject( {
			event_name: 'FairEventTicketClick',
			outcome: null,
			request: null,
			response: null,
		} );
		const config = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		for ( const outcome of config.diagnostics.recent ) {
			expect( typeof outcome.logged_attempts ).toBe( 'number' );
		}
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
 * The calendar test's event list (#1838): only event/date pairs the send
 * route accepts are offered, newest first, a series as one group with its
 * eligible dates. Rows the REST API cannot create — legacy links, series
 * dates, rows pointing at a missing or non-event page — are written with
 * WP-CLI and removed afterwards by their run-unique title.
 */
test.describe( 'MetaConversionsController calendar test events', () => {
	test.describe.configure( { mode: 'serial' } );

	const RUN = `MetaEligible${ Date.now() }`;
	const EVENTS_PATH = `${ PATH }/calendar-events`;
	let api;
	let originalConfig;
	let originalFeatureEnabled;
	const posts = [];
	const fixtures = {};

	/** Insert an event date row and return its ID. */
	async function insertDate( fields ) {
		const out = await wp(
			'eval',
			`global $wpdb; $wpdb->insert( $wpdb->prefix . 'fair_event_dates', json_decode( '${ JSON.stringify(
				fields
			) }', true ) ); echo 'ID=' . $wpdb->insert_id;`
		);
		return Number( out.match( /ID=(\d+)/ )[ 1 ] );
	}

	async function updateDate( id, fields ) {
		await wp(
			'eval',
			`global $wpdb; $wpdb->update( $wpdb->prefix . 'fair_event_dates', json_decode( '${ JSON.stringify(
				fields
			) }', true ), array( 'id' => ${ Number( id ) } ) );`
		);
	}

	/** Create a post through REST and return it with its own event date. */
	async function createPost( name, data = {}, type = 'fair_event' ) {
		const res = await api.post( `/wp-json/wp/v2/${ type }`, {
			headers: adminHeaders,
			data: { title: `${ RUN } ${ name }`, status: 'publish', ...data },
		} );
		expect( res.ok(), `create ${ name }` ).toBeTruthy();
		const id = ( await res.json() ).id;
		posts.push( { id, type } );
		const dates =
			'fair_event' === type
				? await (
						await api.get( '/wp-json/fair-events/v1/event-dates', {
							headers: adminHeaders,
							params: { event_id: id },
						} )
					).json()
				: [];
		const eventDateId = dates[ 0 ]?.id;
		if ( eventDateId ) {
			// Dated, so the newest-first order is known.
			await updateDate( eventDateId, {
				title: `${ RUN } ${ name }`,
				start_date: data.start_date || '2031-01-15',
				start_time: '18:00:00',
			} );
		}
		return { id, eventDateId };
	}

	async function list( params = {} ) {
		const res = await api.get( EVENTS_PATH, {
			headers: adminHeaders,
			params: { search: RUN, ...params },
		} );
		expect( res.status() ).toBe( 200 );
		return res.json();
	}

	function sendFor( postId, eventDateId ) {
		return api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: {
				event_name: 'FairEventCalendarClick',
				post_id: postId,
				event_date_id: eventDateId,
				marketing_consent: true,
				meta_fbp: 'fb.1.1712345678901.eligiblelist',
			},
		} );
	}

	test.beforeAll( async () => {
		test.setTimeout( 240000 );
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
		// Without a Test Events code an eligible send fails closed before
		// Meta, so listed pairs can be checked against the send route.
		await api.post( PATH, {
			headers: adminHeaders,
			data: { dataset_id: '', test_event_code: '' },
		} );

		fixtures.published = await createPost( 'Published', {
			start_date: '2031-03-01',
		} );
		fixtures.legacy = await createPost( 'Legacy link', {
			start_date: '2031-02-01',
		} );
		await updateDate( fixtures.legacy.eventDateId, { link_type: '' } );
		fixtures.series = await createPost( 'Series', {
			start_date: '2031-01-01',
		} );
		await updateDate( fixtures.series.eventDateId, {
			occurrence_type: 'master',
		} );
		fixtures.seriesActive = await insertDate( {
			title: `${ RUN } Series`,
			event_id: fixtures.series.id,
			master_id: fixtures.series.eventDateId,
			occurrence_type: 'generated',
			start_date: '2031-01-08',
			start_time: '18:00:00',
			status: 'active',
		} );
		fixtures.seriesCancelled = await insertDate( {
			title: `${ RUN } Series`,
			event_id: fixtures.series.id,
			master_id: fixtures.series.eventDateId,
			occurrence_type: 'generated',
			start_date: '2031-01-15',
			start_time: '18:00:00',
			status: 'cancelled',
		} );
		fixtures.cancelled = await createPost( 'Cancelled' );
		await updateDate( fixtures.cancelled.eventDateId, {
			status: 'cancelled',
		} );

		fixtures.draft = await createPost( 'Draft', { status: 'draft' } );
		fixtures.private = await createPost( 'Private', {
			status: 'private',
		} );
		fixtures.scheduled = await createPost( 'Scheduled', {
			status: 'future',
			date: '2035-01-01T10:00:00',
		} );
		fixtures.trashed = await createPost( 'Trashed' );
		await api.delete(
			`/wp-json/wp/v2/fair_event/${ fixtures.trashed.id }`,
			{
				headers: adminHeaders,
			}
		);
		fixtures.protected = await createPost( 'Protected', {
			password: 'secret',
		} );
		fixtures.missingPage = await insertDate( {
			title: `${ RUN } Missing page`,
			event_id: 2147483000,
			occurrence_type: 'single',
			start_date: '2031-01-20',
			link_type: 'post',
			status: 'active',
		} );
		const regularPost = await createPost( 'Disabled type', {}, 'posts' );
		fixtures.disabledType = await insertDate( {
			title: `${ RUN } Disabled type`,
			event_id: regularPost.id,
			occurrence_type: 'single',
			start_date: '2031-01-20',
			link_type: 'post',
			status: 'active',
		} );
		// A second top-level row on a published event's page: the page
		// resolves to its first row, so this date is not the page's.
		fixtures.mismatched = await insertDate( {
			title: `${ RUN } Mismatched`,
			event_id: fixtures.published.id,
			occurrence_type: 'single',
			start_date: '2031-04-01',
			link_type: 'post',
			status: 'active',
		} );
	} );

	test.afterAll( async () => {
		await wp(
			'eval',
			`global $wpdb; $wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE title LIKE %s', $wpdb->prefix . 'fair_event_dates', '${ RUN }%' ) );`
		);
		for ( const { id, type } of posts ) {
			await api.delete( `/wp-json/wp/v2/${ type }/${ id }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
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
		await api.dispose();
	} );

	test( 'is for administrators only', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await anon.get( EVENTS_PATH ) ).status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'rejects out-of-range paging', async () => {
		for ( const params of [
			{ per_page: 0 },
			{ per_page: 101 },
			{ page: 0 },
		] ) {
			const res = await api.get( EVENTS_PATH, {
				headers: adminHeaders,
				params,
			} );
			expect( res.status(), JSON.stringify( params ) ).toBe( 400 );
		}
	} );

	test( 'lists only eligible events and dates, newest first, with only the picker’s fields', async () => {
		const events = await list();
		expect( events.map( ( item ) => item.event_id ) ).toEqual( [
			fixtures.published.id,
			fixtures.legacy.id,
			fixtures.series.id,
		] );
		expect( events[ 0 ] ).toEqual( {
			id: fixtures.published.eventDateId,
			event_id: fixtures.published.id,
			title: `${ RUN } Published`,
			start_date: '2031-03-01',
			start_time: '18:00:00',
			all_day: false,
			occurrences: [
				{
					id: fixtures.published.eventDateId,
					start_date: '2031-03-01',
					start_time: '18:00:00',
					all_day: false,
				},
			],
		} );
		// The cancelled series date is left out.
		expect( events[ 2 ].occurrences.map( ( item ) => item.id ) ).toEqual( [
			fixtures.series.eventDateId,
			fixtures.seriesActive,
		] );
		const listed = events.flatMap( ( item ) =>
			item.occurrences.map( ( occurrence ) => occurrence.id )
		);
		for ( const excluded of [
			fixtures.seriesCancelled,
			fixtures.cancelled.eventDateId,
			fixtures.draft.eventDateId,
			fixtures.private.eventDateId,
			fixtures.scheduled.eventDateId,
			fixtures.trashed.eventDateId,
			fixtures.protected.eventDateId,
			fixtures.missingPage,
			fixtures.disabledType,
			fixtures.mismatched,
		] ) {
			expect( listed ).not.toContain( excluded );
		}
	} );

	test( 'every listed pair passes the send route’s event check', async () => {
		for ( const item of await list() ) {
			for ( const occurrence of item.occurrences ) {
				const res = await sendFor( item.event_id, occurrence.id );
				// Fails closed on the missing Test Events code, past the
				// event check.
				expect( ( await res.json() ).data?.code ).toBe(
					'missing_test_code'
				);
			}
		}
		// And the excluded mismatched date does not.
		const res = await sendFor( fixtures.published.id, fixtures.mismatched );
		expect( ( await res.json() ).code ).toBe( 'invalid_event' );
	} );

	test( 'searches by title', async () => {
		const events = await list( { search: `${ RUN } Legacy` } );
		expect( events.map( ( item ) => item.event_id ) ).toEqual( [
			fixtures.legacy.id,
		] );
		expect( await list( { search: `${ RUN } Draft` } ) ).toEqual( [] );
	} );

	test( 'pages through eligible events only', async () => {
		const first = await list( { per_page: 2 } );
		const second = await list( { per_page: 2, page: 2 } );
		expect(
			[ ...first, ...second ].map( ( item ) => item.event_id )
		).toEqual( [
			fixtures.published.id,
			fixtures.legacy.id,
			fixtures.series.id,
		] );
	} );

	test( 'finds eligible events behind more than a page of newer ineligible rows', async () => {
		test.setTimeout( 120000 );
		// Rows that pass the page prefilter but not the event check.
		await wp(
			'eval',
			`global $wpdb; for ( $i = 0; $i < 250; $i++ ) { $wpdb->insert( $wpdb->prefix . 'fair_event_dates', array( 'title' => '${ RUN } Newer duplicate', 'event_id' => ${ fixtures.published.id }, 'occurrence_type' => 'single', 'start_date' => '2032-01-01', 'link_type' => 'post', 'status' => 'active' ) ); }`
		);
		const events = await list();
		expect( events.map( ( item ) => item.event_id ) ).toEqual( [
			fixtures.published.id,
			fixtures.legacy.id,
			fixtures.series.id,
		] );
	} );

	test( 'rejects a listed event that stopped being public before reaching Meta', async () => {
		const [ listed ] = await list( { search: `${ RUN } Published` } );
		expect( listed.event_id ).toBe( fixtures.published.id );
		await wp( 'option', 'delete', 'fair_e2e_meta_last_request' ).catch(
			() => {}
		);
		await api.post( `/wp-json/wp/v2/fair_event/${ listed.event_id }`, {
			headers: adminHeaders,
			data: { status: 'draft' },
		} );

		const res = await sendFor(
			listed.event_id,
			listed.occurrences[ 0 ].id
		);
		expect( res.status() ).toBe( 404 );
		const error = await res.json();
		expect( error.code ).toBe( 'invalid_event' );
		expect( error.message ).toContain( 'nothing was sent to Meta' );
		await expect(
			wp( 'option', 'get', 'fair_e2e_meta_last_request' )
		).rejects.toThrow();
		expect( await list( { search: `${ RUN } Published` } ) ).toEqual( [] );
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
