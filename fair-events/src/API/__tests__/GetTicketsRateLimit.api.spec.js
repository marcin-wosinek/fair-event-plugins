/**
 * Playwright API tests for the get-tickets rate limits (#1769).
 *
 * The public fair-events/v1/get-tickets route keeps two separate counters:
 * one per email, which takes only checkouts that were created (10 within 15
 * minutes of the last one), and one per IP, which takes every attempt that
 * reaches a checkout or a deferred answer (20 an hour).
 *
 * Counters are read, reset and aged through the test-only fair-e2e/v1
 * rate-limit routes. The suite bypasses the per-IP limit; the specs that
 * exercise it switch it on for themselves.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const GET_TICKETS = '/wp-json/fair-events/v1/get-tickets';

const EMAIL_LIMIT = 10;
const EMAIL_WINDOW = 900;
const IP_LIMIT = 20;
const IP_WINDOW = 3600;

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const uniqueEmail = ( label ) =>
	`rate-limit-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

const newKey = () => randomUUID();

test.describe( 'Get-tickets rate limits', () => {
	let api;
	let fairAudienceActive = false;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with its capacity
	 * and ticket types.
	 *
	 * @param {Object}   options
	 * @param {?number}  [options.capacity]    Event capacity (per occurrence).
	 * @param {Object[]} [options.ticketTypes] { name, price, scope }.
	 * @param {string}   [options.rrule]       Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds.
	 */
	async function createEvent( {
		capacity = null,
		ticketTypes = [],
		rrule,
	} = {} ) {
		const title = `Rate limit ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		createdPostIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-11-01 10:00:00',
				end_datetime: '2035-11-01 12:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const occurrenceIds = [
			eventDateId,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
		createdEventDateIds.push( ...occurrenceIds );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					capacity,
					ticket_types: ticketTypes.map( ( type ) => ( {
						name: type.name,
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: type.scope || 'single_instance',
						minimum_instances: 1,
						group_ids: [],
					} ) ),
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: ticketTypes.map( ( type, index ) => ( {
						ticket_type_index: index,
						sale_period_index: 0,
						price: type.price || 0,
					} ) ),
					options: [],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			eventDateId,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
		};
	}

	// One browser per buyer: fair-audience recognises a returning buyer by
	// the session their first purchase opened, and holds back a purchase
	// typed with a known email from a browser it has not seen.
	const buyers = new Map();
	const strangers = [];

	async function buyerContext( email ) {
		if ( ! buyers.has( email ) ) {
			buyers.set(
				email,
				await request.newContext( { baseURL: BASE_URL } )
			);
		}
		return buyers.get( email );
	}

	/**
	 * Submit the purchase form's request. Without a visitor each buyer
	 * (email) gets a browser of their own; pass one to choose the browser.
	 *
	 * @param {Object} data      Request payload.
	 * @param {Object} [visitor] Request context to reuse.
	 * @return {Promise<{status: number, body: Object}>} Response.
	 */
	async function buy( data, visitor ) {
		const context = visitor || ( await buyerContext( data.email || '' ) );
		const res = await context.post( GET_TICKETS, {
			data: { name: 'Rate Limit Buyer', _honeypot: '', ...data },
		} );
		const text = await res.text();
		let body;
		try {
			body = JSON.parse( text );
		} catch ( error ) {
			body = { raw: text.slice( 0, 300 ) };
		}
		return { status: res.status(), body };
	}

	/**
	 * Start a checkout that must be created.
	 *
	 * @param {Object} data Request payload.
	 * @return {Promise<Object>} Response body.
	 */
	async function checkout( data ) {
		const res = await buy( { idempotency_key: newKey(), ...data } );
		expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
		return res.body;
	}

	async function expectRateLimited( res ) {
		expect( res.status, JSON.stringify( res.body ) ).toBe( 429 );
		expect( res.body.code ).toBe( 'rate_limited' );
		// Generic: the answer does not say which limit was reached.
		expect( res.body.message ).toBe(
			'Too many requests. Please try again later.'
		);
	}

	async function fixture( path, data, method = 'post' ) {
		const res = await api[ method ]( `/wp-json/fair-e2e/v1/${ path }`, {
			headers: adminHeaders,
			data,
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	/**
	 * Counters of an email and of the IP every request here comes from.
	 *
	 * @param {string} [email] Email address.
	 * @return {Promise<Object>} { email: { count, ttl }, ip: { count, ttl } }.
	 */
	async function counters( email = '' ) {
		const res = await api.get( '/wp-json/fair-e2e/v1/rate-limit', {
			headers: adminHeaders,
			params: { email },
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	const elapse = ( target, seconds, email = '' ) =>
		fixture( 'rate-limit/elapse', { target, seconds, email } );

	/**
	 * Everything checkouts left on the given event dates.
	 *
	 * @param {number|number[]} eventDateIds Event date ID(s).
	 * @return {Promise<Object>} signups, transactions, keys, mollie_create_count.
	 */
	async function state( eventDateIds ) {
		const params = new URLSearchParams();
		[]
			.concat( eventDateIds )
			.forEach( ( id ) => params.append( 'event_date_ids[]', id ) );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/checkout-keys?${ params }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	// A window just refreshed, allowing for the seconds the requests took.
	const expectFreshWindow = ( ttl, window ) => {
		expect( ttl ).toBeLessThanOrEqual( window );
		expect( ttl ).toBeGreaterThan( window - 60 );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const namespace = await api.get( '/wp-json/fair-audience/v1' );
		fairAudienceActive = namespace.ok();
	} );

	test.beforeEach( async () => {
		// Start every spec from an empty IP counter.
		await fixture( 'rate-limit', {}, 'delete' );
	} );

	test.afterEach( async () => {
		// Leave no enforced IP limit, counter or armed failure behind.
		await fixture( 'rate-limit', {}, 'delete' );
		await fixture(
			'checkout-keys/faults',
			{ crash_transaction_creates: 0, fail_mollie_creates: 0 },
			'put'
		);
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			const res = await api.get( GET_TICKETS, {
				headers: adminHeaders,
				params: { event_date: dateId },
			} );
			for ( const signup of res.ok() ? await res.json() : [] ) {
				await api.delete( `${ GET_TICKETS }/${ signup.id }`, {
					headers: adminHeaders,
				} );
			}
		}
		for ( const postId of createdPostIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const context of [ ...buyers.values(), ...strangers ] ) {
			await context.dispose();
		}
		await api.dispose();
	} );

	test.describe( 'per email', () => {
		test( 'ten checkouts are created and the eleventh is refused', async () => {
			const { eventDateId } = await createEvent();
			const email = uniqueEmail( 'threshold' );
			const purchase = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
			};
			const first = { ...purchase, idempotency_key: newKey() };

			await checkout( first );
			for ( let i = 1; i < EMAIL_LIMIT; i++ ) {
				await checkout( purchase );
			}
			expect( ( await counters( email ) ).email.count ).toBe(
				EMAIL_LIMIT
			);

			await expectRateLimited(
				await buy( { ...purchase, idempotency_key: newKey() } )
			);

			// The address in another letter case is the same buyer.
			await expectRateLimited(
				await buy(
					{
						...purchase,
						email: email.toUpperCase(),
						idempotency_key: newKey(),
					},
					await buyerContext( email )
				)
			);

			// The refusals created and counted nothing.
			expect( ( await counters( email ) ).email.count ).toBe(
				EMAIL_LIMIT
			);
			expect( ( await state( eventDateId ) ).signups ).toHaveLength(
				EMAIL_LIMIT
			);

			// The limit does not stop a key from reporting its purchase.
			const replay = await buy( first );
			expect( replay.status, JSON.stringify( replay.body ) ).toBe( 200 );
			expect( replay.body.status ).toBe( 'confirmed' );
		} );

		test( 'the allowance returns 15 minutes after the last checkout, whatever the IP window', async () => {
			const { eventDateId } = await createEvent();
			const email = uniqueEmail( 'expiry' );
			const purchase = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
			};

			await checkout( purchase );
			let now = await counters( email );
			expect( now.email.count ).toBe( 1 );
			expectFreshWindow( now.email.ttl, EMAIL_WINDOW );
			expect( now.ip.count ).toBe( 1 );
			expectFreshWindow( now.ip.ttl, IP_WINDOW );

			// Ten minutes on, another checkout starts the 15 minutes again.
			now = await elapse( 'email', 600, email );
			expect( now.email.ttl ).toBeLessThanOrEqual( EMAIL_WINDOW - 600 );
			expectFreshWindow( now.ip.ttl, IP_WINDOW );
			await checkout( purchase );
			now = await counters( email );
			expect( now.email.count ).toBe( 2 );
			expectFreshWindow( now.email.ttl, EMAIL_WINDOW );

			for ( let i = 2; i < EMAIL_LIMIT; i++ ) {
				await checkout( purchase );
			}

			// A refused request does not push the end of the window back.
			await elapse( 'email', EMAIL_WINDOW - 100, email );
			await expectRateLimited( await buy( purchase ) );
			now = await counters( email );
			expect( now.email.count ).toBe( EMAIL_LIMIT );
			expect( now.email.ttl ).toBeLessThanOrEqual( 100 );

			// Once the email's window is over the buyer can check out again,
			// while the IP counter is still running.
			now = await elapse( 'email', 200, email );
			expect( now.email.count ).toBe( 0 );
			expect( now.ip.count ).toBe( EMAIL_LIMIT );
			expect( now.ip.ttl ).toBeGreaterThan( EMAIL_WINDOW );

			await checkout( purchase );
			now = await counters( email );
			expect( now.email.count ).toBe( 1 );

			// And the IP window ending leaves the email counter as it is.
			now = await elapse( 'ip', IP_WINDOW + 60, email );
			expect( now.ip.count ).toBe( 0 );
			expect( now.email.count ).toBe( 1 );
			expectFreshWindow( now.email.ttl, EMAIL_WINDOW );
		} );

		test( 'a rejected request uses up none of the allowance', async () => {
			const full = await createEvent( { capacity: 1 } );
			const series = await createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{ name: 'Pick dates', scope: 'multiple_instances' },
				],
			} );
			const email = uniqueEmail( 'rejected' );

			// The only place of the first event goes to someone else.
			await checkout( {
				event_date_id: full.eventDateId,
				email: uniqueEmail( 'other' ),
				quantity: 1,
			} );
			const ipBefore = ( await counters() ).ip.count;

			// More rejections than the allowance, of four kinds.
			for ( let i = 0; i < 3; i++ ) {
				const missing = await buy( {
					event_date_id: 999999999,
					email,
					quantity: 1,
				} );
				expect( missing.status ).toBe( 404 );

				const wrongType = await buy( {
					event_date_id: full.eventDateId,
					ticket_type_id: 999999999,
					email,
					quantity: 1,
				} );
				expect( wrongType.status ).toBe( 400 );
				expect( wrongType.body.code ).toBe( 'invalid_ticket_type' );

				// Refused under the capacity lock, its save rolled back.
				const noPlace = await buy( {
					event_date_id: full.eventDateId,
					email,
					quantity: 1,
					idempotency_key: newKey(),
				} );
				expect( noPlace.status ).toBe( 409 );
				expect( noPlace.body.code ).toBe( 'event_full' );

				const noDates = await buy( {
					event_date_id: series.eventDateId,
					ticket_type_id: series.typeIds[ 0 ],
					event_date_ids: [],
					email,
					quantity: 1,
				} );
				expect( noDates.status ).toBe( 400 );
				expect( noDates.body.code ).toBe( 'no_occurrences_selected' );
			}

			const now = await counters( email );
			expect( now.email ).toEqual( { count: 0, ttl: 0 } );
			// The IP counter still takes the attempts that reached a
			// checkout: the full event and the series purchase.
			expect( now.ip.count - ipBefore ).toBe( 6 );

			// The corrected purchase goes through with the same email.
			await checkout( {
				event_date_id: series.eventDateId,
				ticket_type_id: series.typeIds[ 0 ],
				event_date_ids: series.occurrenceIds.slice( 0, 1 ),
				email,
				quantity: 1,
			} );
			expect( ( await counters( email ) ).email.count ).toBe( 1 );
		} );

		test( 'a purchase held back for a known email is not counted for it', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );

			const { eventDateId } = await createEvent();
			const email = uniqueEmail( 'deferred' );
			const purchase = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
			};
			await checkout( purchase );
			const before = await counters( email );
			expect( before.email.count ).toBe( 1 );

			// The same email typed in browsers that are not known as the
			// buyer: answered with a link by email, nothing saved.
			for ( let i = 0; i < 3; i++ ) {
				const stranger = await request.newContext( {
					baseURL: BASE_URL,
				} );
				strangers.push( stranger );
				const held = await buy(
					{ ...purchase, idempotency_key: newKey() },
					stranger
				);
				expect( held.status, JSON.stringify( held.body ) ).toBe( 200 );
				expect( held.body.status ).toBe( 'email_recognized' );
			}

			const after = await counters( email );
			expect( after.email.count ).toBe( 1 );
			expect( after.email.ttl ).toBeLessThanOrEqual( before.email.ttl );
			// Each answer is an attempt from the IP.
			expect( after.ip.count - before.ip.count ).toBe( 3 );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 1 );
		} );

		test( 'free, paid, no-ticket-type and multiple-occurrence checkouts each count once', async () => {
			const single = await createEvent( {
				ticketTypes: [ { name: 'Free' }, { name: 'Paid', price: 12 } ],
			} );
			const plain = await createEvent();
			const series = await createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{
						name: 'Pick dates',
						price: 8,
						scope: 'multiple_instances',
					},
				],
			} );
			const email = uniqueEmail( 'paths' );
			const count = async () => ( await counters( email ) ).email.count;

			const free = await checkout( {
				event_date_id: single.eventDateId,
				ticket_type_id: single.typeIds[ 0 ],
				email,
				quantity: 1,
			} );
			expect( free.status ).toBe( 'confirmed' );
			expect( await count() ).toBe( 1 );

			// Several tickets are one checkout.
			const paid = await checkout( {
				event_date_id: single.eventDateId,
				ticket_type_id: single.typeIds[ 1 ],
				email,
				quantity: 3,
			} );
			expect( paid.status ).toBe( 'payment_required' );
			expect( await count() ).toBe( 2 );

			const untyped = await checkout( {
				event_date_id: plain.eventDateId,
				email,
				quantity: 2,
			} );
			expect( untyped.status ).toBe( 'confirmed' );
			expect( await count() ).toBe( 3 );

			// So are several occurrences, each with a signup of its own.
			const dates = await checkout( {
				event_date_id: series.eventDateId,
				ticket_type_id: series.typeIds[ 0 ],
				event_date_ids: series.occurrenceIds.slice( 0, 2 ),
				email,
				quantity: 1,
			} );
			expect( dates.status ).toBe( 'payment_required' );
			expect(
				( await state( series.occurrenceIds ) ).signups
			).toHaveLength( 2 );
			expect( await count() ).toBe( 4 );
		} );

		test( 'a checkout whose payment could not be started counts once, and its replay not at all', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 15 } ],
			} );
			const email = uniqueEmail( 'outage' );
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email,
				quantity: 1,
				idempotency_key: newKey(),
			};
			const createsBefore = ( await state( eventDateId ) )
				.mollie_create_count;

			await fixture(
				'checkout-keys/faults',
				{ fail_mollie_creates: 1 },
				'put'
			);
			const failed = await buy( purchase );
			expect( failed.status ).toBeGreaterThanOrEqual( 400 );

			// The signup holds its place, so the attempt counted.
			const interrupted = await state( eventDateId );
			expect( interrupted.signups ).toHaveLength( 1 );
			expect( interrupted.signups[ 0 ].status ).toBe( 'pending_payment' );
			const counted = await counters( email );
			expect( counted.email.count ).toBe( 1 );

			// Repeating the key continues that checkout.
			for ( let i = 0; i < 3; i++ ) {
				const replay = await buy( purchase );
				expect( replay.status, JSON.stringify( replay.body ) ).toBe(
					200
				);
				expect( replay.body.status ).toBe( 'payment_required' );
				expect( replay.body.transaction_id ).toBe(
					interrupted.transactions[ 0 ].id
				);
			}

			const after = await state( eventDateId );
			expect( after.signups.map( ( signup ) => signup.id ) ).toEqual( [
				interrupted.signups[ 0 ].id,
			] );
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.keys ).toHaveLength( 1 );
			expect( after.mollie_create_count - createsBefore ).toBe( 1 );

			const now = await counters( email );
			expect( now.email.count ).toBe( 1 );
			expect( now.email.ttl ).toBeLessThanOrEqual( counted.email.ttl );
			expect( now.ip.count ).toBe( counted.ip.count );
		} );
	} );

	test.describe( 'per IP', () => {
		test( 'twenty attempts an hour are allowed, whoever they are for', async () => {
			test.setTimeout( 120_000 );
			const { eventDateId } = await createEvent();
			await fixture( 'rate-limit', { enforce_ip: true }, 'put' );

			const attempt = ( label ) =>
				buy( {
					event_date_id: eventDateId,
					email: uniqueEmail( label ),
					quantity: 1,
				} );

			expect( ( await attempt( 'ip-0' ) ).status ).toBe( 200 );
			let now = await counters();
			expect( now.ip.count ).toBe( 1 );
			expectFreshWindow( now.ip.ttl, IP_WINDOW );

			// Every counted attempt starts the hour again.
			now = await elapse( 'ip', 1800 );
			expect( now.ip.ttl ).toBeLessThanOrEqual( IP_WINDOW - 1800 );
			expect( ( await attempt( 'ip-1' ) ).status ).toBe( 200 );
			now = await counters();
			expect( now.ip.count ).toBe( 2 );
			expectFreshWindow( now.ip.ttl, IP_WINDOW );

			for ( let i = 2; i < IP_LIMIT; i++ ) {
				const res = await attempt( `ip-${ i }` );
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
			}
			expect( ( await counters() ).ip.count ).toBe( IP_LIMIT );

			// An email never seen before is refused all the same, and the
			// refusal creates and counts nothing.
			const refusedEmail = uniqueEmail( 'ip-refused' );
			await elapse( 'ip', IP_WINDOW - 100 );
			await expectRateLimited(
				await buy( {
					event_date_id: eventDateId,
					email: refusedEmail,
					quantity: 1,
				} )
			);
			now = await counters( refusedEmail );
			expect( now.ip.count ).toBe( IP_LIMIT );
			expect( now.ip.ttl ).toBeLessThanOrEqual( 100 );
			expect( now.email.count ).toBe( 0 );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength(
				IP_LIMIT
			);

			// After the hour the address can check out again.
			await elapse( 'ip', 200 );
			expect( ( await attempt( 'ip-after' ) ).status ).toBe( 200 );
			expect( ( await counters() ).ip.count ).toBe( 1 );
		} );

		test( 'an attempt that reaches a checkout counts even when it fails', async () => {
			const full = await createEvent( { capacity: 1 } );
			await checkout( {
				event_date_id: full.eventDateId,
				email: uniqueEmail( 'ip-holder' ),
				quantity: 1,
			} );
			await fixture( 'rate-limit', { enforce_ip: true }, 'put' );
			const before = ( await counters() ).ip.count;

			// Rejected before a checkout was attempted: not counted.
			const wrongType = await buy( {
				event_date_id: full.eventDateId,
				ticket_type_id: 999999999,
				email: uniqueEmail( 'ip-invalid' ),
				quantity: 1,
			} );
			expect( wrongType.status ).toBe( 400 );
			expect( ( await counters() ).ip.count ).toBe( before );

			for ( let i = before; i < IP_LIMIT; i++ ) {
				const noPlace = await buy( {
					event_date_id: full.eventDateId,
					email: uniqueEmail( `ip-full-${ i }` ),
					quantity: 1,
				} );
				expect( noPlace.status ).toBe( 409 );
				expect( noPlace.body.code ).toBe( 'event_full' );
			}
			expect( ( await counters() ).ip.count ).toBe( IP_LIMIT );

			await expectRateLimited(
				await buy( {
					event_date_id: full.eventDateId,
					email: uniqueEmail( 'ip-over' ),
					quantity: 1,
				} )
			);
		} );
	} );
} );
