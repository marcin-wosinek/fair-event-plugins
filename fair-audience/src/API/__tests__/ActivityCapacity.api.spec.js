/**
 * Playwright API tests for activity capacity on fair-audience's routes
 * (#1697): administrator edits of one ticket's activities, add-ons bought
 * for one ticket, and participant-level history from before activities
 * were stored per ticket.
 *
 * The add-on payment webhooks, a lapsed add-on hold and the history
 * backfill use the test-only fair-e2e/v1/ticket-activities routes. The
 * add-activities route resolves the acting participant from the logged-in
 * user, so the suite links a participant to the admin user (as
 * TicketActivities.api.spec.js does) and removes it afterwards.
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

test.describe.serial( 'Activity capacity on audience routes', () => {
	let api;
	let postId;
	let eventDateId;
	let typeId;
	const option = {};
	let holderId;
	let holderEmail;
	let holderSignupId;
	let ticketOne;
	let ticketTwo;

	async function buy( data, headers = {} ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			headers,
			data: {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				name: 'Activity Capacity Buyer',
				_honeypot: '',
				...data,
			},
		} );
		const body = await res.json();
		await visitor.dispose();
		return { status: res.status(), body };
	}

	async function signupOf( email ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find( ( row ) => row.email === email );
	}

	async function participants() {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders, params: { event_date_id: eventDateId } }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function taken( optionId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?options[]=${ optionId }:${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).ticket_options[
			`${ optionId }:${ eventDateId }`
		];
	}

	async function activityOf( ticketId, optionId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ holderSignupId }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body.tickets
			.find( ( t ) => Number( t.id ) === ticketId )
			.activities.find(
				( a ) => Number( a.ticket_option_id ) === optionId
			);
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

	async function updateTicket( ticketId, data ) {
		const res = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }`,
			{ headers: adminHeaders, data }
		);
		return { status: res.status(), body: await res.json() };
	}

	async function addActivities( data ) {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: adminHeaders,
				data: { event_id: postId, event_date_id: eventDateId, ...data },
			}
		);
		return { status: res.status(), body: await res.json() };
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const title = `Activity capacity audience ${ Date.now() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-12-05 10:00:00',
				end_datetime: '2035-12-05 12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		eventDateId = edBody.id;
		await api.put( `/wp-json/fair-events/v1/event-dates/${ eventDateId }`, {
			headers: adminHeaders,
			data: { event_id: postId },
		} );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Regular',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							minimum_instances: 1,
							group_ids: [],
						},
					],
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
							price: 0,
						},
					],
					options: [
						{ name: 'Workshop', price: 0, capacity: 2 },
						{ name: 'Masterclass', price: 10, capacity: 1 },
						{ name: 'Legacy', price: 0, capacity: null },
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		typeId = ticketsBody.ticket_types[ 0 ].id;
		for ( const opt of ticketsBody.options ) {
			option[ opt.name ] = opt.id;
		}

		const meRes = await api.get( '/wp-json/wp/v2/users/me', {
			headers: adminHeaders,
		} );
		holderEmail = uniqueEmail( 'holder' );
		const partRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Activity Holder',
					email: holderEmail,
					wp_user_id: ( await meRes.json() ).id,
				},
			}
		);
		expect(
			partRes.ok(),
			'admin must not be pre-linked to a participant'
		).toBeTruthy();
		holderId = ( await partRes.json() ).id;

		const purchase = await buy(
			{ email: holderEmail, quantity: 2 },
			adminHeaders
		);
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );
		holderSignupId = ( await signupOf( holderEmail ) ).id;

		const item = ( await participants() ).find(
			( p ) => p.participant_id === holderId
		);
		[ ticketOne, ticketTwo ] = item.tickets.map( ( t ) => t.id );
	} );

	test.afterAll( async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		for ( const signup of res.ok() ? await res.json() : [] ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
				{ headers: adminHeaders }
			);
		}
		if ( holderId ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ holderId }`,
				{ headers: adminHeaders }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test( 'an admin edit needs a place only for a newly added activity, and a reason to exceed it', async () => {
		expect(
			(
				await updateTicket( ticketOne, {
					activity_ids: [ option.Workshop ],
				} )
			).status
		).toBe( 200 );
		expect(
			(
				await updateTicket( ticketTwo, {
					activity_ids: [ option.Workshop ],
				} )
			).status
		).toBe( 200 );
		expect( await taken( option.Workshop ) ).toBe( 2 );

		// Saving a ticket's unchanged selection asks for no new place.
		const unchanged = await updateTicket( ticketOne, {
			activity_ids: [ option.Workshop ],
			attended: true,
		} );
		expect( unchanged.status, JSON.stringify( unchanged.body ) ).toBe(
			200
		);

		const otherEmail = uniqueEmail( 'other' );
		expect( ( await buy( { email: otherEmail } ) ).status ).toBe( 200 );
		const otherTicket = ( await participants() ).find(
			( p ) => p.participant_email === otherEmail
		).tickets[ 0 ];

		const refused = await updateTicket( otherTicket.id, {
			activity_ids: [ option.Workshop ],
		} );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'capacity_exceeded' );
		expect( refused.body.data.projection ).toMatchObject( {
			id: option.Workshop,
			label: 'Workshop',
			taken: 2,
			capacity: 2,
			after: 3,
		} );
		expect( await taken( option.Workshop ) ).toBe( 2 );

		const blank = await updateTicket( otherTicket.id, {
			activity_ids: [ option.Workshop ],
			override_reason: '  ',
		} );
		expect( blank.status ).toBe( 400 );
		expect( blank.body.code ).toBe( 'override_reason_required' );

		const overridden = await updateTicket( otherTicket.id, {
			activity_ids: [ option.Workshop ],
			override_reason: 'Extra chair',
		} );
		expect( overridden.status, JSON.stringify( overridden.body ) ).toBe(
			200
		);
		expect( overridden.body.over_capacity_activity_ids ).toEqual( [
			option.Workshop,
		] );
		expect( await taken( option.Workshop ) ).toBe( 3 );

		const listed = await signupOf( otherEmail );
		expect( listed.over_capacity ).toBe( true );
		expect( listed.overrides ).toEqual( [
			expect.objectContaining( {
				action: 'activity',
				activity_name: 'Workshop',
				reason: 'Extra chair',
			} ),
		] );

		// Removing an activity frees its place.
		await updateTicket( ticketTwo, { activity_ids: [] } );
		expect( await taken( option.Workshop ) ).toBe( 2 );
	} );

	test( 'a paid add-on holds one place for its ticket; failure releases it, and a late payment is flagged', async () => {
		const first = await addActivities( {
			ticket_option_ids: [ option.Masterclass ],
			ticket_id: ticketOne,
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		expect( first.body.status ).toBe( 'payment_required' );
		expect( await taken( option.Masterclass ) ).toBe( 1 );

		// The sibling's add-on finds the only place held.
		const sibling = await addActivities( {
			ticket_option_ids: [ option.Masterclass ],
			ticket_id: ticketTwo,
		} );
		expect( sibling.status ).toBe( 400 );
		expect( sibling.body.code ).toBe( 'no_new_activities' );

		// A failed payment releases the hold at once, on that ticket only.
		await fixture( 'fail-addon', {
			transaction_id: first.body.transaction_id,
		} );
		expect( await activityOf( ticketOne, option.Masterclass ) ).toBe(
			undefined
		);
		expect( await taken( option.Masterclass ) ).toBe( 0 );
		expect( await activityOf( ticketOne, option.Workshop ) ).toMatchObject(
			{
				status: 'confirmed',
			}
		);

		const late = await addActivities( {
			ticket_option_ids: [ option.Masterclass ],
			ticket_id: ticketTwo,
		} );
		expect( late.body.status ).toBe( 'payment_required' );

		// Its hold runs out and someone else takes the place meanwhile.
		await fixture( 'expire-addon', { ticket_id: ticketTwo } );
		expect( await taken( option.Masterclass ) ).toBe( 0 );
		const taker = await buy( {
			email: uniqueEmail( 'taker' ),
			ticket_option_ids: [ option.Masterclass ],
		} );
		expect( taker.status, JSON.stringify( taker.body ) ).toBe( 200 );
		expect( await taken( option.Masterclass ) ).toBe( 1 );

		// The late payment is honored and flagged.
		await fixture( 'pay-addon', {
			transaction_id: late.body.transaction_id,
		} );
		expect(
			await activityOf( ticketTwo, option.Masterclass )
		).toMatchObject( {
			status: 'confirmed',
			over_capacity: '1',
		} );
		expect( await taken( option.Masterclass ) ).toBe( 2 );
		expect( ( await signupOf( holderEmail ) ).over_capacity ).toBe( true );
	} );

	test( 'participant-level history keeps its place without counting twice once carried over', async () => {
		const singleEmail = uniqueEmail( 'single' );
		expect( ( await buy( { email: singleEmail } ) ).status ).toBe( 200 );
		const single = ( await participants() ).find(
			( p ) => p.participant_email === singleEmail
		);
		const holder = ( await participants() ).find(
			( p ) => p.participant_id === holderId
		);

		const before = await taken( option.Legacy );
		await fixture( 'history', {
			event_participant_id: single.id,
			option_ids: [ option.Legacy ],
		} );
		await fixture( 'history', {
			event_participant_id: holder.id,
			option_ids: [ option.Legacy ],
		} );
		// Unresolved history holds one place per participant.
		expect( await taken( option.Legacy ) ).toBe( before + 2 );

		// The single-ticket participant's history moves to their ticket; the
		// holder's two tickets leave theirs at participant level.
		await fixture( 'backfill' );
		expect( await taken( option.Legacy ) ).toBe( before + 2 );
		await fixture( 'backfill' );
		expect( await taken( option.Legacy ) ).toBe( before + 2 );
	} );
} );
