/**
 * Playwright API tests for MetaEngagementController (#1838, #1970): the
 * public button-click capture route validates its input, requires marketing
 * consent and a Meta identifier, only accepts an event date that belongs to
 * a public event post, limits requests per client, stays best effort without
 * Meta credentials, and sends each activation to Meta once, immediately —
 * without WP-Cron — answering only `{ received }`.
 *
 * The `meta-conversions` bundle is off by default, so the suite turns it on
 * through the `fair_events_experimental_features` setting and restores it
 * afterwards. Sending needs credentials; when the instance already has an
 * access token (write-only, so it cannot be restored) the sending tests are
 * skipped rather than overwriting it. The E2E harness answers Graph API
 * requests with a double (e2e/mu-plugins/lib/meta-http-double.php) whose
 * answer the `fair_e2e_meta_response` option switches.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/meta-engagement';
const CONFIG_PATH = '/wp-json/fair-events-experimental/v1/meta-conversions';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const FBP = 'fb.1.1712345678901.apiengagement';

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

/** Make the Graph API double answer with `answer` until reset. */
async function metaAnswers( answer ) {
	await wp(
		'option',
		'update',
		'fair_e2e_meta_response',
		JSON.stringify( answer ),
		'--format=json'
	);
}

async function resetMetaDouble() {
	for ( const option of [
		'fair_e2e_meta_response',
		'fair_e2e_meta_requests',
	] ) {
		await wp( 'option', 'delete', option ).catch( () => {} );
	}
}

/** Forget every client's capture count. */
async function resetRateLimits() {
	await wp(
		'eval',
		'global $wpdb; $wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE \'\\_transient\\_%fair\\_events\\_experimental\\_meta\\_engagement\\_%\'" ); wp_cache_flush();'
	);
}

/** Outbox rows for a post and the Graph API events sent for it. */
async function engagementState( postId ) {
	const out = await wp(
		'eval-file',
		'wp-content/mu-plugins/scripts/meta-engagement-state.php',
		String( postId )
	);
	const state = JSON.parse(
		out.match( /E2E_META_ENGAGEMENT:(\{.*\})/ )[ 1 ]
	);
	return {
		rows: state.rows,
		requests: state.requests.filter(
			( sent ) => sent?.data?.[ 0 ]?.custom_data?.post_id === postId
		),
	};
}

/** A random version 4 UUID, as the browser's crypto.randomUUID() returns. */
function uuid() {
	return crypto.randomUUID();
}

async function setFeature( api, enabled ) {
	const res = await api.post( SETTINGS_PATH, {
		headers: adminHeaders,
		data: {
			fair_events_experimental_features: { 'meta-conversions': enabled },
		},
	} );
	expect( res.ok() ).toBeTruthy();
}

