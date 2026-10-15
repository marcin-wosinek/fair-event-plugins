/**
 * Playwright API tests for activities and attendance stored per ticket
 * (#1533).
 *
 * Purchases go through the public get-tickets route; paid add-ons run
 * against the Mollie double from e2e/mu-plugins. The add-on payment
 * webhook, a lapsed add-on hold, participant-level history from before
 * per-ticket storage, and the history backfill use the test-only
 * fair-e2e/v1/ticket-activities routes, since this environment has no live
 * payment provider and no pre-existing data.
 *
 * The add-activities route resolves the acting participant from the
 * logged-in user, so the suite links a participant to the admin user (as
 * EventSignupAddActivities.api.spec.js does) and removes it afterwards.
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
	`ticket-activities-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe.serial( 'Activities and attendance per ticket', () => {
	let api;
	let postId;
	let eventDateId;
	let otherEventDateId;
	let otherPostId;
	let typeId;
	const option = {};
	let holderId;
	let holderEmail;
	let holderSignupId;
	let ticketOne;
	let ticketTwo;
	const extraEvents = [];

	async function createEvent( title, withOptions ) {
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
				start_datetime: '2035-11-01 10:00:00',
				end_datetime: '2035-11-01 12:00:00',
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
					options: Array.isArray( withOptions )
						? withOptions
						: withOptions
							? [
									{
										name: 'Morning',
										price: 0,
										capacity: null,
									},
									{
										name: 'Evening',
										price: 0,
										capacity: null,
									},
									{
										name: 'Masterclass',
										price: 10,
										capacity: 5,
									},
									{
										name: 'Legacy',
										price: 0,
										capacity: null,
									},
								]
							: [],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			postId: newPostId,
			eventDateId: edBody.id,
			typeId: ticketsBody.ticket_types[ 0 ].id,
			options: ticketsBody.options || [],
		};
	}

	async function buy( data, headers = {} ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			headers,
			data: {
				event_date_id: eventDateId,
				name: 'Ticket Activities Buyer',
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

	async function participantItem( participantId ) {
		return ( await participants() ).find(
			( p ) => p.participant_id === participantId
		);
	}

	async function state( params ) {
		const query = new URLSearchParams();
		( params.signupIds || [] ).forEach( ( id ) =>
			query.append( 'signup_ids[]', id )
		);
		if ( params.eventParticipantId ) {
			query.set( 'event_participant_id', params.eventParticipantId );
		}
		if ( params.optionId ) {
			query.set( 'option_id', params.optionId );
		}
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-activities/state?${ query }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	const ticketIn = ( body, id ) =>
		body.tickets.find( ( t ) => Number( t.id ) === id );
	const activitiesOf = ( ticket ) =>
		ticket.activities
			.map( ( a ) => ( {
				option: Number( a.ticket_option_id ),
				status: a.status,
			} ) )
			.sort( ( a, b ) => a.option - b.option );

	async function fixture( path, data ) {
		const res = await api.post(
			`/wp-json/fair-e2e/v1/ticket-activities/${ path }`,
			{ headers: adminHeaders, data }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	async function updateTicket( ticketId, data, dateId = eventDateId ) {
		const res = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/tickets/${ ticketId }`,
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

		const event = await createEvent(
			`Ticket activities ${ Date.now() }`,
			true
		);
		postId = event.postId;
		eventDateId = event.eventDateId;
		typeId = event.typeId;
		for ( const opt of event.options ) {
			option[ opt.name ] = opt.id;
		}
		expect( Object.keys( option ) ).toHaveLength( 4 );

		const other = await createEvent(
			`Ticket activities other ${ Date.now() }`,
			false
		);
		otherPostId = other.postId;
		otherEventDateId = other.eventDateId;

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

		// One purchase of two tickets: siblings held by the same participant.
		const purchase = await buy(
			{ email: holderEmail, ticket_type_id: typeId, quantity: 2 },
			adminHeaders
		);
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );
		holderSignupId = ( await signupOf( holderEmail ) ).id;

		const item = await participantItem( holderId );
		expect( item.tickets ).toHaveLength( 2 );
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
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const extra of extraEvents ) {
			const extraRes = await api.get(
				'/wp-json/fair-events/v1/get-tickets',
				{
					headers: adminHeaders,
					params: { event_date: extra.eventDateId },
				}
			);
			for ( const signup of extraRes.ok() ? await extraRes.json() : [] ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const id of [
			postId,
			otherPostId,
			...extraEvents.map( ( extra ) => extra.postId ),
		] ) {
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

	test( 'rejects ticket updates without admin rights, for another event date, or with foreign activities', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const unauthenticated = await anonymous.put(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketOne }`,
			{ data: { attended: true } }
		);
		expect( unauthenticated.status() ).toBe( 401 );
		await anonymous.dispose();

		expect(
			(
				await updateTicket(
					ticketOne,
					{ attended: true },
					otherEventDateId
				)
			).status
		).toBe( 404 );
		expect(
			( await updateTicket( 999999999, { attended: true } ) ).status
		).toBe( 404 );
		expect( ( await updateTicket( ticketOne, {} ) ).status ).toBe( 400 );

		const foreign = await updateTicket( ticketOne, {
			activity_ids: [ 999999999 ],
		} );
		expect( foreign.status ).toBe( 400 );
		expect( foreign.body.code ).toBe( 'invalid_ticket_option' );

		const untouched = await state( { signupIds: [ holderSignupId ] } );
		expect( ticketIn( untouched, ticketOne ).attended_at ).toBeNull();
		expect( ticketIn( untouched, ticketOne ).activities ).toHaveLength( 0 );
	} );

	test( 'edits and checks in one ticket without changing its sibling', async () => {
		const edited = await updateTicket( ticketOne, {
			activity_ids: [ option.Morning ],
			attended: true,
		} );
		expect( edited.status, JSON.stringify( edited.body ) ).toBe( 200 );
		expect( edited.body.activity_ids ).toEqual( [ option.Morning ] );
		expect( edited.body.attended_at ).toBeTruthy();

		let current = await state( { signupIds: [ holderSignupId ] } );
		expect( activitiesOf( ticketIn( current, ticketOne ) ) ).toEqual( [
			{ option: option.Morning, status: 'confirmed' },
		] );
		expect( ticketIn( current, ticketTwo ).activities ).toHaveLength( 0 );
		expect( ticketIn( current, ticketTwo ).attended_at ).toBeNull();

		// The sibling gets a different selection; the first keeps its own.
		await updateTicket( ticketTwo, { activity_ids: [ option.Evening ] } );
		current = await state( { signupIds: [ holderSignupId ] } );
		expect( activitiesOf( ticketIn( current, ticketOne ) ) ).toEqual( [
			{ option: option.Morning, status: 'confirmed' },
		] );
		expect( activitiesOf( ticketIn( current, ticketTwo ) ) ).toEqual( [
			{ option: option.Evening, status: 'confirmed' },
		] );
		expect( ticketIn( current, ticketTwo ).attended_at ).toBeNull();

		const item = await participantItem( holderId );
		const byId = Object.fromEntries(
			item.tickets.map( ( t ) => [ t.id, t ] )
		);
		expect( byId[ ticketOne ].activity_ids ).toEqual( [ option.Morning ] );
		expect( byId[ ticketTwo ].activity_ids ).toEqual( [ option.Evening ] );
		expect( item.participant_ticket_option_ids ).toEqual( [] );
		expect( item.ticket_option_ids.sort() ).toEqual(
			[ option.Morning, option.Evening ].sort()
		);
	} );

	test( 'repeated check-in keeps the first time and clearing sets it to null', async () => {
		const first = ticketIn(
			await state( { signupIds: [ holderSignupId ] } ),
			ticketOne
		).attended_at;
		expect( first ).toBeTruthy();

		await new Promise( ( resolve ) => setTimeout( resolve, 1100 ) );
		const again = await updateTicket( ticketOne, { attended: true } );
		expect( again.body.attended_at ).toBe( first );

		// Saving the same activities again changes nothing.
		const repeated = await updateTicket( ticketOne, {
			activity_ids: [ option.Morning ],
		} );
		expect( repeated.body.activity_ids ).toEqual( [ option.Morning ] );

		const cleared = await updateTicket( ticketOne, { attended: false } );
		expect( cleared.body.attended_at ).toBeNull();
		expect(
			ticketIn(
				await state( { signupIds: [ holderSignupId ] } ),
				ticketTwo
			).attended_at
		).toBeNull();
	} );

	test( 'adds a free activity to the chosen ticket only', async () => {
		const unchosen = await addActivities( {
			ticket_option_ids: [ option.Legacy ],
		} );
		expect( unchosen.status ).toBe( 400 );
		expect( unchosen.body.code ).toBe( 'ticket_required' );

		const foreign = await addActivities( {
			ticket_option_ids: [ option.Legacy ],
			ticket_id: 999999999,
		} );
		expect( foreign.status ).toBe( 400 );
		expect( foreign.body.code ).toBe( 'invalid_ticket' );

		const added = await addActivities( {
			ticket_option_ids: [ option.Evening ],
			ticket_id: ticketOne,
		} );
		expect( added.status, JSON.stringify( added.body ) ).toBe( 200 );
		expect( added.body.status ).toBe( 'activities_added' );

		const current = await state( { signupIds: [ holderSignupId ] } );
		expect( activitiesOf( ticketIn( current, ticketOne ) ) ).toEqual(
			[
				{ option: option.Morning, status: 'confirmed' },
				{ option: option.Evening, status: 'confirmed' },
			].sort( ( a, b ) => a.option - b.option )
		);
		expect( activitiesOf( ticketIn( current, ticketTwo ) ) ).toEqual( [
			{ option: option.Evening, status: 'confirmed' },
		] );

		// Repeating the same add-on is refused rather than duplicated.
		const repeated = await addActivities( {
			ticket_option_ids: [ option.Evening ],
			ticket_id: ticketOne,
		} );
		expect( repeated.status ).toBe( 400 );
		expect( repeated.body.code ).toBe( 'no_new_activities' );
	} );

	test( 'a paid add-on holds its place on one ticket until paid, and a lapsed hold is released', async () => {
		const paid = await addActivities( {
			ticket_option_ids: [ option.Masterclass ],
			ticket_id: ticketOne,
		} );
		expect( paid.status, JSON.stringify( paid.body ) ).toBe( 200 );
		expect( paid.body.status ).toBe( 'payment_required' );
		expect( Number( paid.body.amount ) ).toBe( 10 );

		let current = await state( {
			signupIds: [ holderSignupId ],
			optionId: option.Masterclass,
		} );
		expect(
			activitiesOf( ticketIn( current, ticketOne ) ).find(
				( a ) => a.option === option.Masterclass
			)
		).toEqual( { option: option.Masterclass, status: 'pending_payment' } );
		expect(
			activitiesOf( ticketIn( current, ticketTwo ) ).map(
				( a ) => a.option
			)
		).not.toContain( option.Masterclass );
		expect( current.option_count ).toBe( 1 );

		// The webhook confirms it on that ticket; a repeated webhook is a no-op.
		await fixture( 'pay-addon', {
			transaction_id: paid.body.transaction_id,
		} );
		await fixture( 'pay-addon', {
			transaction_id: paid.body.transaction_id,
		} );
		current = await state( {
			signupIds: [ holderSignupId ],
			optionId: option.Masterclass,
		} );
		expect(
			ticketIn( current, ticketOne ).activities.filter(
				( a ) => Number( a.ticket_option_id ) === option.Masterclass
			)
		).toEqual( [
			expect.objectContaining( {
				status: 'confirmed',
				expires_at: null,
			} ),
		] );
		expect( current.option_count ).toBe( 1 );

		// The same add-on for the sibling is held, then lapses unpaid.
		const sibling = await addActivities( {
			ticket_option_ids: [ option.Masterclass ],
			ticket_id: ticketTwo,
		} );
		expect( sibling.body.status ).toBe( 'payment_required' );
		current = await state( { signupIds: [ holderSignupId ] } );
		expect(
			activitiesOf( ticketIn( current, ticketTwo ) ).find(
				( a ) => a.option === option.Masterclass
			)
		).toEqual( { option: option.Masterclass, status: 'pending_payment' } );

		await fixture( 'lapse-addon', { ticket_id: ticketTwo } );
		current = await state( {
			signupIds: [ holderSignupId ],
			optionId: option.Masterclass,
		} );
		expect(
			activitiesOf( ticketIn( current, ticketTwo ) ).map(
				( a ) => a.option
			)
		).not.toContain( option.Masterclass );
		expect(
			activitiesOf( ticketIn( current, ticketOne ) ).find(
				( a ) => a.option === option.Masterclass
			)
		).toEqual( { option: option.Masterclass, status: 'confirmed' } );
		expect( current.option_count ).toBe( 1 );
	} );

	// #1821 — an add-on whose checkout was abandoned, failed or expired is
	// not owned: it can be bought again, each attempt holds a single place,
	// and only a confirmed payment makes it a duplicate.
	test( 'an unpaid add-on can be bought on a later attempt after abandoning, failing or expiring', async () => {
		const countMasterclass = async () =>
			( await state( { optionId: option.Masterclass } ) ).option_count;
		const pendingOnTicketTwo = async () =>
			activitiesOf(
				ticketIn(
					await state( { signupIds: [ holderSignupId ] } ),
					ticketTwo
				)
			).find( ( a ) => a.option === option.Masterclass );
		const tryMasterclass = () =>
			addActivities( {
				ticket_option_ids: [ option.Masterclass ],
				ticket_id: ticketTwo,
			} );

		const baseline = await countMasterclass();

		const abandoned = await tryMasterclass();
		expect( abandoned.body.status ).toBe( 'payment_required' );
		expect( await countMasterclass() ).toBe( baseline + 1 );

		// Returning while the abandoned checkout's hold still runs starts a
		// new attempt on the same hold instead of a second place.
		const returned = await tryMasterclass();
		expect( returned.status, JSON.stringify( returned.body ) ).toBe( 200 );
		expect( returned.body.status ).toBe( 'payment_required' );
		expect( returned.body.transaction_id ).not.toBe(
			abandoned.body.transaction_id
		);
		expect( await countMasterclass() ).toBe( baseline + 1 );

		// A failed payment releases the hold; the add-on stays buyable.
		await fixture( 'fail-addon', {
			transaction_id: returned.body.transaction_id,
		} );
		expect( await pendingOnTicketTwo() ).toBeUndefined();
		expect( await countMasterclass() ).toBe( baseline );
		const afterFailure = await tryMasterclass();
		expect( afterFailure.body.status ).toBe( 'payment_required' );
		expect( await countMasterclass() ).toBe( baseline + 1 );

		// An expired hold, before the cleanup runs, does not block either.
		await fixture( 'expire-addon', { ticket_id: ticketTwo } );
		expect( await countMasterclass() ).toBe( baseline );
		const afterExpiry = await tryMasterclass();
		expect( afterExpiry.body.status ).toBe( 'payment_required' );
		expect( await pendingOnTicketTwo() ).toEqual( {
			option: option.Masterclass,
			status: 'pending_payment',
		} );
		expect( await countMasterclass() ).toBe( baseline + 1 );

		// The later attempt is paid and confirmed once, even when the
		// webhook repeats.
		await fixture( 'pay-addon', {
			transaction_id: afterExpiry.body.transaction_id,
		} );
		await fixture( 'pay-addon', {
			transaction_id: afterExpiry.body.transaction_id,
		} );
		expect( await pendingOnTicketTwo() ).toEqual( {
			option: option.Masterclass,
			status: 'confirmed',
		} );
		expect( await countMasterclass() ).toBe( baseline + 1 );

		// Only now is it a duplicate.
		const duplicate = await tryMasterclass();
		expect( duplicate.status ).toBe( 400 );
		expect( duplicate.body.code ).toBe( 'no_new_activities' );
	} );

	test( 'a returning buyer whose own hold fills the last place can start a new attempt', async () => {
		const extra = await createEvent(
			`Ticket activities last place ${ Date.now() }`,
			[ { name: 'Solo', price: 10, capacity: 1 } ]
		);
		extraEvents.push( extra );
		const solo = extra.options[ 0 ].id;

		const purchase = await buy(
			{
				event_date_id: extra.eventDateId,
				email: holderEmail,
				ticket_type_id: extra.typeId,
				quantity: 1,
			},
			adminHeaders
		);
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ extra.eventDateId }/participants`,
			{
				headers: adminHeaders,
				params: { event_date_id: extra.eventDateId },
			}
		);
		expect( listRes.ok() ).toBeTruthy();
		const item = ( await listRes.json() ).find(
			( p ) => p.participant_id === holderId
		);
		expect( item.tickets ).toHaveLength( 1 );

		const tryLastPlace = () =>
			addActivities( {
				event_id: extra.postId,
				event_date_id: extra.eventDateId,
				ticket_option_ids: [ solo ],
				ticket_id: item.tickets[ 0 ].id,
			} );

		const first = await tryLastPlace();
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		expect( first.body.status ).toBe( 'payment_required' );
		expect( ( await state( { optionId: solo } ) ).option_count ).toBe( 1 );

		const again = await tryLastPlace();
		expect( again.status, JSON.stringify( again.body ) ).toBe( 200 );
		expect( again.body.status ).toBe( 'payment_required' );
		expect( ( await state( { optionId: solo } ) ).option_count ).toBe( 1 );
	} );

	test( 'activities chosen with a purchase go to the created ticket and keep their price', async () => {
		const freeEmail = uniqueEmail( 'free-buyer' );
		const free = await buy( {
			email: freeEmail,
			ticket_type_id: typeId,
			ticket_option_ids: [ option.Morning ],
		} );
		expect( free.status, JSON.stringify( free.body ) ).toBe( 200 );
		expect( free.body.status ).toBe( 'confirmed' );

		const freeSignup = await signupOf( freeEmail );
		const freeState = await state( { signupIds: [ freeSignup.id ] } );
		expect( freeState.tickets ).toHaveLength( 1 );
		expect( activitiesOf( freeState.tickets[ 0 ] ) ).toEqual( [
			{ option: option.Morning, status: 'confirmed' },
		] );

		const freeParticipant = ( await participants() ).find(
			( p ) => p.participant_email === freeEmail
		);
		expect( freeParticipant.participant_ticket_option_ids ).toEqual( [] );
		expect( freeParticipant.ticket_option_ids ).toEqual( [
			option.Morning,
		] );
		expect(
			( await state( { eventParticipantId: freeParticipant.id } ) )
				.participant_options
		).toEqual( [] );

		// A priced activity is still charged as its own line.
		const paidEmail = uniqueEmail( 'paid-buyer' );
		const before = ( await state( { optionId: option.Masterclass } ) )
			.option_count;
		const paid = await buy( {
			email: paidEmail,
			ticket_type_id: typeId,
			ticket_option_ids: [ option.Masterclass ],
		} );
		expect( paid.status, JSON.stringify( paid.body ) ).toBe( 200 );
		expect( paid.body.status ).toBe( 'payment_required' );
		expect( Number( paid.body.amount ) ).toBe( 10 );

		const paidSignup = await signupOf( paidEmail );
		const paidState = await state( {
			signupIds: [ paidSignup.id ],
			optionId: option.Masterclass,
		} );
		expect( paidState.tickets[ 0 ].status ).toBe( 'pending_payment' );
		expect( activitiesOf( paidState.tickets[ 0 ] ) ).toEqual( [
			{ option: option.Masterclass, status: 'confirmed' },
		] );
		// The unpaid ticket holds its activity place while its payment is open.
		expect( paidState.option_count ).toBe( before + 1 );
	} );

	test( 'history is carried over only to an unambiguous ticket, idempotently', async () => {
		// A participant with exactly one ticket.
		const singleEmail = uniqueEmail( 'single' );
		expect(
			( await buy( { email: singleEmail, ticket_type_id: typeId } ) )
				.status
		).toBe( 200 );
		const singleSignup = await signupOf( singleEmail );
		const single = ( await participants() ).find(
			( p ) => p.participant_email === singleEmail
		);
		const holder = await participantItem( holderId );

		await fixture( 'history', {
			event_participant_id: single.id,
			option_ids: [ option.Legacy ],
			attended_at: '2035-11-01 10:05:00',
		} );
		await fixture( 'history', {
			event_participant_id: holder.id,
			option_ids: [ option.Legacy ],
			attended_at: '2035-11-01 10:10:00',
		} );
		const holderTicketsBefore = await state( {
			signupIds: [ holderSignupId ],
		} );

		await fixture( 'backfill' );

		// One ticket: carried over, and the originals kept as history.
		const singleState = await state( {
			signupIds: [ singleSignup.id ],
			eventParticipantId: single.id,
		} );
		expect( activitiesOf( singleState.tickets[ 0 ] ) ).toEqual( [
			{ option: option.Legacy, status: 'confirmed' },
		] );
		expect( singleState.tickets[ 0 ].attended_at ).toBe(
			'2035-11-01 10:05:00'
		);
		expect( singleState.participant_options ).toEqual( [
			{
				ticket_option_id: String( option.Legacy ),
				status: 'confirmed',
				ticket_id: String( singleState.tickets[ 0 ].id ),
			},
		] );
		expect( Number( singleState.relationship.attended_ticket_id ) ).toBe(
			Number( singleState.tickets[ 0 ].id )
		);
		const singleItem = await participantItem( single.participant_id );
		expect( singleItem.participant_ticket_option_ids ).toEqual( [] );
		expect( singleItem.attended_at ).toBeNull();
		expect( singleItem.tickets[ 0 ].attended_at ).toBe(
			'2035-11-01 10:05:00'
		);

		// Two tickets: nothing is guessed; the history stays participant-level.
		const holderState = await state( {
			signupIds: [ holderSignupId ],
			eventParticipantId: holder.id,
		} );
		for ( const ticket of holderState.tickets ) {
			const before = ticketIn( holderTicketsBefore, Number( ticket.id ) );
			expect( activitiesOf( ticket ) ).toEqual( activitiesOf( before ) );
			expect( ticket.attended_at ).toBe( before.attended_at );
		}
		expect(
			holderState.participant_options.find(
				( row ) => Number( row.ticket_option_id ) === option.Legacy
			).ticket_id
		).toBeNull();
		expect( holderState.relationship.attended_ticket_id ).toBeNull();
		const holderItem = await participantItem( holderId );
		expect( holderItem.participant_ticket_option_ids ).toEqual( [
			option.Legacy,
		] );
		expect( holderItem.attended_at ).toBe( '2035-11-01 10:10:00' );
		expect( holderItem.ticket_option_ids ).toContain( option.Legacy );

		// Running the backfill again changes nothing.
		await fixture( 'backfill' );
		const again = await state( {
			signupIds: [ singleSignup.id ],
			eventParticipantId: single.id,
		} );
		expect( again.tickets[ 0 ].activities ).toHaveLength( 1 );
		expect( again.tickets[ 0 ].attended_at ).toBe( '2035-11-01 10:05:00' );
		const holderAgain = await state( { eventParticipantId: holder.id } );
		expect( holderAgain.relationship.attended_ticket_id ).toBeNull();
	} );
} );
