/**
 * Telegram ticket sale alerts (#2448): settings on the sale-alerts route,
 * and one alert per paid Get Tickets checkout.
 *
 * - Administrators only; subscribers and visitors are refused.
 * - Every organizer starts off; its own switch is the only one. A
 *   destination is validated before it is saved.
 * - A test message goes to the chat in the request, saved or not, while
 *   alerts are off, and changes no settings; refusals, timeouts and a
 *   missing bot token are reported.
 * - Upgrading from the former sitewide switch keeps effective delivery.
 * - A paid checkout queues one alert, sent to the event's organizer as
 *   Telegram HTML naming the event (entities decoded once), each ticket
 *   type with its quantity and the charged total. Replays send nothing
 *   twice; a failed payment queues nothing.
 * - A refusal is recorded as failed and a timeout as uncertain, without
 *   Telegram's text or the buyer in the response, and neither is resent.
 * - An organizer's frequency (#2449): a daily or weekly digest keeps its
 *   sales pending until its site-local time, then sends them in one
 *   message, once; switching back to Immediate sends what is pending in a
 *   final digest.
 *
 * Purchases go through the public route against the Mollie double,
 * payment notifications through payment-lifecycle.php, and alerts through
 * sale-alerts-fixture.php. Telegram is answered by
 * e2e/mu-plugins/lib/telegram-http-double.php. The suite restores the
 * alert settings and bot token it found.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/sale-alerts';
const CHAT = '-100244801';
const BUYER_EMAIL_DOMAIN = 'sale-alerts.example.com';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

// Fixtures run without blocking the event loop, so idle keep-alive
// connections aren't closed unnoticed between requests.
async function script( file, marker, action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			`wp-content/mu-plugins/scripts/${ file }`,
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( new RegExp( `${ marker }:(\\{.*\\})` ) );
	if ( ! match ) {
		throw new Error( `Expected ${ marker } output, got:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

const alerts = ( action, data ) =>
	script( 'sale-alerts-fixture.php', 'E2E_SALE_ALERTS', action, data );
const lifecycle = ( action, data ) =>
	script( 'payment-lifecycle.php', 'E2E_PAYMENT_LIFECYCLE', action, data );

test.describe.serial( 'Telegram ticket sale alerts', () => {
	test.describe.configure( { timeout: 180 * 1000 } );

	let api;
	let eventId;
	let eventDateId;
	let ticketTypeIds;
	let subscriberId;
	let subscriberHeaders;
	const signupIds = [];
	const transactionIds = [];
	const chats = [ CHAT, '@e2e_missing_chat', '@e2e_timeout_chat' ];
	const run = Date.now();

	async function save( data ) {
		return api.put( PATH, { headers: adminHeaders, data } );
	}

	async function sitewideChat( chatId ) {
		const res = await save( {
			organizers: { default: { enabled: true, chat_id: chatId } },
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
	}

	// A paid checkout of two tickets by a new buyer.
	async function checkout() {
		const email = `buyer-${ randomUUID() }@${ BUYER_EMAIL_DOMAIN }`;
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				ticket_type_id: ticketTypeIds[ 0 ],
				quantity: 2,
				name: 'Alert Buyer',
				email,
				idempotency_key: randomUUID(),
				_honeypot: '',
			},
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		expect( body.status ).toBe( 'payment_required' );
		await visitor.dispose();
		transactionIds.push( body.transaction_id );

		const list = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const signup = ( await list.json() ).find(
			( row ) => row.email === email
		);
		signupIds.push( Number( signup.id ) );
		return {
			transactionId: body.transaction_id,
			signupId: Number( signup.id ),
		};
	}

	async function telegram() {
		return ( await alerts( 'telegram', { chatIds: chats } ) ).requests;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await alerts( 'stash' );
		await alerts( 'cleanup', { transactionIds: [], chatIds: chats } );

		// Stored HTML-encoded, as WordPress stores titles (#2450): a
		// non-breaking space and tag-like text, which must stay text.
		const title = `La&nbsp;Mutable &lt;b&gt;${ run }&lt;/b&gt;`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		eventId = ( await post.json() ).id;

		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-11-20',
				start_time: '19:00:00',
				end_date: '2035-11-20',
				end_time: '21:00:00',
			},
		} );
		const dateBody = await date.json();
		expect( date.ok(), JSON.stringify( dateBody ) ).toBeTruthy();
		eventDateId = dateBody.id;
		expect(
			(
				await api.put(
					`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
					{ headers: adminHeaders, data: { event_id: eventId } }
				)
			).ok()
		).toBeTruthy();

		const type = ( name ) => ( {
			name,
			capacity: null,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			minimum_instances: 1,
			group_ids: [],
		} );
		const tickets = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [ type( 'Standard' ), type( 'Reduced' ) ],
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 20,
						},
						{
							ticket_type_index: 1,
							sale_period_index: 0,
							price: 10,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await tickets.json();
		expect( tickets.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		ticketTypeIds = ticketsBody.ticket_types.map( ( { id } ) => id );

		const login = `sale-alerts-2448-${ run }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: 'Test-password-2448!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ login }:Test-password-2448!` ).toString(
					'base64'
				),
		};
	} );

	test.afterAll( async () => {
		await alerts( 'restore' ).catch( () => {} );
		await alerts( 'cleanup', { transactionIds, chatIds: chats } ).catch(
			() => {}
		);
		await lifecycle( 'cleanup', { signupIds, transactionIds } ).catch(
			() => {}
		);
		for ( const id of signupIds ) {
			await api.delete( `/wp-json/fair-events/v1/get-tickets/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: true },
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

	test( 'only administrators read and save the settings', async () => {
		const guest = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await guest.get( PATH ) ).status() ).toBe( 401 );
		expect(
			( await guest.put( PATH, { data: { organizers: {} } } ) ).status()
		).toBe( 401 );
		expect(
			(
				await guest.post( `${ PATH }/test`, {
					data: { chat_id: CHAT },
				} )
			).status()
		).toBe( 401 );
		await guest.dispose();

		expect(
			( await api.get( PATH, { headers: subscriberHeaders } ) ).status()
		).toBe( 403 );
		expect(
			(
				await api.put( PATH, {
					headers: subscriberHeaders,
					data: { organizers: {} },
				} )
			).status()
		).toBe( 403 );
		expect(
			(
				await api.post( `${ PATH }/test`, {
					headers: subscriberHeaders,
					data: { chat_id: CHAT },
				} )
			).status()
		).toBe( 403 );
		expect( await telegram() ).toHaveLength( 0 );
	} );

	test( 'starts off and validates destinations', async () => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body ).not.toHaveProperty( 'enabled' );
		expect( body.settings_url ).toContain( 'page=fair-events-' );
		expect( body.organizers[ 0 ] ).toMatchObject( {
			id: 'default',
			sitewide: true,
			settings: { enabled: false, chat_id: '' },
		} );
		expect( JSON.stringify( body ) ).not.toContain( 'notification_emails' );

		const invalid = await save( {
			organizers: {
				default: { enabled: true, chat_id: 'https://t.me/x' },
			},
		} );
		expect( invalid.status() ).toBe( 400 );
		expect( ( await invalid.json() ).data.params ).toHaveProperty( [
			'organizers.default.chat_id',
		] );

		const withoutChat = await save( {
			organizers: { default: { enabled: true, chat_id: '' } },
		} );
		expect( withoutChat.status() ).toBe( 400 );
		expect(
			(
				await api
					.get( PATH, { headers: adminHeaders } )
					.then( ( r ) => r.json() )
			).organizers[ 0 ].settings.enabled
		).toBe( false );
	} );

	test( 'a test message goes to the unsaved chat and changes nothing', async () => {
		const before = ( await alerts( 'stored' ) ).stored;
		const sent = ( await telegram() ).length;

		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: ` ${ CHAT } ` },
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( await res.json() ).toEqual( { sent: true } );

		const requests = ( await telegram() ).slice( sent );
		expect( requests ).toHaveLength( 1 );
		expect( requests[ 0 ].chat_id ).toBe( CHAT );
		expect( requests[ 0 ].parse_mode ).toBe( 'HTML' );
		expect( requests[ 0 ].text.split( '\n' )[ 0 ] ).toBe(
			'<b>Test message</b>'
		);
		expect( requests[ 0 ].text ).not.toContain( 'Total' );
		expect( ( await alerts( 'stored' ) ).stored ).toEqual( before );
		expect(
			( await alerts( 'digests', { organizer: 'default' } ) ).digests
		).toEqual( [] );

		const invalid = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: 'https://t.me/x' },
		} );
		expect( invalid.status() ).toBe( 400 );
		expect( ( await invalid.json() ).data.params ).toHaveProperty(
			'chat_id'
		);
		const empty = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: '' },
		} );
		expect( empty.status() ).toBe( 400 );

		const refused = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: '@e2e_missing_chat' },
		} );
		const refusedBody = await refused.json();
		expect( refused.status() ).toBe( 502 );
		expect( refusedBody.code ).toBe( 'fair_events_telegram_refused' );
		expect( refusedBody.message ).toContain( 'chat not found' );
		expect( refusedBody.message ).not.toContain( 'AAEabcdefghijklmnop' );

		const timeout = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: '@e2e_timeout_chat' },
		} );
		expect( timeout.status() ).toBe( 504 );
		expect( ( await timeout.json() ).code ).toBe(
			'fair_events_telegram_uncertain'
		);

		await alerts( 'token', { token: null } );
		const withoutToken = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { chat_id: CHAT },
		} );
		await alerts( 'token', {
			token: '123456789:AAEabcdefghijklmnopqrstuvwxyz012345',
		} );
		const tokenBody = await withoutToken.json();
		expect( withoutToken.status() ).toBe( 409 );
		expect( tokenBody.code ).toBe( 'fair_events_telegram_credential' );
		expect( tokenBody.data.connectors_url ).toContain(
			'options-connectors.php'
		);

		// Only the accepted, refused and timed-out tests reached Telegram.
		expect( ( await telegram() ).slice( sent ) ).toHaveLength( 3 );
		expect( ( await alerts( 'stored' ) ).stored ).toEqual( before );
		// Later tests count only the alerts they send.
		await alerts( 'cleanup', { transactionIds: [], chatIds: chats } );
	} );

	test( 'a paid checkout sends one alert to the sitewide organizer', async () => {
		// While alerts are off, a paid sale queues nothing.
		const before = await checkout();
		await lifecycle( 'settle', {
			transactionId: before.transactionId,
			status: 'paid',
		} );
		expect(
			(
				await alerts( 'rows', {
					transactionIds: [ before.transactionId ],
				} )
			).rows[ before.transactionId ]
		).toBeNull();

		await sitewideChat( CHAT );
		const sale = await checkout();
		// One of the two tickets is changed to another type before payment.
		expect(
			(
				await alerts( 'retype', {
					signupId: sale.signupId,
					ticketTypeId: ticketTypeIds[ 1 ],
				} )
			).retyped
		).toBeTruthy();
		const settled = await lifecycle( 'settle', {
			transactionId: sale.transactionId,
			status: 'paid',
		} );
		expect( settled.announcements.confirmed ).toBe( 1 );

		const queued = await alerts( 'rows', {
			transactionIds: [ sale.transactionId ],
		} );
		expect( queued.rows[ sale.transactionId ].state ).toBe( 'queued' );
		expect( queued.scheduled ).toEqual( [ true ] );

		const sent = await alerts( 'run', {
			transactionId: sale.transactionId,
		} );
		expect( sent.row.state ).toBe( 'sent' );

		const requests = await telegram();
		expect( requests ).toHaveLength( 1 );
		expect( requests[ 0 ].chat_id ).toBe( CHAT );
		expect( requests[ 0 ].parse_mode ).toBe( 'HTML' );
		const lines = requests[ 0 ].text.split( '\n' );
		expect( lines[ 0 ] ).toBe( '<b>New ticket sale</b>' );
		expect( lines[ 1 ] ).toBe(
			`<b>La Mutable &lt;b&gt;${ run }&lt;/b&gt;</b>`
		);
		expect( requests[ 0 ].text ).toContain( '1 × Standard' );
		expect( requests[ 0 ].text ).toContain( '1 × Reduced' );
		expect( requests[ 0 ].text ).toMatch( /Total: 40[.,]00 [A-Z]{3}/ );
		expect( requests[ 0 ].text ).not.toContain( '&nbsp;' );
		expect( requests[ 0 ].text ).not.toContain( BUYER_EMAIL_DOMAIN );
		expect( requests[ 0 ].text ).not.toContain( 'Alert Buyer' );

		// Replayed webhook, worker and recovery: nothing more is sent.
		await lifecycle( 'settle', {
			transactionId: sale.transactionId,
			status: 'paid',
		} );
		await alerts( 'run', { transactionId: sale.transactionId } );
		await alerts( 'recover' );
		expect( await telegram() ).toHaveLength( 1 );

		const page = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		const recent = page.recent.find(
			( row ) => row.event_id === eventDateId
		);
		expect( recent ).toMatchObject( { state: 'sent', reason: '' } );
		expect( recent.event_title ).toBe( `La Mutable <b>${ run }</b>` );
	} );

	test( 'a failed payment queues no alert', async () => {
		const sale = await checkout();
		await lifecycle( 'settle', {
			transactionId: sale.transactionId,
			status: 'failed',
		} );
		expect(
			(
				await alerts( 'rows', {
					transactionIds: [ sale.transactionId ],
				} )
			).rows[ sale.transactionId ]
		).toBeNull();
	} );

	test( 'refusals and timeouts are recorded, without Telegram text or the buyer, and not resent', async () => {
		const outcomes = {};
		for ( const chat of [ '@e2e_missing_chat', '@e2e_timeout_chat' ] ) {
			await sitewideChat( chat );
			const sale = await checkout();
			await lifecycle( 'settle', {
				transactionId: sale.transactionId,
				status: 'paid',
			} );
			outcomes[ chat ] = (
				await alerts( 'run', { transactionId: sale.transactionId } )
			).row;
			await lifecycle( 'settle', {
				transactionId: sale.transactionId,
				status: 'paid',
			} );
			await alerts( 'run', { transactionId: sale.transactionId } );
		}
		await alerts( 'recover' );

		expect( outcomes[ '@e2e_missing_chat' ] ).toMatchObject( {
			state: 'failed',
			reason: 'http_400',
		} );
		expect( outcomes[ '@e2e_timeout_chat' ] ).toMatchObject( {
			state: 'uncertain',
			reason: 'transport_error',
		} );
		const requests = await telegram();
		expect(
			requests.filter(
				( { chat_id: chatId } ) => '@e2e_missing_chat' === chatId
			)
		).toHaveLength( 1 );
		expect(
			requests.filter(
				( { chat_id: chatId } ) => '@e2e_timeout_chat' === chatId
			)
		).toHaveLength( 1 );

		const res = await api.get( PATH, { headers: adminHeaders } );
		const text = await res.text();
		expect( text ).not.toContain( 'chat not found' );
		expect( text ).not.toContain( 'timed out' );
		expect( text ).not.toContain( BUYER_EMAIL_DOMAIN );
		expect( text ).not.toContain( 'AAEabcdefghijklmnop' );
	} );

	test( 'a daily digest collects sales and sends them once', async () => {
		const res = await save( {
			organizers: {
				default: {
					enabled: true,
					chat_id: CHAT,
					frequency: 'daily',
					time_of_day: '07:45',
				},
			},
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		expect( body.organizers[ 0 ].settings ).toEqual( {
			enabled: true,
			chat_id: CHAT,
			frequency: 'daily',
			time_of_day: '07:45',
			day_of_week: 1,
		} );
		expect( typeof body.timezone ).toBe( 'string' );

		const queued = ( await alerts( 'digests', { organizer: 'default' } ) )
			.digests;
		expect( queued ).toHaveLength( 1 );
		expect( queued[ 0 ].args.slice( 0, 2 ) ).toEqual( [
			'default',
			'daily',
		] );
		expect( queued[ 0 ].local ).toMatch( / 07:45$/ );
		expect( Date.parse( body.organizers[ 0 ].next_digest ) ).toBe(
			queued[ 0 ].timestamp * 1000
		);

		// Fields left out keep their saved values; unknown values are refused.
		const partial = await save( {
			organizers: { default: { chat_id: CHAT } },
		} );
		expect(
			( await partial.json() ).organizers[ 0 ].settings.frequency
		).toBe( 'daily' );
		const invalid = await save( {
			organizers: {
				default: { frequency: 'hourly', day_of_week: 9 },
			},
		} );
		expect( invalid.status() ).toBe( 400 );
		expect( Object.keys( ( await invalid.json() ).data.params ) ).toEqual( [
			'organizers.default.frequency',
			'organizers.default.day_of_week',
		] );

		const sent = ( await telegram() ).length;
		const sales = [ await checkout(), await checkout() ];
		for ( const sale of sales ) {
			await lifecycle( 'settle', {
				transactionId: sale.transactionId,
				status: 'paid',
			} );
			expect(
				( await alerts( 'run', { transactionId: sale.transactionId } ) )
					.row.state
			).toBe( 'pending' );
		}
		expect( await telegram() ).toHaveLength( sent );
		expect(
			(
				await api
					.get( PATH, { headers: adminHeaders } )
					.then( ( r ) => r.json() )
			).organizers[ 0 ].pending
		).toBe( 2 );

		expect(
			( await alerts( 'fire', { organizer: 'default' } ) ).fired
		).toBe( 1 );
		// The next digest is queued again; firing it finds nothing to send.
		expect(
			( await alerts( 'fire', { organizer: 'default' } ) ).fired
		).toBe( 1 );
		await alerts( 'recover' );

		const requests = ( await telegram() ).slice( sent );
		expect( requests ).toHaveLength( 1 );
		expect( requests[ 0 ].chat_id ).toBe( CHAT );
		expect( requests[ 0 ].text.split( '\n' )[ 0 ] ).toBe(
			'<b>Ticket sales digest</b>'
		);
		expect( requests[ 0 ].text ).toMatch(
			/2 sales, total: 80[.,]00 [A-Z]{3}/
		);
		expect( requests[ 0 ].text ).toContain( '4 × Standard' );
		expect( requests[ 0 ].text ).not.toContain( BUYER_EMAIL_DOMAIN );

		const rows = (
			await alerts( 'rows', {
				transactionIds: sales.map( ( s ) => s.transactionId ),
			} )
		).rows;
		for ( const sale of sales ) {
			expect( rows[ sale.transactionId ].state ).toBe( 'sent' );
		}
		const page = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( page.organizers[ 0 ].pending ).toBe( 0 );
		expect(
			page.recent.find(
				( row ) =>
					row.event_id === eventDateId &&
					'sent' === row.state &&
					row.digest
			)
		).toBeTruthy();
	} );

	test( 'switching a digest to Immediate sends what is pending once', async () => {
		await save( {
			organizers: {
				default: {
					frequency: 'weekly',
					day_of_week: 5,
					time_of_day: '18:30',
				},
			},
		} );
		const weekly = ( await alerts( 'digests', { organizer: 'default' } ) )
			.digests;
		expect( weekly ).toHaveLength( 1 );
		expect( weekly[ 0 ].local ).toBe( '5 18:30' );

		const sent = ( await telegram() ).length;
		const pending = await checkout();
		await lifecycle( 'settle', {
			transactionId: pending.transactionId,
			status: 'paid',
		} );
		await alerts( 'run', { transactionId: pending.transactionId } );

		await save( { organizers: { default: { frequency: 'immediate' } } } );
		const flush = ( await alerts( 'digests', { organizer: 'default' } ) )
			.digests;
		expect( flush.map( ( { args } ) => args ) ).toEqual( [
			[ 'default', 'immediate', 'now' ],
		] );
		await alerts( 'fire', { organizer: 'default' } );
		await alerts( 'recover' );

		const later = await checkout();
		await lifecycle( 'settle', {
			transactionId: later.transactionId,
			status: 'paid',
		} );
		expect(
			( await alerts( 'run', { transactionId: later.transactionId } ) )
				.row.state
		).toBe( 'sent' );

		const requests = ( await telegram() ).slice( sent );
		expect( requests.map( ( r ) => r.text.split( '\n' )[ 0 ] ) ).toEqual( [
			'<b>Ticket sales digest</b>',
			'<b>New ticket sale</b>',
		] );
		expect( requests[ 0 ].text ).toMatch( /1 sale, total: / );
		expect(
			( await alerts( 'digests', { organizer: 'default' } ) ).digests
		).toEqual( [] );
	} );
	test( 'switching an organizer off skips its queued sale', async () => {
		await sitewideChat( CHAT );
		const sent = ( await telegram() ).length;
		const sale = await checkout();
		await lifecycle( 'settle', {
			transactionId: sale.transactionId,
			status: 'paid',
		} );
		expect(
			(
				await alerts( 'rows', {
					transactionIds: [ sale.transactionId ],
				} )
			).rows[ sale.transactionId ].state
		).toBe( 'queued' );

		const off = await save( {
			organizers: { default: { enabled: false } },
		} );
		expect( off.status() ).toBe( 200 );
		expect(
			( await alerts( 'run', { transactionId: sale.transactionId } ) ).row
		).toMatchObject( {
			state: 'skipped',
			reason: 'organizer_disabled',
		} );
		expect( await telegram() ).toHaveLength( sent );

		// Every organizer off: a new sale queues nothing at all.
		const later = await checkout();
		await lifecycle( 'settle', {
			transactionId: later.transactionId,
			status: 'paid',
		} );
		expect(
			(
				await alerts( 'rows', {
					transactionIds: [ later.transactionId ],
				} )
			).rows[ later.transactionId ]
		).toBeNull();
	} );

	test( 'upgrading keeps each site’s effective delivery', async () => {
		const organizer = ( enabled ) => ( {
			enabled,
			chat_id: CHAT,
			frequency: 'weekly',
			time_of_day: '18:30',
			day_of_week: 5,
		} );

		const wasOff = await alerts( 'legacy', {
			settings: {
				enabled: false,
				organizers: { default: organizer( true ) },
			},
		} );
		expect( wasOff.migrated ).toBe( true );
		expect( wasOff.stored ).toEqual( {
			organizers: { default: organizer( false ) },
		} );

		const wasOn = await alerts( 'legacy', {
			settings: {
				enabled: true,
				organizers: { default: organizer( true ) },
			},
		} );
		expect( wasOn.stored ).toEqual( {
			organizers: { default: organizer( true ) },
		} );
		const body = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( body.organizers[ 0 ].settings ).toEqual( organizer( true ) );
		expect( body ).not.toHaveProperty( 'enabled' );
	} );
} );
