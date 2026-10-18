/**
 * Playwright API tests for EventNotificationsController (#1810): one route
 * set per notification channel under /fair-events/v1/event-notifications.
 *
 * Telegram (#1660, #1734): authorization, input validation, the bot token
 * living in Settings → Connectors, and the fail-closed test-send and preview
 * paths. The token is entered, replaced and removed through the core
 * settings route (`/wp/v2/settings`), the route the Connectors screen writes
 * to; these routes only report whether a token is configured.
 *
 * Bulk email: settings independent of Telegram, validation, the preview and
 * the administrator-only test.
 *
 * Individual email (#1852): one explicitly configured address, validated
 * rather than repaired; its own schedule and event selection; a preview and
 * a test that name their destination, use the saved settings and never
 * count as a scheduled send. Mail is captured by the test support layer
 * (e2e/mu-plugins), which can also make delivery to one address fail.
 *
 * Configurations (#1919): several notifications of one kind, each with a
 * server-generated ID, its own settings, schedule and history; the type
 * routes above manage only the configuration each type started with.
 *
 * The retired routes of the former owners
 * (Fair Events Experimental, Fair Audience) must be gone.
 *
 * No case here reaches api.telegram.org: the #1883 regression uses the
 * Telegram HTTP double; other cases are refused by a permission
 * check, validation, a missing-configuration guard, or an empty week first.
 * The successful test send is covered end to end by
 * e2e/user-flows/weekly-telegram-notifications.spec.js, which runs against
 * the Telegram HTTP double.
 *
 * The suite restores the settings it found. Responses never hold the token,
 * so it cannot be restored: the cases that save or remove one are skipped
 * when the site already has a token.
 */

