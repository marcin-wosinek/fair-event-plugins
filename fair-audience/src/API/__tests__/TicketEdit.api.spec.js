/**
 * Playwright API tests for editing one ticket's type, activities and
 * check-in together (#1709): GET and PUT
 * fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}.
 *
 * Covers permissions, the data the shared ticket editor loads, a combined
 * edit that leaves sibling tickets and the purchase alone, selection rules,
 * capacity overrides for the ticket type and activities together, rollback
 * of a refused edit, a pending add-on hold kept through an edit, tickets
 * awaiting payment, and the guard on the signup-wide type change.
 *
 * The paid add-on needs the acting participant linked to the admin user
 * (as in TicketActivities.api.spec.js); the suite removes it afterwards.
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
	`ticket-edit-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe.serial( 'Edit one ticket (#1709)', () => {
	let api;
	let postId;
	let eventDateId;
	let otherPostId;
	let otherEventDateId;
	let otherTypeId;
	const type = {};
	const option = {};
	let holderId;
	let holderEmail;
	let holderSignup;
	let ticketOne;
	let ticketTwo;
	let ticketThree;
	let reducedBuyerSignupId;
	let reducedBuyerTicket;

	async function createEvent( title, ticketTypes, options ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const newPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-12-01 10:00:00',
				end_datetime: '2035-12-01 12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: newPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: ticketTypes.map( ( ticketType ) => ( {
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						minimum_instances: 1,
						group_ids: [],
						...ticketType,
					} ) ),
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: ticketTypes.map( ( _, index ) => ( {
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
			ticketTypes: ticketsBody.ticket_types,
			options: ticketsBody.options || [],
		};
	}

	async function buy( data, headers = {} ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			headers,
			data: {
				event_date_id: eventDateId,
				name: 'Ticket Edit Buyer',
				_honeypot: '',
				...data,
			},
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	}

	async function signups() {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function signupOf( email ) {
		return ( await signups() ).find( ( row ) => row.email === email );
	}

	async function tickets( signupId ) {
		const query = new URLSearchParams();
		query.append( 'signup_ids[]', signupId );
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
					type: Number( ticket.ticket_type_id ),
					attended: ticket.attended_at,
					activities: ticket.activities
						.map( ( a ) => ( {
							option: Number( a.ticket_option_id ),
							status: a.status,
							over: Number( a.over_capacity ) === 1,
						} ) )
						.sort( ( a, b ) => a.option - b.option ),
				},
			] )
		);
	}

	async function getTicket( ticketId, dateId = eventDateId, headers ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/tickets/${ ticketId }`,
			{ headers: headers ?? adminHeaders }
		);
		return { status: res.status(), body: await res.json() };
	}

	async function updateTicket( ticketId, data ) {
		const res = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }`,
			{ headers: adminHeaders, data }
		);
		return { status: res.status(), body: await res.json() };
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const event = await createEvent(
			`Ticket edit ${ Date.now() }`,
			[
				{ name: 'Regular', maximum_activities: 2 },
				{ name: 'Reduced', capacity: 2, maximum_activities: 1 },
				{ name: 'Standing', activities_enabled: false },
			],
			[
				{ name: 'Morning', price: 0, capacity: null },
				{ name: 'Evening', price: 0, capacity: 1 },
				{ name: 'Masterclass', price: 10, capacity: null },
			]
		);
		postId = event.postId;
		eventDateId = event.eventDateId;
		for ( const ticketType of event.ticketTypes ) {
			type[ ticketType.name ] = ticketType.id;
		}
		for ( const opt of event.options ) {
			option[ opt.name ] = opt.id;
		}

		const other = await createEvent(
			`Ticket edit other ${ Date.now() }`,
			[ { name: 'Elsewhere' } ],
			[]
		);
		otherPostId = other.postId;
		otherEventDateId = other.eventDateId;
		otherTypeId = other.ticketTypes[ 0 ].id;

		const meRes = await api.get( '/wp-json/wp/v2/users/me', {
			headers: adminHeaders,
		} );
		expect( meRes.ok() ).toBeTruthy();
		holderEmail = uniqueEmail( 'holder' );
		const partRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Ticket Holder',
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

		// One purchase of three Regular tickets.
		await buy(
			{ email: holderEmail, ticket_type_id: type.Regular, quantity: 3 },
			adminHeaders
		);
		holderSignup = await signupOf( holderEmail );
		[ ticketOne, ticketTwo, ticketThree ] = holderSignup.tickets.map(
			( ticket ) => ticket.id
		);

		// Another buyer takes one of the two Reduced places.
		const reducedEmail = uniqueEmail( 'reduced' );
		await buy( {
			email: reducedEmail,
			ticket_type_id: type.Reduced,
			quantity: 1,
		} );
		const reducedSignup = await signupOf( reducedEmail );
		reducedBuyerSignupId = reducedSignup.id;
		reducedBuyerTicket = reducedSignup.tickets[ 0 ].id;
	} );

	test.afterAll( async () => {
		for ( const signup of await signups() ) {
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
		for ( const id of [ postId, otherPostId ] ) {
			if ( id ) {
				await api.delete(
					`/wp-json/wp/v2/fair_event/${ id }?force=true`,
					{
						headers: adminHeaders,
					}
				);
			}
		}
		await api.dispose();
	} );

	test( 'requires an administrator and a ticket on the event date', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const url = `/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketOne }`;
		expect( ( await anonymous.get( url ) ).status() ).toBe( 401 );
		expect(
			(
				await anonymous.put( url, {
					data: { ticket_type_id: type.Reduced },
				} )
			).status()
		).toBe( 401 );
		await anonymous.dispose();

		expect(
			( await getTicket( ticketOne, otherEventDateId ) ).status
		).toBe( 404 );
		expect( ( await getTicket( 999999999 ) ).status ).toBe( 404 );

		const foreignType = await updateTicket( ticketOne, {
			ticket_type_id: otherTypeId,
		} );
		expect( foreignType.status ).toBe( 400 );
		expect( foreignType.body.code ).toBe( 'invalid_ticket_type' );
	} );

	test( 'returns the ticket, its holder and the choices the editor needs', async () => {
		const { status, body } = await getTicket( ticketTwo );
		expect( status, JSON.stringify( body ) ).toBe( 200 );

		expect( body.ticket ).toMatchObject( {
			id: ticketTwo,
			position: 2,
			ticket_type_id: type.Regular,
			ticket_type_name: 'Regular',
			status: 'confirmed',
			attended_at: null,
			activity_ids: [],
			participant_name: 'Ticket Holder',
			editable: true,
		} );
		expect( body.ticket.reference ).toMatch( /^[0-9A-F]{8}$/ );

		expect( body.ticket_types ).toEqual( [
			expect.objectContaining( {
				id: type.Regular,
				label: 'Regular',
				current: true,
				activities_enabled: true,
				maximum_activities: 2,
			} ),
			expect.objectContaining( {
				id: type.Reduced,
				current: false,
				capacity: 2,
				remaining: 1,
				maximum_activities: 1,
			} ),
			expect.objectContaining( {
				id: type.Standing,
				activities_enabled: false,
			} ),
		] );
		expect( body.activities ).toEqual( [
			{
				id: option.Morning,
				name: 'Morning',
				capacity: null,
				remaining: null,
			},
			{ id: option.Evening, name: 'Evening', capacity: 1, remaining: 1 },
			{
				id: option.Masterclass,
				name: 'Masterclass',
				capacity: null,
				remaining: null,
			},
		] );
	} );

	test( 'saves type, activities and check-in together, leaving siblings and the purchase alone', async () => {
		const saved = await updateTicket( ticketOne, {
			ticket_type_id: type.Reduced,
			activity_ids: [ option.Morning ],
			attended: true,
		} );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
		expect( saved.body ).toMatchObject( {
			id: ticketOne,
			ticket_type_id: type.Reduced,
			ticket_type_name: 'Reduced',
			activity_ids: [ option.Morning ],
		} );
		expect( saved.body.attended_at ).toBeTruthy();

		const state = await tickets( holderSignup.id );
		expect( state[ ticketOne ] ).toMatchObject( {
			type: type.Reduced,
			activities: [
				{ option: option.Morning, status: 'confirmed', over: false },
			],
		} );
		for ( const sibling of [ ticketTwo, ticketThree ] ) {
			expect( state[ sibling ] ).toEqual( {
				type: type.Regular,
				attended: null,
				activities: [],
			} );
		}

		// The purchase keeps its type, quantity, amount and payment; the
		// list shows each ticket's own type.
		const signup = await signupOf( holderEmail );
		expect( signup ).toMatchObject( {
			ticket_type_id: holderSignup.ticket_type_id,
			quantity: holderSignup.quantity,
			amount: holderSignup.amount,
			transaction_id: holderSignup.transaction_id,
			status: 'confirmed',
		} );
		expect(
			signup.tickets.map( ( ticket ) => ticket.ticket_type_name )
		).toEqual( [ 'Reduced', 'Regular', 'Regular' ] );
	} );

	test( 'refuses a selection the chosen type does not allow and applies nothing', async () => {
		const disabled = await updateTicket( ticketTwo, {
			ticket_type_id: type.Standing,
			activity_ids: [ option.Morning ],
			attended: true,
		} );
		expect( disabled.status ).toBe( 409 );
		expect( disabled.body.code ).toBe( 'ticket_type_activities_disabled' );

		const tooMany = await updateTicket( ticketTwo, {
			activity_ids: [
				option.Morning,
				option.Evening,
				option.Masterclass,
			],
			attended: true,
		} );
		expect( tooMany.status ).toBe( 409 );
		expect( tooMany.body.code ).toBe( 'ticket_type_activities_exceeded' );

		expect( ( await tickets( holderSignup.id ) )[ ticketTwo ] ).toEqual( {
			type: type.Regular,
			attended: null,
			activities: [],
		} );
	} );

	test( 'reports every limit an edit would pass, rolls back, and saves only with a reason', async () => {
		// The other buyer takes Evening's only place; Reduced is now full.
		expect(
			(
				await updateTicket( reducedBuyerTicket, {
					activity_ids: [ option.Evening ],
				} )
			).status
		).toBe( 200 );

		const edit = {
			ticket_type_id: type.Reduced,
			activity_ids: [ option.Evening ],
			attended: true,
		};
		const refused = await updateTicket( ticketTwo, edit );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'capacity_exceeded' );
		expect( refused.body.data.projections ).toEqual( [
			expect.objectContaining( {
				scope: 'ticket_type',
				id: type.Reduced,
				taken: 2,
				capacity: 2,
				after: 3,
			} ),
			expect.objectContaining( {
				scope: 'ticket_option',
				id: option.Evening,
				taken: 1,
				capacity: 1,
				after: 2,
			} ),
		] );
		expect( ( await tickets( holderSignup.id ) )[ ticketTwo ] ).toEqual( {
			type: type.Regular,
			attended: null,
			activities: [],
		} );

		const blank = await updateTicket( ticketTwo, {
			...edit,
			override_reason: '  ',
		} );
		expect( blank.status ).toBe( 400 );
		expect( blank.body.code ).toBe( 'override_reason_required' );

		const overridden = await updateTicket( ticketTwo, {
			...edit,
			override_reason: 'Speaker guest',
		} );
		expect( overridden.status, JSON.stringify( overridden.body ) ).toBe(
			200
		);
		const state = await tickets( holderSignup.id );
		expect( state[ ticketTwo ] ).toMatchObject( {
			type: type.Reduced,
			activities: [
				{ option: option.Evening, status: 'confirmed', over: true },
			],
		} );
		expect( state[ ticketTwo ].attended ).toBeTruthy();
		expect( state[ ticketThree ].type ).toBe( type.Regular );

		const signup = await signupOf( holderEmail );
		expect( signup.over_capacity ).toBe( true );
		expect(
			signup.overrides.map( ( override ) => ( {
				action: override.action,
				activity: override.activity_name,
				reason: override.reason,
			} ) )
		).toEqual( [
			{
				action: 'change_type',
				activity: '',
				reason: 'Speaker guest',
			},
			{
				action: 'activity',
				activity: 'Evening',
				reason: 'Speaker guest',
			},
		] );
		// The other purchase is not flagged.
		expect(
			( await signups() ).find(
				( row ) => row.id === reducedBuyerSignupId
			).over_capacity
		).toBe( false );
	} );

	test( 'keeps a pending add-on hold when other fields of the ticket change', async () => {
		const addOn = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: adminHeaders,
				data: {
					event_id: postId,
					event_date_id: eventDateId,
					ticket_option_ids: [ option.Masterclass ],
					ticket_id: ticketThree,
				},
			}
		);
		const addOnBody = await addOn.json();
		expect( addOnBody.status, JSON.stringify( addOnBody ) ).toBe(
			'payment_required'
		);

		const saved = await updateTicket( ticketThree, {
			activity_ids: [ option.Masterclass, option.Morning ],
			attended: true,
		} );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );

		expect(
			( await tickets( holderSignup.id ) )[ ticketThree ].activities
		).toEqual( [
			{ option: option.Morning, status: 'confirmed', over: false },
			{
				option: option.Masterclass,
				status: 'pending_payment',
				over: false,
			},
		] );
	} );

	test( 'keeps a ticket awaiting payment read-only', async () => {
		const pendingEmail = uniqueEmail( 'pending' );
		await buy( {
			email: pendingEmail,
			ticket_type_id: type.Regular,
			quantity: 1,
		} );
		const pendingSignup = await signupOf( pendingEmail );
		const res = await api.post(
			'/wp-json/fair-e2e/v1/ticket-capacity/unit-status',
			{
				headers: adminHeaders,
				data: {
					signup_id: pendingSignup.id,
					position: 1,
					status: 'pending_payment',
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		const pendingTicket = pendingSignup.tickets[ 0 ].id;

		const loaded = await getTicket( pendingTicket );
		expect( loaded.body.ticket ).toMatchObject( {
			status: 'pending_payment',
			editable: false,
		} );

		for ( const data of [
			{ attended: true },
			{ activity_ids: [ option.Morning ] },
			{ ticket_type_id: type.Standing },
		] ) {
			const refused = await updateTicket( pendingTicket, data );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.code ).toBe( 'ticket_awaiting_payment' );
		}
		expect(
			( await tickets( pendingSignup.id ) )[ pendingTicket ]
		).toEqual( {
			type: type.Regular,
			attended: null,
			activities: [],
		} );
	} );

	test( 'refuses a signup-wide type change once a ticket has its own type', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ holderSignup.id }`,
			{
				headers: adminHeaders,
				data: { ticket_type_id: type.Standing },
			}
		);
		const body = await res.json();
		expect( res.status() ).toBe( 409 );
		expect( body.code ).toBe( 'ticket_types_individually_edited' );

		const state = await tickets( holderSignup.id );
		expect(
			[ ticketOne, ticketTwo, ticketThree ].map(
				( id ) => state[ id ].type
			)
		).toEqual( [ type.Reduced, type.Reduced, type.Regular ] );
	} );
} );
