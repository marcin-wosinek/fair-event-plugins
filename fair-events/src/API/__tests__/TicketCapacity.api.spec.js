/**
 * Playwright API tests for capacity counted from ticket units (#1532).
 *
 * Purchases go through the public get-tickets route (paid ones against the
 * Mollie double from e2e/mu-plugins). Payment webhooks, lapsed holds,
 * per-unit status changes, and admissions from before ticket units use the
 * test-only fair-e2e/v1/ticket-capacity routes, since this environment has
 * no live payment provider and no pre-unit data.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const uniqueEmail = ( label ) =>
	`capacity-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Ticket capacity', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) and configure its
	 * capacity and ticket types in one call.
	 *
	 * @param {Object}   options
	 * @param {?number}  options.capacity    Event capacity (per occurrence).
	 * @param {Object[]} options.ticketTypes { name, capacity, price, scope }.
	 * @param {string}   [options.rrule]     Recurrence rule for a series.
	 * @return {Promise<{eventDateId: number, occurrenceIds: number[], typeIds: number[]}>} Created IDs.
	 */
	async function createEvent( { capacity, ticketTypes, rrule } ) {
		const title = `Capacity ${ Date.now() } ${ Math.random() }`;
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
				start_datetime: '2035-10-01 10:00:00',
				end_datetime: '2035-10-01 12:00:00',
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

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Capacity Buyer', _honeypot: '', ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		return { status: res.status(), body };
	}

	async function signupOf( eventDateId, email ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find( ( row ) => row.email === email );
	}

	async function counts( { eventDateIds = [], ticketTypeIds = [] } ) {
		const params = new URLSearchParams();
		eventDateIds.forEach( ( id ) =>
			params.append( 'event_date_ids[]', id )
		);
		ticketTypeIds.forEach( ( id ) =>
			params.append( 'ticket_type_ids[]', id )
		);
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		return {
			event: ( id ) => body.event_dates[ id ],
			type: ( id ) => body.ticket_types[ id ],
		};
	}

	async function fixture( path, data ) {
		const res = await api.post(
			`/wp-json/fair-e2e/v1/ticket-capacity/${ path }`,
			{ headers: adminHeaders, data }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
				headers: adminHeaders,
				params: { event_date: dateId },
			} );
			for ( const signup of res.ok() ? await res.json() : [] ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
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

	test( 'a quantity-4 signup takes four event places and the rest is enforced', async () => {
		const { eventDateId } = await createEvent( {
			capacity: 5,
			ticketTypes: [],
		} );

		const first = await buy( {
			event_date_id: eventDateId,
			email: uniqueEmail( 'four' ),
			quantity: 4,
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		expect(
			( await counts( { eventDateIds: [ eventDateId ] } ) ).event(
				eventDateId
			)
		).toBe( 4 );

		const tooMany = await buy( {
			event_date_id: eventDateId,
			email: uniqueEmail( 'two' ),
			quantity: 2,
		} );
		expect( tooMany.status ).toBe( 409 );
		expect( tooMany.body.code ).toBe( 'event_full' );
		expect( tooMany.body.message ).toBe( 'Only 1 place is left.' );
		expect( tooMany.body.data.remaining ).toBe( 1 );

		const last = await buy( {
			event_date_id: eventDateId,
			email: uniqueEmail( 'last' ),
			quantity: 1,
		} );
		expect( last.status ).toBe( 200 );

		const full = await buy( {
			event_date_id: eventDateId,
			email: uniqueEmail( 'full' ),
			quantity: 1,
		} );
		expect( full.status ).toBe( 409 );
		expect( full.body.message ).toBe( 'This event is fully booked.' );
	} );

	test( 'ticket-type capacity counts units of that type only', async () => {
		const {
			eventDateId,
			typeIds: [ limitedId, openId ],
		} = await createEvent( {
			capacity: null,
			ticketTypes: [
				{ name: 'Limited', capacity: 3 },
				{ name: 'Open', capacity: null },
			],
		} );

		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: limitedId,
					email: uniqueEmail( 'limited' ),
					quantity: 2,
				} )
			).status
		).toBe( 200 );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: openId,
					email: uniqueEmail( 'open' ),
					quantity: 5,
				} )
			).status
		).toBe( 200 );

		const c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ limitedId, openId ],
		} );
		expect( c.type( limitedId ) ).toBe( 2 );
		expect( c.type( openId ) ).toBe( 5 );
		expect( c.event( eventDateId ) ).toBe( 7 );

		const over = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: limitedId,
			email: uniqueEmail( 'limited-over' ),
			quantity: 2,
		} );
		expect( over.status ).toBe( 409 );
		expect( over.body.code ).toBe( 'ticket_type_sold_out' );
		expect( over.body.message ).toBe(
			'Only 1 ticket of this type is left.'
		);

		// The has_sales edit guard reads the same unit count.
		const configRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{ headers: adminHeaders }
		);
		const config = await configRes.json();
		expect( config.ticket_types.map( ( type ) => type.has_sales ) ).toEqual(
			[ true, true ]
		);
	} );

	test( 'a pending payment holds its places until its hold lapses', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 2,
			ticketTypes: [ { name: 'Paid', capacity: 2, price: 10 } ],
		} );

		const email = uniqueEmail( 'pending' );
		const pending = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email,
			quantity: 2,
		} );
		expect( pending.status, JSON.stringify( pending.body ) ).toBe( 200 );
		expect( pending.body.status ).toBe( 'payment_required' );

		const signup = await signupOf( eventDateId, email );
		expect( signup.status ).toBe( 'pending_payment' );

		let c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ paidId ],
		} );
		expect( c.event( eventDateId ) ).toBe( 2 );
		expect( c.type( paidId ) ).toBe( 2 );

		const blocked = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: uniqueEmail( 'blocked' ),
			quantity: 1,
		} );
		expect( blocked.status ).toBe( 409 );

		// Once the hold lapses the places are free again, even before the
		// expiry cron has marked the signup expired.
		await fixture( 'lapse', { signup_id: signup.id } );
		c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ paidId ],
		} );
		expect( c.event( eventDateId ) ).toBe( 0 );
		expect( c.type( paidId ) ).toBe( 0 );
	} );

	test( 'failed and cancelled payments release their places; confirmed ones keep them', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 3,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
		} );

		const emails = [ 'fail', 'cancel', 'confirm' ].map( uniqueEmail );
		for ( const email of emails ) {
			const { status, body } = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: paidId,
				email,
				quantity: 1,
			} );
			expect( status, JSON.stringify( body ) ).toBe( 200 );
		}
		const [ failed, cancelled, confirmed ] = await Promise.all(
			emails.map( ( email ) => signupOf( eventDateId, email ) )
		);
		expect(
			( await counts( { eventDateIds: [ eventDateId ] } ) ).event(
				eventDateId
			)
		).toBe( 3 );

		await fixture( 'fail', { signup_id: failed.id } );
		const cancelRes = await api.post(
			'/wp-json/fair-e2e/v1/ticket-units/transition',
			{
				headers: adminHeaders,
				data: { signup_id: cancelled.id, action: 'cancel_pending' },
			}
		);
		expect( cancelRes.ok() ).toBeTruthy();
		const paid = await fixture( 'pay', { signup_id: confirmed.id } );
		expect( paid.signup.status ).toBe( 'confirmed' );
		expect( Number( paid.signup.over_capacity ) ).toBe( 0 );

		expect(
			( await counts( { eventDateIds: [ eventDateId ] } ) ).event(
				eventDateId
			)
		).toBe( 1 );
	} );

	test( 'a cancelled unit releases only its own place and stays cancelled', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 3,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
		} );

		const email = uniqueEmail( 'partial' );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: paidId,
					email,
					quantity: 3,
				} )
			).status
		).toBe( 200 );
		const signup = await signupOf( eventDateId, email );

		await fixture( 'unit-status', {
			signup_id: signup.id,
			position: 2,
			status: 'cancelled',
		} );
		let c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ paidId ],
		} );
		expect( c.event( eventDateId ) ).toBe( 2 );
		expect( c.type( paidId ) ).toBe( 2 );

		// Confirming the payment confirms the other units but never
		// resurrects the cancelled one.
		const paid = await fixture( 'pay', { signup_id: signup.id } );
		expect( paid.tickets.map( ( unit ) => unit.status ) ).toEqual( [
			'confirmed',
			'cancelled',
			'confirmed',
		] );
		c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ paidId ],
		} );
		expect( c.event( eventDateId ) ).toBe( 2 );

		const refill = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: uniqueEmail( 'refill' ),
			quantity: 1,
		} );
		expect( refill.status ).toBe( 200 );
	} );

	test( 'a late payment is honored and flagged when its places were taken', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 1,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
		} );

		const lateEmail = uniqueEmail( 'late' );
		await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: lateEmail,
			quantity: 1,
		} );
		const late = await signupOf( eventDateId, lateEmail );
		await fixture( 'lapse', { signup_id: late.id } );

		// Someone else takes the released place and pays in time.
		const onTimeEmail = uniqueEmail( 'on-time' );
		const onTimeBuy = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: onTimeEmail,
			quantity: 1,
		} );
		expect( onTimeBuy.status ).toBe( 200 );
		const onTime = await signupOf( eventDateId, onTimeEmail );
		const onTimePaid = await fixture( 'pay', { signup_id: onTime.id } );
		expect( Number( onTimePaid.signup.over_capacity ) ).toBe( 0 );

		const latePaid = await fixture( 'pay', { signup_id: late.id } );
		expect( latePaid.signup.status ).toBe( 'confirmed' );
		expect( Number( latePaid.signup.over_capacity ) ).toBe( 1 );
		expect( latePaid.tickets[ 0 ].status ).toBe( 'confirmed' );

		const listed = await signupOf( eventDateId, lateEmail );
		expect( listed.over_capacity ).toBe( true );
		expect(
			( await counts( { eventDateIds: [ eventDateId ] } ) ).event(
				eventDateId
			)
		).toBe( 2 );
	} );

	test( 'a late payment with room left is confirmed without a flag', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 2,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
		} );

		const email = uniqueEmail( 'late-room' );
		await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email,
			quantity: 1,
		} );
		const signup = await signupOf( eventDateId, email );
		await fixture( 'lapse', { signup_id: signup.id } );

		const paid = await fixture( 'pay', { signup_id: signup.id } );
		expect( paid.signup.status ).toBe( 'confirmed' );
		expect( Number( paid.signup.over_capacity ) ).toBe( 0 );
	} );

	test( 'retrying a failed payment rechecks capacity', async () => {
		const {
			eventDateId,
			typeIds: [ paidId ],
		} = await createEvent( {
			capacity: 1,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
		} );

		const retryEmail = uniqueEmail( 'retry' );
		const first = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: retryEmail,
			quantity: 1,
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		const token = new URL( first.body.checkout_url ).searchParams.get(
			'token'
		);
		const signup = await signupOf( eventDateId, retryEmail );
		await fixture( 'fail', { signup_id: signup.id } );

		// The failed payment released the only place; another buyer takes it.
		const other = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: paidId,
			email: uniqueEmail( 'other' ),
			quantity: 1,
		} );
		expect( other.status ).toBe( 200 );

		const retry = async () => {
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const res = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets/retry-payment',
				{
					data: {
						transaction_id: first.body.transaction_id,
						token,
					},
				}
			);
			const body = await res.json();
			await visitor.dispose();
			return { status: res.status(), body };
		};

		const refused = await retry();
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'event_full' );
		expect( ( await signupOf( eventDateId, retryEmail ) ).status ).toBe(
			'failed'
		);

		// Once the place is free again the retry holds it.
		const otherSignup = (
			await api
				.get( '/wp-json/fair-events/v1/get-tickets', {
					headers: adminHeaders,
					params: { event_date: eventDateId },
				} )
				.then( ( res ) => res.json() )
		).find( ( row ) => row.email !== retryEmail );
		await fixture( 'lapse', { signup_id: otherSignup.id } );

		const accepted = await retry();
		expect( accepted.status, JSON.stringify( accepted.body ) ).toBe( 200 );
		expect( accepted.body.status ).toBe( 'payment_required' );
		expect( ( await signupOf( eventDateId, retryEmail ) ).status ).toBe(
			'pending_payment'
		);
		expect(
			( await counts( { eventDateIds: [ eventDateId ] } ) ).event(
				eventDateId
			)
		).toBe( 1 );
	} );

	test( 'concurrent purchases never exceed event or ticket-type capacity', async () => {
		const {
			eventDateId,
			typeIds: [ limitedId, openId ],
		} = await createEvent( {
			capacity: 5,
			ticketTypes: [
				{ name: 'Limited', capacity: 2 },
				{ name: 'Open', capacity: null },
			],
		} );

		const limitedResults = await Promise.all(
			Array.from( { length: 6 }, ( _, i ) =>
				buy( {
					event_date_id: eventDateId,
					ticket_type_id: limitedId,
					email: uniqueEmail( `race-limited-${ i }` ),
					quantity: 1,
				} )
			)
		);
		expect(
			limitedResults.filter( ( r ) => r.status === 200 )
		).toHaveLength( 2 );
		expect(
			limitedResults.filter(
				( r ) =>
					r.status === 409 && r.body.code === 'ticket_type_sold_out'
			)
		).toHaveLength( 4 );

		const openResults = await Promise.all(
			Array.from( { length: 6 }, ( _, i ) =>
				buy( {
					event_date_id: eventDateId,
					ticket_type_id: openId,
					email: uniqueEmail( `race-open-${ i }` ),
					quantity: 1,
				} )
			)
		);
		expect( openResults.filter( ( r ) => r.status === 200 ) ).toHaveLength(
			3
		);
		expect(
			openResults.filter(
				( r ) => r.status === 409 && r.body.code === 'event_full'
			)
		).toHaveLength( 3 );

		const c = await counts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ limitedId ],
		} );
		expect( c.event( eventDateId ) ).toBe( 5 );
		expect( c.type( limitedId ) ).toBe( 2 );
	} );

	test.describe( 'recurring events', () => {
		let series;
		let singleId;
		let multipleId;
		let wholeId;

		test.beforeAll( async () => {
			series = await createEvent( {
				capacity: 3,
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{ name: 'One date', scope: 'single_instance' },
					{ name: 'Pick dates', scope: 'multiple_instances' },
					{ name: 'Whole series', scope: 'whole_series' },
				],
			} );
			[ singleId, multipleId, wholeId ] = series.typeIds;
			expect( series.occurrenceIds ).toHaveLength( 3 );
		} );

		test( 'each scope takes places on the occurrences it covers', async () => {
			const [ first, second, third ] = series.occurrenceIds;
			const all = { eventDateIds: series.occurrenceIds };

			// A whole-series pass takes one place on every occurrence and
			// one of its ticket type — not one per occurrence.
			const whole = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: uniqueEmail( 'whole' ),
				quantity: 1,
			} );
			expect( whole.status, JSON.stringify( whole.body ) ).toBe( 200 );
			let c = await counts( { ...all, ticketTypeIds: [ wholeId ] } );
			expect( series.occurrenceIds.map( c.event ) ).toEqual( [
				1, 1, 1,
			] );
			expect( c.type( wholeId ) ).toBe( 1 );

			// A single-instance ticket takes places on its occurrence only.
			const single = await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email: uniqueEmail( 'single' ),
				quantity: 2,
			} );
			expect( single.status ).toBe( 200 );

			// A multiple-instance purchase takes one place per chosen date.
			const multiple = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: multipleId,
				event_date_ids: [ first, third ],
				email: uniqueEmail( 'multiple' ),
			} );
			expect( multiple.status, JSON.stringify( multiple.body ) ).toBe(
				200
			);

			c = await counts( {
				...all,
				ticketTypeIds: [ singleId, multipleId, wholeId ],
			} );
			expect( series.occurrenceIds.map( c.event ) ).toEqual( [
				2, 3, 2,
			] );
			expect( c.type( singleId ) ).toBe( 2 );
			expect( c.type( multipleId ) ).toBe( 2 );
			expect( c.type( wholeId ) ).toBe( 1 );

			// The second occurrence is full: a pass covering it, a pick
			// including it, and a single ticket for it are all refused.
			const wholeAgain = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: uniqueEmail( 'whole-again' ),
				quantity: 1,
			} );
			expect( wholeAgain.status ).toBe( 409 );
			expect( wholeAgain.body.code ).toBe( 'event_full' );
			expect( wholeAgain.body.message ).toMatch(
				/^The event on .+ is fully booked\.$/
			);

			const pickFull = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: multipleId,
				event_date_ids: [ first, second ],
				email: uniqueEmail( 'pick-full' ),
			} );
			expect( pickFull.status ).toBe( 409 );
			expect( pickFull.body.code ).toBe( 'event_full' );

			const singleFull = await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email: uniqueEmail( 'single-full' ),
				quantity: 1,
			} );
			expect( singleFull.status ).toBe( 409 );

			// Nothing from the refused purchases was saved.
			c = await counts( all );
			expect( series.occurrenceIds.map( c.event ) ).toEqual( [
				2, 3, 2,
			] );
		} );
	} );

	test.describe( 'migration', () => {
		test( 'admissions without ticket units keep their places without counting twice', async () => {
			const {
				eventDateId,
				typeIds: [ typeId ],
			} = await createEvent( {
				capacity: 10,
				ticketTypes: [ { name: 'Standard', capacity: 10 } ],
			} );
			const both = {
				eventDateIds: [ eventDateId ],
				ticketTypeIds: [ typeId ],
			};

			// A relationship from before ticket units, with no signup.
			await fixture( 'legacy-admission', {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'legacy-only' ),
			} );
			let c = await counts( both );
			expect( c.event( eventDateId ) ).toBe( 1 );
			expect( c.type( typeId ) ).toBe( 1 );

			// A signup the backfill hasn't reached yet counts its quantity.
			await fixture( 'unbackfilled-signup', {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'unbackfilled' ),
				quantity: 2,
			} );
			c = await counts( both );
			expect( c.event( eventDateId ) ).toBe( 3 );
			expect( c.type( typeId ) ).toBe( 3 );

			// A relationship and the signup behind it are one admission.
			const { participant_id: participantId } = await fixture(
				'legacy-admission',
				{
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email: uniqueEmail( 'represented' ),
				}
			);
			await fixture( 'unbackfilled-signup', {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				participant_id: participantId,
				email: uniqueEmail( 'represented-signup' ),
				quantity: 3,
			} );
			c = await counts( both );
			expect( c.event( eventDateId ) ).toBe( 6 );
			expect( c.type( typeId ) ).toBe( 6 );

			// Backfilling units changes how admissions are stored, not how
			// many places they take.
			const backfill = await api.post(
				'/wp-json/fair-e2e/v1/ticket-units/backfill',
				{
					headers: adminHeaders,
					data: {
						restart: true,
						last_signup_id: 0,
						batch_size: 500,
						max_batches: 20,
					},
				}
			);
			expect( backfill.ok() ).toBeTruthy();
			expect( ( await backfill.json() ).audit.missing ).toEqual( [] );

			c = await counts( both );
			expect( c.event( eventDateId ) ).toBe( 6 );
			expect( c.type( typeId ) ).toBe( 6 );

			// The remaining four places are still sellable, and no more.
			const rest = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'rest' ),
				quantity: 5,
			} );
			expect( rest.status ).toBe( 409 );
			expect( rest.body.data.remaining ).toBe( 4 );
		} );
	} );
} );
