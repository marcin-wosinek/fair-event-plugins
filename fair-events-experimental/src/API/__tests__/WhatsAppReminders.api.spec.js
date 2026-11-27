/**
 * Playwright API tests for per-feed WhatsApp sharing reminders (#2136):
 * administrator-only routes, saving, changing and removing each feed's
 * collaborator with destination consent, template checks against the feed's
 * weekly-summary link, scheduling, and scheduled runs: feed isolation,
 * skips with zero outbound requests, failures, and at most one send per
 * feed and week even after a timeout or a replay.
 *
 * Nothing reaches Meta: e2e/mu-plugins/lib/whatsapp-http-double.php answers
 * graph.facebook.com and logs each request. Templates with a static button
 * opening each feed's summary are stored in its
 * `fair_e2e_whatsapp_extra_templates` option. Runs are started through
 * e2e/mu-plugins/scripts/whatsapp-reminders-fixture.php for weeks far from
 * other fixtures, as WP-Cron would start them.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const WHATSAPP = '/wp-json/fair-events-experimental/v1/whatsapp';
const PATH = `${ WHATSAPP }/reminders`;
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const TOKEN_OPTION = 'fair_events_experimental_whatsapp_access_token';
const TOKEN = 'e2e-whatsapp-reminders-token-0123456789';
const WABA = '100000000000001';
const PHONE = '200000000000002';
const FIXTURE = 'wp-content/mu-plugins/scripts/whatsapp-reminders-fixture.php';
const FEATURES_OPTION = 'fair_events_experimental_features';

const ANA = '+34 600 000 401';
const BEA = '+34 600 000 402';
const ANA_DIGITS = '34600000401';
const BEA_DIGITS = '34600000402';

// Weeks far from any other fixture data.
const WEEK = '2037-W10';
const SHARED_WEEK = '2037-W11';
const OFF_WEEK = '2037-W12';
const EMPTY_WEEK = '2037-W30';
const RENAMED_WEEK = '2037-W13';
const TIMEOUT_WEEK = '2037-W14';
const INVALID_WEEK = '2037-W15';
const NOT_READY_WEEK = '2037-W16';
const EVENT_WEEKS = [
	NOT_READY_WEEK,
	WEEK,
	SHARED_WEEK,
	OFF_WEEK,
	RENAMED_WEEK,
	TIMEOUT_WEEK,
	INVALID_WEEK,
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

/** Run a fixture step and return its JSON result. */
async function fixture( ...args ) {
	const out = await wp( 'eval-file', FIXTURE, ...args.map( String ) );
	const line = out
		.split( '\n' )
		.find( ( entry ) => entry.startsWith( 'E2E_REMINDERS:' ) );
	return JSON.parse( line.slice( 'E2E_REMINDERS:'.length ) );
}

/** Store an option as JSON. */
async function setJsonOption( name, value ) {
	await wp(
		'option',
		'update',
		name,
		JSON.stringify( value ),
		'--format=json'
	);
}

/** Template sends the double received, oldest first. */
async function sends() {
	const out = await wp(
		'option',
		'get',
		'fair_e2e_whatsapp_requests',
		'--format=json'
	).catch( () => '[]' );
	const start = out.indexOf( '[' );
	const log = start < 0 ? [] : JSON.parse( out.slice( start ) );
	return log.filter(
		( entry ) =>
			'POST' === entry.method && `${ PHONE }/messages` === entry.path
	);
}

async function clearRequests() {
	await wp( 'option', 'delete', 'fair_e2e_whatsapp_requests' ).catch(
		() => {}
	);
}

/** An approved template whose static button opens a link. */
const buttonTemplate = ( name, url ) => ( {
	name,
	language: 'es_ES',
	status: 'APPROVED',
	category: 'UTILITY',
	components: [
		{ type: 'BODY', text: 'Comparte el resumen semanal.' },
		{ type: 'BUTTONS', buttons: [ { type: 'URL', text: 'Abrir', url } ] },
	],
} );

