/**
 * Playwright API tests for moving, cancelling and deleting one ticket
 * (#1699):
 *
 *   POST   fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/move
 *   POST   fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/cancel
 *   DELETE fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}
 *
 * Covers permissions, a ticket on another event date, sibling isolation,
 * destination restrictions, status eligibility, moving a checked-in ticket,
 * capacity conflicts with the audited override, reconciling a participant
 * left without tickets, and that the purchase and its payment keep their
 * owner and amount. Deletion is followed through signup reconciliation and a
 * payment callback, and a moved ticket through a move of its whole signup.
 *
 * Capacity counts, signup rows and payment callbacks use the test-only
 * fair-e2e/v1/ticket-capacity routes.
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
	`ticket-ops-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Move, cancel and delete one ticket (#1699)', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with its capacity,
	 * ticket types and activities.
	 *
	 * @param {Object}   options
	 * @param {?number}  [options.capacity]  Event capacity (per occurrence).
	 * @param {Object[]} options.ticketTypes { name, price, scope }.
	 * @param {Object[]} [options.options]   Activities: { name, price, capacity }.
	 * @param {string}   [options.rrule]     Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds, optionIds.
	 */
	async function createEvent( {
		capacity = null,
		ticketTypes,
		options = [],
		rrule,
	} ) {
		const title = `Ticket operations ${ Date.now() } ${ Math.random() }`;
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
				start_datetime: '2035-11-03 10:00:00',
				end_datetime: '2035-11-03 12:00:00',
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
					options,
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
			optionIds: ( ticketsBody.options || [] ).map( ( o ) => o.id ),
		};
	}

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Ticket Ops Buyer', _honeypot: '', ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	}

	/**
	 * The signup made with an email on an event date, from the admin list,
	 * plus the IDs of its tickets.
	 *
	 * @param {number} eventDateId Event date bought for.
	 * @param {string} email       Buyer's email.
	 * @return {Promise<Object>} Signup row with `ticketIds`.
	 */
	async function signupOf( eventDateId, email ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signup = ( await res.json() ).find(
			( row ) => row.email === email
		);
		expect( signup, `signup of ${ email }` ).toBeTruthy();
		return {
			...signup,
			ticketIds: signup.tickets.map( ( ticket ) => ticket.id ),
		};
	}

	/**
	 * Buy tickets and return the purchase's signup row with its tickets.
	 *
	 * @param {number} eventDateId Event date bought for.
	 * @param {Object} data        Purchase details; `email` is generated when missing.
	 * @return {Promise<Object>} Signup row with `ticketIds`, and the checkout `result`.
	 */
	async function purchase( eventDateId, data ) {
		const email = data.email || uniqueEmail( 'buyer' );
		const result = await buy( {
			event_date_id: eventDateId,
			...data,
			email,
		} );
		return { ...( await signupOf( eventDateId, email ) ), email, result };
	}

	// The signup row and its ticket units, as stored.
	async function state( signupId ) {
		const res = await api.get(
			'/wp-json/fair-e2e/v1/ticket-capacity/signup',
			{ headers: adminHeaders, params: { signup_id: signupId } }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return {
			signup: body.signup,
			tickets: Object.fromEntries(
				body.tickets.map( ( ticket ) => [
					Number( ticket.id ),
					ticket,
				] )
			),
		};
	}

	async function taken( eventDateId ) {
		const params = new URLSearchParams();
		params.append( 'event_date_ids[]', eventDateId );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).event_dates[ eventDateId ];
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

	const ticketUrl = ( eventDateId, ticketId, action = '' ) =>
		`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }${ action }`;

	async function move( eventDateId, ticketId, data ) {
		const res = await api.post(
			ticketUrl( eventDateId, ticketId, '/move' ),
			{
				headers: adminHeaders,
				data,
			}
		);
		return { status: res.status(), body: await res.json() };
	}

	async function cancel( eventDateId, ticketId ) {
		const res = await api.post(
			ticketUrl( eventDateId, ticketId, '/cancel' ),
			{ headers: adminHeaders }
		);
		return { status: res.status(), body: await res.json() };
	}

	async function remove( eventDateId, ticketId ) {
		const res = await api.delete( ticketUrl( eventDateId, ticketId ), {
			headers: adminHeaders,
		} );
		return { status: res.status(), body: await res.json() };
	}

	// The Audience tab's row of the participant with the given email.
	async function audienceRow( eventDateId, email ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find(
			( row ) => row.participant_email === email
		);
	}

	const ids = ( tickets ) => ( tickets || [] ).map( ( ticket ) => ticket.id );

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

	test( 'requires an administrator and a ticket on the event date', async () => {
		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const [ first, second ] = event.occurrenceIds;
		const signup = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
		} );
		const [ ticketId ] = signup.ticketIds;

		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		expect(
			(
				await anonymous.post( ticketUrl( first, ticketId, '/move' ), {
					data: { target_event_date_id: second },
				} )
			).status()
		).toBe( 401 );
		expect(
			(
				await anonymous.post( ticketUrl( first, ticketId, '/cancel' ) )
			).status()
		).toBe( 401 );
		expect(
			( await anonymous.delete( ticketUrl( first, ticketId ) ) ).status()
		).toBe( 401 );
		await anonymous.dispose();

		// The ticket is on the first date, not the second.
		for ( const response of [
			await move( second, ticketId, { target_event_date_id: first } ),
			await cancel( second, ticketId ),
			await remove( second, ticketId ),
			await cancel( first, 999999999 ),
		] ) {
			expect( response.status ).toBe( 404 );
			expect( response.body.code ).toBe( 'ticket_not_found' );
		}

		const untouched = await state( signup.id );
		expect( untouched.tickets[ ticketId ] ).toMatchObject( {
			status: 'confirmed',
			event_date_id: String( first ),
			deleted_at: null,
		} );
	} );

	test( 'moves one ticket, with its check-in, and leaves its siblings and the purchase alone', async () => {
		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const [ first, second ] = event.occurrenceIds;
		const signup = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 3,
		} );
		const [ one, two, three ] = signup.ticketIds;
		const before = await state( signup.id );

		// A checked-in ticket moves, and stays checked in.
		const checkedIn = await api.put( ticketUrl( first, two ), {
			headers: adminHeaders,
			data: { attended: true },
		} );
		expect( checkedIn.ok() ).toBeTruthy();
		const attendedAt = ( await checkedIn.json() ).attended_at;
		expect( attendedAt ).toBeTruthy();

		const moved = await move( first, two, {
			target_event_date_id: second,
		} );
		expect( moved.status, JSON.stringify( moved.body ) ).toBe( 200 );
		expect( moved.body ).toMatchObject( {
			id: two,
			event_date_id: second,
			status: 'confirmed',
			attended_at: attendedAt,
		} );

		const after = await state( signup.id );
		expect( after.tickets[ two ] ).toMatchObject( {
			event_date_id: String( second ),
			reference: before.tickets[ two ].reference,
			unit_position: before.tickets[ two ].unit_position,
			ticket_type_id: before.tickets[ two ].ticket_type_id,
			purchaser_participant_id:
				before.tickets[ two ].purchaser_participant_id,
			holder_participant_id: before.tickets[ two ].holder_participant_id,
		} );
		// Its siblings and the purchase itself are exactly as they were.
		expect( after.tickets[ one ] ).toEqual( before.tickets[ one ] );
		expect( after.tickets[ three ] ).toEqual( before.tickets[ three ] );
		expect( after.signup ).toEqual( before.signup );

		expect( await taken( first ) ).toBe( 2 );
		expect( await taken( second ) ).toBe( 1 );

		// The holder is listed, signed up, on both dates, each with the
		// tickets held there.
		const onFirst = await audienceRow( first, signup.email );
		expect( onFirst.label ).toBe( 'signed_up' );
		expect( ids( onFirst.tickets ) ).toEqual( [ one, three ] );
		const onSecond = await audienceRow( second, signup.email );
		expect( onSecond.label ).toBe( 'signed_up' );
		expect( ids( onSecond.tickets ) ).toEqual( [ two ] );
		expect( onSecond.participant_id ).toBe( onFirst.participant_id );

		// It is found on its new date only.
		expect( ( await cancel( first, two ) ).status ).toBe( 404 );
	} );

	test( 'moves only to another date of the same recurring event, and never a whole-series pass', async () => {
		const event = await createEvent( {
			ticketTypes: [
				{ name: 'Regular' },
				{ name: 'Pass', scope: 'whole_series' },
			],
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const [ first, second ] = event.occurrenceIds;
		const other = await createEvent( {
			ticketTypes: [ { name: 'Elsewhere' } ],
		} );

		const signup = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
		} );
		const [ ticketId ] = signup.ticketIds;

		for ( const target of [ first, other.eventDateId, 999999999 ] ) {
			const refused = await move( first, ticketId, {
				target_event_date_id: target,
			} );
			expect( refused.status ).toBe( 400 );
			expect( refused.body.code ).toBe( 'invalid_target' );
		}

		// A single date has nowhere to move a ticket to.
		const alone = await purchase( other.eventDateId, {
			ticket_type_id: other.typeIds[ 0 ],
		} );
		const nowhere = await move( other.eventDateId, alone.ticketIds[ 0 ], {
			target_event_date_id: first,
		} );
		expect( nowhere.status ).toBe( 400 );
		expect( nowhere.body.code ).toBe( 'invalid_target' );

		const pass = await purchase( event.eventDateId, {
			ticket_type_id: event.typeIds[ 1 ],
		} );
		const passDate = Number(
			( await state( pass.id ) ).tickets[ pass.ticketIds[ 0 ] ]
				.event_date_id
		);
		const passMove = await move( passDate, pass.ticketIds[ 0 ], {
			target_event_date_id: passDate === first ? second : first,
		} );
		expect( passMove.status ).toBe( 400 );
		expect( passMove.body.code ).toBe( 'ticket_not_movable' );

		expect(
			( await state( signup.id ) ).tickets[ ticketId ].event_date_id
		).toBe( String( first ) );
	} );

	test( 'a full target date or activity needs a reason, which is audited', async () => {
		const event = await createEvent( {
			capacity: 2,
			ticketTypes: [ { name: 'Regular' } ],
			options: [ { name: 'Workshop', price: 0, capacity: 1 } ],
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const [ first, second, third ] = event.occurrenceIds;
		const [ typeId ] = event.typeIds;
		const [ workshopId ] = event.optionIds;

		// The second date is full: 2 of 2.
		await purchase( second, { ticket_type_id: typeId, quantity: 2 } );

		const signup = await purchase( first, {
			ticket_type_id: typeId,
			quantity: 2,
		} );
		const [ one, two ] = signup.ticketIds;

		const refused = await move( first, one, {
			target_event_date_id: second,
		} );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'capacity_exceeded' );
		expect( refused.body.data.projection ).toMatchObject( {
			scope: 'event_date',
			id: second,
			taken: 2,
			capacity: 2,
			after: 3,
		} );
		// A refused move changes nothing.
		expect(
			( await state( signup.id ) ).tickets[ one ].event_date_id
		).toBe( String( first ) );
		expect( await taken( second ) ).toBe( 2 );

		const empty = await move( first, one, {
			target_event_date_id: second,
			override_reason: '   ',
		} );
		expect( empty.status ).toBe( 400 );
		expect( empty.body.code ).toBe( 'override_reason_required' );

		const forced = await move( first, one, {
			target_event_date_id: second,
			override_reason: 'Organizer approved an extra place',
		} );
		expect( forced.status, JSON.stringify( forced.body ) ).toBe( 200 );
		expect( await taken( second ) ).toBe( 3 );
		expect( await taken( first ) ).toBe( 1 );

		const listed = await signupOf( first, signup.email );
		expect( listed.over_capacity ).toBe( true );
		expect( listed.overrides ).toHaveLength( 1 );
		expect( listed.overrides[ 0 ] ).toMatchObject( {
			action: 'move',
			reason: 'Organizer approved an extra place',
		} );

		// An activity's limit applies on each date: the ticket's place in
		// the workshop on the first date does not come along for free.
		const withWorkshop = await purchase( first, {
			ticket_type_id: typeId,
			ticket_option_ids: [ workshopId ],
		} );
		await purchase( third, {
			ticket_type_id: typeId,
			ticket_option_ids: [ workshopId ],
		} );
		const activityRefused = await move(
			first,
			withWorkshop.ticketIds[ 0 ],
			{
				target_event_date_id: third,
			}
		);
		expect( activityRefused.status ).toBe( 409 );
		expect( activityRefused.body.code ).toBe( 'capacity_exceeded' );
		expect( activityRefused.body.data.projection ).toMatchObject( {
			scope: 'ticket_option',
			id: workshopId,
			event_date_id: third,
			taken: 1,
			capacity: 1,
			after: 2,
		} );
		expect(
			( await state( withWorkshop.id ) ).tickets[
				withWorkshop.ticketIds[ 0 ]
			].event_date_id
		).toBe( String( first ) );

		// The sibling was never touched.
		expect( ( await state( signup.id ) ).tickets[ two ] ).toMatchObject( {
			event_date_id: String( first ),
			status: 'confirmed',
		} );
	} );

	test( 'cancels only the selected ticket and keeps the payment as it is', async () => {
		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
		} );
		const date = event.eventDateId;
		const signup = await purchase( date, {
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 2,
		} );
		const [ one, two ] = signup.ticketIds;
		const before = await state( signup.id );

		const cancelled = await cancel( date, one );
		expect( cancelled.status, JSON.stringify( cancelled.body ) ).toBe(
			200
		);
		expect( cancelled.body ).toMatchObject( {
			id: one,
			status: 'cancelled',
		} );

		const after = await state( signup.id );
		expect( after.tickets[ one ].status ).toBe( 'cancelled' );
		expect( after.tickets[ two ] ).toEqual( before.tickets[ two ] );
		// The purchase keeps its owner, amount, quantity and status:
		// nothing is refunded.
		expect( after.signup ).toEqual( before.signup );
		expect( await taken( date ) ).toBe( 1 );

		const row = await audienceRow( date, signup.email );
		expect( row.label ).toBe( 'signed_up' );
		expect( ids( row.tickets ) ).toEqual( [ two ] );
		expect( ids( row.cancelled_tickets ) ).toEqual( [ one ] );

		// A cancelled ticket cannot be cancelled again, moved or edited.
		const again = await cancel( date, one );
		expect( again.status ).toBe( 409 );
		expect( again.body.code ).toBe( 'ticket_inactive' );
	} );

	test( 'a participant left without tickets stays listed but is no longer signed up', async () => {
		const event = await createEvent( {
			capacity: 5,
			ticketTypes: [ { name: 'Regular' } ],
		} );
		const date = event.eventDateId;
		const signup = await purchase( date, {
			ticket_type_id: event.typeIds[ 0 ],
		} );
		const [ only ] = signup.ticketIds;

		const signedUp = await audienceRow( date, signup.email );
		expect( signedUp.label ).toBe( 'signed_up' );

		expect( ( await cancel( date, only ) ).status ).toBe( 200 );

		const row = await audienceRow( date, signup.email );
		expect( row, 'the participant stays in the audience' ).toBeTruthy();
		expect( row.participant_id ).toBe( signedUp.participant_id );
		expect( row.label ).toBe( 'interested' );
		expect( row.tickets ).toEqual( [] );
		expect( ids( row.cancelled_tickets ) ).toEqual( [ only ] );

		// The participant record itself is untouched.
		const participant = await api.get(
			`/wp-json/fair-audience/v1/participants/${ row.participant_id }`,
			{ headers: adminHeaders }
		);
		expect( participant.ok() ).toBeTruthy();
		expect( ( await participant.json() ).email ).toBe( signup.email );

		// Neither the ticket nor the purchase behind it takes a place.
		expect( await taken( date ) ).toBe( 0 );
	} );

	test( 'only a cancelled ticket can be deleted, and it stays gone', async () => {
		const event = await createEvent( {
			capacity: 5,
			ticketTypes: [ { name: 'Regular' } ],
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const [ first, second ] = event.occurrenceIds;
		const signup = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 2,
		} );
		const [ one, two ] = signup.ticketIds;

		const tooEarly = await remove( first, one );
		expect( tooEarly.status ).toBe( 409 );
		expect( tooEarly.body.code ).toBe( 'ticket_not_cancelled' );

		expect( ( await cancel( first, one ) ).status ).toBe( 200 );
		const deleted = await remove( first, one );
		expect( deleted.status, JSON.stringify( deleted.body ) ).toBe( 200 );
		expect( deleted.body ).toEqual( { deleted: true, id: one } );

		// Hidden from the audience and from every ticket route.
		const row = await audienceRow( first, signup.email );
		expect( ids( row.tickets ) ).toEqual( [ two ] );
		expect( row.cancelled_tickets ).toEqual( [] );
		expect(
			(
				await api.get( ticketUrl( first, one ), {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 404 );
		for ( const response of [
			await remove( first, one ),
			await cancel( first, one ),
			await move( first, one, { target_event_date_id: second } ),
		] ) {
			expect( response.status ).toBe( 404 );
		}

		// Its record stays with the purchase, which keeps its quantity.
		const kept = await state( signup.id );
		expect( kept.tickets[ one ].status ).toBe( 'cancelled' );
		expect( kept.tickets[ one ].deleted_at ).toBeTruthy();
		expect( kept.signup.quantity ).toBe( String( 2 ) );

		// Re-saving the signup reconciles its tickets: the deleted one is
		// neither created again nor revived, and takes no place.
		const resaved = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
			{ headers: adminHeaders, data: { event_date_id: first } }
		);
		expect( resaved.ok(), await resaved.text() ).toBeTruthy();
		const reconciled = await state( signup.id );
		expect( Object.keys( reconciled.tickets ) ).toHaveLength( 2 );
		expect( reconciled.tickets[ one ] ).toEqual( kept.tickets[ one ] );
		expect( await taken( first ) ).toBe( 1 );

		// Deleting the last ticket leaves no admission behind either.
		expect( ( await cancel( first, two ) ).status ).toBe( 200 );
		expect( ( await remove( first, two ) ).status ).toBe( 200 );
		const emptied = await audienceRow( first, signup.email );
		expect( emptied.label ).toBe( 'interested' );
		expect( emptied.tickets ).toEqual( [] );
		expect( emptied.cancelled_tickets ).toEqual( [] );
		expect( await taken( first ) ).toBe( 0 );
	} );

	test( 'a payment completed later never revives a cancelled or deleted ticket', async () => {
		const event = await createEvent( {
			capacity: 5,
			ticketTypes: [ { name: 'Paid', price: 10 } ],
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const [ first, second ] = event.occurrenceIds;
		const row = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 3,
		} );
		expect( row.result.status ).toBe( 'payment_required' );
		const { email } = row;
		const [ one, two, three ] = row.ticketIds;
		const before = await state( row.id );
		expect( before.signup.status ).toBe( 'pending_payment' );
		expect( await taken( first ) ).toBe( 3 );

		// While the payment is awaited: one ticket is cancelled and
		// deleted, another moved to the second date.
		expect( ( await cancel( first, one ) ).status ).toBe( 200 );
		expect( ( await remove( first, one ) ).status ).toBe( 200 );
		const moved = await move( first, two, {
			target_event_date_id: second,
		} );
		expect( moved.status, JSON.stringify( moved.body ) ).toBe( 200 );
		expect( await taken( first ) ).toBe( 1 );
		expect( await taken( second ) ).toBe( 1 );

		const paid = await fixture( 'pay', { signup_id: row.id } );
		expect( paid.signup.status ).toBe( 'confirmed' );
		// The amount and the transaction are the purchase's own.
		expect( paid.signup.amount ).toBe( before.signup.amount );
		expect( paid.signup.transaction_id ).toBe(
			before.signup.transaction_id
		);

		const after = await state( row.id );
		expect( after.tickets[ one ].status ).toBe( 'cancelled' );
		expect( after.tickets[ one ].deleted_at ).toBeTruthy();
		expect( after.tickets[ two ] ).toMatchObject( {
			status: 'confirmed',
			event_date_id: String( second ),
		} );
		expect( after.tickets[ three ] ).toMatchObject( {
			status: 'confirmed',
			event_date_id: String( first ),
		} );
		expect( await taken( first ) ).toBe( 1 );
		expect( await taken( second ) ).toBe( 1 );

		const onFirst = await audienceRow( first, email );
		expect( onFirst.label ).toBe( 'signed_up' );
		expect( ids( onFirst.tickets ) ).toEqual( [ three ] );
		expect( onFirst.cancelled_tickets ).toEqual( [] );
		const onSecond = await audienceRow( second, email );
		expect( onSecond.label ).toBe( 'signed_up' );
		expect( ids( onSecond.tickets ) ).toEqual( [ two ] );
	} );

	test( 'a ticket awaiting payment moves only while its hold runs', async () => {
		const event = await createEvent( {
			ticketTypes: [ { name: 'Paid', price: 10 } ],
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const [ first, second ] = event.occurrenceIds;
		const row = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
		} );
		const [ ticketId ] = row.ticketIds;

		await fixture( 'lapse', { signup_id: row.id } );

		const refused = await move( first, ticketId, {
			target_event_date_id: second,
		} );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_payment_expired' );
		expect(
			( await state( row.id ) ).tickets[ ticketId ].event_date_id
		).toBe( String( first ) );
	} );

	test( 'moving the whole signup afterwards leaves an individually moved ticket where it is', async () => {
		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const [ first, second, third ] = event.occurrenceIds;
		const signup = await purchase( first, {
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 3,
		} );
		const [ one, two, three ] = signup.ticketIds;

		expect(
			( await move( first, two, { target_event_date_id: second } ) )
				.status
		).toBe( 200 );
		// A cancelled ticket stays behind too.
		expect( ( await cancel( first, three ) ).status ).toBe( 200 );

		const signupMove = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
			{ headers: adminHeaders, data: { event_date_id: third } }
		);
		expect( signupMove.ok(), await signupMove.text() ).toBeTruthy();

		const after = await state( signup.id );
		expect( after.signup.event_date_id ).toBe( String( third ) );
		expect( after.tickets[ one ].event_date_id ).toBe( String( third ) );
		expect( after.tickets[ two ].event_date_id ).toBe( String( second ) );
		expect( after.tickets[ three ] ).toMatchObject( {
			event_date_id: String( first ),
			status: 'cancelled',
		} );

		expect( await taken( first ) ).toBe( 0 );
		expect( await taken( second ) ).toBe( 1 );
		expect( await taken( third ) ).toBe( 1 );

		// Moving the signup back does not pull the moved ticket along.
		const back = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
			{ headers: adminHeaders, data: { event_date_id: first } }
		);
		expect( back.ok(), await back.text() ).toBeTruthy();
		const returned = await state( signup.id );
		expect( returned.tickets[ one ].event_date_id ).toBe( String( first ) );
		expect( returned.tickets[ two ].event_date_id ).toBe(
			String( second )
		);
		expect( await taken( second ) ).toBe( 1 );
	} );
} );
