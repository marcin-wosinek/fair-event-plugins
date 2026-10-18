/**
 * Playwright API tests for MetaEngagementController (#1838): the public
 * button-click capture route validates its input, requires marketing consent
 * and a Meta identifier, only accepts an event date that belongs to a public
 * event post, stays best effort without Meta credentials, and never queues a
 * replayed activation twice.
 *
 * The `meta-conversions` bundle is off by default, so the suite turns it on
 * through the `fair_events_experimental_features` setting and restores it
 * afterwards. Queuing needs credentials; when the instance already has an
 * access token (write-only, so it cannot be restored) the queuing tests are
 * skipped rather than overwriting it. Queued rows are delivered by WP-Cron,
 * which the E2E harness answers with a Graph API double.
 */

import { test, expect, request } from '@playwright/test';

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

	test( 'answers without queuing when Meta credentials are missing', async () => {
		test.skip(
			originalConfig.token_configured,
			'This instance has Meta credentials.'
		);
		const res = await anon.post( PATH, { data: body() } );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toEqual( { queued: false } );
	} );

	test( 'queues each activation once', async () => {
		test.skip(
			originalConfig.token_configured,
			'Would overwrite this instance’s write-only access token.'
		);
		const configRes = await api.post( CONFIG_PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: '1234567890123456',
				test_event_code: originalConfig.test_event_code,
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

		const calendar = await anon.post( PATH, {
			data: body( { action: 'calendar' } ),
		} );
		expect( calendar.status() ).toBe( 202 );
		expect( await calendar.json() ).toEqual( { queued: true } );

		const first = body();
		const queued = await anon.post( PATH, { data: first } );
		expect( queued.status() ).toBe( 202 );

		const replay = await anon.post( PATH, { data: first } );
		expect( replay.status() ).toBe( 200 );
		expect( await replay.json() ).toEqual( { queued: false } );

		const replayOtherAction = await anon.post( PATH, {
			data: { ...first, action: 'calendar' },
		} );
		expect( await replayOtherAction.json() ).toEqual( { queued: false } );

		const config = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
		const names = config.diagnostics.recent.map(
			( row ) => row.event_name
		);
		expect( names ).toContain( 'FairEventCalendarClick' );
		expect( names ).toContain( 'FairEventTicketClick' );
	} );
} );
