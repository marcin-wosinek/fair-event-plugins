/**
 * Playwright API tests for giving one ticket to another participant (#1535):
 * POST fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/assign.
 *
 * Covers permissions, a ticket on another event date, the purchaser and
 * assignee named by ticket responses, assignment to an existing and to a new
 * participant, email conflicts, sibling tickets and the purchase left alone,
 * a purchaser left holding none of their tickets and getting them back,
 * checked-in tickets, tickets awaiting payment and terminal ones, payment
 * staying with the purchaser, capacity, a moved purchase, and a whole-series
 * pass held by someone else.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const uniqueEmail = ( label ) =>
	`ticket-assign-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe.serial( 'Assign one ticket (#1535)', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];
	const createdParticipantIds = [];

	let eventDateId;
	let otherEventDateId;
	let regularId;
	let paidId;
	let buyerEmail;
	let buyerId;
	let buyerSignupId;
	let ticketOne;
	let ticketTwo;
	let ticketThree;
	let companionId;
	let companionEmail;
	let newcomerId;

	async function createEvent( { ticketTypes, rrule, capacity = null } ) {
		const title = `Ticket assign ${ Date.now() }-${ Math.random()
			.toString( 36 )
			.slice( 2 ) }`;
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

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const occurrenceIds = [
			edBody.id,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
		createdEventDateIds.push( ...occurrenceIds );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }/tickets`,
			{
				headers: adminHeaders,
				data: {
					capacity,
					ticket_types: ticketTypes.map( ( ticketType ) => ( {
						name: ticketType.name,
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: ticketType.scope || 'single_instance',
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
					prices: ticketTypes.map( ( ticketType, index ) => ( {
						ticket_type_index: index,
						sale_period_index: 0,
						price: ticketType.price || 0,
					} ) ),
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			eventDateId: edBody.id,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map(
				( ticketType ) => ticketType.id
			),
		};
	}

	// Each purchase is a separate visitor, so no audience session carries
	// over from one buyer to the next.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Assign Buyer', _honeypot: '', ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	}

	async function signups( dateId ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: dateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function signupOf( dateId, email ) {
		return ( await signups( dateId ) ).find(
			( row ) => row.email === email
		);
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

	// The signup row and its ticket rows, straight from the tables.
	async function purchase( signupId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity/signup?signup_id=${ signupId }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return {
			signup: body.signup,
			tickets: Object.fromEntries(
				body.tickets.map( ( ticket ) => [
					Number( ticket.id ),
					{
						holder: Number( ticket.holder_participant_id ),
						purchaser: Number( ticket.purchaser_participant_id ),
						type: Number( ticket.ticket_type_id ),
						status: ticket.status,
						attended: ticket.attended_at,
					},
				] )
			),
		};
	}

	async function assign(
		ticketId,
		data,
		dateId = eventDateId,
		headers = adminHeaders
	) {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/tickets/${ ticketId }/assign`,
			{ headers, data }
		);
		return { status: res.status(), body: await res.json() };
	}

	// The Audience list of an event date, keyed by participant ID.
	async function audience( dateId = eventDateId ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return Object.fromEntries(
			( await res.json() ).map( ( row ) => [
				Number( row.participant_id ),
				{
					...row,
					ticketIds: row.tickets.map( ( ticket ) => ticket.id ),
				},
			] )
		);
	}

	async function createParticipant( data ) {
		const res = await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data,
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		createdParticipantIds.push( body.id );
		return body.id;
	}

	async function participantsMatching( search ) {
		const res = await api.get( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			params: { search, per_page: 0 },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function eventDatePlaces( dateId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?event_date_ids[]=${ dateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).event_dates[ dateId ];
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' }, { name: 'Paid', price: 10 } ],
		} );
		eventDateId = event.eventDateId;
		[ regularId, paidId ] = event.typeIds;

		otherEventDateId = (
			await createEvent( { ticketTypes: [ { name: 'Elsewhere' } ] } )
		).eventDateId;

		// One purchase of three tickets.
		buyerEmail = uniqueEmail( 'buyer' );
		await buy( {
			event_date_id: eventDateId,
			email: buyerEmail,
			ticket_type_id: regularId,
			quantity: 3,
		} );
		const signup = await signupOf( eventDateId, buyerEmail );
		buyerSignupId = signup.id;
		buyerId = Number( signup.participant_id );
		[ ticketOne, ticketTwo, ticketThree ] = signup.tickets.map(
			( ticket ) => ticket.id
		);

		companionEmail = uniqueEmail( 'companion' );
		companionId = await createParticipant( {
			name: 'Casey',
			surname: 'Companion',
			email: companionEmail,
		} );
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			for ( const signup of await signups( dateId ) ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const id of createdParticipantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const id of createdPostIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'requires an administrator, a ticket on the event date and one assignee', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const anonRes = await anonymous.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketOne }/assign`,
			{ data: { participant_id: companionId } }
		);
		expect( anonRes.status() ).toBe( 401 );
		await anonymous.dispose();

		const username = `ticket-assign-subscriber-${ Date.now() }`;
		const password = 'Ticket-assign-test-1535!';
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		const userId = ( await userRes.json() ).id;
		const forbidden = await assign(
			ticketOne,
			{ participant_id: companionId },
			eventDateId,
			basicAuth( username, password )
		);
		expect( forbidden.status ).toBe( 403 );
		await api.delete(
			`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);

		const wrongDate = await assign(
			ticketOne,
			{ participant_id: companionId },
			otherEventDateId
		);
		expect( wrongDate.status ).toBe( 404 );
		expect( wrongDate.body.code ).toBe( 'ticket_not_found' );
		expect(
			( await assign( 999999999, { participant_id: companionId } ) )
				.status
		).toBe( 404 );

		for ( const data of [
			{},
			{
				participant_id: companionId,
				participant: { name: 'Both At Once' },
			},
		] ) {
			const refused = await assign( ticketOne, data );
			expect( refused.status ).toBe( 400 );
			expect( refused.body.code ).toBe( 'invalid_assignee' );
		}

		const unknown = await assign( ticketOne, {
			participant_id: 999999999,
		} );
		expect( unknown.status ).toBe( 404 );
		expect( unknown.body.code ).toBe( 'invalid_participant' );

		const state = await purchase( buyerSignupId );
		for ( const id of [ ticketOne, ticketTwo, ticketThree ] ) {
			expect( state.tickets[ id ].holder ).toBe( buyerId );
		}
	} );

	test( 'ticket responses name the purchaser and the current assignee', async () => {
		const buyer = {
			participant_id: buyerId,
			name: 'Assign Buyer',
			email: buyerEmail,
		};

		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketOne }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const single = ( await res.json() ).ticket;
		expect( single.purchaser ).toEqual( buyer );
		expect( single.assignee ).toEqual( buyer );

		const row = ( await audience() )[ buyerId ];
		expect( row.ticketIds ).toEqual( [
			ticketOne,
			ticketTwo,
			ticketThree,
		] );
		for ( const ticket of row.tickets ) {
			expect( ticket.purchaser ).toEqual( buyer );
			expect( ticket.assignee ).toEqual( buyer );
		}
		expect( row.assigned_away_ticket_count ).toBe( 0 );
	} );

	test( 'assigns one ticket to an existing participant and leaves the rest of the purchase alone', async () => {
		const before = await purchase( buyerSignupId );

		const assigned = await assign( ticketTwo, {
			participant_id: companionId,
		} );
		expect( assigned.status, JSON.stringify( assigned.body ) ).toBe( 200 );
		expect( assigned.body.id ).toBe( ticketTwo );
		expect( assigned.body.purchaser ).toMatchObject( {
			participant_id: buyerId,
			email: buyerEmail,
		} );
		expect( assigned.body.assignee ).toEqual( {
			participant_id: companionId,
			name: 'Casey Companion',
			email: companionEmail,
		} );

		const after = await purchase( buyerSignupId );
		expect( after.signup ).toEqual( before.signup );
		expect( after.tickets[ ticketTwo ] ).toEqual( {
			...before.tickets[ ticketTwo ],
			holder: companionId,
		} );
		expect( after.tickets[ ticketOne ] ).toEqual(
			before.tickets[ ticketOne ]
		);
		expect( after.tickets[ ticketThree ] ).toEqual(
			before.tickets[ ticketThree ]
		);

		// The ticket is listed under its new holder, who counts as signed
		// up; the purchaser keeps the other two.
		const rows = await audience();
		expect( rows[ companionId ].ticketIds ).toEqual( [ ticketTwo ] );
		expect( rows[ companionId ].label ).toBe( 'signed_up' );
		expect(
			rows[ companionId ].tickets[ 0 ].purchaser.participant_id
		).toBe( buyerId );
		expect( rows[ buyerId ].ticketIds ).toEqual( [
			ticketOne,
			ticketThree,
		] );
		expect( rows[ buyerId ].label ).toBe( 'signed_up' );
		expect( rows[ buyerId ].assigned_away_ticket_count ).toBe( 1 );

		// The existing identity was reused, not copied.
		expect( await participantsMatching( companionEmail ) ).toHaveLength(
			1
		);
	} );

	test( 'creates a participant and assigns the ticket in one step', async () => {
		const email = uniqueEmail( 'newcomer' );
		const assigned = await assign( ticketThree, {
			participant: { name: 'Nico', surname: 'Newcomer', email },
		} );
		expect( assigned.status, JSON.stringify( assigned.body ) ).toBe( 200 );
		newcomerId = assigned.body.assignee.participant_id;
		createdParticipantIds.push( newcomerId );
		expect( assigned.body.assignee ).toEqual( {
			participant_id: newcomerId,
			name: 'Nico Newcomer',
			email,
		} );
		expect( assigned.body.purchaser.participant_id ).toBe( buyerId );

		const created = await participantsMatching( email );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ] ).toMatchObject( {
			id: newcomerId,
			name: 'Nico',
			surname: 'Newcomer',
			email_profile: 'minimal',
		} );

		const state = await purchase( buyerSignupId );
		expect( state.tickets[ ticketThree ] ).toMatchObject( {
			holder: newcomerId,
			purchaser: buyerId,
		} );
		expect( state.tickets[ ticketOne ].holder ).toBe( buyerId );
		expect( state.tickets[ ticketTwo ].holder ).toBe( companionId );

		const rows = await audience();
		expect( rows[ newcomerId ].ticketIds ).toEqual( [ ticketThree ] );
		expect( rows[ newcomerId ].label ).toBe( 'signed_up' );
	} );

	test( 'refuses unusable new-participant details and creates nothing', async () => {
		const marker = `Conflict${ Date.now() }`;

		const conflict = await assign( ticketOne, {
			participant: { name: marker, email: companionEmail },
		} );
		expect( conflict.status ).toBe( 409 );
		expect( conflict.body.code ).toBe( 'email_exists' );
		// The refusal names the existing identity so it can be chosen.
		expect( conflict.body.data.participant ).toEqual( {
			participant_id: companionId,
			name: 'Casey Companion',
			email: companionEmail,
		} );

		const nameless = await assign( ticketOne, {
			participant: { name: '  ', email: uniqueEmail( 'nameless' ) },
		} );
		expect( nameless.status ).toBe( 400 );
		expect( nameless.body.code ).toBe( 'participant_name_required' );

		const badEmail = await assign( ticketOne, {
			participant: { name: marker, email: 'not-an-email' },
		} );
		expect( badEmail.status ).toBe( 400 );
		expect( badEmail.body.code ).toBe( 'invalid_email' );

		expect( await participantsMatching( marker ) ).toHaveLength( 0 );
		expect( await participantsMatching( companionEmail ) ).toHaveLength(
			1
		);
		expect(
			( await purchase( buyerSignupId ) ).tickets[ ticketOne ].holder
		).toBe( buyerId );
	} );

	test( 'a purchaser holding none of their tickets is not listed as attending, and can get one back', async () => {
		const before = await purchase( buyerSignupId );
		const placesBefore = await eventDatePlaces( eventDateId );

		const away = await assign( ticketOne, { participant_id: companionId } );
		expect( away.status, JSON.stringify( away.body ) ).toBe( 200 );

		let rows = await audience();
		expect( rows[ buyerId ].ticketIds ).toEqual( [] );
		expect( rows[ buyerId ].label ).toBe( 'interested' );
		expect( rows[ buyerId ].assigned_away_ticket_count ).toBe( 3 );
		expect( rows[ companionId ].ticketIds ).toEqual( [
			ticketOne,
			ticketTwo,
		] );

		// The purchase is still the purchaser's, and still three places.
		let state = await purchase( buyerSignupId );
		expect( state.signup ).toEqual( before.signup );
		expect( Number( state.signup.participant_id ) ).toBe( buyerId );
		for ( const id of [ ticketOne, ticketTwo, ticketThree ] ) {
			expect( state.tickets[ id ].purchaser ).toBe( buyerId );
		}
		expect( await eventDatePlaces( eventDateId ) ).toBe( placesBefore );

		// Back to the purchaser, twice: the second time changes nothing.
		for ( let i = 0; i < 2; i++ ) {
			const back = await assign( ticketOne, { participant_id: buyerId } );
			expect( back.status, JSON.stringify( back.body ) ).toBe( 200 );
			expect( back.body.assignee.participant_id ).toBe( buyerId );
			expect( back.body.purchaser.participant_id ).toBe( buyerId );
		}

		rows = await audience();
		expect( rows[ buyerId ].ticketIds ).toEqual( [ ticketOne ] );
		expect( rows[ buyerId ].label ).toBe( 'signed_up' );
		expect( rows[ buyerId ].assigned_away_ticket_count ).toBe( 2 );
		// The previous holder's relationship stays; they keep ticket two.
		expect( rows[ companionId ].ticketIds ).toEqual( [ ticketTwo ] );

		state = await purchase( buyerSignupId );
		expect( state.tickets[ ticketTwo ].holder ).toBe( companionId );
		expect( state.tickets[ ticketThree ].holder ).toBe( newcomerId );
		expect( await eventDatePlaces( eventDateId ) ).toBe( placesBefore );
	} );

	test( 'someone left without a ticket stays listed but is no longer signed up', async () => {
		// The newcomer's only ticket goes back to the purchaser.
		const back = await assign( ticketThree, { participant_id: buyerId } );
		expect( back.status, JSON.stringify( back.body ) ).toBe( 200 );

		const rows = await audience();
		expect( rows[ newcomerId ].ticketIds ).toEqual( [] );
		expect( rows[ newcomerId ].label ).toBe( 'interested' );
		expect( rows[ newcomerId ].assigned_away_ticket_count ).toBe( 0 );
		expect( rows[ buyerId ].ticketIds ).toEqual( [
			ticketOne,
			ticketThree,
		] );
	} );

	test( 'refuses a checked-in ticket until its check-in is cleared', async () => {
		const ticketUrl = `/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketThree }`;
		expect(
			(
				await api.put( ticketUrl, {
					headers: adminHeaders,
					data: { attended: true },
				} )
			).ok()
		).toBeTruthy();

		const refused = await assign( ticketThree, {
			participant_id: companionId,
		} );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_checked_in' );
		let state = await purchase( buyerSignupId );
		expect( state.tickets[ ticketThree ].holder ).toBe( buyerId );
		expect( state.tickets[ ticketThree ].attended ).not.toBeNull();

		expect(
			(
				await api.put( ticketUrl, {
					headers: adminHeaders,
					data: { attended: false },
				} )
			).ok()
		).toBeTruthy();
		const assigned = await assign( ticketThree, {
			participant_id: companionId,
		} );
		expect( assigned.status, JSON.stringify( assigned.body ) ).toBe( 200 );
		state = await purchase( buyerSignupId );
		expect( state.tickets[ ticketThree ].holder ).toBe( companionId );
	} );

	test( 'assigns a ticket awaiting payment and keeps the payment with its purchaser', async () => {
		const payerEmail = uniqueEmail( 'payer' );
		const pending = await buy( {
			event_date_id: eventDateId,
			email: payerEmail,
			ticket_type_id: paidId,
			quantity: 2,
		} );
		expect( pending.status ).toBe( 'payment_required' );
		const signup = await signupOf( eventDateId, payerEmail );
		const payerId = Number( signup.participant_id );
		const [ paidOne, paidTwo ] = signup.tickets.map(
			( ticket ) => ticket.id
		);

		async function payment() {
			const state = await purchase( signup.id );
			const res = await api.get(
				`/wp-json/fair-e2e/v1/transaction-participants/state?transaction_id=${ state.signup.transaction_id }&signup_ids[]=${ signup.id }`,
				{ headers: adminHeaders }
			);
			expect( res.ok() ).toBeTruthy();
			return res.json();
		}
		const paymentBefore = await payment();
		expect( paymentBefore.participant_id ).toBe( payerId );

		const assigned = await assign( paidTwo, {
			participant_id: companionId,
		} );
		expect( assigned.status, JSON.stringify( assigned.body ) ).toBe( 200 );
		expect( assigned.body.status ).toBe( 'pending_payment' );

		let state = await purchase( signup.id );
		expect( state.signup.status ).toBe( 'pending_payment' );
		expect( state.tickets[ paidTwo ] ).toMatchObject( {
			holder: companionId,
			purchaser: payerId,
			status: 'pending_payment',
		} );
		expect( state.tickets[ paidOne ].holder ).toBe( payerId );
		expect( await payment() ).toEqual( paymentBefore );

		// The payment confirms both tickets; each stays with its holder,
		// and the transaction and its ledger stay with the purchaser.
		await fixture( 'pay', { signup_id: signup.id } );
		state = await purchase( signup.id );
		expect( state.tickets[ paidOne ] ).toMatchObject( {
			holder: payerId,
			status: 'confirmed',
		} );
		expect( state.tickets[ paidTwo ] ).toMatchObject( {
			holder: companionId,
			purchaser: payerId,
			status: 'confirmed',
		} );
		const paymentAfter = await payment();
		expect( paymentAfter.participant_id ).toBe( payerId );
		expect( paymentAfter.signups ).toEqual( paymentBefore.signups );
		expect(
			paymentAfter.ledger.map( ( row ) => row.participant_id )
		).toEqual( [ payerId ] );

		const rows = await audience();
		expect( rows[ payerId ].ticketIds ).toEqual( [ paidOne ] );
		expect( rows[ companionId ].ticketIds ).toContain( paidTwo );
	} );

	test( 'refuses a ticket whose payment lapsed, failed or was cancelled or refunded', async () => {
		const lapsedEmail = uniqueEmail( 'lapsed' );
		await buy( {
			event_date_id: eventDateId,
			email: lapsedEmail,
			ticket_type_id: paidId,
			quantity: 1,
		} );
		const lapsedSignup = await signupOf( eventDateId, lapsedEmail );
		const lapsedTicket = lapsedSignup.tickets[ 0 ].id;
		await fixture( 'lapse', { signup_id: lapsedSignup.id } );

		const lapsed = await assign( lapsedTicket, {
			participant_id: companionId,
		} );
		expect( lapsed.status ).toBe( 409 );
		expect( lapsed.body.code ).toBe( 'ticket_payment_expired' );

		for ( const status of [
			'failed',
			'expired',
			'cancelled',
			'refunded',
		] ) {
			await fixture( 'unit-status', {
				signup_id: lapsedSignup.id,
				position: 1,
				status,
			} );
			const refused = await assign( lapsedTicket, {
				participant_id: companionId,
			} );
			expect( refused.status, status ).toBe( 409 );
			expect( refused.body.code, status ).toBe( 'ticket_inactive' );
		}

		const state = await purchase( lapsedSignup.id );
		expect( state.tickets[ lapsedTicket ].holder ).toBe(
			Number( lapsedSignup.participant_id )
		);
	} );

	test( 'counts a hand-added participant once when they are given a ticket', async () => {
		const event = await createEvent( {
			capacity: 10,
			ticketTypes: [ { name: 'Standard' } ],
		} );
		const email = uniqueEmail( 'door' );
		await buy( {
			event_date_id: event.eventDateId,
			email,
			ticket_type_id: event.typeIds[ 0 ],
			quantity: 2,
		} );
		const signup = await signupOf( event.eventDateId, email );

		// Someone added by hand as signed up, with no purchase of their own.
		const { participant_id: handAddedId } = await fixture(
			'legacy-admission',
			{
				event_date_id: event.eventDateId,
				ticket_type_id: event.typeIds[ 0 ],
				email: uniqueEmail( 'hand-added' ),
			}
		);
		createdParticipantIds.push( handAddedId );
		expect( await eventDatePlaces( event.eventDateId ) ).toBe( 3 );

		// Given one of the two tickets, they use that place, not a third.
		const assigned = await assign(
			signup.tickets[ 1 ].id,
			{ participant_id: handAddedId },
			event.eventDateId
		);
		expect( assigned.status, JSON.stringify( assigned.body ) ).toBe( 200 );
		expect( await eventDatePlaces( event.eventDateId ) ).toBe( 2 );

		// Their own relationship was reused as it was.
		const rows = await audience( event.eventDateId );
		expect( rows[ handAddedId ].label ).toBe( 'signed_up' );
		expect( rows[ handAddedId ].ticket_type_id ).toBe( event.typeIds[ 0 ] );
		expect( rows[ handAddedId ].ticketIds ).toEqual( [
			signup.tickets[ 1 ].id,
		] );
	} );

	test( 'keeps an assigned holder listed when the purchase moves to another date', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
			ticketTypes: [ { name: 'One date', scope: 'single_instance' } ],
		} );
		const [ , second, third ] = series.occurrenceIds;
		const email = uniqueEmail( 'mover' );
		await buy( {
			event_date_id: second,
			email,
			ticket_type_id: series.typeIds[ 0 ],
			quantity: 2,
		} );
		const signup = await signupOf( second, email );
		const moverId = Number( signup.participant_id );
		const givenTicket = signup.tickets[ 1 ].id;

		expect(
			(
				await assign(
					givenTicket,
					{ participant_id: companionId },
					second
				)
			).status
		).toBe( 200 );

		const moveRes = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
			{ headers: adminHeaders, data: { event_date_id: third } }
		);
		expect( moveRes.ok(), JSON.stringify( await moveRes.json() ) ).toBe(
			true
		);

		const rows = await audience( third );
		expect( rows[ moverId ].ticketIds ).toEqual( [
			signup.tickets[ 0 ].id,
		] );
		expect( rows[ companionId ].ticketIds ).toEqual( [ givenTicket ] );
		expect( rows[ companionId ].label ).toBe( 'signed_up' );
	} );

	test( 'a whole-series pass given to someone else admits its holder on each date', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
			ticketTypes: [ { name: 'Whole series', scope: 'whole_series' } ],
		} );
		const [ master, second ] = series.occurrenceIds;
		const email = uniqueEmail( 'pass' );
		await buy( {
			event_date_id: master,
			email,
			ticket_type_id: series.typeIds[ 0 ],
			quantity: 1,
		} );
		const signup = await signupOf( master, email );
		const passBuyerId = Number( signup.participant_id );

		let rows = await audience( second );
		expect( rows[ passBuyerId ].is_series_pass ).toBe( true );
		expect( rows[ companionId ] ).toBeUndefined();

		expect(
			(
				await assign(
					signup.tickets[ 0 ].id,
					{ participant_id: companionId },
					master
				)
			).status
		).toBe( 200 );

		rows = await audience( second );
		expect( rows[ passBuyerId ] ).toBeUndefined();
		expect( rows[ companionId ] ).toMatchObject( {
			is_series_pass: true,
			label: 'signed_up',
			ticket_type_id: series.typeIds[ 0 ],
		} );
	} );
} );
