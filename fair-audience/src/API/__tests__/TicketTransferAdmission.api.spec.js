/**
 * Playwright API tests for who a transferred ticket admits (#2133).
 *
 * After an administrator gives a ticket to someone else, its purchaser keeps
 * their relationship on the date, as the record of the purchase, while the
 * new holder may only be listed as 'interested'. Admission follows the
 * tickets held: the viewer-context fragments (the signed-up card, its
 * tickets and activities, the add-activities form and the occurrence
 * picker) and the add-activities and retry routes must agree with it.
 *
 * Covers a purchaser giving away their last ticket and getting it back, a
 * purchaser keeping a sibling, the new holder's admission and activities,
 * explicit-ticket and omitted-ticket requests from a former holder, a stale
 * page submitting after a transfer, a transfer during an add-on checkout
 * (its retry refused, its payment still honoured on the ticket), an
 * admission without tickets, and a whole-series pass given away. Rejected
 * requests are checked to leave activities, holds, purchases and other
 * tickets as they were.
 *
 * Visitors act through participant tokens minted by the test-only
 * fair-e2e/v1 routes; paid add-ons run against the Mollie double, and
 * their webhooks are simulated through fair-e2e/v1/ticket-activities.
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

const VIEWER_CONTEXT = '/wp-json/fair-events/v1/get-tickets/viewer-context';
const ADD_ACTIVITIES = '/wp-json/fair-audience/v1/event-signup/add-activities';
const SIGNED_UP = 'You are signed up for this date.';

const uniqueEmail = ( label ) =>
	`transfer-admission-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe.serial( 'Admission follows the ticket holder (#2133)', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];
	const createdParticipantIds = [];
	const visitors = [];

	let postId;
	let eventDateId;
	let typeId;
	const option = {};

	// Bought two tickets; gives one away and keeps the other.
	let pairBuyer;
	// Bought one ticket and gives it away.
	let soleBuyer;
	// Receives the pair buyer's first ticket.
	let friend;
	// Receives the sole buyer's ticket.
	let holder;

	async function createEvent( { ticketTypes, options = [], rrule } ) {
		const title = `Transfer admission ${ Date.now() }-${ Math.random()
			.toString( 36 )
			.slice( 2 ) }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const newPostId = ( await postRes.json() ).id;
		createdPostIds.push( newPostId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-10-04',
				start_time: '10:00:00',
				end_date: '2035-10-04',
				end_time: '12:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: newPostId } }
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
						price: 0,
					} ) ),
					options,
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			postId: newPostId,
			eventDateId: edBody.id,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map( ( t ) => t.id ),
			options: ticketsBody.options || [],
		};
	}

	async function signups( dateId ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: dateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	// A purchase through the public route, by a visitor of its own.
	async function buy( email, quantity, dateId = eventDateId, type = typeId ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: dateId,
				name: 'Transfer Buyer',
				email,
				ticket_type_id: type,
				quantity,
				_honeypot: '',
			},
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );

		const signup = ( await signups( dateId ) ).find(
			( row ) => row.email === email
		);
		const id = Number( signup.participant_id );
		createdParticipantIds.push( id );
		return {
			id,
			signupId: Number( signup.id ),
			tickets: signup.tickets.map( ( ticket ) => ticket.id ),
		};
	}

	async function createParticipant( name ) {
		const res = await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name, email: uniqueEmail( name.toLowerCase() ) },
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		createdParticipantIds.push( body.id );
		return body.id;
	}

	async function assign( ticketId, participantId, dateId = eventDateId ) {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/tickets/${ ticketId }/assign`,
			{ headers: adminHeaders, data: { participant_id: participantId } }
		);
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
	}

	// A browser of its own for a participant, recognised by a token as an
	// emailed link would carry it. Its cookies keep the audience session
	// the routes open.
	async function visitorFor( participantId, dateId = eventDateId ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/event-signup/participant-token',
			{
				headers: adminHeaders,
				data: { participant_id: participantId, event_date_id: dateId },
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const token = ( await res.json() ).token;
		const context = await request.newContext( { baseURL: BASE_URL } );
		visitors.push( context );
		return { context, token };
	}

	async function viewerContext( visitor, dateId = eventDateId ) {
		const res = await visitor.context.get( VIEWER_CONTEXT, {
			params: {
				event_date_id: dateId,
				participant_token: visitor.token,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	}

	async function addActivities( visitor, data ) {
		const res = await visitor.context.post( ADD_ACTIVITIES, {
			data: {
				event_id: postId,
				event_date_id: eventDateId,
				participant_token: visitor.token,
				...data,
			},
		} );
		return { status: res.status(), body: await res.json() };
	}

	async function fixture( path, data ) {
		const res = await api.post(
			`/wp-json/fair-e2e/v1/ticket-activities/${ path }`,
			{ headers: adminHeaders, data }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	// Each ticket's holder, purchaser, status and activities, keyed by ID.
	async function ticketsOf( ...signupIds ) {
		const query = new URLSearchParams();
		signupIds.forEach( ( id ) => query.append( 'signup_ids[]', id ) );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-activities/state?${ query }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return Object.fromEntries(
			body.tickets.map( ( ticket ) => [
				Number( ticket.id ),
				{
					holder: Number( ticket.holder_participant_id ),
					purchaser: Number( ticket.purchaser_participant_id ),
					signup: Number( ticket.signup_id ),
					status: ticket.status,
					activities: ticket.activities
						.map(
							( a ) =>
								`${ Number( a.ticket_option_id ) }:${
									a.status
								}`
						)
						.sort(),
				},
			] )
		);
	}

	// A relationship as stored, and its participant-level activity rows.
	async function storedRelationship( relationshipId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-activities/state?event_participant_id=${ relationshipId }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	const participantScopeRows = async ( relationshipId ) =>
		( await storedRelationship( relationshipId ) ).participant_options;

	async function relationshipOf( participantId, dateId = eventDateId ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find(
			( row ) => Number( row.participant_id ) === participantId
		);
	}

	const heldTickets = ( html ) =>
		( html || '' )
			.split( '<ul class="fair-events-signed-up-tickets">' )[ 1 ]
			?.split( '<div class="fair-events-add-activities"' )[ 0 ]
			.split( '<li><strong>' )
			.slice( 1 ) || [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const event = await createEvent( {
			ticketTypes: [ { name: 'Regular' } ],
			options: [
				{ name: 'Morning', price: 0, capacity: null },
				{ name: 'Evening', price: 0, capacity: null },
				{ name: 'Masterclass', price: 10, capacity: 5 },
			],
		} );
		postId = event.postId;
		eventDateId = event.eventDateId;
		[ typeId ] = event.typeIds;
		for ( const opt of event.options ) {
			option[ opt.name ] = opt.id;
		}

		pairBuyer = await buy( uniqueEmail( 'pair' ), 2 );
		soleBuyer = await buy( uniqueEmail( 'sole' ), 1 );
		friend = { id: await createParticipant( 'Friend' ) };
		holder = { id: await createParticipant( 'Holder' ) };
	} );

	test.afterAll( async () => {
		for ( const visitor of visitors ) {
			await visitor.dispose();
		}
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
				{ headers: adminHeaders }
			);
		}
		for ( const id of createdPostIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'a purchaser who gives away their last ticket can register again, and is admitted once it comes back', async () => {
		const [ ticket ] = soleBuyer.tickets;
		const buyer = await visitorFor( soleBuyer.id );
		const newHolder = await visitorFor( holder.id );

		let context = await viewerContext( buyer );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		// Read while they are listed: the Audience tab leaves out a
		// purchaser holding none of their tickets.
		soleBuyer.relationshipId = ( await relationshipOf( soleBuyer.id ) ).id;

		await assign( ticket, holder.id );

		// The purchaser's view: no card, no ticket type of the old ticket,
		// no add-activities form, and the form offered as a first purchase.
		context = await viewerContext( buyer );
		expect( context.viewer_resolved ).toBe( true );
		expect( context.suppress_form ).toBe( false );
		expect( context.existing_signup_html ).not.toContain( SIGNED_UP );
		expect( context.existing_signup_html ).not.toContain(
			'fair-events-add-activities'
		);
		expect( context.before_form_html ).not.toContain(
			'Buy another ticket for yourself'
		);
		expect( context.ticket_type_fieldset_html ).toContain( 'Regular' );

		// The new holder's view: admitted, with the ticket and the form to
		// add activities to it.
		context = await viewerContext( newHolder );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		expect( heldTickets( context.existing_signup_html ) ).toHaveLength( 1 );
		expect( context.existing_signup_html ).toContain(
			'fair-events-add-activities'
		);
		// Tickets back the admission: no broad cancellation.
		expect( context.existing_signup_html ).not.toContain(
			'fair-events-cancel-signup-button'
		);

		// The relationship stays as the record of the purchase.
		expect(
			( await storedRelationship( soleBuyer.relationshipId ) )
				.relationship
		).not.toBeNull();

		await assign( ticket, soleBuyer.id );
		expect(
			( await viewerContext( buyer ) ).existing_signup_html
		).toContain( SIGNED_UP );
		expect(
			( await viewerContext( newHolder ) ).existing_signup_html
		).not.toContain( SIGNED_UP );

		await assign( ticket, holder.id );
	} );

	test( 'the new holder adds activities to the ticket they hold', async () => {
		const [ ticket ] = soleBuyer.tickets;
		const newHolder = await visitorFor( holder.id );

		const added = await addActivities( newHolder, {
			ticket_option_ids: [ option.Morning ],
		} );
		expect( added.status, JSON.stringify( added.body ) ).toBe( 200 );
		expect( added.body.status ).toBe( 'activities_added' );

		const tickets = await ticketsOf( soleBuyer.signupId );
		expect( tickets[ ticket ] ).toMatchObject( {
			holder: holder.id,
			purchaser: soleBuyer.id,
			activities: [ `${ option.Morning }:confirmed` ],
		} );

		const held = heldTickets(
			( await viewerContext( newHolder ) ).existing_signup_html
		);
		expect( held ).toHaveLength( 1 );
		expect( held[ 0 ] ).toContain( 'Morning' );
	} );

	test( 'a former holder cannot add activities, with or without naming the ticket', async () => {
		const [ ticket ] = soleBuyer.tickets;
		const buyer = await visitorFor( soleBuyer.id );
		const before = await ticketsOf(
			soleBuyer.signupId,
			pairBuyer.signupId
		);

		for ( const data of [
			{ ticket_option_ids: [ option.Evening ], ticket_id: ticket },
			{ ticket_option_ids: [ option.Evening ] },
			{ ticket_option_ids: [ option.Masterclass ] },
		] ) {
			const refused = await addActivities( buyer, data );
			expect( refused.status, JSON.stringify( refused.body ) ).toBe(
				400
			);
			expect( refused.body.code ).toBe( 'not_signed_up' );
		}

		expect(
			await ticketsOf( soleBuyer.signupId, pairBuyer.signupId )
		).toEqual( before );
		expect(
			await participantScopeRows( soleBuyer.relationshipId )
		).toEqual( [] );
	} );

	test( 'a purchaser keeping a sibling stays admitted, on that ticket only', async () => {
		const [ given, kept ] = pairBuyer.tickets;
		const buyer = await visitorFor( pairBuyer.id );
		const receiver = await visitorFor( friend.id );

		await assign( given, friend.id );

		const context = await viewerContext( buyer );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		expect( heldTickets( context.existing_signup_html ) ).toHaveLength( 1 );

		// Naming the ticket given away is refused; without a ticket, the
		// one still held is the only target.
		const foreign = await addActivities( buyer, {
			ticket_option_ids: [ option.Evening ],
			ticket_id: given,
		} );
		expect( foreign.status ).toBe( 400 );
		expect( foreign.body.code ).toBe( 'invalid_ticket' );

		const added = await addActivities( buyer, {
			ticket_option_ids: [ option.Evening ],
		} );
		expect( added.status, JSON.stringify( added.body ) ).toBe( 200 );

		const tickets = await ticketsOf( pairBuyer.signupId );
		expect( tickets[ kept ] ).toMatchObject( {
			holder: pairBuyer.id,
			activities: [ `${ option.Evening }:confirmed` ],
		} );
		expect( tickets[ given ] ).toMatchObject( {
			holder: friend.id,
			purchaser: pairBuyer.id,
			activities: [],
		} );

		// The friend is admitted on the ticket they were given.
		const friendView = await viewerContext( receiver );
		expect( friendView.existing_signup_html ).toContain( SIGNED_UP );
		expect( heldTickets( friendView.existing_signup_html ) ).toHaveLength(
			1
		);
	} );

	test( 'a page left open after a transfer changes nothing when submitted', async () => {
		const [ ticket ] = soleBuyer.tickets;
		const newHolder = await visitorFor( holder.id );

		// The holder's page offers activities for the ticket ...
		expect(
			( await viewerContext( newHolder ) ).existing_signup_html
		).toContain( 'fair-events-add-activities' );

		// ... which is given back before they submit.
		await assign( ticket, soleBuyer.id );
		const before = await ticketsOf( soleBuyer.signupId );

		for ( const data of [
			{ ticket_option_ids: [ option.Evening ], ticket_id: ticket },
			{ ticket_option_ids: [ option.Evening ] },
		] ) {
			const refused = await addActivities( newHolder, data );
			expect( refused.status, JSON.stringify( refused.body ) ).toBe(
				400
			);
			expect( refused.body.code ).toBe( 'not_signed_up' );
		}

		expect( await ticketsOf( soleBuyer.signupId ) ).toEqual( before );
		const relationship = await relationshipOf( holder.id );
		expect( await participantScopeRows( relationship.id ) ).toEqual( [] );

		await assign( ticket, holder.id );
	} );

	test( 'a transfer during an add-on checkout refuses its retry and still honours its payment on the ticket', async () => {
		const [ ticket ] = soleBuyer.tickets;
		const newHolder = await visitorFor( holder.id );
		const relationship = await relationshipOf( holder.id );

		const abandoned = await addActivities( newHolder, {
			ticket_option_ids: [ option.Masterclass ],
		} );
		expect( abandoned.status, JSON.stringify( abandoned.body ) ).toBe(
			200
		);
		expect( abandoned.body.status ).toBe( 'payment_required' );

		await assign( ticket, soleBuyer.id );
		await fixture( 'fail-addon', {
			transaction_id: abandoned.body.transaction_id,
		} );

		// The retry would hold the place again on a ticket they no longer hold.
		const retry = await newHolder.context.post(
			'/wp-json/fair-audience/v1/event-signup/retry-payment',
			{ data: { transaction_id: abandoned.body.transaction_id } }
		);
		const retryBody = await retry.json();
		expect( retry.status(), JSON.stringify( retryBody ) ).toBe( 409 );
		expect( retryBody.code ).toBe( 'not_signed_up' );
		expect(
			( await ticketsOf( soleBuyer.signupId ) )[ ticket ].activities
		).toEqual( [ `${ option.Morning }:confirmed` ] );

		// A checkout paid after the ticket changed hands: the payment is
		// honoured on the ticket it bought the activity for, never on the
		// payer's own relationship.
		await assign( ticket, holder.id );
		const paid = await addActivities( newHolder, {
			ticket_option_ids: [ option.Masterclass ],
		} );
		expect( paid.body.status ).toBe( 'payment_required' );
		await assign( ticket, soleBuyer.id );
		await fixture( 'pay-addon', {
			transaction_id: paid.body.transaction_id,
		} );

		const tickets = await ticketsOf( soleBuyer.signupId );
		expect( tickets[ ticket ] ).toMatchObject( {
			holder: soleBuyer.id,
			purchaser: soleBuyer.id,
			signup: soleBuyer.signupId,
			activities: [
				`${ option.Masterclass }:confirmed`,
				`${ option.Morning }:confirmed`,
			].sort(),
		} );
		expect( await participantScopeRows( relationship.id ) ).toEqual( [] );
	} );

	test( 'an admission without tickets keeps its participant-level activities', async () => {
		const guestId = await createParticipant( 'Guest' );
		const batch = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants/batch`,
			{
				headers: adminHeaders,
				data: { participant_ids: [ guestId ], label: 'signed_up' },
			}
		);
		expect( batch.ok(), await batch.text() ).toBeTruthy();
		const guest = await visitorFor( guestId );

		const context = await viewerContext( guest );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		expect( context.existing_signup_html ).toContain(
			'fair-events-cancel-signup-button'
		);

		const added = await addActivities( guest, {
			ticket_option_ids: [ option.Evening ],
		} );
		expect( added.status, JSON.stringify( added.body ) ).toBe( 200 );
		const relationship = await relationshipOf( guestId );
		expect(
			( await participantScopeRows( relationship.id ) ).map( ( row ) =>
				Number( row.ticket_option_id )
			)
		).toEqual( [ option.Evening ] );
	} );

	test( 'a whole-series pass given away admits its new holder on every date, and no longer its buyer', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
			ticketTypes: [ { name: 'Whole series', scope: 'whole_series' } ],
		} );
		const [ master, second ] = series.occurrenceIds;
		const passBuyer = await buy(
			uniqueEmail( 'pass' ),
			1,
			master,
			series.typeIds[ 0 ]
		);
		const passHolderId = await createParticipant( 'Pass Holder' );
		const buyer = await visitorFor( passBuyer.id, second );
		const passHolder = await visitorFor( passHolderId, second );

		let context = await viewerContext( buyer, second );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		expect( context.occurrences_signed_up ).toEqual( series.occurrenceIds );

		await assign( passBuyer.tickets[ 0 ], passHolderId, master );

		context = await viewerContext( buyer, second );
		expect( context.existing_signup_html ).not.toContain( SIGNED_UP );
		expect( context.occurrences_signed_up ).toEqual( [] );

		context = await viewerContext( passHolder, second );
		expect( context.existing_signup_html ).toContain( SIGNED_UP );
		expect( context.existing_signup_html ).toContain( 'Whole series' );
		expect( context.occurrences_signed_up ).toEqual( series.occurrenceIds );
	} );
} );
