/**
 * Playwright API tests for WeeklyNotificationsController (#1660, #1734):
 * authorization, input validation, the bot token's move to Settings →
 * Connectors, and the fail-closed test-send and preview paths.
 *
 * The bot token is entered, replaced and removed through the core settings
 * route (`/wp/v2/settings`), the route the Connectors screen writes to. The
 * weekly notifications routes only report whether a token is configured.
 *
 * No case here reaches api.telegram.org: each is refused by a permission
 * check, validation, a missing-configuration guard, or an empty week first. The successful
 * test send is covered end to end by
 * e2e/user-flows/weekly-telegram-notifications.spec.js, which runs against
 * the Telegram HTTP double.
 *
 * The routes register with the `sources` feature bundle (on by default).
 * The suite restores the settings it found. Responses never hold the token,
 * so it cannot be restored: the cases that save or remove one are skipped
 * when the site already has a token.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/weekly-notifications';
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

test.describe( 'WeeklyNotificationsController', () => {
	let api;
	let original;
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

	const readStatus = async () =>
		( await api.get( PATH, { headers: adminHeaders } ) ).json();

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
		original = await res.json();

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
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				enabled: original.enabled,
				source_slug: original.source_slug,
				page_id: original.page_id,
				day_of_week: original.day_of_week,
				time_of_day: original.time_of_day,
				week_scope: original.week_scope,
				telegram_enabled: original.telegram_enabled,
				telegram_chat_ids: original.telegram_chat_ids,
			},
		} );
		if ( ! original.telegram_token_configured ) {
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
			( await anon.post( PATH, { data: { enabled: true } } ) ).status()
		).toBe( 401 );
		expect( ( await anon.post( `${ PATH }/test` ) ).status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'forbids non-administrators', async () => {
		for ( const call of [
			() => api.get( PATH, { headers: subscriberHeaders } ),
			() =>
				api.post( PATH, {
					headers: subscriberHeaders,
					data: { enabled: false },
				} ),
			() =>
				api.get( `${ PATH }/preview`, { headers: subscriberHeaders } ),
			() => api.post( `${ PATH }/test`, { headers: subscriberHeaders } ),
			() => saveToken( TOKEN, subscriberHeaders ),
			// Refused on permissions, not on the value's format.
			() => saveToken( 'not-a-token', subscriberHeaders ),
		] ) {
			expect( ( await call() ).status() ).toBe( 403 );
		}
	} );

	test( 'returns settings without any token value', async () => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body ).toEqual(
			expect.objectContaining( {
				enabled: expect.any( Boolean ),
				day_of_week: expect.any( Number ),
				time_of_day: expect.stringMatching( /^\d{2}:\d{2}$/ ),
				week_scope: expect.stringMatching( /^(current|next)$/ ),
				telegram_token_configured: expect.any( Boolean ),
				telegram_token_valid: expect.any( Boolean ),
				telegram_token_source: expect.stringMatching(
					/^(env|constant|database|none)$/
				),
				connectors_url: expect.stringMatching(
					/\/wp-admin\/options-connectors\.php$/
				),
				telegram_chat_ids: expect.any( Array ),
				sources: expect.any( Array ),
				pages: expect.any( Array ),
				runs: expect.any( Array ),
				deliveries: expect.any( Array ),
			} )
		);
		expect( body ).not.toHaveProperty( 'telegram_bot_token' );
	} );

	test( 'enters, replaces and removes the token through the settings API', async () => {
		test.skip(
			original.telegram_token_configured,
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
			expect( JSON.parse( statusText ) ).toMatchObject( {
				telegram_token_configured: true,
				telegram_token_valid: true,
				telegram_token_source: 'database',
			} );

			const settings = await api.get( SETTINGS_PATH, {
				headers: adminHeaders,
			} );
			expect( await settings.text() ).not.toContain( token );
		}

		const removed = await saveToken( '' );
		expect( removed.status() ).toBe( 200 );
		expect( await readStatus() ).toMatchObject( {
			telegram_token_configured: false,
			telegram_token_valid: false,
			telegram_token_source: 'none',
		} );
	} );

	test( 'rejects a malformed replacement and keeps the previous token', async () => {
		test.skip(
			original.telegram_token_configured,
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
			telegram_token_configured: true,
			telegram_token_valid: true,
		} );
	} );

	test( 'rejects the former token parameter and route without saving anything', async () => {
		await api.post( PATH, {
			headers: adminHeaders,
			data: { time_of_day: '07:45' },
		} );
		const before = await readStatus();

		const res = await api.post( PATH, {
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
		expect( after.telegram_token_configured ).toBe(
			before.telegram_token_configured
		);

		const removed = await api.delete( `${ PATH }/telegram-token`, {
			headers: adminHeaders,
		} );
		expect( removed.status() ).toBe( 404 );
		expect( ( await readStatus() ).telegram_token_configured ).toBe(
			before.telegram_token_configured
		);
	} );

	const ensureToken = async () => {
		if ( ( await readStatus() ).telegram_token_configured ) {
			return;
		}
		expect( ( await saveToken( TOKEN ) ).status() ).toBe( 200 );
	};

	test( 'keeps the saved token when other settings are saved (#1733)', async () => {
		await ensureToken();

		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: {
				time_of_day: '07:45',
				telegram_chat_ids: '@fair_e2e_channel',
			},
		} );
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		expect( text ).not.toContain( TOKEN );
		const body = JSON.parse( text );
		expect( body.time_of_day ).toBe( '07:45' );
		expect( body.telegram_token_configured ).toBe( true );
		expect( body ).not.toHaveProperty( 'telegram_bot_token' );
	} );

	test( 'keeps Telegram destinations when Telegram is turned off', async () => {
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				telegram_enabled: true,
				telegram_chat_ids: '@fair_e2e_channel\n-1001234567890',
			},
		} );
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: { telegram_enabled: false },
		} );

		const body = await res.json();
		expect( body.telegram_enabled ).toBe( false );
		expect( body.telegram_chat_ids ).toEqual( [
			'@fair_e2e_channel',
			'-1001234567890',
		] );
	} );

	test( 'rejects invalid chat identifiers and names them', async () => {
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: { telegram_chat_ids: '@fair_e2e_channel, https://t.me/x' },
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
			const res = await api.post( PATH, { headers: adminHeaders, data } );
			expect( res.status() ).toBe( 400 );
		}
	} );

	test( 'refuses to turn on without a valid source and page', async () => {
		const res = await api.post( PATH, {
			headers: adminHeaders,
			data: { enabled: true, source_slug: '', page_id: 0 },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'missing_source' );

		const read = await api.get( PATH, { headers: adminHeaders } );
		expect( ( await read.json() ).enabled ).toBe( original.enabled );
	} );

	test( 'accepts any public page as the message heading', async () => {
		const page = await createPage( 'publish' );

		const saved = await api.post( PATH, {
			headers: adminHeaders,
			data: { source_slug: sourceSlug, page_id: page.id },
		} );
		expect( saved.status() ).toBe( 200 );
		const body = await saved.json();
		expect( body.configuration_error ).toBeNull();
		expect( body.pages.map( ( p ) => p.id ) ).toContain( page.id );

		const preview = await api.get( `${ PATH }/preview`, {
			headers: adminHeaders,
		} );
		expect( preview.status() ).toBe( 200 );
		const previewBody = await preview.json();
		expect( previewBody.text ).toContain( page.link );

		// The Telegram presentation links the page title instead of printing its URL.
		const [ first ] = previewBody.telegram_messages;
		expect( previewBody.telegram_parts ).toBe(
			previewBody.telegram_messages.length
		);
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

		const saved = await api.post( PATH, {
			headers: adminHeaders,
			data: { source_slug: sourceSlug, page_id: draft.id },
		} );
		const body = await saved.json();
		expect( body.configuration_error ).toBeTruthy();
		// The saved page stays selectable even though it no longer qualifies.
		expect( body.pages.map( ( p ) => p.id ) ).toContain( draft.id );

		const preview = await api.get( `${ PATH }/preview`, {
			headers: adminHeaders,
		} );
		expect( preview.status() ).toBe( 400 );
		expect( ( await preview.json() ).code ).toBe( 'page_not_public' );
	} );

	test( 'refuses a preview without a valid configuration', async () => {
		await api.post( PATH, {
			headers: adminHeaders,
			data: { source_slug: 'no-such-source-1660' },
		} );
		const res = await api.get( `${ PATH }/preview`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'invalid_source' );
	} );

	test( 'refuses a test send and turning on without a token', async () => {
		test.skip(
			original.telegram_token_configured,
			'Would remove the bot token already configured on this site.'
		);
		expect( ( await saveToken( '' ) ).status() ).toBe( 200 );
		expect( ( await readStatus() ).telegram_token_configured ).toBe(
			false
		);

		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'missing_token' );
		expect( body.message ).toContain( 'Connectors' );

		const page = await createPage( 'publish' );
		const enabled = await api.post( PATH, {
			headers: adminHeaders,
			data: {
				enabled: true,
				source_slug: sourceSlug,
				page_id: page.id,
				telegram_enabled: true,
				telegram_chat_ids: '@fair_e2e_channel',
			},
		} );
		expect( enabled.status() ).toBe( 400 );
		const refusal = await enabled.json();
		expect( refusal.code ).toBe( 'no_destination' );
		expect( refusal.message ).toContain( 'Connectors' );
		expect( ( await readStatus() ).enabled ).toBe( original.enabled );
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
			const saved = await api.post( PATH, {
				headers: adminHeaders,
				data: {
					source_slug: emptySlug,
					page_id: page.id,
					telegram_chat_ids: '@e2e_weekly_empty',
				},
			} );
			// Only saved when the site has no token of its own; afterAll removes it.
			await ensureToken();
			expect( saved.status() ).toBe( 200 );

			const preview = await api.get( `${ PATH }/preview`, {
				headers: adminHeaders,
			} );
			expect( ( await preview.json() ).occurrence_count ).toBe( 0 );

			const res = await api.post( `${ PATH }/test`, {
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
} );