test.describe( 'WhatsApp sharing reminders', () => {
	test.describe.configure( { mode: 'serial' } );
	test.setTimeout( 180_000 );

	let api;
	let previousFeatures;
	let subscriberId;
	let subscriberHeaders;
	const feeds = {};
	const created = { termIds: [], pageIds: [], sourceIds: [], eventIds: [] };

	const put = ( feed, data ) =>
		api.put( `${ PATH }/${ feed.sourceId }`, {
			headers: adminHeaders,
			data: {
				enabled: true,
				day_of_week: 3,
				time_of_day: '09:30',
				recipient: null,
				consent: false,
				template: null,
				...data,
			},
		} );
	const listed = async ( feed ) => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		return {
			body,
			feed: body.feeds.find(
				( { source_id: id } ) => id === feed.sourceId
			),
		};
	};
	const standalone = ( name, number ) => ( {
		kind: 'standalone',
		name,
		number,
	} );
	const run = ( week, feed ) => fixture( 'run', week, feed.sourceId );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const out = await wp(
			'option',
			'get',
			FEATURES_OPTION,
			'--format=json'
		).catch( () => 'null' );
		previousFeatures = JSON.parse( out.trim().split( '\n' ).pop() );
		await setJsonOption( FEATURES_OPTION, {
			...( previousFeatures || {} ),
			whatsapp: true,
		} );

		const login = `reminders-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: 'Test-password-2136!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ login }:Test-password-2136!` ).toString(
					'base64'
				),
		};

		for ( const label of [ 'valencia', 'madrid' ] ) {
			const feed = await fixture( 'feed', label );
			feeds[ label ] = feed;
			created.termIds.push( feed.termId );
			created.pageIds.push( feed.pageId );
			created.sourceIds.push( feed.sourceId );
			for ( const week of EVENT_WEEKS ) {
				const { eventId } = await fixture( 'event', feed.termId, week );
				created.eventIds.push( eventId );
			}
		}
		await setJsonOption( 'fair_e2e_whatsapp_extra_templates', [
			buttonTemplate( 'valencia_summary', feeds.valencia.summaryUrl ),
			buttonTemplate( 'madrid_summary', feeds.madrid.summaryUrl ),
		] );

		// A validated connection, as Fair Events → WhatsApp leaves it.
		expect(
			(
				await api.post( SETTINGS_PATH, {
					headers: adminHeaders,
					data: { [ TOKEN_OPTION ]: TOKEN },
				} )
			).ok()
		).toBeTruthy();
		expect(
			(
				await api.post( WHATSAPP, {
					headers: adminHeaders,
					data: { waba_id: WABA, phone_number_id: PHONE },
				} )
			).ok()
		).toBeTruthy();
		expect(
			(
				await api.post( `${ WHATSAPP }/validate`, {
					headers: adminHeaders,
				} )
			).ok()
		).toBeTruthy();
		await clearRequests();
	} );

	test.afterAll( async () => {
		await fixture( 'cleanup', JSON.stringify( created ) ).catch( () => {} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: '' },
		} );
		await api.post( WHATSAPP, {
			headers: adminHeaders,
			data: { waba_id: '', phone_number_id: '' },
		} );
		await wp(
			'option',
			'delete',
			'fair_events_experimental_whatsapp_validation',
			'fair_e2e_whatsapp_response',
			'fair_e2e_whatsapp_extra_templates'
		).catch( () => {} );
		await clearRequests();
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		if ( previousFeatures ) {
			await setJsonOption( FEATURES_OPTION, previousFeatures );
		} else {
			await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		}
		await api.dispose();
	} );

	test( 'only administrators reach the routes', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const target = `${ PATH }/${ feeds.valencia.sourceId }`;
		const body = {
			enabled: false,
			day_of_week: 1,
			time_of_day: '10:00',
		};
		for ( const [ headers, status ] of [
			[ {}, 401 ],
			[ subscriberHeaders, 403 ],
		] ) {
			expect( ( await anon.get( PATH, { headers } ) ).status() ).toBe(
				status
			);
			expect(
				( await anon.put( target, { headers, data: body } ) ).status()
			).toBe( status );
			expect(
				( await anon.delete( target, { headers } ) ).status()
			).toBe( status );
		}
		await anon.dispose();
		expect( await sends() ).toHaveLength( 0 );
	} );

	test( 'saving, changing and removing a feed collaborator', async () => {
		// A collaborator needs confirmed consent for their number.
		let res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'consent_required' );

		res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', 'not a number' ),
			consent: true,
		} );
		expect( res.status() ).toBe( 400 );
		res = await put( feeds.valencia, {
			recipient: { kind: 'group', name: 'Community' },
			consent: true,
		} );
		expect( res.status() ).toBe( 400 );

		// A template without a button opening the feed's page is refused.
		res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'hello_world', language: 'en_US' },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'template_url_mismatch' );
		// So is another feed's template.
		res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'madrid_summary', language: 'es_ES' },
		} );
		expect( res.status() ).toBe( 400 );

		res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		expect( res.status() ).toBe( 200 );
		const saved = await res.json();
		expect( saved.summary_url ).toBe( feeds.valencia.summaryUrl );
		expect( saved.reminder ).toMatchObject( {
			enabled: true,
			day_of_week: 3,
			time_of_day: '09:30',
			recipient: {
				kind: 'standalone',
				name: 'Ana',
				number: `+${ ANA_DIGITS }`,
			},
			destination_status: 'ok',
			consent_confirmed: true,
			template: {
				name: 'valencia_summary',
				language: 'es_ES',
				matches_feed: true,
			},
		} );
		expect( saved.next_run ).toBeTruthy();
		const { next } = await fixture( 'next', feeds.valencia.sourceId );
		expect( next.send_week ).toMatch( /^\d{4}-W\d{2}$/ );

		// Another number needs consent again; the saved one is unchanged.
		res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', BEA ),
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		expect( res.status() ).toBe( 400 );
		expect(
			( await listed( feeds.valencia ) ).feed.reminder.recipient.number
		).toBe( `+${ ANA_DIGITS }` );

		// Removing the collaborator keeps the rest of the reminder.
		res = await put( feeds.valencia, {
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		expect( res.status() ).toBe( 200 );
		expect( ( await res.json() ).reminder ).toMatchObject( {
			recipient: null,
			destination_status: 'none',
		} );

		// Deleting the reminder unschedules it.
		expect(
			(
				await api.delete( `${ PATH }/${ feeds.valencia.sourceId }`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 200 );
		expect(
			( await fixture( 'next', feeds.valencia.sourceId ) ).next
		).toBeNull();
		expect(
			(
				await api.delete( `${ PATH }/${ feeds.valencia.sourceId }`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 404 );
		expect(
			(
				await api.put( `${ PATH }/999999`, {
					headers: adminHeaders,
					data: {
						enabled: false,
						day_of_week: 1,
						time_of_day: '10:00',
					},
				} )
			).status()
		).toBe( 404 );
		expect( await sends() ).toHaveLength( 0 );
	} );

	test( 'each feed reminds its own collaborator with its own link', async () => {
		for ( const [ feed, name, number, template ] of [
			[ feeds.valencia, 'Ana', ANA, 'valencia_summary' ],
			[ feeds.madrid, 'Bea', BEA, 'madrid_summary' ],
		] ) {
			expect(
				(
					await put( feed, {
						recipient: standalone( name, number ),
						consent: true,
						template: { name: template, language: 'es_ES' },
					} )
				).status()
			).toBe( 200 );
		}
		await clearRequests();

		expect( await run( WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'accepted',
		} );
		expect( await run( WEEK, feeds.madrid ) ).toMatchObject( {
			state: 'accepted',
		} );
		let log = await sends();
		expect(
			log.map( ( { to, template, language } ) => [
				to,
				template,
				language,
			] )
		).toEqual( [
			[ ANA_DIGITS, 'valencia_summary', 'es_ES' ],
			[ BEA_DIGITS, 'madrid_summary', 'es_ES' ],
		] );

		// The same collaborator can handle several feeds.
		expect(
			(
				await put( feeds.madrid, {
					recipient: standalone( 'Ana', ANA ),
					consent: true,
					template: { name: 'madrid_summary', language: 'es_ES' },
				} )
			).status()
		).toBe( 200 );
		await clearRequests();
		await run( SHARED_WEEK, feeds.valencia );
		await run( SHARED_WEEK, feeds.madrid );
		log = await sends();
		expect( log.map( ( { to, template } ) => [ to, template ] ) ).toEqual( [
			[ ANA_DIGITS, 'valencia_summary' ],
			[ ANA_DIGITS, 'madrid_summary' ],
		] );

		// The history masks the number and shows WhatsApp's acceptance.
		const { body } = await listed( feeds.valencia );
		const entry = body.history.find(
			( item ) =>
				item.source_id === feeds.valencia.sourceId &&
				item.send_week === WEEK
		);
		expect( entry ).toMatchObject( {
			state: 'accepted',
			recipient: '••••••••401',
			template: { name: 'valencia_summary', language: 'es_ES' },
			delivery: { origin: 'scheduled', outcome: 'accepted' },
		} );
		expect( JSON.stringify( body.history ) ).not.toContain( ANA_DIGITS );
	} );

	test( 'a week is never sent twice', async () => {
		await clearRequests();
		expect( await run( WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'duplicate',
		} );

		// A timed-out send is uncertain and is not repeated, even after
		// the collaborator is replaced.
		await setJsonOption( 'fair_e2e_whatsapp_response', {
			transport: true,
		} );
		expect( await run( TIMEOUT_WEEK, feeds.madrid ) ).toMatchObject( {
			state: 'uncertain',
		} );
		await wp( 'option', 'delete', 'fair_e2e_whatsapp_response' );
		expect(
			(
				await put( feeds.madrid, {
					recipient: standalone( 'Bea', BEA ),
					consent: true,
					template: { name: 'madrid_summary', language: 'es_ES' },
				} )
			).status()
		).toBe( 200 );
		expect( await run( TIMEOUT_WEEK, feeds.madrid ) ).toMatchObject( {
			state: 'duplicate',
		} );
		expect( await sends() ).toHaveLength( 1 );

		const { body } = await listed( feeds.madrid );
		const entry = body.history.find(
			( item ) =>
				item.source_id === feeds.madrid.sourceId &&
				item.send_week === TIMEOUT_WEEK
		);
		expect( entry.state ).toBe( 'uncertain' );
		expect( entry.delivery.outcome ).toBe( 'uncertain' );
	} );

	test( 'skipped runs send nothing and say why', async () => {
		await clearRequests();

		// An empty week.
		expect( await run( EMPTY_WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'skipped',
			reason: 'empty_week',
		} );

		// No collaborator.
		await put( feeds.valencia, {
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		expect( await run( OFF_WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'skipped',
			reason: 'no_recipient',
		} );

		// Turned off: the run does nothing at all.
		await put( feeds.madrid, {
			enabled: false,
			recipient: standalone( 'Bea', BEA ),
			consent: true,
			template: { name: 'madrid_summary', language: 'es_ES' },
		} );
		expect( await run( OFF_WEEK, feeds.madrid ) ).toMatchObject( {
			state: 'inactive',
		} );
		expect(
			( await fixture( 'next', feeds.madrid.sourceId ) ).next
		).toBeNull();
		expect( await sends() ).toHaveLength( 0 );

		const { body } = await listed( feeds.valencia );
		const reasons = body.history
			.filter( ( item ) => item.source_id === feeds.valencia.sourceId )
			.map( ( item ) => [ item.send_week, item.state, item.reason ] );
		expect( reasons ).toEqual(
			expect.arrayContaining( [
				[ EMPTY_WEEK, 'skipped', 'empty_week' ],
				[ OFF_WEEK, 'skipped', 'no_recipient' ],
			] )
		);
		expect(
			body.history.some(
				( item ) =>
					item.source_id === feeds.madrid.sourceId &&
					item.send_week === OFF_WEEK
			)
		).toBe( false );
	} );

	test( 'a renamed feed pauses until a matching template is chosen', async () => {
		await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		const newSlug = `${ feeds.valencia.slug }-renamed`;
		const { summaryUrl } = await fixture(
			'rename',
			feeds.valencia.sourceId,
			newSlug
		);
		await clearRequests();

		const { feed } = await listed( feeds.valencia );
		expect( feed.summary_url ).toBe( summaryUrl );
		expect( feed.reminder.template.matches_feed ).toBe( false );
		expect( await run( RENAMED_WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'skipped',
			reason: 'template_url_changed',
		} );
		expect( await sends() ).toHaveLength( 0 );

		// Saving the old template again is checked against the new link.
		const res = await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'template_url_mismatch' );
		await fixture( 'rename', feeds.valencia.sourceId, feeds.valencia.slug );
	} );

	test( 'a template WhatsApp no longer offers fails without sending', async () => {
		await put( feeds.valencia, {
			recipient: standalone( 'Ana', ANA ),
			consent: true,
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
		await setJsonOption( 'fair_e2e_whatsapp_extra_templates', [
			buttonTemplate( 'madrid_summary', feeds.madrid.summaryUrl ),
		] );
		await clearRequests();
		expect( await run( INVALID_WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'failed',
			reason: 'template_invalid',
		} );
		expect( await sends() ).toHaveLength( 0 );

		// Without a validated connection nothing is attempted.
		await wp(
			'option',
			'delete',
			'fair_events_experimental_whatsapp_validation'
		);
		await setJsonOption( 'fair_e2e_whatsapp_extra_templates', [
			buttonTemplate( 'valencia_summary', feeds.valencia.summaryUrl ),
		] );
		expect( await run( NOT_READY_WEEK, feeds.valencia ) ).toMatchObject( {
			state: 'failed',
			reason: 'whatsapp_not_ready',
		} );
		const { body } = await listed( feeds.valencia );
		expect( body.connection.ready ).toBe( false );
		expect( await sends() ).toHaveLength( 0 );
	} );

	test( 'turning WhatsApp off removes the routes', async () => {
		await setJsonOption( FEATURES_OPTION, {
			...( previousFeatures || {} ),
			whatsapp: false,
		} );
		expect(
			( await api.get( PATH, { headers: adminHeaders } ) ).status()
		).toBe( 404 );
		await setJsonOption( FEATURES_OPTION, {
			...( previousFeatures || {} ),
			whatsapp: true,
		} );
	} );
} );
