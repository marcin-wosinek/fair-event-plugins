/**
 * Playwright API tests for activity capacity counted per ticket (#1697).
 *
 * Purchases go through the public get-tickets route (paid ones against the
 * Mollie double from e2e/mu-plugins). Payment webhooks, lapsed holds and
 * per-unit status changes use the test-only fair-e2e/v1 routes, since this
 * environment has no live payment provider. Add-ons, administrator ticket
 * edits and participant-level history are covered by fair-audience's
 * ActivityCapacity spec.
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
	`activity-capacity-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Activity capacity per ticket', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with ticket types and
	 * activities.
	 *
	 * @param {Object}   options
	 * @param {Object[]} options.ticketTypes { name, price, scope, activities_enabled, maximum_activities, minimum_activities }.
	 * @param {Object[]} options.activities  { name, price, capacity }.
	 * @param {string}   [options.rrule]     Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds, optionIds.
	 */
	async function createEvent( { ticketTypes, activities, rrule } ) {
		const title = `Activity capacity ${ Date.now() } ${ Math.random() }`;
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
				start_datetime: '2035-12-01 10:00:00',
				end_datetime: '2035-12-01 12:00:00',
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
					capacity: null,
					ticket_types: ticketTypes.map( ( type ) => ( {
						name: type.name,
						capacity: null,
						minimum_activities: type.minimum_activities ?? 0,
						maximum_activities: type.maximum_activities ?? null,
						activities_enabled: type.activities_enabled ?? true,
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

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Activity Buyer', _honeypot: '', ...data },
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

	// Activity places taken on an occurrence.
	async function taken( optionId, eventDateId ) {
		const params = new URLSearchParams();
		params.append( 'options[]', `${ optionId }:${ eventDateId }` );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).ticket_options[
			`${ optionId }:${ eventDateId }`
		];
	}

	async function ticketsOf( signupId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ signupId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).tickets;
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

	async function editSignup( signupId, data ) {
		const res = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
			{ headers: adminHeaders, data }
		);
		return { status: res.status(), body: await res.json() };
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

	test( 'sibling tickets choosing the same activity take one place each', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Workshop: workshop },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Workshop', capacity: 3 } ],
		} );

		const email = uniqueEmail( 'siblings' );
		const pair = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email,
			quantity: 2,
			ticket_activities: [ [ workshop ], [ workshop ] ],
		} );
		expect( pair.status, JSON.stringify( pair.body ) ).toBe( 200 );
		expect( await taken( workshop, eventDateId ) ).toBe( 2 );

		// Each ticket keeps its own selection.
		const tickets = await ticketsOf(
			( await signupOf( eventDateId, email ) ).id
		);
		expect( tickets ).toHaveLength( 2 );
		for ( const ticket of tickets ) {
			expect(
				ticket.activities.map( ( a ) => Number( a.ticket_option_id ) )
			).toEqual( [ workshop ] );
		}

		const tooMany = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'too-many' ),
			quantity: 2,
			ticket_activities: [ [ workshop ], [ workshop ] ],
		} );
		expect( tooMany.status ).toBe( 409 );
		expect( tooMany.body.code ).toBe( 'ticket_option_full' );
		expect( tooMany.body.message ).toBe(
			'Only 1 place is left in "Workshop".'
		);
		expect( await taken( workshop, eventDateId ) ).toBe( 2 );

		// One ticket may still take the last place while its sibling skips it.
		const mixed = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'mixed' ),
			quantity: 2,
			ticket_activities: [ [ workshop ], [] ],
		} );
		expect( mixed.status, JSON.stringify( mixed.body ) ).toBe( 200 );
		expect( await taken( workshop, eventDateId ) ).toBe( 3 );

		const full = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'full' ),
			ticket_option_ids: [ workshop ],
		} );
		expect( full.status ).toBe( 409 );
		expect( full.body.message ).toBe( '"Workshop" is full.' );
	} );

	test( 'a selection is never multiplied or dropped across several tickets', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Workshop: workshop },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Workshop', capacity: null } ],
		} );
		const base = { event_date_id: eventDateId, ticket_type_id: typeId };

		const single = await buy( {
			...base,
			email: uniqueEmail( 'single-list' ),
			quantity: 2,
			ticket_option_ids: [ workshop ],
		} );
		expect( single.status ).toBe( 400 );
		expect( single.body.code ).toBe( 'activity_selection_mismatch' );

		const short = await buy( {
			...base,
			email: uniqueEmail( 'short' ),
			quantity: 3,
			ticket_activities: [ [ workshop ], [ workshop ] ],
		} );
		expect( short.status ).toBe( 400 );
		expect( short.body.code ).toBe( 'activity_selection_mismatch' );

		const both = await buy( {
			...base,
			email: uniqueEmail( 'both' ),
			quantity: 1,
			ticket_option_ids: [ workshop ],
			ticket_activities: [ [ workshop ] ],
		} );
		expect( both.status ).toBe( 400 );
		expect( both.body.code ).toBe( 'ambiguous_activity_selection' );

		const foreign = await buy( {
			...base,
			email: uniqueEmail( 'foreign' ),
			quantity: 2,
			ticket_activities: [ [ workshop ], [ 999999999 ] ],
		} );
		expect( foreign.status ).toBe( 400 );
		expect( foreign.body.code ).toBe( 'invalid_ticket_option' );

		expect( await taken( workshop, eventDateId ) ).toBe( 0 );

		const none = await buy( {
			...base,
			email: uniqueEmail( 'none' ),
			quantity: 2,
		} );
		expect( none.status, JSON.stringify( none.body ) ).toBe( 200 );
		expect( await taken( workshop, eventDateId ) ).toBe( 0 );
	} );

	test( 'a cancelled or refunded ticket releases only its own activity place', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Workshop: workshop },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Workshop', capacity: 5 } ],
		} );

		const email = uniqueEmail( 'partial' );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email,
					quantity: 3,
					ticket_activities: [
						[ workshop ],
						[ workshop ],
						[ workshop ],
					],
				} )
			).status
		).toBe( 200 );
		const signup = await signupOf( eventDateId, email );
		expect( await taken( workshop, eventDateId ) ).toBe( 3 );

		await fixture( 'unit-status', {
			signup_id: signup.id,
			position: 2,
			status: 'cancelled',
		} );
		expect( await taken( workshop, eventDateId ) ).toBe( 2 );

		await fixture( 'unit-status', {
			signup_id: signup.id,
			position: 3,
			status: 'refunded',
		} );
		expect( await taken( workshop, eventDateId ) ).toBe( 1 );
	} );

	test( 'paid selections hold their places until the hold lapses; a late payment is honored and flagged', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Masterclass: masterclass },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Masterclass', price: 10, capacity: 2 } ],
		} );

		const lateEmail = uniqueEmail( 'late' );
		const late = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: lateEmail,
			quantity: 2,
			ticket_activities: [ [ masterclass ], [ masterclass ] ],
		} );
		expect( late.status, JSON.stringify( late.body ) ).toBe( 200 );
		expect( late.body.status ).toBe( 'payment_required' );
		// Each ticket's activity is charged.
		expect( Number( late.body.amount ) ).toBe( 20 );
		expect( await taken( masterclass, eventDateId ) ).toBe( 2 );

		const refused = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'refused' ),
			ticket_option_ids: [ masterclass ],
		} );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_option_full' );

		const lateSignup = await signupOf( eventDateId, lateEmail );
		await fixture( 'lapse', { signup_id: lateSignup.id } );
		expect( await taken( masterclass, eventDateId ) ).toBe( 0 );

		const onTimeEmail = uniqueEmail( 'on-time' );
		const onTime = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: onTimeEmail,
			ticket_option_ids: [ masterclass ],
		} );
		expect( onTime.status ).toBe( 200 );
		expect( await taken( masterclass, eventDateId ) ).toBe( 1 );

		// The late payment is honored and flagged: only one place was left
		// for its two tickets.
		const paid = await fixture( 'pay', { signup_id: lateSignup.id } );
		expect( paid.signup.status ).toBe( 'confirmed' );
		expect( Number( paid.signup.over_capacity ) ).toBe( 1 );
		for ( const ticket of await ticketsOf( lateSignup.id ) ) {
			expect( ticket.activities ).toEqual( [
				expect.objectContaining( {
					ticket_option_id: String( masterclass ),
					status: 'confirmed',
					over_capacity: '1',
				} ),
			] );
		}
		expect( await taken( masterclass, eventDateId ) ).toBe( 3 );

		// The on-time payment kept its place and is not flagged.
		const onTimeSignup = await signupOf( eventDateId, onTimeEmail );
		const onTimePaid = await fixture( 'pay', {
			signup_id: onTimeSignup.id,
		} );
		expect( Number( onTimePaid.signup.over_capacity ) ).toBe( 0 );
		expect(
			( await ticketsOf( onTimeSignup.id ) )[ 0 ].activities[ 0 ]
				.over_capacity
		).toBe( '0' );
	} );

	test( 'retrying a failed payment takes its activity places back only if free', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Masterclass: masterclass },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Masterclass', price: 10, capacity: 1 } ],
		} );

		const retryEmail = uniqueEmail( 'retry' );
		const first = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: retryEmail,
			ticket_option_ids: [ masterclass ],
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		const token = new URL( first.body.checkout_url ).searchParams.get(
			'token'
		);
		const signup = await signupOf( eventDateId, retryEmail );
		await fixture( 'fail', { signup_id: signup.id } );
		expect( await taken( masterclass, eventDateId ) ).toBe( 0 );

		const otherEmail = uniqueEmail( 'other' );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email: otherEmail,
					ticket_option_ids: [ masterclass ],
				} )
			).status
		).toBe( 200 );

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
		expect( refused.body.code ).toBe( 'ticket_option_full' );
		expect( ( await signupOf( eventDateId, retryEmail ) ).status ).toBe(
			'failed'
		);

		await fixture( 'lapse', {
			signup_id: ( await signupOf( eventDateId, otherEmail ) ).id,
		} );
		const accepted = await retry();
		expect( accepted.status, JSON.stringify( accepted.body ) ).toBe( 200 );
		expect( await taken( masterclass, eventDateId ) ).toBe( 1 );
	} );

	test( 'concurrent purchases never exceed an activity', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Workshop: workshop },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Workshop', capacity: 3 } ],
		} );

		const results = await Promise.all(
			Array.from( { length: 6 }, ( _, i ) =>
				buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email: uniqueEmail( `race-${ i }` ),
					quantity: 2,
					ticket_activities: [ [ workshop ], [] ],
				} )
			)
		);
		expect( results.filter( ( r ) => r.status === 200 ) ).toHaveLength( 3 );
		expect(
			results.filter(
				( r ) =>
					r.status === 409 && r.body.code === 'ticket_option_full'
			)
		).toHaveLength( 3 );
		expect( await taken( workshop, eventDateId ) ).toBe( 3 );
	} );

	test( 'concurrent administrator edits and purchases never exceed an activity', async () => {
		const {
			eventDateId,
			typeIds: [ typeId ],
			optionIds: { Workshop: workshop },
		} = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			activities: [ { name: 'Workshop', capacity: 2 } ],
		} );

		const email = uniqueEmail( 'edit-race' );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email,
					quantity: 3,
				} )
			).status
		).toBe( 200 );
		const tickets = await ticketsOf(
			( await signupOf( eventDateId, email ) ).id
		);

		const edits = tickets.map( ( ticket ) =>
			api
				.put(
					`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }`,
					{
						headers: adminHeaders,
						data: { activity_ids: [ workshop ] },
					}
				)
				.then( ( res ) => res.status() )
		);
		const purchases = Array.from( { length: 3 }, ( _, i ) =>
			buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( `edit-race-buyer-${ i }` ),
				ticket_option_ids: [ workshop ],
			} ).then( ( result ) => result.status )
		);

		const statuses = await Promise.all( [ ...edits, ...purchases ] );
		expect( statuses.filter( ( status ) => status === 200 ) ).toHaveLength(
			2
		);
		expect( statuses.filter( ( status ) => status === 409 ) ).toHaveLength(
			4
		);
		expect( await taken( workshop, eventDateId ) ).toBe( 2 );
	} );

	test.describe( 'recurring events', () => {
		let series;
		let singleId;
		let wholeId;
		let workshop;
		let tour;

		test.beforeAll( async () => {
			series = await createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{ name: 'One date', scope: 'single_instance' },
					{ name: 'Whole series', scope: 'whole_series' },
				],
				activities: [
					{ name: 'Workshop', capacity: 1 },
					{ name: 'Tour', capacity: 1 },
				],
			} );
			[ singleId, wholeId ] = series.typeIds;
			workshop = series.optionIds.Workshop;
			tour = series.optionIds.Tour;
			expect( series.occurrenceIds ).toHaveLength( 3 );
		} );

		test( 'each occurrence has its own places, and a series ticket takes one on each', async () => {
			const [ first, second, third ] = series.occurrenceIds;

			const onSecond = await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email: uniqueEmail( 'second' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( onSecond.status, JSON.stringify( onSecond.body ) ).toBe(
				200
			);
			expect( await taken( workshop, second ) ).toBe( 1 );
			expect( await taken( workshop, first ) ).toBe( 0 );
			expect( await taken( workshop, third ) ).toBe( 0 );

			// The limit on the series master applies to each occurrence.
			const secondFull = await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email: uniqueEmail( 'second-full' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( secondFull.status ).toBe( 409 );
			const onThird = await buy( {
				event_date_id: third,
				ticket_type_id: singleId,
				email: uniqueEmail( 'third' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( onThird.status ).toBe( 200 );

			// A series ticket needs the activity on every date it covers.
			const wholeRefused = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: uniqueEmail( 'whole-refused' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( wholeRefused.status ).toBe( 409 );
			expect( wholeRefused.body.code ).toBe( 'ticket_option_full' );
			expect( wholeRefused.body.message ).toContain(
				'"Workshop" is full on'
			);

			const whole = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: uniqueEmail( 'whole' ),
				ticket_option_ids: [ tour ],
			} );
			expect( whole.status, JSON.stringify( whole.body ) ).toBe( 200 );
			for ( const occurrenceId of series.occurrenceIds ) {
				expect( await taken( tour, occurrenceId ) ).toBe( 1 );
			}
		} );

		test( 'moving a signup takes its activities to the new date, with an override when full', async () => {
			const [ first, second ] = series.occurrenceIds;
			const firstEmail = uniqueEmail( 'move-first' );

			const onFirst = await buy( {
				event_date_id: first,
				ticket_type_id: singleId,
				email: firstEmail,
				ticket_option_ids: [ workshop ],
			} );
			expect( onFirst.status, JSON.stringify( onFirst.body ) ).toBe(
				200
			);
			// The second date's Workshop place is already taken above.
			expect( await taken( workshop, second ) ).toBe( 1 );
			const signup = await signupOf( first, firstEmail );

			const refused = await editSignup( signup.id, {
				event_date_id: second,
			} );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.code ).toBe( 'capacity_exceeded' );
			expect( refused.body.data.projection ).toMatchObject( {
				scope: 'ticket_option',
				id: workshop,
				label: 'Workshop',
				taken: 1,
				capacity: 1,
				after: 2,
			} );
			expect( refused.body.message ).toBe(
				'Workshop would have 2 of 1 place taken.'
			);

			const moved = await editSignup( signup.id, {
				event_date_id: second,
				override_reason: 'Speaker agreed',
			} );
			expect( moved.status, JSON.stringify( moved.body ) ).toBe( 200 );
			expect( moved.body.over_capacity ).toBe( true );
			expect( await taken( workshop, second ) ).toBe( 2 );
			expect( await taken( workshop, first ) ).toBe( 0 );

			const listed = await signupOf( second, firstEmail );
			expect( listed.over_capacity ).toBe( true );
			expect( listed.overrides ).toEqual( [
				expect.objectContaining( {
					action: 'move',
					activity_name: 'Workshop',
					reason: 'Speaker agreed',
				} ),
			] );
			expect(
				( await ticketsOf( signup.id ) )[ 0 ].activities[ 0 ]
			).toMatchObject( { over_capacity: '1' } );
		} );
	} );

	test( 'a ticket-type change must keep each ticket within the new type’s activity rules', async () => {
		const {
			eventDateId,
			typeIds: [ openId, noneId, oneId ],
			optionIds: { Morning: morning, Evening: evening },
		} = await createEvent( {
			ticketTypes: [
				{ name: 'Open' },
				{ name: 'No activities', activities_enabled: false },
				{ name: 'One activity', maximum_activities: 1 },
			],
			activities: [ { name: 'Morning' }, { name: 'Evening' } ],
		} );

		const email = uniqueEmail( 'type-rules' );
		expect(
			(
				await buy( {
					event_date_id: eventDateId,
					ticket_type_id: openId,
					email,
					quantity: 2,
					ticket_activities: [ [ morning, evening ], [] ],
				} )
			).status
		).toBe( 200 );
		const signup = await signupOf( eventDateId, email );

		const disabled = await editSignup( signup.id, {
			ticket_type_id: noneId,
		} );
		expect( disabled.status ).toBe( 409 );
		expect( disabled.body.code ).toBe( 'ticket_type_activities_disabled' );

		const exceeded = await editSignup( signup.id, {
			ticket_type_id: oneId,
		} );
		expect( exceeded.status ).toBe( 409 );
		expect( exceeded.body.code ).toBe( 'ticket_type_activities_exceeded' );

		expect( ( await signupOf( eventDateId, email ) ).ticket_type_id ).toBe(
			String( openId )
		);
	} );
} );
