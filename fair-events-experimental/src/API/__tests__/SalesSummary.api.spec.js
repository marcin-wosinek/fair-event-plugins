/**
 * Playwright API tests for Fair Events' sales summaries (#2306), with
 * organizers from Fair Events Experimental:
 * GET/PUT /fair-events/v1/sales-summary/{report} and its preview and test.
 *
 * Covers administrator-only access, Off by default, the fallback address
 * required before turning a report on, per-field validation, preferences
 * stored apart from the organizer identity, previews holding only the
 * organizer's own events (and every organizer in the central report),
 * tests sent only to the requesting administrator, scheduled delivery to
 * each private address once (also when the cron run repeats), the
 * fallback address, a partial delivery failure, and the `organizers`
 * bundle pausing additional and central reports without regrouping their
 * sales while keeping every preference.
 *
 * The suite removes the events, purchases, organizers, user and options
 * it creates.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/sales-summary';
const ORGANIZERS_PATH = '/wp-json/fair-events/v1/organizers';
const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const MAIL_LOG = '/wp-json/fair-e2e/v1/fee-reminders/mail';
const MAIL_FAILURE = '/wp-json/fair-e2e/v1/fee-reminders/mail-failure';
const INDEX_OPTION = 'fair_events_experimental_organizer_ids';
const OPTION_PREFIX = 'fair_events_experimental_organizer_';
const FEATURES_OPTION = 'fair_events_experimental_features';
const PREFERENCES_OPTION = 'fair_events_sales_summary';
const EDITOR_PASSWORD = 'Test-password-2306!';
// Delivery claims are permanent, and the central and default reports keep
// their keys between runs, so their address is new each run.
const SITEWIDE_EMAIL = `sitewide-2306-${ Date.now() }@example.com`;
const NORTH_A = 'north-a-2306@example.com';
const NORTH_B = 'north-b-2306@example.com';
const FALLBACK = 'fallback-2306@example.com';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

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

test.describe( 'Sales summaries', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let north;
	let south;
	let editorId;
	let editorHeaders;
	const events = {};
	const eventDateIds = [];
	const organizerIds = [];
	const reportKeys = [ 'central', 'default' ];

	const read = ( report, headers = adminHeaders ) =>
		api.get( `${ PATH }/${ report }`, { headers } );
	const save = ( report, data ) =>
		api.put( `${ PATH }/${ report }`, { headers: adminHeaders, data } );
	const preview = async ( report, frequency = 'daily' ) => {
		const res = await api.post( `${ PATH }/${ report }/preview`, {
			headers: adminHeaders,
			data: { frequency },
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	};
	const mails = async () =>
		( await api.get( MAIL_LOG, { headers: adminHeaders } ) ).json();
	const clearMail = () => api.delete( MAIL_LOG, { headers: adminHeaders } );

	const setOrganizersBundle = ( enabled ) =>
		wp(
			'option',
			'update',
			FEATURES_OPTION,
			JSON.stringify( { organizers: enabled } ),
			'--format=json'
		);

	const createOrganizer = async ( data ) => {
		const res = await api.post( ORGANIZERS_PATH, {
			headers: adminHeaders,
			data,
		} );
		expect( res.status(), await res.text() ).toBe( 201 );
		const body = await res.json();
		organizerIds.push( body.id );
		reportKeys.push( body.id );
		return body;
	};

	/**
	 * Create an event, assign it, and record a purchase of `quantity`
	 * tickets made yesterday in the site timezone.
	 *
	 * @param {string}      title       Event title.
	 * @param {string|null} organizerId Assigned organizer, null for the default.
	 * @param {number}      quantity    Tickets bought.
	 * @return {Promise<number>} Event date ID.
	 */
	const createEventWithSale = async ( title, organizerId, quantity ) => {
		const res = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title,
				start_date: '2035-09-03',
				start_time: '18:00:00',
				end_date: '2035-09-03',
				end_time: '20:00:00',
			},
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		eventDateIds.push( body.id );

		if ( organizerId ) {
			const assigned = await api.put(
				`${ EVENT_DATES_PATH }/${ body.id }/organizer`,
				{ headers: adminHeaders, data: { organizer_id: organizerId } }
			);
			expect( assigned.ok(), await assigned.text() ).toBeTruthy();
		}

		// One purchase yesterday (the daily period) and one a week ago,
		// always inside the previous Monday-to-Sunday week.
		await wp(
			'eval',
			`global $wpdb; foreach ( array( 'yesterday 12:00', '-7 days 12:00' ) as $when ) { $wpdb->insert( $wpdb->prefix . 'fair_events_signups', array( 'event_date_id' => ${ Number(
				body.id
			) }, 'name' => 'Buyer', 'email' => 'buyer-2306@example.com', 'quantity' => ${ Number(
				quantity
			) }, 'status' => 'confirmed', 'created_at' => ( new DateTimeImmutable( $when, wp_timezone() ) )->format( 'Y-m-d H:i:s' ) ) ); }`
		);
		return body.id;
	};

	/** Run a report's scheduled send for now, as WP-Cron would. */
	const runScheduledSend = ( report, frequency ) =>
		wp(
			'eval',
			`$now = new DateTimeImmutable( 'now', wp_timezone() ); do_action( 'fair_events_sales_summary', \\FairEvents\\Notifications\\SalesSummaryPeriod::occurrence( '${ frequency }', $now ), '${ report }', '${ frequency }' );`
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await setOrganizersBundle( true );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_organizer: {
					name: 'Sitewide 2306',
					notification_emails: [ SITEWIDE_EMAIL ],
				},
			},
		} );

		north = await createOrganizer( {
			name: 'North 2306',
			notification_emails: [ NORTH_A, NORTH_B ],
		} );
		south = await createOrganizer( { name: 'South 2306' } );

		events.north = await createEventWithSale(
			'North concert 2306',
			north.id,
			3
		);
		events.south = await createEventWithSale(
			'South workshop 2306',
			south.id,
			2
		);
		events.site = await createEventWithSale( 'Site meetup 2306', null, 1 );

		const login = `sales-summary-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: EDITOR_PASSWORD,
				roles: [ 'editor' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		editorId = ( await userRes.json() ).id;
		editorHeaders = basic( login, EDITOR_PASSWORD );
	} );

	test.afterAll( async () => {
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );
		// Report keys are 'central', 'default' or UUIDs: safe to inline.
		const keys = reportKeys.map( ( key ) => `'${ key }'` ).join( ', ' );
		await wp(
			'eval',
			`global $wpdb;
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE email = %s', $wpdb->prefix . 'fair_events_signups', 'buyer-2306@example.com' ) );
			wp_unschedule_hook( 'fair_events_sales_summary' );
			foreach ( array( ${ keys } ) as $key ) {
				$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE config_id = %s AND provider IN ( %s, %s )', $wpdb->prefix . 'fair_events_weekly_notification_deliveries', $key, 'sales_daily', 'sales_weekly' ) );
			}`
		);
		for ( const key of reportKeys ) {
			for ( const field of [ 'next_run', 'last_sent', 'runs' ] ) {
				await wp(
					'option',
					'delete',
					`fair_events_sales_summary_${ field }_${ key }`
				).catch( () => {} );
			}
		}
		await wp( 'option', 'delete', PREFERENCES_OPTION ).catch( () => {} );
		await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		for ( const id of [ ...eventDateIds ].reverse() ) {
			await api.delete( `${ EVENT_DATES_PATH }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of organizerIds ) {
			await wp( 'option', 'delete', OPTION_PREFIX + id ).catch(
				() => {}
			);
		}
		await wp( 'option', 'delete', INDEX_OPTION ).catch( () => {} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { fair_events_organizer: {} },
		} );
		if ( editorId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ editorId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'only administrators can read or change a sales summary', async () => {
		expect( ( await read( 'central', {} ) ).status() ).toBe( 401 );
		expect( ( await read( 'central', editorHeaders ) ).status() ).toBe(
			403
		);
		const write = await api.put( `${ PATH }/central`, {
			headers: editorHeaders,
			data: { frequency: 'off' },
		} );
		expect( write.status() ).toBe( 403 );
		const test403 = await api.post( `${ PATH }/central/test`, {
			headers: editorHeaders,
		} );
		expect( test403.status() ).toBe( 403 );
	} );

	test( 'every report starts off, and an unknown organizer is not found', async () => {
		for ( const key of [ 'central', 'default', north.id, south.id ] ) {
			const body = await ( await read( key ) ).json();
			expect( body.settings.frequency ).toBe( 'off' );
			expect( body.available ).toBe( true );
			expect( body.next_run ).toBeNull();
		}
		expect(
			( await read( '00000000-0000-4000-8000-000000000000' ) ).status()
		).toBe( 404 );
	} );

	test( 'turning a report on needs a fallback address; invalid values are refused per field', async () => {
		const missing = await save( north.id, { frequency: 'daily' } );
		expect( missing.status() ).toBe( 400 );
		expect( ( await missing.json() ).data.params ).toHaveProperty(
			'fallback_email'
		);

		const invalid = await save( north.id, {
			frequency: 'hourly',
			time_of_day: '24:00',
			day_of_week: 9,
			fallback_email: 'a@example.com, b@example.com',
		} );
		expect( invalid.status() ).toBe( 400 );
		expect(
			Object.keys( ( await invalid.json() ).data.params ).sort()
		).toEqual( [
			'day_of_week',
			'fallback_email',
			'frequency',
			'time_of_day',
		] );

		expect( ( await ( await read( north.id ) ).json() ).settings ).toEqual(
			{
				frequency: 'off',
				time_of_day: '08:00',
				day_of_week: 1,
				fallback_email: '',
			}
		);
	} );

	test( 'saves and schedules a report, kept apart from the organizer identity', async () => {
		const res = await save( north.id, {
			frequency: 'daily',
			time_of_day: '07:30',
			fallback_email: FALLBACK,
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		const body = await res.json();
		expect( body.settings ).toEqual( {
			frequency: 'daily',
			time_of_day: '07:30',
			day_of_week: 1,
			fallback_email: FALLBACK,
		} );
		expect( body.recipient_count ).toBe( 2 );
		expect( body.next_run.frequency ).toBe( 'daily' );

		// Saving the organizer's identity does not touch the preferences.
		const identity = await api.put( `${ ORGANIZERS_PATH }/${ north.id }`, {
			headers: adminHeaders,
			data: {
				name: 'North 2306',
				notification_emails: [ NORTH_A, NORTH_B ],
			},
		} );
		expect( identity.ok(), await identity.text() ).toBeTruthy();
		expect(
			( await ( await read( north.id ) ).json() ).settings.frequency
		).toBe( 'daily' );
		expect(
			( await ( await read( south.id ) ).json() ).settings.frequency
		).toBe( 'off' );
	} );

	test( 'each organizer’s preview holds only its own events', async () => {
		const northPreview = await preview( north.id );
		expect( northPreview.subject ).toMatch(
			/^Sales summary for North 2306: /
		);
		expect( northPreview.html ).toContain( 'North concert 2306' );
		expect( northPreview.html ).not.toContain( 'South workshop 2306' );
		expect( northPreview.html ).not.toContain( 'Site meetup 2306' );
		expect( northPreview.html ).not.toContain( NORTH_A );
		expect( northPreview.html ).not.toContain( 'buyer-2306' );
		expect( northPreview.recipients ).toEqual( {
			count: 2,
			fallback: false,
		} );

		const southPreview = await preview( south.id );
		expect( southPreview.html ).toContain( 'South workshop 2306' );
		expect( southPreview.html ).not.toContain( 'North concert 2306' );
		expect( southPreview.recipients.fallback ).toBe( true );

		const sitePreview = await preview( 'default' );
		expect( sitePreview.html ).toContain( 'Site meetup 2306' );
		expect( sitePreview.html ).not.toContain( 'North concert 2306' );
	} );

	test( 'the central preview groups every organizer', async () => {
		const central = await preview( 'central', 'weekly' );
		expect( central.subject ).toMatch( /all organizers/ );
		for ( const text of [
			'Sitewide 2306',
			'North 2306',
			'South 2306',
			'North concert 2306',
			'South workshop 2306',
			'Site meetup 2306',
		] ) {
			expect( central.html ).toContain( text );
		}
		expect( central.html.indexOf( 'North 2306' ) ).toBeLessThan(
			central.html.indexOf( 'North concert 2306' )
		);
	} );

	test( 'a test goes only to the requesting administrator, labelled as a test', async () => {
		await clearMail();
		const admin = await (
			await api.get( '/wp-json/wp/v2/users/me?context=edit', {
				headers: adminHeaders,
			} )
		).json();

		const res = await api.post( `${ PATH }/${ north.id }/test`, {
			headers: adminHeaders,
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await res.json() ).sent_to ).toBe( admin.email );

		const sent = await mails();
		expect( sent ).toHaveLength( 1 );
		expect( sent[ 0 ].to ).toEqual( [ admin.email ] );
		expect( sent[ 0 ].subject ).toMatch( /^\[Test\] Sales summary/ );
		// A test is not a scheduled send.
		expect(
			( await ( await read( north.id ) ).json() ).last_run
		).toBeNull();
	} );

	test( 'a scheduled send reaches each address once, also when the cron run repeats', async () => {
		await clearMail();
		await runScheduledSend( north.id, 'daily' );
		await runScheduledSend( north.id, 'daily' );

		const sent = await mails();
		expect( sent.map( ( mail ) => mail.to ) ).toEqual( [
			[ NORTH_A ],
			[ NORTH_B ],
		] );
		for ( const mail of sent ) {
			expect( mail.subject ).toMatch( /^Sales summary for North 2306/ );
		}
		const status = await ( await read( north.id ) ).json();
		expect( status.last_run ).toMatchObject( {
			status: 'sent',
			frequency: 'daily',
			sent: 2,
			fallback: false,
		} );
		expect( status.next_run ).not.toBeNull();
	} );

	test( 'an organizer without addresses receives its summary at the fallback', async () => {
		await save( south.id, {
			frequency: 'daily',
			fallback_email: FALLBACK,
		} );
		await clearMail();

		await runScheduledSend( south.id, 'daily' );

		const sent = await mails();
		expect( sent ).toHaveLength( 1 );
		expect( sent[ 0 ].to ).toEqual( [ FALLBACK ] );
		expect( sent[ 0 ].subject ).toMatch( /^Sales summary for South 2306/ );
		expect(
			( await ( await read( south.id ) ).json() ).last_run.fallback
		).toBe( true );
	} );

	test( 'the central summary goes to the sitewide organizer on its own schedule', async () => {
		await save( 'central', {
			frequency: 'weekly',
			day_of_week: 2,
			fallback_email: FALLBACK,
		} );
		await clearMail();

		await runScheduledSend( 'central', 'weekly' );

		const sent = await mails();
		expect( sent ).toHaveLength( 1 );
		expect( sent[ 0 ].to ).toEqual( [ SITEWIDE_EMAIL ] );
		expect( sent[ 0 ].subject ).toMatch( /all organizers/ );
		// The organizers' own schedules are unchanged.
		expect(
			( await ( await read( north.id ) ).json() ).settings.frequency
		).toBe( 'daily' );
	} );

	test( 'a failed address does not stop the others', async () => {
		await save( north.id, { frequency: 'weekly' } );
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: NORTH_A },
		} );
		await clearMail();

		await runScheduledSend( north.id, 'weekly' );

		// The mail log captures an email before the failure is reported, so
		// both addresses were attempted; the run records the outcome.
		expect( ( await mails() ).map( ( mail ) => mail.to ) ).toEqual( [
			[ NORTH_A ],
			[ NORTH_B ],
		] );
		expect(
			( await ( await read( north.id ) ).json() ).last_run
		).toMatchObject( { status: 'partial', sent: 1, failed: 1 } );
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );
	} );

	test( 'turning organizers off pauses additional and central summaries without regrouping, and keeps them', async () => {
		await setOrganizersBundle( false );
		try {
			const central = await ( await read( 'central' ) ).json();
			expect( central.available ).toBe( false );
			expect( central.organizer_resolution_available ).toBe( false );
			expect( central.settings.frequency ).toBe( 'weekly' );

			expect(
				( await save( 'central', { frequency: 'daily' } ) ).status()
			).toBe( 409 );
			const paused = await api.post( `${ PATH }/${ north.id }/preview`, {
				headers: adminHeaders,
			} );
			expect( paused.status() ).toBe( 409 );

			const site = await preview( 'default', 'weekly' );
			expect( site.html ).toContain( 'Site meetup 2306' );
			expect( site.html ).not.toContain( 'North concert 2306' );
			expect( site.html ).not.toContain( 'South workshop 2306' );

			await clearMail();
			await runScheduledSend( 'central', 'weekly' );
			expect( await mails() ).toHaveLength( 0 );
			expect(
				( await ( await read( 'central' ) ).json() ).last_run.status
			).toBe( 'paused' );
		} finally {
			await setOrganizersBundle( true );
		}

		const back = await ( await read( north.id ) ).json();
		expect( back.available ).toBe( true );
		expect( back.settings ).toMatchObject( {
			frequency: 'weekly',
			fallback_email: FALLBACK,
		} );
	} );
} );
