/**
 * Playwright API tests for repeat purchases and idempotent checkout (#1534).
 *
 * Every purchase goes through the public fair-events/v1/get-tickets route,
 * paid ones against the Mollie double from e2e/mu-plugins. An idempotency
 * key stands for one intended purchase: repeating it returns that purchase,
 * a new one buys again — also for a participant who already holds a ticket.
 *
 * Payment callbacks, lapsed holds, an interrupted checkout and the passing
 * of time are driven through the test-only fair-e2e/v1 routes
 * (ticket-capacity, checkout-keys, mollie-status), since this environment
 * has no live payment provider.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const GET_TICKETS = '/wp-json/fair-events/v1/get-tickets';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const uniqueEmail = ( label ) =>
	`idempotency-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

const newKey = () => randomUUID();

test.describe( 'Repeat purchases with idempotent checkout', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with its capacity,
	 * ticket types and activities.
	 *
	 * @param {Object}   options
	 * @param {?number}  [options.capacity]    Event capacity (per occurrence).
	 * @param {Object[]} [options.ticketTypes] { name, capacity, price, scope }.
	 * @param {Object[]} [options.activities]  { name, price, capacity }.
	 * @param {string}   [options.rrule]       Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds, optionIds.
	 */
	async function createEvent( {
		capacity = null,
		ticketTypes = [],
		activities = [],
		rrule,
	} = {} ) {
		const title = `Idempotency ${ Date.now() } ${ Math.random() }`;
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
						capacity: type.capacity ?? null,
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
					options: activities.map( ( activity ) => ( {
						name: activity.name,
						price: activity.price || 0,
						capacity: activity.capacity ?? null,
					} ) ),
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		const optionIds = {};
		for ( const option of ticketsBody.options || [] ) {
			optionIds[ option.name ] = option.id;
		}

		return {
			eventDateId,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
			optionIds,
		};
	}

	/**
	 * Submit the purchase form's request. Without a visitor each call is a
	 * new anonymous browser; pass one to keep its cookies between calls, as
	 * a returning participant's browser does.
	 *
	 * @param {Object} data      Request payload.
	 * @param {Object} [visitor] Request context to reuse.
	 * @return {Promise<{status: number, body: Object}>} Response.
	 */
	async function buy( data, visitor ) {
		const context =
			visitor || ( await request.newContext( { baseURL: BASE_URL } ) );
		const res = await context.post( GET_TICKETS, {
			data: { name: 'Repeat Buyer', _honeypot: '', ...data },
		} );
		const text = await res.text();
		let body;
		try {
			body = JSON.parse( text );
		} catch ( error ) {
			body = { raw: text.slice( 0, 300 ) };
		}
		if ( ! visitor ) {
			await context.dispose();
		}
		return { status: res.status(), body };
	}

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

	async function taken( { eventDateId, typeId } ) {
		const params = new URLSearchParams();
		if ( eventDateId ) {
			params.append( 'event_date_ids[]', eventDateId );
		}
		if ( typeId ) {
			params.append( 'ticket_type_ids[]', typeId );
		}
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		return typeId
			? body.ticket_types[ typeId ]
			: body.event_dates[ eventDateId ];
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

	const pay = ( signupId ) =>
		fixture( 'ticket-capacity/pay', { signup_id: signupId } );
	const fail = ( signupId ) =>
		fixture( 'ticket-capacity/fail', { signup_id: signupId } );
	const lapse = ( signupId ) =>
		fixture( 'ticket-capacity/lapse', { signup_id: signupId } );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		// Leave no armed failure or provider status behind for other specs.
		await fixture(
			'checkout-keys/faults',
			{ crash_transaction_creates: 0, fail_mollie_creates: 0 },
			'put'
		);
		await fixture( 'mollie-status', { status: 'paid' }, 'put' );
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
		await api.dispose();
	} );

	test.describe( 'one key, one purchase', () => {
		test( 'repeating a key returns the first purchase without another signup, unit or place', async () => {
			const { eventDateId } = await createEvent( { capacity: 5 } );
			const purchase = {
				event_date_id: eventDateId,
				email: uniqueEmail( 'replay' ),
				quantity: 2,
				idempotency_key: newKey(),
			};

			const first = await buy( purchase );
			expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
			expect( first.body.status ).toBe( 'confirmed' );

			for ( let i = 0; i < 2; i++ ) {
				const again = await buy( purchase );
				expect( again.status, JSON.stringify( again.body ) ).toBe(
					200
				);
				expect( again.body ).toEqual( first.body );
			}

			const { signups, keys } = await state( eventDateId );
			expect( signups ).toHaveLength( 1 );
			expect( signups[ 0 ].ticket_statuses ).toEqual( [
				'confirmed',
				'confirmed',
			] );
			expect( keys ).toHaveLength( 1 );
			expect( keys[ 0 ] ).toMatchObject( {
				state: 'completed',
				signup_ids: [ signups[ 0 ].id ],
				hooks_fired: true,
			} );
			expect( await taken( { eventDateId } ) ).toBe( 2 );
		} );

		test( 'a key reused with different purchase details is refused', async () => {
			const { eventDateId } = await createEvent();
			const purchase = {
				event_date_id: eventDateId,
				email: uniqueEmail( 'conflict' ),
				quantity: 1,
				idempotency_key: newKey(),
			};

			expect( ( await buy( purchase ) ).status ).toBe( 200 );

			const changed = await buy( { ...purchase, quantity: 3 } );
			expect( changed.status ).toBe( 409 );
			expect( changed.body.code ).toBe( 'idempotency_key_reused' );

			const other = await buy( {
				...purchase,
				email: uniqueEmail( 'someone-else' ),
			} );
			expect( other.status ).toBe( 409 );
			expect( other.body.code ).toBe( 'idempotency_key_reused' );

			const { signups } = await state( eventDateId );
			expect( signups ).toHaveLength( 1 );
			expect( signups[ 0 ].quantity ).toBe( 1 );
		} );

		test( 'a malformed key is rejected before anything is saved', async () => {
			const { eventDateId } = await createEvent();

			for ( const key of [
				'short',
				'has spaces in the key 123',
				'x'.repeat( 129 ),
			] ) {
				const res = await buy( {
					event_date_id: eventDateId,
					email: uniqueEmail( 'malformed' ),
					idempotency_key: key,
				} );
				expect( res.status ).toBe( 400 );
				expect( res.body.code ).toBe( 'rest_invalid_param' );
			}

			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 0 );
		} );

		test( 'concurrent submissions of one key converge on one free purchase', async () => {
			// One place: a second purchase could not fit, so every answer
			// must be the same one.
			const { eventDateId } = await createEvent( { capacity: 1 } );
			const purchase = {
				event_date_id: eventDateId,
				email: uniqueEmail( 'concurrent-free' ),
				quantity: 1,
				idempotency_key: newKey(),
			};

			const results = await Promise.all(
				Array.from( { length: 4 }, () => buy( purchase ) )
			);

			for ( const result of results ) {
				expect( result.status, JSON.stringify( result.body ) ).toBe(
					200
				);
				expect( result.body.status ).toBe( 'confirmed' );
			}
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 1 );
			expect( await taken( { eventDateId } ) ).toBe( 1 );
		} );

		test( 'concurrent submissions of one key start one payment', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 12 } ],
			} );
			const before = ( await state( eventDateId ) ).mollie_create_count;
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'concurrent-paid' ),
				quantity: 2,
				idempotency_key: newKey(),
			};

			const results = await Promise.all(
				Array.from( { length: 4 }, () => buy( purchase ) )
			);

			for ( const result of results ) {
				expect( result.status, JSON.stringify( result.body ) ).toBe(
					200
				);
				expect( result.body ).toEqual( results[ 0 ].body );
			}
			expect( results[ 0 ].body.status ).toBe( 'payment_required' );
			expect( results[ 0 ].body.amount ).toBe( 24 );

			const after = await state( eventDateId );
			expect( after.signups ).toHaveLength( 1 );
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.transactions[ 0 ].id ).toBe(
				results[ 0 ].body.transaction_id
			);
			expect( after.mollie_create_count - before ).toBe( 1 );
			expect( await taken( { typeId } ) ).toBe( 2 );
		} );

		test( 'repeating a paid checkout returns its open payment and never a second one', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 10 } ],
			} );
			const before = ( await state( eventDateId ) ).mollie_create_count;
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'paid-replay' ),
				quantity: 1,
				idempotency_key: newKey(),
			};

			const first = await buy( purchase );
			expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
			expect( first.body.status ).toBe( 'payment_required' );

			const again = await buy( purchase );
			expect( again.status ).toBe( 200 );
			expect( again.body ).toEqual( first.body );

			let after = await state( eventDateId );
			expect( after.signups ).toHaveLength( 1 );
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.mollie_create_count - before ).toBe( 1 );

			// Once paid, the key reports the confirmed purchase.
			await pay( after.signups[ 0 ].id );
			const paid = await buy( purchase );
			expect( paid.status ).toBe( 200 );
			expect( paid.body.status ).toBe( 'confirmed' );

			after = await state( eventDateId );
			expect( after.signups ).toHaveLength( 1 );
			expect( after.mollie_create_count - before ).toBe( 1 );
		} );

		test( 'a multiple-occurrence checkout has one key for all its signups', async () => {
			const {
				eventDateId,
				occurrenceIds,
				typeIds: [ typeId ],
			} = await createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{
						name: 'Pick dates',
						price: 8,
						scope: 'multiple_instances',
					},
				],
			} );
			const before = ( await state( occurrenceIds ) ).mollie_create_count;
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				event_date_ids: occurrenceIds.slice( 0, 2 ),
				email: uniqueEmail( 'multi' ),
				quantity: 1,
				idempotency_key: newKey(),
			};

			const first = await buy( purchase );
			expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
			expect( first.body.status ).toBe( 'payment_required' );
			expect( first.body.amount ).toBe( 16 );

			// The same occurrences in another order are the same purchase.
			const again = await buy( {
				...purchase,
				event_date_ids: [ ...purchase.event_date_ids ].reverse(),
			} );
			expect( again.status ).toBe( 200 );
			expect( again.body ).toEqual( first.body );

			const after = await state( occurrenceIds );
			expect( after.signups ).toHaveLength( 2 );
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.keys ).toHaveLength( 1 );
			expect( after.keys[ 0 ].signup_ids ).toEqual(
				after.signups.map( ( signup ) => signup.id )
			);
			expect( after.mollie_create_count - before ).toBe( 1 );

			// Another set of occurrences under that key is another purchase.
			const changed = await buy( {
				...purchase,
				event_date_ids: occurrenceIds.slice( 1, 3 ),
			} );
			expect( changed.status ).toBe( 409 );
			expect( changed.body.code ).toBe( 'idempotency_key_reused' );
		} );
	} );

	test.describe( 'a new key, another purchase', () => {
		test( 'the same buyer buys the same and another ticket type again', async () => {
			const {
				eventDateId,
				typeIds: [ standardId, supporterId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Standard' }, { name: 'Supporter' } ],
			} );
			const email = uniqueEmail( 'again' );
			// One browser throughout: the buyer is recognised from the
			// second purchase on and already holds a ticket for the date.
			const visitor = await request.newContext( { baseURL: BASE_URL } );

			const purchases = [
				{ ticket_type_id: standardId, quantity: 1 },
				{ ticket_type_id: standardId, quantity: 2 },
				{ ticket_type_id: supporterId, quantity: 1 },
			];
			for ( const purchase of purchases ) {
				const res = await buy(
					{
						event_date_id: eventDateId,
						email,
						idempotency_key: newKey(),
						...purchase,
					},
					visitor
				);
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
				expect( res.body.status ).toBe( 'confirmed' );
			}
			await visitor.dispose();

			const { signups, keys } = await state( eventDateId );
			expect(
				signups.map( ( signup ) => [
					signup.ticket_type_id,
					signup.ticket_statuses.length,
				] )
			).toEqual( [
				[ standardId, 1 ],
				[ standardId, 2 ],
				[ supporterId, 1 ],
			] );
			expect( new Set( signups.map( ( s ) => s.email ) ) ).toEqual(
				new Set( [ email ] )
			);
			expect( keys ).toHaveLength( 3 );
			expect( await taken( { typeId: standardId } ) ).toBe( 3 );
			expect( await taken( { typeId: supporterId } ) ).toBe( 1 );
			expect( await taken( { eventDateId } ) ).toBe( 4 );
		} );

		test( 'a whole-series ticket can be bought again', async () => {
			const {
				eventDateId,
				occurrenceIds,
				typeIds: [ passId ],
			} = await createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [ { name: 'Pass', scope: 'whole_series' } ],
			} );
			const email = uniqueEmail( 'pass' );
			const visitor = await request.newContext( { baseURL: BASE_URL } );

			for ( let i = 0; i < 2; i++ ) {
				const res = await buy(
					{
						event_date_id: eventDateId,
						ticket_type_id: passId,
						email,
						quantity: 1,
						idempotency_key: newKey(),
					},
					visitor
				);
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
			}
			await visitor.dispose();

			expect( ( await state( occurrenceIds ) ).signups ).toHaveLength(
				2
			);
			expect( await taken( { typeId: passId } ) ).toBe( 2 );
		} );

		test( 'each purchase takes its places and a repeated key takes none', async () => {
			const { eventDateId } = await createEvent( { capacity: 2 } );
			const email = uniqueEmail( 'capacity' );
			const first = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
				idempotency_key: newKey(),
			};

			expect( ( await buy( first ) ).status ).toBe( 200 );
			expect( ( await buy( first ) ).status ).toBe( 200 );
			expect( await taken( { eventDateId } ) ).toBe( 1 );

			const second = await buy( { ...first, idempotency_key: newKey() } );
			expect( second.status, JSON.stringify( second.body ) ).toBe( 200 );
			expect( await taken( { eventDateId } ) ).toBe( 2 );

			const third = await buy( { ...first, idempotency_key: newKey() } );
			expect( third.status ).toBe( 409 );
			expect( third.body.code ).toBe( 'event_full' );

			// A full event does not stop a key from reporting its purchase.
			const replay = await buy( first );
			expect( replay.status ).toBe( 200 );
			expect( replay.body.status ).toBe( 'confirmed' );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 2 );
			expect( await taken( { eventDateId } ) ).toBe( 2 );
		} );

		test( 'a repeated key is not counted by the rate limit, a new purchase is', async () => {
			const { eventDateId } = await createEvent();
			const email = uniqueEmail( 'rate-limit' );
			const first = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
				idempotency_key: newKey(),
			};

			// One purchase and four repeats: more requests than the limit of
			// three an hour for one email.
			for ( let i = 0; i < 5; i++ ) {
				const res = await buy( first );
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
			}

			// Only the purchase counted, so two more fit and a fourth does not.
			for ( let i = 0; i < 2; i++ ) {
				const res = await buy( {
					...first,
					idempotency_key: newKey(),
				} );
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
			}
			const limited = await buy( {
				...first,
				idempotency_key: newKey(),
			} );
			expect( limited.status ).toBe( 429 );
			expect( limited.body.code ).toBe( 'rate_limited' );

			// The limit does not stop a key from reporting its purchase.
			expect( ( await buy( first ) ).status ).toBe( 200 );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 3 );
		} );

		test( 'failed attempts do not block another ticket for the same email', async () => {
			const { eventDateId } = await createEvent( { capacity: 2 } );
			const email = uniqueEmail( 'retry-after-full' );
			const purchase = {
				event_date_id: eventDateId,
				email,
				quantity: 1,
			};

			expect(
				( await buy( { ...purchase, idempotency_key: newKey() } ) )
					.status
			).toBe( 200 );

			for ( let i = 0; i < 3; i++ ) {
				const failed = await buy( {
					...purchase,
					quantity: 2,
					idempotency_key: newKey(),
				} );
				expect( failed.status, JSON.stringify( failed.body ) ).toBe(
					409
				);
				expect( failed.body.code ).toBe( 'event_full' );
			}

			const second = await buy( {
				...purchase,
				idempotency_key: newKey(),
			} );
			expect( second.status, JSON.stringify( second.body ) ).toBe( 200 );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 2 );
		} );
	} );

	test.describe( 'an interrupted checkout is continued, not repeated', () => {
		test( 'a payment the provider could not start is started by repeating the key', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 15 } ],
			} );
			const before = ( await state( eventDateId ) ).mollie_create_count;
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'outage' ),
				quantity: 1,
				idempotency_key: newKey(),
			};

			await fixture(
				'checkout-keys/faults',
				{ fail_mollie_creates: 1 },
				'put'
			);
			const failed = await buy( purchase );
			expect( failed.status ).toBeGreaterThanOrEqual( 400 );

			const interrupted = await state( eventDateId );
			expect( interrupted.signups ).toHaveLength( 1 );
			expect( interrupted.signups[ 0 ].status ).toBe( 'pending_payment' );
			expect( interrupted.transactions ).toHaveLength( 1 );
			expect( interrupted.transactions[ 0 ] ).toMatchObject( {
				status: 'draft',
				mollie_payment_id: '',
			} );
			expect( interrupted.keys[ 0 ] ).toMatchObject( {
				state: 'open',
				claimed: false,
				hooks_fired: true,
			} );

			const resumed = await buy( purchase );
			expect( resumed.status, JSON.stringify( resumed.body ) ).toBe(
				200
			);
			expect( resumed.body.status ).toBe( 'payment_required' );
			expect( resumed.body.transaction_id ).toBe(
				interrupted.transactions[ 0 ].id
			);

			const after = await state( eventDateId );
			expect( after.signups.map( ( s ) => s.id ) ).toEqual( [
				interrupted.signups[ 0 ].id,
			] );
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.transactions[ 0 ].mollie_payment_id ).not.toBe( '' );
			expect( after.keys[ 0 ].state ).toBe( 'completed' );
			expect( after.mollie_create_count - before ).toBe( 1 );
			expect( await taken( { typeId } ) ).toBe( 1 );

			// And the finished checkout keeps answering with that payment.
			const again = await buy( purchase );
			expect( again.body ).toEqual( resumed.body );
			expect(
				( await state( eventDateId ) ).mollie_create_count - before
			).toBe( 1 );
		} );

		test( 'a checkout cut off before its transaction existed is finished by the next request', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 9 } ],
			} );
			const before = ( await state( eventDateId ) ).mollie_create_count;
			const purchase = {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'crash' ),
				quantity: 2,
				idempotency_key: newKey(),
			};

			await fixture(
				'checkout-keys/faults',
				{ crash_transaction_creates: 1 },
				'put'
			);
			const crashed = await buy( purchase );
			expect( crashed.status ).toBe( 500 );

			const interrupted = await state( eventDateId );
			expect( interrupted.signups ).toHaveLength( 1 );
			expect( interrupted.signups[ 0 ].transaction_id ).toBeNull();
			expect( interrupted.transactions ).toHaveLength( 0 );
			expect( interrupted.keys[ 0 ] ).toMatchObject( {
				state: 'open',
				claimed: true,
				hooks_fired: false,
			} );

			// While the dead request's claim runs, a repeat waits and is then
			// told to come back — it never starts over.
			const waiting = await buy( purchase );
			expect( waiting.status ).toBe( 409 );
			expect( waiting.body.code ).toBe( 'checkout_in_progress' );
			expect( ( await state( eventDateId ) ).signups ).toHaveLength( 1 );

			await fixture( 'checkout-keys/expire-claims', {
				event_date_ids: [ eventDateId ],
			} );

			const finished = await buy( purchase );
			expect( finished.status, JSON.stringify( finished.body ) ).toBe(
				200
			);
			expect( finished.body.status ).toBe( 'payment_required' );
			expect( finished.body.amount ).toBe( 18 );

			const after = await state( eventDateId );
			expect( after.signups.map( ( s ) => s.id ) ).toEqual( [
				interrupted.signups[ 0 ].id,
			] );
			expect( after.signups[ 0 ].transaction_id ).toBe(
				finished.body.transaction_id
			);
			expect( after.transactions ).toHaveLength( 1 );
			expect( after.keys[ 0 ] ).toMatchObject( {
				state: 'completed',
				hooks_fired: true,
			} );
			expect( after.mollie_create_count - before ).toBe( 1 );
			expect( await taken( { typeId } ) ).toBe( 2 );
		} );
	} );

	test.describe( 'after a checkout ended', () => {
		/**
		 * Start a paid purchase and return it with its signup.
		 *
		 * @param {string} label Email label.
		 * @return {Promise<Object>} event, purchase payload, response body, signup.
		 */
		async function startPaidPurchase( label ) {
			const event = await createEvent( {
				capacity: 3,
				ticketTypes: [ { name: 'Paid', price: 10 } ],
			} );
			const purchase = {
				event_date_id: event.eventDateId,
				ticket_type_id: event.typeIds[ 0 ],
				email: uniqueEmail( label ),
				quantity: 1,
				idempotency_key: newKey(),
			};
			const res = await buy( purchase );
			expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
			const [ signup ] = ( await state( event.eventDateId ) ).signups;
			return { event, purchase, body: res.body, signup };
		}

		/**
		 * The ended checkout's key starts nothing; a new key buys again.
		 *
		 * @param {Object} started      Result of startPaidPurchase().
		 * @param {string} endedStatus  Status the first signup must keep.
		 * @param {number} placesBefore Places the ended purchase still takes.
		 */
		async function expectClosedThenBuyAgain(
			started,
			endedStatus,
			placesBefore
		) {
			const { event, purchase, signup } = started;

			const replay = await buy( purchase );
			expect( replay.status, JSON.stringify( replay.body ) ).toBe( 409 );
			expect( replay.body.code ).toBe( 'checkout_closed' );
			expect( await taken( { eventDateId: event.eventDateId } ) ).toBe(
				placesBefore
			);

			const later = await buy( {
				...purchase,
				idempotency_key: newKey(),
			} );
			expect( later.status, JSON.stringify( later.body ) ).toBe( 200 );
			expect( later.body.status ).toBe( 'payment_required' );
			expect( later.body.transaction_id ).not.toBe(
				started.body.transaction_id
			);

			const after = await state( event.eventDateId );
			expect( after.signups ).toHaveLength( 2 );
			expect( after.signups[ 0 ] ).toMatchObject( {
				id: signup.id,
				status: endedStatus,
			} );
			expect( after.signups[ 1 ].status ).toBe( 'pending_payment' );
			expect( await taken( { eventDateId: event.eventDateId } ) ).toBe(
				placesBefore + 1
			);
		}

		test( 'a failed payment closes its key; a new key buys again', async () => {
			const started = await startPaidPurchase( 'failed' );
			await fail( started.signup.id );

			await expectClosedThenBuyAgain( started, 'failed', 0 );
		} );

		test( 'a cancelled checkout closes its key; a new key buys again', async () => {
			const started = await startPaidPurchase( 'cancelled' );
			await fixture( 'mollie-status', { status: 'canceled' }, 'put' );

			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const cancel = await visitor.post(
				`${ GET_TICKETS }/cancel-payment`,
				{
					data: {
						transaction_id: started.body.transaction_id,
						token: new URL(
							started.body.checkout_url
						).searchParams.get( 'token' ),
					},
				}
			);
			expect( cancel.ok(), await cancel.text() ).toBeTruthy();
			await visitor.dispose();

			await expectClosedThenBuyAgain( started, 'failed', 0 );
		} );

		test( 'an expired hold closes its key; a new key buys again', async () => {
			const started = await startPaidPurchase( 'expired' );
			await lapse( started.signup.id );

			await expectClosedThenBuyAgain( started, 'pending_payment', 0 );
		} );

		test( 'a completed purchase keeps its key; a new key buys again', async () => {
			const started = await startPaidPurchase( 'completed' );
			const { event, purchase, signup } = started;
			await pay( signup.id );

			const replay = await buy( purchase );
			expect( replay.status ).toBe( 200 );
			expect( replay.body.status ).toBe( 'confirmed' );

			const later = await buy( {
				...purchase,
				idempotency_key: newKey(),
			} );
			expect( later.status, JSON.stringify( later.body ) ).toBe( 200 );
			expect( later.body.status ).toBe( 'payment_required' );

			const after = await state( event.eventDateId );
			expect( after.signups.map( ( s ) => s.status ) ).toEqual( [
				'confirmed',
				'pending_payment',
			] );
			expect( after.transactions ).toHaveLength( 2 );
			expect( await taken( { eventDateId: event.eventDateId } ) ).toBe(
				2
			);
		} );

		test( 'a failed payment is retried on its own signup, not another purchase', async () => {
			const started = await startPaidPurchase( 'retry' );
			const { event, purchase, signup } = started;
			const other = await buy( {
				...purchase,
				idempotency_key: newKey(),
			} );
			expect( other.status, JSON.stringify( other.body ) ).toBe( 200 );
			await fail( signup.id );

			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const retry = await visitor.post(
				`${ GET_TICKETS }/retry-payment`,
				{
					data: {
						transaction_id: started.body.transaction_id,
						token: new URL(
							started.body.checkout_url
						).searchParams.get( 'token' ),
					},
				}
			);
			const retryBody = await retry.json();
			await visitor.dispose();
			expect( retry.ok(), JSON.stringify( retryBody ) ).toBeTruthy();

			const after = await state( event.eventDateId );
			expect( after.signups ).toHaveLength( 2 );
			// The retried signup moved to the retry's transaction and holds
			// its place again; the other purchase is untouched.
			expect( after.signups[ 0 ] ).toMatchObject( {
				id: signup.id,
				status: 'pending_payment',
				transaction_id: retryBody.transaction_id,
			} );
			expect( after.signups[ 1 ] ).toMatchObject( {
				status: 'pending_payment',
				transaction_id: other.body.transaction_id,
			} );

			// The key follows its signup to the retried payment.
			const replay = await buy( purchase );
			expect( replay.status, JSON.stringify( replay.body ) ).toBe( 200 );
			expect( replay.body.transaction_id ).toBe(
				retryBody.transaction_id
			);
			expect( ( await state( event.eventDateId ) ).signups ).toHaveLength(
				2
			);
		} );

		test( 'the cleanup keeps the key of a confirmed purchase and drops an unconfirmed one', async () => {
			const confirmed = await startPaidPurchase( 'kept' );
			await pay( confirmed.signup.id );
			const ended = await startPaidPurchase( 'dropped' );
			await fail( ended.signup.id );

			expect(
				(
					await fixture( 'checkout-keys/cleanup', {
						event_date_ids: [ confirmed.event.eventDateId ],
					} )
				).remaining
			).toBe( 1 );
			expect(
				(
					await fixture( 'checkout-keys/cleanup', {
						event_date_ids: [ ended.event.eventDateId ],
					} )
				).remaining
			).toBe( 0 );

			// The kept key still answers for its purchase.
			const replay = await buy( confirmed.purchase );
			expect( replay.status ).toBe( 200 );
			expect( replay.body.status ).toBe( 'confirmed' );
		} );
	} );

	test.describe( 'payment callbacks stay with their own purchase', () => {
		/**
		 * Two paid purchases by one buyer for the same date.
		 *
		 * @param {Object} event  Result of createEvent().
		 * @param {Object} [data] Per-purchase payload overrides, first and second.
		 * @return {Promise<Object[]>} The two signups, in purchase order.
		 */
		async function buyTwice( event, data = [ {}, {} ] ) {
			const email = uniqueEmail( 'callbacks' );
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			for ( const overrides of data ) {
				const res = await buy(
					{
						event_date_id: event.eventDateId,
						ticket_type_id: event.typeIds[ 0 ],
						email,
						quantity: 1,
						idempotency_key: newKey(),
						...overrides,
					},
					visitor
				);
				expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );
				expect( res.body.status ).toBe( 'payment_required' );
			}
			await visitor.dispose();
			return ( await state( event.eventDateId ) ).signups;
		}

		const statuses = async ( event ) =>
			( await state( event.eventDateId ) ).signups.map( ( signup ) => [
				signup.status,
				signup.ticket_statuses,
			] );

		test( 'repeated and out-of-order callbacks change only their own signup and tickets', async () => {
			const event = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 10 } ],
			} );
			const [ first, second ] = await buyTwice( event, [
				{ quantity: 2 },
				{ quantity: 1 },
			] );
			expect( first.transaction_id ).not.toBe( second.transaction_id );
			const pending = [ 'pending_payment', [ 'pending_payment' ] ];
			const confirmed = [ 'confirmed', [ 'confirmed', 'confirmed' ] ];

			// Paid, and the same notification again.
			await pay( first.id );
			await pay( first.id );
			expect( await statuses( event ) ).toEqual( [ confirmed, pending ] );

			// The other payment fails, twice.
			await fail( second.id );
			await fail( second.id );
			expect( await statuses( event ) ).toEqual( [
				confirmed,
				[ 'failed', [ 'failed' ] ],
			] );

			// A failure arriving after the paid one changes nothing.
			await fail( first.id );
			expect( await statuses( event ) ).toEqual( [
				confirmed,
				[ 'failed', [ 'failed' ] ],
			] );

			// A paid notification arriving after the failed one is honoured.
			await pay( second.id );
			expect( await statuses( event ) ).toEqual( [
				confirmed,
				[ 'confirmed', [ 'confirmed' ] ],
			] );
			expect( await taken( { eventDateId: event.eventDateId } ) ).toBe(
				3
			);
		} );

		test( 'a payment arriving after its hold ran out is honoured without touching the other purchase', async () => {
			const event = await createEvent( {
				capacity: 1,
				ticketTypes: [ { name: 'Paid', price: 10 } ],
			} );
			const lateEmail = uniqueEmail( 'late' );
			const late = await buy( {
				event_date_id: event.eventDateId,
				ticket_type_id: event.typeIds[ 0 ],
				email: lateEmail,
				quantity: 1,
				idempotency_key: newKey(),
			} );
			expect( late.status, JSON.stringify( late.body ) ).toBe( 200 );
			const [ lateSignup ] = ( await state( event.eventDateId ) ).signups;

			// The hold runs out and someone else takes the place.
			await lapse( lateSignup.id );
			const onTime = await buy( {
				event_date_id: event.eventDateId,
				ticket_type_id: event.typeIds[ 0 ],
				email: uniqueEmail( 'on-time' ),
				quantity: 1,
				idempotency_key: newKey(),
			} );
			expect( onTime.status, JSON.stringify( onTime.body ) ).toBe( 200 );
			const onTimeSignup = ( await state( event.eventDateId ) )
				.signups[ 1 ];
			await pay( onTimeSignup.id );

			await pay( lateSignup.id );

			const { signups } = await state( event.eventDateId );
			expect( signups[ 0 ] ).toMatchObject( {
				id: lateSignup.id,
				status: 'confirmed',
				over_capacity: true,
			} );
			expect( signups[ 1 ] ).toMatchObject( {
				id: onTimeSignup.id,
				status: 'confirmed',
				over_capacity: false,
			} );
		} );

		test( 'a failed purchase releases its own activities and leaves the other purchase its own', async () => {
			const event = await createEvent( {
				ticketTypes: [ { name: 'Paid', price: 10 } ],
				activities: [
					{ name: 'Dinner', price: 5, capacity: 5 },
					{ name: 'Tour', price: 5, capacity: 5 },
				],
			} );
			const { Dinner: dinnerId, Tour: tourId } = event.optionIds;
			const [ first, second ] = await buyTwice( event, [
				{ ticket_option_ids: [ dinnerId ] },
				{ ticket_option_ids: [ tourId ] },
			] );

			const places = async () => {
				const params = new URLSearchParams();
				for ( const optionId of [ dinnerId, tourId ] ) {
					params.append(
						'options[]',
						`${ optionId }:${ event.eventDateId }`
					);
				}
				const res = await api.get(
					`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
					{ headers: adminHeaders }
				);
				const body = await res.json();
				return [ dinnerId, tourId ].map(
					( optionId ) =>
						body.ticket_options[
							`${ optionId }:${ event.eventDateId }`
						]
				);
			};
			expect( await places() ).toEqual( [ 1, 1 ] );

			await fail( first.id );
			await pay( second.id );

			expect( await places() ).toEqual( [ 0, 1 ] );
			const res = await api.get(
				`/wp-json/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ first.id }&signup_ids[]=${ second.id }`,
				{ headers: adminHeaders }
			);
			const { tickets } = await res.json();
			expect(
				tickets.map( ( ticket ) => [
					Number( ticket.signup_id ),
					ticket.status,
					ticket.activities.map( ( activity ) =>
						Number( activity.ticket_option_id )
					),
				] )
			).toEqual( [
				[ first.id, 'failed', [ dinnerId ] ],
				[ second.id, 'confirmed', [ tourId ] ],
			] );
		} );
	} );
} );