import { test, expect, request } from '@playwright/test';
import { runScript } from '../../../../e2e/support/wp-cli.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/event-notifications';
const TELEGRAM = `${ PATH }/telegram`;
const BULK_EMAIL = `${ PATH }/bulk-email`;
const INDIVIDUAL_EMAIL = `${ PATH }/individual-email`;
const MAIL_LOG = '/wp-json/fair-e2e/v1/fee-reminders/mail';
const MAIL_FAILURE = '/wp-json/fair-e2e/v1/fee-reminders/mail-failure';
const RECIPIENT = 'organizer-1852-api@example.test';
const INDIVIDUAL_FIELDS = [
	'enabled',
	'recipient',
	'event_selection',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'skip_empty',
	'subject',
	'intro',
	'outro',
];
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const TOKEN_OPTION = 'fair_events_experimental_weekly_telegram_token';
const TOKEN = '123456789:AAEe2eWeeklyNotificationsToken0123456';
const REPLACEMENT = '987654321:AAEe2eWeeklyNotificationsToken6543210';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'EventNotificationsController', () => {
	let api;
	let original;
	let originalBulk;
	let originalIndividual;
	let subscriberId;
	let subscriberHeaders;
	let sourceId;
	let sourceSlug;
	const pageIds = [];

	// Write the credential the way the Connectors screen does.
	const saveToken = ( value, headers = adminHeaders ) =>
		api.post( SETTINGS_PATH, {
			headers,
			data: { [ TOKEN_OPTION ]: value },
		} );

	const readChannels = async () =>
		( await ( await api.get( PATH, { headers: adminHeaders } ) ).json() )
			.channels;

	const readStatus = async () => ( await readChannels() ).telegram;

	const telegramOf = async ( res ) => ( await res.json() ).channels.telegram;

	const createPage = async ( status ) => {
		const res = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: {
				title: `Weekly heading ${ status } ${ Date.now() }`,
				content:
					'<!-- wp:paragraph --><p>No calendar here.</p><!-- /wp:paragraph -->',
				status,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const page = await res.json();
		pageIds.push( page.id );
		return page;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.ok() ).toBeTruthy();
		( {
			telegram: original,
			bulk_email: originalBulk,
			individual_email: originalIndividual,
		} = ( await res.json() ).channels );

		const userLogin = `weekly-notifications-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1660!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1660!` ).toString(
					'base64'
				),
		};

		sourceSlug = `weekly-notifications-${ Date.now() }`;
		const sourceRes = await api.post( '/wp-json/fair-events/v1/sources', {
			headers: adminHeaders,
			data: {
				name: 'Weekly notifications source',
				slug: sourceSlug,
				enabled: true,
				data_sources: [
					{
						source_type: 'categories',
						config: { category_ids: [ 1 ] },
					},
				],
			},
		} );
		expect( sourceRes.ok() ).toBeTruthy();
		sourceId = ( await sourceRes.json() ).id;
	} );

	test.afterAll( async () => {
		await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: {
				enabled: original.enabled,
				source_slug: original.source_slug,
				page_id: original.page_id,
				day_of_week: original.day_of_week,
				time_of_day: original.time_of_day,
				week_scope: original.week_scope,
				chat_ids: original.chat_ids,
			},
		} );
		await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: Object.fromEntries(
				[
					'enabled',
					'source_slug',
					'day_of_week',
					'time_of_day',
					'week_scope',
					'skip_empty',
					'subject',
					'intro',
					'outro',
				].map( ( field ) => [ field, originalBulk[ field ] ] )
			),
		} );
		// Turned off first, so restoring never depends on the saved selection.
		await api.post( INDIVIDUAL_EMAIL, {
			headers: adminHeaders,
			data: { enabled: false },
		} );
		await api.post( INDIVIDUAL_EMAIL, {
			headers: adminHeaders,
			data: Object.fromEntries(
				INDIVIDUAL_FIELDS.map( ( field ) => [
					field,
					originalIndividual[ field ],
				] )
			),
		} );
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );
		if ( ! original.token_configured ) {
			await saveToken( '' );
		}
		for ( const id of pageIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		if ( sourceId ) {
			await api.delete( `/wp-json/fair-events/v1/sources/${ sourceId }`, {
				headers: adminHeaders,
			} );
		}
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'rejects unauthenticated requests', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await anon.get( PATH ) ).status() ).toBe( 401 );
		expect(
			(
				await anon.post( TELEGRAM, { data: { enabled: true } } )
			).status()
		).toBe( 401 );
		expect(
			(
				await anon.post( BULK_EMAIL, { data: { enabled: true } } )
			).status()
		).toBe( 401 );
		expect(
			(
				await anon.post( INDIVIDUAL_EMAIL, {
					data: { enabled: true, recipient: RECIPIENT },
				} )
			).status()
		).toBe( 401 );
		for ( const channel of [ TELEGRAM, BULK_EMAIL, INDIVIDUAL_EMAIL ] ) {
			expect( ( await anon.post( `${ channel }/test` ) ).status() ).toBe(
				401
			);
			expect(
				( await anon.get( `${ channel }/preview` ) ).status()
			).toBe( 401 );
		}
		await anon.dispose();
	} );

	test( 'forbids non-administrators', async () => {
		for ( const call of [
			() => api.get( PATH, { headers: subscriberHeaders } ),
			...[ TELEGRAM, BULK_EMAIL, INDIVIDUAL_EMAIL ].flatMap(
				( channel ) => [
					() =>
						api.post( channel, {
							headers: subscriberHeaders,
							data: { enabled: false },
						} ),
					() =>
						api.get( `${ channel }/preview`, {
							headers: subscriberHeaders,
						} ),
					() =>
						api.post( `${ channel }/test`, {
							headers: subscriberHeaders,
						} ),
				]
			),
			() => saveToken( TOKEN, subscriberHeaders ),
			// Refused on permissions, not on the value's format.
			() => saveToken( 'not-a-token', subscriberHeaders ),
		] ) {
			expect( ( await call() ).status() ).toBe( 403 );
		}
	} );

	test( 'returns every channel without any token value', async () => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		const body = JSON.parse( text );

		expect( body ).toEqual(
			expect.objectContaining( {
				sources: expect.any( Array ),
				pages: expect.any( Array ),
			} )
		);
		expect( body.channels.telegram ).toEqual(
			expect.objectContaining( {
				state: 'active',
				enabled: expect.any( Boolean ),
				day_of_week: expect.any( Number ),
				time_of_day: expect.stringMatching( /^\d{2}:\d{2}$/ ),
				week_scope: expect.stringMatching( /^(current|next)$/ ),
				token_configured: expect.any( Boolean ),
				token_valid: expect.any( Boolean ),
				token_source: expect.stringMatching(
					/^(env|constant|database|none)$/
				),
				connectors_url: expect.stringMatching(
					/\/wp-admin\/options-connectors\.php$/
				),
				chat_ids: expect.any( Array ),
				runs: expect.any( Array ),
				deliveries: expect.any( Array ),
			} )
		);
		expect( body.channels.bulk_email ).toEqual(
			expect.objectContaining( {
				state: 'active',
				enabled: expect.any( Boolean ),
				day_of_week: expect.any( Number ),
				time_of_day: expect.stringMatching( /^\d{2}:\d{2}$/ ),
				week_scope: expect.stringMatching( /^(current|next)$/ ),
				skip_empty: expect.any( Boolean ),
				subject: expect.any( String ),
				test_recipient: expect.stringContaining( '@' ),
				runs: expect.any( Array ),
			} )
		);
		expect( body.channels.individual_email ).toEqual(
			expect.objectContaining( {
				state: 'active',
				enabled: expect.any( Boolean ),
				recipient: expect.any( String ),
				event_selection: expect.any( String ),
				day_of_week: expect.any( Number ),
				time_of_day: expect.stringMatching( /^\d{2}:\d{2}$/ ),
				week_scope: expect.stringMatching( /^(current|next)$/ ),
				skip_empty: expect.any( Boolean ),
				subject: expect.any( String ),
				runs: expect.any( Array ),
			} )
		);
		expect( text ).not.toMatch( /bot_token/ );
	} );

	test( "retires the former owners' routes and settings", async () => {
		for ( const path of [
			'/wp-json/fair-events-experimental/v1/weekly-notifications',
			'/wp-json/fair-audience/v1/weekly-digest',
		] ) {
			const res = await api.get( path, { headers: adminHeaders } );
			expect( res.status() ).toBe( 404 );
		}

		// The core settings route no longer accepts the former digest option.
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		expect( settings ).not.toHaveProperty( 'fair_audience_weekly_digest' );
	} );

	test( "keeps each channel's schedule and event selection independent", async () => {
		const before = await readChannels();

		const telegramRes = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { day_of_week: 5, time_of_day: '10:30', week_scope: 'next' },
		} );
		expect( telegramRes.status() ).toBe( 200 );
		const bulkRes = await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: {
				source_slug: sourceSlug,
				day_of_week: 2,
				time_of_day: '06:15',
				week_scope: 'current',
			},
		} );
		expect( bulkRes.status() ).toBe( 200 );

		const after = await readChannels();
		expect( after.telegram ).toMatchObject( {
			day_of_week: 5,
			time_of_day: '10:30',
			week_scope: 'next',
			source_slug: before.telegram.source_slug,
		} );
		expect( after.bulk_email ).toMatchObject( {
			source_slug: sourceSlug,
			day_of_week: 2,
			time_of_day: '06:15',
			week_scope: 'current',
		} );
	} );

	test( 'saves the bulk email wording, dropping unsafe markup', async () => {
		const res = await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: {
				subject: 'Events {week_start}',
				intro: '<strong>Hello</strong><script>alert(1)</script>',
				outro: 'See you',
				skip_empty: false,
			},
		} );
		expect( res.status() ).toBe( 200 );
		const bulk = ( await res.json() ).channels.bulk_email;
		expect( bulk.subject ).toBe( 'Events {week_start}' );
		expect( bulk.intro ).toContain( '<strong>Hello</strong>' );
		expect( bulk.intro ).not.toContain( '<script' );
		expect( bulk.outro ).toBe( 'See you' );
		expect( bulk.skip_empty ).toBe( false );
	} );

	test( 'rejects invalid bulk email schedules and sources', async () => {
		for ( const data of [
			{ time_of_day: '25:00' },
			{ day_of_week: 0 },
			{ week_scope: 'last' },
		] ) {
			const res = await api.post( BULK_EMAIL, {
				headers: adminHeaders,
				data,
			} );
			expect( res.status() ).toBe( 400 );
		}

		const res = await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: { enabled: true, source_slug: 'no-such-source-1810' },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'invalid_source' );
		expect( ( await readChannels() ).bulk_email.source_slug ).not.toBe(
			'no-such-source-1810'
		);
	} );

	test( 'schedules the next future bulk email only while it is on', async () => {
		const on = await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: { enabled: true, source_slug: sourceSlug },
		} );
		expect( on.status() ).toBe( 200 );
		const scheduled = ( await on.json() ).channels.bulk_email;
		expect( scheduled.enabled ).toBe( true );
		expect( scheduled.next_run.timestamp ).toBeGreaterThan(
			Date.now() / 1000
		);
		expect( scheduled.next_run.send_week ).toMatch( /^\d{4}-W\d{2}$/ );
		// A send week that was already used is never scheduled again.
		expect( scheduled.next_run.send_week ).not.toBe(
			scheduled.last_sent_week
		);

		const off = await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: { enabled: false },
		} );
		const paused = ( await off.json() ).channels.bulk_email;
		expect( paused.enabled ).toBe( false );
		expect( paused.next_run ).toBeNull();
		expect( paused.source_slug ).toBe( sourceSlug );
	} );

	test( 'previews the bulk email and sends its test to the administrator only', async () => {
		await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: { source_slug: sourceSlug, subject: 'Events {week_start}' },
		} );

		const preview = await api.get( `${ BULK_EMAIL }/preview`, {
			headers: adminHeaders,
		} );
		expect( preview.status() ).toBe( 200 );
		const email = await preview.json();
		expect( email.subject ).toMatch( /^Events \d{4}-\d{2}-\d{2}$/ );
		expect( email.html ).toEqual( expect.any( String ) );
		expect( email.empty ).toEqual( expect.any( Boolean ) );

		const before = ( await readChannels() ).bulk_email;
		const sent = await api.post( `${ BULK_EMAIL }/test`, {
			headers: adminHeaders,
		} );
		// 500 when the test site has no mail transport; never another recipient.
		if ( sent.status() === 200 ) {
			expect( ( await sent.json() ).sent_to ).toBe(
				before.test_recipient
			);
		} else {
			expect( ( await sent.json() ).code ).toBe( 'send_failed' );
		}
		// A test never counts as the week's send.
		const after = ( await readChannels() ).bulk_email;
		expect( after.last_sent_week ).toBe( before.last_sent_week );
		expect( after.runs ).toEqual( before.runs );
	} );

	test( 'refuses a bulk email preview without an event feed', async () => {
		await api.post( BULK_EMAIL, {
			headers: adminHeaders,
			data: { enabled: false, source_slug: '' },
		} );
		const res = await api.get( `${ BULK_EMAIL }/preview`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'missing_source' );
	} );

	test( 'enters, replaces and removes the token through the settings API', async () => {
		test.skip(
			original.token_configured,
			'Would replace the bot token already configured on this site.'
		);

		for ( const token of [ TOKEN, REPLACEMENT ] ) {
			const res = await saveToken( token );
			expect( res.status() ).toBe( 200 );
			const text = await res.text();
			expect( text ).not.toContain( token );
			// Masked, showing only the last four characters.
			expect( JSON.parse( text )[ TOKEN_OPTION ] ).toMatch(
				new RegExp( `^•+${ token.slice( -4 ) }$` )
			);

			const read = await api.get( PATH, { headers: adminHeaders } );
			const statusText = await read.text();
			expect( statusText ).not.toContain( token );
			expect( JSON.parse( statusText ).channels.telegram ).toMatchObject(
				{
					token_configured: true,
					token_valid: true,
					token_source: 'database',
				}
			);

			const settings = await api.get( SETTINGS_PATH, {
				headers: adminHeaders,
			} );
			expect( await settings.text() ).not.toContain( token );
		}

		const removed = await saveToken( '' );
		expect( removed.status() ).toBe( 200 );
		expect( await readStatus() ).toMatchObject( {
			token_configured: false,
			token_valid: false,
			token_source: 'none',
		} );
	} );

	test( 'rejects a malformed replacement and keeps the previous token', async () => {
		test.skip(
			original.token_configured,
			'Would replace the bot token already configured on this site.'
		);
		expect( ( await saveToken( TOKEN ) ).status() ).toBe( 200 );

		const invalid = 'not-a-token-1734';
		const res = await saveToken( invalid );
		expect( res.status() ).toBe( 400 );
		const text = await res.text();
		expect( text ).not.toContain( invalid );
		expect( JSON.parse( text ).code ).toBe( 'invalid_bot_token' );

		const settings = await api.get( SETTINGS_PATH, {
			headers: adminHeaders,
		} );
		expect( ( await settings.json() )[ TOKEN_OPTION ] ).toMatch(
			new RegExp( `^•+${ TOKEN.slice( -4 ) }$` )
		);
		expect( await readStatus() ).toMatchObject( {
			token_configured: true,
			token_valid: true,
		} );
	} );

	test( 'rejects the former token parameter and route without saving anything', async () => {
		await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { time_of_day: '07:45' },
		} );
		const before = await readStatus();

		const res = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { time_of_day: '18:30', telegram_bot_token: REPLACEMENT },
		} );
		expect( res.status() ).toBe( 400 );
		const text = await res.text();
		expect( text ).not.toContain( REPLACEMENT );
		const body = JSON.parse( text );
		expect( body.code ).toBe( 'token_managed_in_connectors' );
		expect( body.message ).toContain( 'Connectors' );

		const after = await readStatus();
		expect( after.time_of_day ).toBe( '07:45' );
		expect( after.token_configured ).toBe( before.token_configured );

		const removed = await api.delete( `${ TELEGRAM }/token`, {
			headers: adminHeaders,
		} );
		expect( removed.status() ).toBe( 404 );
		expect( ( await readStatus() ).token_configured ).toBe(
			before.token_configured
		);
	} );

	const ensureToken = async () => {
		if ( ( await readStatus() ).token_configured ) {
			return;
		}
		expect( ( await saveToken( TOKEN ) ).status() ).toBe( 200 );
	};

	test( 'keeps the saved token when other settings are saved (#1733)', async () => {
		await ensureToken();

		const res = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: {
				time_of_day: '07:45',
				chat_ids: '@fair_e2e_channel',
			},
		} );
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		expect( text ).not.toContain( TOKEN );
		const body = JSON.parse( text ).channels.telegram;
		expect( body.time_of_day ).toBe( '07:45' );
		expect( body.token_configured ).toBe( true );
		expect( text ).not.toMatch( /bot_token/ );
	} );

	test( 'keeps Telegram destinations when Telegram is turned off', async () => {
		await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { chat_ids: '@fair_e2e_channel\n-1001234567890' },
		} );
		const res = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { enabled: false },
		} );

		const body = await telegramOf( res );
		expect( body.enabled ).toBe( false );
		expect( body.next_run ).toBeNull();
		expect( body.chat_ids ).toEqual( [
			'@fair_e2e_channel',
			'-1001234567890',
		] );
	} );

	test( 'rejects invalid chat identifiers and names them', async () => {
		const res = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { chat_ids: '@fair_e2e_channel, https://t.me/x' },
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'invalid_chat_ids' );
		expect( body.message ).toContain( 'https://t.me/x' );
		expect( body.message ).not.toContain( '@fair_e2e_channel' );
	} );

	test( 'rejects an invalid send time, weekday or week scope', async () => {
		for ( const data of [
			{ time_of_day: '25:00' },
			{ day_of_week: 8 },
			{ week_scope: 'last' },
		] ) {
			const res = await api.post( TELEGRAM, {
				headers: adminHeaders,
				data,
			} );
			expect( res.status() ).toBe( 400 );
		}
	} );

	test( 'refuses to turn on without a valid source and page', async () => {
		const res = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { enabled: true, source_slug: '', page_id: 0 },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'missing_source' );

		expect( ( await readStatus() ).enabled ).toBe( false );
	} );

	test( 'accepts any public page as the message heading', async () => {
		const page = await createPage( 'publish' );

		const saved = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { source_slug: sourceSlug, page_id: page.id },
		} );
		expect( saved.status() ).toBe( 200 );
		const body = await saved.json();
		expect( body.channels.telegram.configuration_error ).toBeNull();
		expect( body.pages.map( ( p ) => p.id ) ).toContain( page.id );

		const preview = await api.get( `${ TELEGRAM }/preview`, {
			headers: adminHeaders,
		} );
		expect( preview.status() ).toBe( 200 );
		const previewBody = await preview.json();
		expect( previewBody.week_title ).toEqual( expect.any( String ) );

		// The Telegram presentation links the page title instead of printing its URL.
		const [ first ] = previewBody.messages;
		expect( first.text.startsWith( page.title.rendered ) ).toBe( true );
		expect( first.text ).not.toContain( page.link );
		expect( first.entities ).toContainEqual( {
			type: 'text_link',
			offset: 0,
			length: page.title.rendered.length,
			url: page.link,
		} );
	} );

	test( 'refuses a page that is not public', async () => {
		const draft = await createPage( 'draft' );

		const saved = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { source_slug: sourceSlug, page_id: draft.id },
		} );
		const body = await saved.json();
		expect( body.channels.telegram.configuration_error ).toBeTruthy();
		// The saved page stays selectable even though it no longer qualifies.
		expect( body.pages.map( ( p ) => p.id ) ).toContain( draft.id );

		const preview = await api.get( `${ TELEGRAM }/preview`, {
			headers: adminHeaders,
		} );
		expect( preview.status() ).toBe( 400 );
		expect( ( await preview.json() ).code ).toBe( 'page_not_public' );
	} );

	test( 'refuses a preview without a valid configuration', async () => {
		await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: { source_slug: 'no-such-source-1660' },
		} );
		const res = await api.get( `${ TELEGRAM }/preview`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'invalid_source' );
	} );

	test( 'refuses a test send and turning on without a token', async () => {
		test.skip(
			original.token_configured,
			'Would remove the bot token already configured on this site.'
		);
		expect( ( await saveToken( '' ) ).status() ).toBe( 200 );
		expect( ( await readStatus() ).token_configured ).toBe( false );

		const res = await api.post( `${ TELEGRAM }/test`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'missing_token' );
		expect( body.message ).toContain( 'Connectors' );

		const page = await createPage( 'publish' );
		const enabled = await api.post( TELEGRAM, {
			headers: adminHeaders,
			data: {
				enabled: true,
				source_slug: sourceSlug,
				page_id: page.id,
				chat_ids: '@fair_e2e_channel',
			},
		} );
		expect( enabled.status() ).toBe( 400 );
		const refusal = await enabled.json();
		expect( refusal.code ).toBe( 'no_destination' );
		expect( refusal.message ).toContain( 'Connectors' );
		expect( ( await readStatus() ).enabled ).toBe( false );
	} );

	test( 'sends nothing when the test week has no events (#1735)', async () => {
		const categoryRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Weekly empty ${ Date.now() }` },
		} );
		expect( categoryRes.ok() ).toBeTruthy();
		const categoryId = ( await categoryRes.json() ).id;
		const emptySlug = `weekly-empty-${ Date.now() }`;
		const sourceRes = await api.post( '/wp-json/fair-events/v1/sources', {
			headers: adminHeaders,
			data: {
				name: 'Weekly notifications empty source',
				slug: emptySlug,
				enabled: true,
				data_sources: [
					{
						source_type: 'categories',
						config: { category_ids: [ categoryId ] },
					},
				],
			},
		} );
		expect( sourceRes.ok() ).toBeTruthy();
		const emptySourceId = ( await sourceRes.json() ).id;

		try {
			const page = await createPage( 'publish' );
			const saved = await api.post( TELEGRAM, {
				headers: adminHeaders,
				data: {
					source_slug: emptySlug,
					page_id: page.id,
					chat_ids: '@e2e_weekly_empty',
				},
			} );
			// Only saved when the site has no token of its own; afterAll removes it.
			await ensureToken();
			expect( saved.status() ).toBe( 200 );

			const preview = await api.get( `${ TELEGRAM }/preview`, {
				headers: adminHeaders,
			} );
			expect( ( await preview.json() ).occurrence_count ).toBe( 0 );

			const res = await api.post( `${ TELEGRAM }/test`, {
				headers: adminHeaders,
			} );
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'no_events' );
		} finally {
			await api.delete(
				`/wp-json/fair-events/v1/sources/${ emptySourceId }`,
				{ headers: adminHeaders }
			);
			await api.delete(
				`/wp-json/wp/v2/categories/${ categoryId }?force=true`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'previews and tests use today for both scopes across every channel (#1883)', async () => {
		test.setTimeout( 240000 );
		const fixture = ( action ) =>
			runScript(
				'notification-weeks-fixture.php',
				'E2E_NOTIFICATION_WEEKS',
				action
			);
		const site = fixture( 'site' );
		expect( site.url.replace( /\/$/, '' ) ).toBe(
			BASE_URL.replace( /\/$/, '' )
		);
		expect( site.offline ).toBe( true );
		const source = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			'source'
		);
		try {
			const seeded = fixture( `seed ${ source.termId }` );
			// The day-by-day event listing of an email, without its own text
			// and inline styles.
			const eventSections = ( html ) =>
				( html.match( /<h3\b[\s\S]*?<\/ul>/g ) || [] )
					.join( '' )
					.replace( / style="[^"]*"/g, '' );
			const bulkEvents = {};
			const page = await createPage( 'publish' );
			const monday = new Date( `${ seeded.today }T12:00:00Z` );
			monday.setUTCDate( monday.getUTCDate() - seeded.weekday + 1 );
			for ( const scenario of [ 'passed', 'disabled', 'prior' ] ) {
				if ( scenario === 'prior' ) {
					fixture( 'prior' );
				}
				for ( const scope of [ 'current', 'next' ] ) {
					for ( const [ route, key ] of [
						[ TELEGRAM, 'telegram' ],
						[ BULK_EMAIL, 'bulk_email' ],
						[ INDIVIDUAL_EMAIL, 'individual_email' ],
					] ) {
						const data = {
							enabled: scenario !== 'disabled',
							day_of_week: seeded.weekday,
							time_of_day: '00:00',
							week_scope: scope,
							source_slug: source.sourceSlug,
						};
						if ( key === 'telegram' ) {
							Object.assign( data, {
								page_id: page.id,
								chat_ids: '@e2e_week_scope',
							} );
						} else if ( key === 'individual_email' ) {
							delete data.source_slug;
							Object.assign( data, {
								recipient: RECIPIENT,
								event_selection: source.sourceSlug,
							} );
						}
						const saved = await api.post( route, {
							headers: adminHeaders,
							data,
						} );
						expect( saved.status() ).toBe( 200 );
						const before = ( await saved.json() ).channels[ key ];
						const previewResponse = await api.get(
							`${ route }/preview`,
							{ headers: adminHeaders }
						);
						expect( previewResponse.status() ).toBe( 200 );
						const preview = await previewResponse.json();
						const start = new Date( monday );
						if ( key === 'telegram' && seeded.weekday !== 7 ) {
							start.setUTCDate( start.getUTCDate() - 1 );
						} else if ( key === 'telegram' ) {
							start.setUTCDate( start.getUTCDate() + 6 );
						}
						if ( scope === 'next' ) {
							start.setUTCDate( start.getUTCDate() + 7 );
						}
						const end = new Date( start );
						end.setUTCDate( end.getUTCDate() + 6 );
						expect( preview.week_start ).toBe(
							start.toISOString().slice( 0, 10 )
						);
						expect( preview.week_end ).toBe(
							end.toISOString().slice( 0, 10 )
						);
						const content =
							key === 'telegram'
								? preview.messages
										.map( ( m ) => m.text )
										.join( '\n' )
								: preview.html;
						for ( const event of seeded.events ) {
							if (
								event.date >= preview.week_start &&
								event.date <= preview.week_end
							) {
								expect( content ).toContain( event.title );
							} else {
								expect( content ).not.toContain( event.title );
							}
						}
						// Both emails list the same events the same way.
						if ( key === 'bulk_email' ) {
							bulkEvents[ scope ] = eventSections( preview.html );
						} else if ( key === 'individual_email' ) {
							expect( eventSections( preview.html ) ).toBe(
								bulkEvents[ scope ]
							);
						}
						fixture( 'clear' );
						const sent = await api.post( `${ route }/test`, {
							headers: adminHeaders,
						} );
						expect( sent.status() ).toBe( 200 );
						const captured = fixture( 'captured' );
						if ( key === 'telegram' ) {
							expect(
								captured.telegram.map( ( m ) => ( {
									text: m.text,
									entities: m.entities,
								} ) )
							).toEqual( preview.messages );
							expect( captured.mail ).toEqual( [] );
						} else {
							expect( captured.mail ).toHaveLength( 1 );
							expect( captured.mail[ 0 ].subject ).toBe(
								preview.subject
							);
							const eventItems = ( html ) =>
								(
									html.match(
										/<li\b[^>]*>[\s\S]*?<\/li>/g
									) || []
								).map( ( item ) =>
									item.replace( / style="[^"]*"/g, '' )
								);
							expect(
								eventItems( captured.mail[ 0 ].body )
							).toEqual( eventItems( preview.html ) );
							expect( captured.telegram ).toEqual( [] );
						}
						if ( key === 'individual_email' ) {
							// The subscribers' branded layout, without their
							// greeting or subscription link.
							const body = captured.mail[ 0 ].body;
							expect( body ).toContain( 'max-width: 600px' );
							expect( body ).toMatch( /<h1\b[^>]*>[^<]+<\/h1>/ );
							expect( body ).toContain( 'Team' );
							expect( body ).not.toContain(
								'Manage your preferences'
							);
						}
						const after = ( await readChannels() )[ key ];
						expect( after.next_run ).toEqual( before.next_run );
						expect( after.runs ).toEqual( before.runs );
						expect( after.deliveries ).toEqual( before.deliveries );
						expect( after.last_sent_week ).toBe(
							before.last_sent_week
						);
					}
				}
			}
		} finally {
			fixture( 'cleanup' );
			runScript(
				'weekly-summary-fixture.php',
				'E2E_WEEKLY',
				`cleanup ${ source.termId } ${ source.sourceId }`
			);
		}
	} );

	test.describe( 'individual email', () => {
		const save = ( data ) =>
			api.post( INDIVIDUAL_EMAIL, { headers: adminHeaders, data } );
		const readIndividual = async () =>
			( await readChannels() ).individual_email;
		const capturedFor = async ( to ) =>
			(
				await api.get(
					`${ MAIL_LOG }?to=${ encodeURIComponent( to ) }`,
					{
						headers: adminHeaders,
					}
				)
			).json();

		test.beforeEach( async () => {
			await api.post( MAIL_FAILURE, {
				headers: adminHeaders,
				data: { email: '' },
			} );
			// Earlier tests send to the same address.
			await api.delete( MAIL_LOG, { headers: adminHeaders } );
			const res = await save( {
				enabled: false,
				recipient: '',
				event_selection: '@local',
				day_of_week: 1,
				time_of_day: '08:00',
				week_scope: 'current',
				skip_empty: false,
				subject: 'Organizer update {week_start}',
				intro: '',
				outro: '',
			} );
			expect( res.status() ).toBe( 200 );
		} );

		test( 'cannot be turned on without one valid address', async () => {
			const missing = await save( { enabled: true } );
			expect( missing.status() ).toBe( 400 );
			const refusal = await missing.json();
			expect( refusal.code ).toBe( 'missing_recipient' );
			expect( refusal.message ).toContain( 'email address' );

			const off = await readIndividual();
			expect( off.enabled ).toBe( false );
			expect( off.next_run ).toBeNull();
		} );

		test( 'refuses recipient lists and header injection without altering them', async () => {
			expect( ( await save( { recipient: RECIPIENT } ) ).status() ).toBe(
				200
			);

			for ( const recipient of [
				`${ RECIPIENT }, second-1852@example.test`,
				`${ RECIPIENT }; second-1852@example.test`,
				`${ RECIPIENT } second-1852@example.test`,
				`Organizer <${ RECIPIENT }>`,
				`${ RECIPIENT }\r\nBcc: second-1852@example.test`,
				`${ RECIPIENT }\n`,
				'not-an-address',
				[ RECIPIENT ],
			] ) {
				const res = await save( { enabled: true, recipient } );
				expect( res.status() ).toBe( 400 );
				expect( ( await res.json() ).code ).toMatch(
					/^(invalid_recipient|rest_invalid_param)$/
				);
			}

			// Nothing of the refused requests was saved, not even a part.
			const kept = await readIndividual();
			expect( kept.recipient ).toBe( RECIPIENT );
			expect( kept.enabled ).toBe( false );
		} );

		test( 'rejects invalid schedules and event selections', async () => {
			for ( const data of [
				{ time_of_day: '25:00' },
				{ day_of_week: 0 },
				{ day_of_week: 8 },
				{ week_scope: 'last' },
				{ event_selection: '' },
				{ event_selection: 'Not A Slug' },
			] ) {
				expect( ( await save( data ) ).status() ).toBe( 400 );
			}

			// A source that does not exist is kept as chosen, reported, and
			// cannot be sent from: it never widens to every local event.
			const gone = await save( {
				recipient: RECIPIENT,
				event_selection: 'no-such-source-1852',
			} );
			expect( gone.status() ).toBe( 200 );
			const channel = ( await gone.json() ).channels.individual_email;
			expect( channel.event_selection ).toBe( 'no-such-source-1852' );
			expect( channel.configuration_error ).toBeTruthy();

			const enable = await save( { enabled: true } );
			expect( enable.status() ).toBe( 400 );
			expect( ( await enable.json() ).code ).toBe( 'invalid_source' );
			for ( const call of [
				() =>
					api.get( `${ INDIVIDUAL_EMAIL }/preview`, {
						headers: adminHeaders,
					} ),
				() =>
					api.post( `${ INDIVIDUAL_EMAIL }/test`, {
						headers: adminHeaders,
					} ),
			] ) {
				const res = await call();
				expect( res.status() ).toBe( 400 );
				expect( ( await res.json() ).code ).toBe( 'invalid_source' );
			}
			expect( await capturedFor( RECIPIENT ) ).toEqual( [] );
		} );

		test( 'keeps its schedule, selection and wording apart from the other channels', async () => {
			const before = await readChannels();

			const res = await save( {
				recipient: RECIPIENT,
				event_selection: sourceSlug,
				day_of_week: 4,
				time_of_day: '05:20',
				week_scope: 'next',
				skip_empty: true,
				subject: 'Only for the organizer',
				intro: '<strong>Hello</strong><script>alert(1)</script>',
				outro: 'Bye',
			} );
			expect( res.status() ).toBe( 200 );

			const after = await readChannels();
			expect( after.individual_email ).toMatchObject( {
				recipient: RECIPIENT,
				event_selection: sourceSlug,
				day_of_week: 4,
				time_of_day: '05:20',
				week_scope: 'next',
				skip_empty: true,
				subject: 'Only for the organizer',
				outro: 'Bye',
				configuration_error: null,
			} );
			expect( after.individual_email.intro ).toContain(
				'<strong>Hello</strong>'
			);
			expect( after.individual_email.intro ).not.toContain( '<script' );
			expect( after.telegram ).toEqual( before.telegram );
			expect( after.bulk_email ).toEqual( before.bulk_email );

			// And the other way round.
			const bulkRes = await api.post( BULK_EMAIL, {
				headers: adminHeaders,
				data: { subject: 'Bulk subject 1852', time_of_day: '11:11' },
			} );
			expect( bulkRes.status() ).toBe( 200 );
			expect(
				( await bulkRes.json() ).channels.individual_email
			).toEqual( after.individual_email );
		} );

		test( 'schedules the next future send only while it is on', async () => {
			const on = await save( { enabled: true, recipient: RECIPIENT } );
			expect( on.status() ).toBe( 200 );
			const scheduled = ( await on.json() ).channels.individual_email;
			expect( scheduled.enabled ).toBe( true );
			expect( scheduled.next_run.timestamp ).toBeGreaterThan(
				Date.now() / 1000
			);
			expect( scheduled.next_run.send_week ).toMatch( /^\d{4}-W\d{2}$/ );
			// Saving sends nothing.
			expect( await capturedFor( RECIPIENT ) ).toEqual( [] );

			const off = await save( { enabled: false } );
			const paused = ( await off.json() ).channels.individual_email;
			expect( paused.enabled ).toBe( false );
			expect( paused.next_run ).toBeNull();
			expect( paused.recipient ).toBe( RECIPIENT );
		} );

		test( 'previews the saved email and names its destination', async () => {
			await save( { recipient: RECIPIENT, intro: 'Hello organizer' } );

			const res = await api.get( `${ INDIVIDUAL_EMAIL }/preview`, {
				headers: adminHeaders,
			} );
			expect( res.status() ).toBe( 200 );
			const email = await res.json();
			expect( email.recipient ).toBe( RECIPIENT );
			expect( email.subject ).toMatch(
				/^Organizer update \d{4}-\d{2}-\d{2}$/
			);
			expect( email.html ).toContain( 'Hello organizer' );
			expect( email.empty ).toEqual( expect.any( Boolean ) );
			expect( email.skip_empty ).toBe( false );
			expect( email.week_title ).toEqual( expect.any( String ) );
			// A preview sends nothing.
			expect( await capturedFor( RECIPIENT ) ).toEqual( [] );
		} );

		test( 'sends a test to the configured address only, without touching the schedule', async () => {
			await api.delete( MAIL_LOG, { headers: adminHeaders } );
			// Works while scheduled delivery is off.
			await save( { recipient: RECIPIENT } );
			const before = await readIndividual();
			expect( before.enabled ).toBe( false );

			const res = await api.post( `${ INDIVIDUAL_EMAIL }/test`, {
				headers: adminHeaders,
			} );
			expect( res.status() ).toBe( 200 );
			expect( ( await res.json() ).sent_to ).toBe( RECIPIENT );

			const all = await (
				await api.get( MAIL_LOG, { headers: adminHeaders } )
			).json();
			expect( all ).toHaveLength( 1 );
			expect( all[ 0 ].to ).toEqual( [ RECIPIENT ] );
			expect( all[ 0 ].subject ).toMatch( /^Organizer update / );

			// A test never counts as the week's send or moves the next one.
			const after = await readIndividual();
			expect( after.last_sent_week ).toBe( before.last_sent_week );
			expect( after.runs ).toEqual( before.runs );
			expect( after.next_run ).toEqual( before.next_run );

			// The same with a schedule in place.
			const on = ( await ( await save( { enabled: true } ) ).json() )
				.channels.individual_email;
			await api.post( `${ INDIVIDUAL_EMAIL }/test`, {
				headers: adminHeaders,
			} );
			const tested = await readIndividual();
			expect( tested.next_run ).toEqual( on.next_run );
			expect( tested.runs ).toEqual( on.runs );
		} );

		test( 'refuses a test without a saved address', async () => {
			const res = await api.post( `${ INDIVIDUAL_EMAIL }/test`, {
				headers: adminHeaders,
			} );
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'missing_recipient' );
		} );

		test( 'reports a failed test and leaves the other channels alone', async () => {
			await save( { recipient: RECIPIENT } );
			const before = await readChannels();
			await api.post( MAIL_FAILURE, {
				headers: adminHeaders,
				data: { email: RECIPIENT },
			} );

			const res = await api.post( `${ INDIVIDUAL_EMAIL }/test`, {
				headers: adminHeaders,
			} );
			expect( res.status() ).toBe( 500 );
			const body = await res.json();
			expect( body.code ).toBe( 'send_failed' );
			expect( body.message ).toContain( RECIPIENT );

			const after = await readChannels();
			expect( after.telegram ).toEqual( before.telegram );
			expect( after.bulk_email ).toEqual( before.bulk_email );
		} );
	} );

	test.describe( 'configurations', () => {
		const CONFIGURATIONS = `${ PATH }/configurations`;
		const SHARED = 'shared-1919-api@example.test';
		const created = [];

		const create = async ( data, headers = adminHeaders ) =>
			api.post( CONFIGURATIONS, { headers, data } );

		const createIndividual = async ( name ) => {
			const res = await create( { type: 'individual_email', name } );
			expect( res.status() ).toBe( 201 );
			const configuration = await res.json();
			created.push( configuration.id );
			return configuration;
		};

		const update = ( id, data ) =>
			api.post( `${ CONFIGURATIONS }/${ id }`, {
				headers: adminHeaders,
				data,
			} );

		const read = async ( id ) =>
			(
				await api.get( `${ CONFIGURATIONS }/${ id }`, {
					headers: adminHeaders,
				} )
			).json();

		test.afterAll( () => {
			if ( created.length ) {
				runScript(
					'notification-configurations-fixture.php',
					'E2E_NOTIFICATION_CONFIGURATIONS',
					`remove ${ created.join( ' ' ) }`
				);
			}
		} );

		test( 'are managed by administrators only', async () => {
			const anon = await request.newContext( { baseURL: BASE_URL } );
			expect(
				(
					await anon.post( CONFIGURATIONS, {
						data: { type: 'individual_email' },
					} )
				).status()
			).toBe( 401 );
			await anon.dispose();
			expect(
				(
					await create(
						{ type: 'individual_email' },
						subscriberHeaders
					)
				).status()
			).toBe( 403 );
		} );

		test( 'start paused with a server-generated ID and their own name', async () => {
			const first = await createIndividual( 'Team inbox' );
			const second = await createIndividual( 'Board inbox' );

			expect( first.id ).toMatch( /^[a-z0-9-]{36}$/ );
			expect( second.id ).not.toBe( first.id );
			expect( first ).toMatchObject( {
				type: 'individual_email',
				name: 'Team inbox',
				enabled: false,
				next_run: null,
				runs: [],
			} );

			const page = await (
				await api.get( PATH, { headers: adminHeaders } )
			).json();
			const ids = page.configurations.map( ( { id } ) => id );
			expect( ids ).toEqual(
				expect.arrayContaining( [
					'telegram',
					'bulk_email',
					'individual_email',
					first.id,
					second.id,
				] )
			);
			expect( page.types.individual_email.state ).toBe( 'active' );
			// The type routes keep describing the configuration each type started with.
			expect( page.channels.individual_email.id ).toBe(
				'individual_email'
			);
		} );

		test( 'refuse unknown kinds, unknown IDs and changing a kind', async () => {
			expect( ( await create( { type: 'sms' } ) ).status() ).toBe( 400 );
			expect( ( await create( {} ) ).status() ).toBe( 400 );

			const unknown = `${ CONFIGURATIONS }/00000000-0000-4000-a000-000000000000`;
			for ( const res of [
				await api.get( unknown, { headers: adminHeaders } ),
				await api.post( unknown, {
					headers: adminHeaders,
					data: { enabled: false },
				} ),
				await api.get( `${ unknown }/preview`, {
					headers: adminHeaders,
				} ),
				await api.post( `${ unknown }/test`, {
					headers: adminHeaders,
				} ),
				await api.get( `${ unknown }/history`, {
					headers: adminHeaders,
				} ),
			] ) {
				expect( res.status() ).toBe( 404 );
				expect( ( await res.json() ).code ).toBe(
					'unknown_configuration'
				);
			}

			const own = await createIndividual( 'Kind check' );
			const res = await update( own.id, {
				type: 'telegram',
				recipient: SHARED,
			} );
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe(
				'configuration_type_immutable'
			);
			const kept = await read( own.id );
			expect( kept.type ).toBe( 'individual_email' );
			expect( kept.recipient ).toBe( '' );
		} );

		test( 'save, schedule and pause independently with the same address', async () => {
			const first = await createIndividual( 'First' );
			const second = await createIndividual( 'Second' );
			const legacy = ( await readChannels() ).individual_email;

			let res = await update( first.id, {
				enabled: true,
				recipient: SHARED,
				time_of_day: '06:15',
				name: 'First renamed',
			} );
			expect( res.status() ).toBe( 200 );
			const savedFirst = await res.json();
			expect( savedFirst.name ).toBe( 'First renamed' );
			expect( savedFirst.next_run ).not.toBeNull();

			res = await update( second.id, {
				enabled: true,
				recipient: SHARED,
				time_of_day: '19:45',
			} );
			const savedSecond = await res.json();
			expect( savedSecond.time_of_day ).toBe( '19:45' );
			expect( savedSecond.next_run ).not.toBeNull();
			expect( savedSecond.next_run.timestamp ).not.toBe(
				savedFirst.next_run.timestamp
			);
			expect( ( await read( first.id ) ).time_of_day ).toBe( '06:15' );
			// Neither touched the configuration the type routes manage.
			expect( ( await readChannels() ).individual_email ).toEqual(
				legacy
			);

			// Pausing one leaves the other scheduled.
			res = await update( first.id, { enabled: false } );
			expect( ( await res.json() ).next_run ).toBeNull();
			expect( ( await read( second.id ) ).next_run ).toEqual(
				savedSecond.next_run
			);

			// Rescheduling one leaves the other where it was.
			res = await update( second.id, { time_of_day: '20:30' } );
			expect( ( await res.json() ).next_run.timestamp ).not.toBe(
				savedSecond.next_run.timestamp
			);
			expect( ( await read( first.id ) ).next_run ).toBeNull();
		} );

		test( 'preview, test and history use their own settings', async () => {
			const own = await createIndividual( 'Previewed' );
			await update( own.id, {
				recipient: SHARED,
				subject: 'Own subject {week_start}',
			} );

			const preview = await (
				await api.get( `${ CONFIGURATIONS }/${ own.id }/preview`, {
					headers: adminHeaders,
				} )
			).json();
			expect( preview.recipient ).toBe( SHARED );
			expect( preview.subject ).toContain( 'Own subject' );

			const sent = await api.post(
				`${ CONFIGURATIONS }/${ own.id }/test`,
				{ headers: adminHeaders }
			);
			expect( sent.status() ).toBe( 200 );
			expect( ( await sent.json() ).sent_to ).toBe( SHARED );

			const history = await (
				await api.get( `${ CONFIGURATIONS }/${ own.id }/history`, {
					headers: adminHeaders,
				} )
			).json();
			// A test is not a scheduled send.
			expect( history ).toMatchObject( {
				id: own.id,
				next_run: null,
				runs: [],
			} );
		} );
	} );
} );