test.describe( 'MetaEngagementController', () => {
	// Later tests rely on the first one switching the feature on.
	test.describe.configure( { mode: 'serial' } );

	let api;
	let anon;
	let originalFeatureEnabled;
	let originalConfig;
	const events = [];

	/** Create a published event and return `{ id, eventDateId }`. */
	async function createEvent( title ) {
		const eventRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `${ title } ${ Date.now() }`, status: 'publish' },
		} );
		expect( eventRes.ok() ).toBeTruthy();
		const id = ( await eventRes.json() ).id;
		events.push( id );
		const listRes = await api.get( '/wp-json/fair-audience/v1/events', {
			headers: adminHeaders,
			params: { per_page: 100 },
		} );
		expect( listRes.ok() ).toBeTruthy();
		const match = ( await listRes.json() ).find(
			( event ) => event.event_id === id
		);
		expect( match, 'event-date row for test event' ).toBeTruthy();
		return { id, eventDateId: match.event_date_id };
	}

	let event;
	let otherEvent;

	function body( overrides = {} ) {
		return {
			action: 'ticket',
			activation_id: uuid(),
			post_id: event.id,
			event_date_id: event.eventDateId,
			marketing_consent: true,
			meta_fbp: FBP,
			...overrides,
		};
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anon = await request.newContext( { baseURL: BASE_URL } );

		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await setFeature( api, false );
		event = await createEvent( 'Meta engagement' );
		otherEvent = await createEvent( 'Meta engagement other' );
	} );

	test.afterAll( async () => {
		await setFeature( api, true );
		if ( originalConfig ) {
			await api.post( CONFIG_PATH, {
				headers: adminHeaders,
				data: {
					dataset_id: originalConfig.dataset_id,
					test_event_code: originalConfig.test_event_code,
				},
			} );
			if ( ! originalConfig.token_configured ) {
				await api.post( SETTINGS_PATH, {
					headers: adminHeaders,
					data: { fair_events_experimental_meta_access_token: '' },
				} );
			}
		}
		await setFeature( api, originalFeatureEnabled );
		for ( const id of events ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await anon.dispose();
		await api.dispose();
	} );

	test( 'is not registered while the feature is off', async () => {
		const res = await anon.post( PATH, { data: body() } );
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'rest_no_route' );

		await setFeature( api, true );
		originalConfig = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
	} );

	test( 'rejects unsupported actions and malformed input', async () => {
		for ( const data of [
			body( { action: 'purchase' } ),
			body( { activation_id: 'not-a-uuid' } ),
			body( { activation_id: undefined } ),
			body( { post_id: 0 } ),
			body( { event_date_id: 'abc' } ),
			body( { meta_fbp: 'invalid' } ),
		] ) {
			const res = await anon.post( PATH, { data } );
			expect( res.status(), JSON.stringify( data ) ).toBe( 400 );
		}
	} );

	test( 'requires marketing consent and a Meta identifier', async () => {
		const withoutConsent = await anon.post( PATH, {
			data: body( { marketing_consent: false } ),
		} );
		expect( withoutConsent.status() ).toBe( 400 );
		expect( ( await withoutConsent.json() ).code ).toBe(
			'marketing_consent_required'
		);

		const missingConsent = await anon.post( PATH, {
			data: body( { marketing_consent: undefined } ),
		} );
		expect( missingConsent.status() ).toBe( 400 );

		const withoutIdentifier = await anon.post( PATH, {
			data: body( { meta_fbp: '' } ),
		} );
		expect( withoutIdentifier.status() ).toBe( 400 );
		expect( ( await withoutIdentifier.json() ).code ).toBe(
			'meta_identifier_required'
		);
	} );

	test( 'only accepts a date of the supplied public event', async () => {
		const foreignDate = await anon.post( PATH, {
			data: body( { event_date_id: otherEvent.eventDateId } ),
		} );
		expect( foreignDate.status() ).toBe( 404 );
		expect( ( await foreignDate.json() ).code ).toBe( 'invalid_event' );

		await api.post( `/wp-json/wp/v2/fair_event/${ otherEvent.id }`, {
			headers: adminHeaders,
			data: { status: 'draft' },
		} );
		const draft = await anon.post( PATH, {
			data: body( {
				post_id: otherEvent.id,
				event_date_id: otherEvent.eventDateId,
			} ),
		} );
		expect( draft.status() ).toBe( 404 );
	} );

	test( 'answers without sending when Meta credentials are missing', async () => {
		test.skip(
			originalConfig.token_configured,
			'This instance has Meta credentials.'
		);
		const res = await anon.post( PATH, { data: body() } );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toEqual( { received: false } );
		expect( ( await engagementState( event.id ) ).rows ).toEqual( [] );
	} );

	test.describe( 'immediate delivery', () => {
		test.beforeAll( async () => {
			test.skip(
				originalConfig.token_configured,
				'Would overwrite this instance’s write-only access token.'
			);
			const configRes = await api.post( CONFIG_PATH, {
				headers: adminHeaders,
				data: {
					dataset_id: '1234567890123456',
					test_event_code: 'TEST12345',
				},
			} );
			expect( configRes.ok() ).toBeTruthy();
			// The credential is written the way Settings → Connectors writes it.
			const tokenRes = await api.post( SETTINGS_PATH, {
				headers: adminHeaders,
				data: {
					fair_events_experimental_meta_access_token:
						'e2e-meta-access-token',
				},
			} );
			expect( tokenRes.ok() ).toBeTruthy();
		} );

		test.beforeEach( async () => {
			await resetMetaDouble();
			await resetRateLimits();
			event = await createEvent( 'Meta engagement delivery' );
		} );

		test.afterAll( async () => {
			await resetMetaDouble();
			await resetRateLimits();
		} );

		test( 'sends each activation once, without WP-Cron or the Test Events code', async () => {
			// Nothing may depend on scheduling: the delivery hook is never queued.
			await wp(
				'cron',
				'event',
				'delete',
				'fair_events_experimental_meta_deliver'
			).catch( () => {} );

			const calendar = await anon.post( PATH, {
				data: body( { action: 'calendar' } ),
			} );
			expect( calendar.status() ).toBe( 200 );
			expect( await calendar.json() ).toEqual( { received: true } );

			const first = body();
			const ticket = await anon.post( PATH, { data: first } );
			expect( await ticket.json() ).toEqual( { received: true } );

			const replay = await anon.post( PATH, { data: first } );
			expect( replay.status() ).toBe( 200 );
			expect( await replay.json() ).toEqual( { received: false } );
			const replayOtherAction = await anon.post( PATH, {
				data: { ...first, action: 'calendar' },
			} );
			expect( await replayOtherAction.json() ).toEqual( {
				received: false,
			} );

			const state = await engagementState( event.id );
			expect( state.requests ).toHaveLength( 2 );
			for ( const sent of state.requests ) {
				expect( sent ).not.toHaveProperty( 'test_event_code' );
				expect( sent.data[ 0 ].user_data ).toEqual( { fbp: FBP } );
			}
			expect(
				state.requests.map( ( sent ) => sent.data[ 0 ].event_name )
			).toEqual( [ 'FairEventCalendarClick', 'FairEventTicketClick' ] );
			expect( state.rows ).toHaveLength( 2 );
			for ( const row of state.rows ) {
				expect( row.state ).toBe( 'immediate_received' );
				// Identifiers are used in memory only.
				expect( row.fbp || '' ).toBe( '' );
				expect( row.fbc || '' ).toBe( '' );
				expect( row.meta_diagnostics ).toEqual( {
					http_status: 200,
					events_received: 1,
					messages: [],
					fbtrace_id: 'E2Efbtrace00000',
				} );
			}

			const scheduled = await wp(
				'cron',
				'event',
				'list',
				'--hook=fair_events_experimental_meta_deliver',
				'--format=count'
			);
			expect( scheduled.trim() ).toBe( '0' );

			const config = await (
				await api.get( CONFIG_PATH, { headers: adminHeaders } )
			).json();
			const recent = config.diagnostics.recent.find(
				( row ) =>
					'immediate_received' === row.state &&
					'FairEventTicketClick' === row.event_name
			);
			expect( recent ).toMatchObject( {
				http_status: 200,
				events_received: 1,
				fbtrace_id: 'E2Efbtrace00000',
			} );
			expect( JSON.stringify( config.diagnostics ) ).not.toContain( FBP );
		} );

		for ( const [ name, answer, expectedState, diagnostics ] of [
			[
				'an unconfirmed answer',
				{ status: 200, body: { events_received: 0, messages: [] } },
				'immediate_unconfirmed',
				{ http_status: 200, events_received: 0 },
			],
			[
				'a malformed answer',
				{ status: 200, body: 'not json' },
				'immediate_unconfirmed',
				{ http_status: 200, events_received: null },
			],
			[
				'a rejection',
				{
					status: 400,
					body: {
						error: {
							message: `Invalid parameter ${ FBP }`,
							type: 'OAuthException',
							code: 100,
							fbtrace_id: 'E2Erejected01',
						},
					},
				},
				'immediate_rejected',
				{
					http_status: 400,
					messages: [ 'Invalid parameter [redacted]' ],
					fbtrace_id: 'E2Erejected01',
				},
			],
			[
				'a temporary Meta error',
				{ status: 503, body: '' },
				'immediate_temporary_error',
				{ http_status: 503 },
			],
			[
				'a transport failure',
				{ transport: true },
				'immediate_transport',
				{ http_status: null, events_received: null },
			],
		] ) {
			test( `records ${ name } once, without retrying it`, async () => {
				await metaAnswers( answer );
				const res = await anon.post( PATH, { data: body() } );
				expect( res.status() ).toBe( 200 );
				const json = await res.json();
				// Only the minimal result: no Meta diagnostics or identifiers.
				expect( json ).toEqual( { received: false } );

				const state = await engagementState( event.id );
				expect( state.requests ).toHaveLength( 1 );
				expect( state.rows ).toHaveLength( 1 );
				expect( state.rows[ 0 ].state ).toBe( expectedState );
				expect( state.rows[ 0 ].meta_diagnostics ).toMatchObject(
					diagnostics
				);
				expect(
					JSON.stringify( state.rows[ 0 ].meta_diagnostics )
				).not.toContain( 'e2e-meta-access-token' );

				// Nothing is left for the queue worker to retry.
				await wp(
					'eval',
					'( new FairEventsExperimental\\Meta\\Conversions() )->deliver_due();'
				);
				const after = await engagementState( event.id );
				expect( after.requests ).toHaveLength( 1 );
				expect( after.rows[ 0 ].state ).toBe( expectedState );
			} );
		}

		test( 'concurrent duplicate requests send once', async () => {
			const data = body();
			const responses = await Promise.all(
				Array.from( { length: 5 }, () => anon.post( PATH, { data } ) )
			);
			const results = await Promise.all(
				responses.map( ( res ) => res.json() )
			);
			expect(
				results.filter( ( result ) => result.received )
			).toHaveLength( 1 );
			const state = await engagementState( event.id );
			expect( state.requests ).toHaveLength( 1 );
			expect( state.rows ).toHaveLength( 1 );
		} );

		test( 'a click queued before immediate delivery finishes through the queue once', async () => {
			const activationId = uuid();
			await wp(
				'eval',
				`$event = FairEventsExperimental\\Meta\\Conversions::build_engagement_event( 'ticket', '${ activationId }', FairEventsExperimental\\Meta\\Engagement::event_context( ${ event.id }, ${ event.eventDateId } ), '${ FBP }', '' ); ( new FairEventsExperimental\\Meta\\Outbox() )->enqueue( $event );`
			);

			const replay = await anon.post( PATH, {
				data: body( { activation_id: activationId } ),
			} );
			expect( await replay.json() ).toEqual( { received: false } );
			expect( ( await engagementState( event.id ) ).requests ).toEqual(
				[]
			);

			await wp(
				'eval',
				'( new FairEventsExperimental\\Meta\\Conversions() )->deliver_due();'
			);
			const state = await engagementState( event.id );
			expect( state.requests ).toHaveLength( 1 );
			expect( state.requests[ 0 ] ).not.toHaveProperty(
				'test_event_code'
			);
			expect( state.rows.map( ( row ) => row.state ) ).toEqual( [
				'received',
			] );
		} );

		test( 'limits requests per client', async () => {
			let limited = null;
			for ( let i = 0; i <= 60 && ! limited; i++ ) {
				const res = await anon.post( PATH, { data: body() } );
				if ( 429 === res.status() ) {
					limited = await res.json();
				}
			}
			expect( limited?.code ).toBe( 'rate_limited' );
			const blocked = await anon.post( PATH, { data: body() } );
			expect( blocked.status() ).toBe( 429 );
			// 60 sends were allowed, the limited ones never reach Meta.
			expect(
				( await engagementState( event.id ) ).requests
			).toHaveLength( 60 );
		} );
	} );
} );
