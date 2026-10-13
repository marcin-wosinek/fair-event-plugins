/**
 * Playwright API tests for removing a participant from one event date
 * (#1820):
 *
 *   DELETE fair-audience/v1/event-dates/{event_date_id}/participants/{participant_id}
 *   DELETE fair-audience/v1/event-dates/{event_date_id}/participants/batch
 *
 * Covers permissions, a missing event date or relationship, an eligible
 * removal and what it keeps, the refusals for a registration, a held, a
 * cancelled and a given-away ticket and a payment in progress, eligibility
 * that changed after the list was read, a failed write rolling back, and the
 * batch route applying the same guard.
 *
 * Stored rows, registrations awaiting payment and the failed write use the
 * test-only fair-e2e/v1/participant-removal routes.
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
	`remove-participant-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Remove a participant from an event date (#1820)', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];
	const createdParticipantIds = [];

	/**
	 * Create a post-linked event with one free ticket type and its
	 * activities.
	 *
	 * @param {Object[]} [options] Activities: { name, price, capacity }.
	 * @return {Promise<Object>} eventDateId, typeId, optionIds.
	 */
	async function createEvent( options = [] ) {
		const title = `Remove participant ${ Date.now() } ${ Math.random() }`;
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
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;
		createdEventDateIds.push( eventDateId );

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

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
					options,
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			eventDateId,
			typeId: ticketsBody.ticket_types[ 0 ].id,
			optionIds: ( ticketsBody.options || [] ).map( ( o ) => o.id ),
		};
	}

	// A participant added to event dates by hand, with no purchase.
	async function addByHand( eventDateIds, label = 'interested' ) {
		const email = uniqueEmail( 'hand' );
		const res = await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'Hand', surname: 'Added', email },
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		createdParticipantIds.push( body.id );

		for ( const eventDateId of eventDateIds ) {
			const added = await api.post( participantsUrl( eventDateId ), {
				headers: adminHeaders,
				data: { participant_id: body.id, label },
			} );
			expect( added.ok(), await added.text() ).toBeTruthy();
		}

		return { participantId: body.id, email };
	}

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function purchase( event, quantity = 1 ) {
		const email = uniqueEmail( 'buyer' );
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				name: 'Removal Buyer',
				_honeypot: '',
				event_date_id: event.eventDateId,
				ticket_type_id: event.typeId,
				quantity,
				email,
			},
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );

		const row = await audienceRow( event.eventDateId, email );
		expect( row, `audience row of ${ email }` ).toBeTruthy();
		const listRes = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: event.eventDateId },
		} );
		const signup = ( await listRes.json() ).find(
			( s ) => s.email === email
		);

		return {
			email,
			participantId: row.participant_id,
			signupId: signup.id,
			ticketIds: signup.tickets.map( ( ticket ) => ticket.id ),
		};
	}

	const participantsUrl = ( eventDateId, participantId = '' ) =>
		`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants${
			participantId ? `/${ participantId }` : ''
		}`;

	const ticketUrl = ( eventDateId, ticketId, action = '' ) =>
		`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }${ action }`;

	async function remove(
		eventDateId,
		participantId,
		headers = adminHeaders
	) {
		const res = await api.delete(
			participantsUrl( eventDateId, participantId ),
			{ headers }
		);
		return {
			status: res.status(),
			body: await res.json().catch( () => null ),
		};
	}

	// The Audience tab's row of the participant with the given email.
	async function audienceRow( eventDateId, email ) {
		const res = await api.get( participantsUrl( eventDateId ), {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find(
			( row ) => row.participant_email === email
		);
	}

	const blockerCodes = async ( eventDateId, email ) =>
		( await audienceRow( eventDateId, email ) ).removal_blockers.map(
			( blocker ) => blocker.code
		);

	async function records( eventParticipantId, participantId ) {
		const res = await api.get(
			'/wp-json/fair-e2e/v1/participant-removal/records',
			{
				headers: adminHeaders,
				params: {
					event_participant_id: eventParticipantId,
					participant_id: participantId,
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function fixture( path, data ) {
		const res = await api.post(
			`/wp-json/fair-e2e/v1/participant-removal/${ path }`,
			{ headers: adminHeaders, data }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	async function ticketAction( method, eventDateId, ticketId, action, data ) {
		const res = await api[ method ](
			ticketUrl( eventDateId, ticketId, action ),
			{ headers: adminHeaders, data }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.post( '/wp-json/fair-e2e/v1/participant-removal/fail', {
			headers: adminHeaders,
			data: { enabled: false },
		} );
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
		for ( const participantId of createdParticipantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: adminHeaders }
			);
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

	test( 'requires an administrator, an event date and a relationship', async () => {
		const event = await createEvent();
		const other = await createEvent();
		const { participantId, email } = await addByHand( [
			event.eventDateId,
		] );

		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		expect(
			(
				await anonymous.delete(
					participantsUrl( event.eventDateId, participantId )
				)
			).status()
		).toBe( 401 );
		await anonymous.dispose();

		const username = `remove-participant-subscriber-${ Date.now() }`;
		const password = 'Remove-participant-test-1820!';
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
		expect(
			(
				await remove(
					event.eventDateId,
					participantId,
					basicAuth( username, password )
				)
			).status
		).toBe( 403 );
		await api.delete(
			`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);

		const missingDate = await remove( 999999999, participantId );
		expect( missingDate.status ).toBe( 404 );
		expect( missingDate.body.code ).toBe( 'invalid_event_date' );

		// In the audience of one date, not of the other.
		const missingRelationship = await remove(
			other.eventDateId,
			participantId
		);
		expect( missingRelationship.status ).toBe( 404 );
		expect( missingRelationship.body.code ).toBe( 'not_found' );

		// None of the refused requests removed anything.
		expect( await audienceRow( event.eventDateId, email ) ).toBeTruthy();
	} );

	test( 'removes the relationship and its activities, and nothing else', async () => {
		const event = await createEvent( [
			{ name: 'Workshop', price: 0, capacity: null },
		] );
		const other = await createEvent();
		const { participantId, email } = await addByHand(
			[ event.eventDateId, other.eventDateId ],
			'signed_up'
		);

		// An activity recorded for the participant on this date.
		const edited = await api.put(
			participantsUrl( event.eventDateId, participantId ),
			{
				headers: adminHeaders,
				data: { ticket_option_ids: [ event.optionIds[ 0 ] ] },
			}
		);
		expect( edited.ok(), await edited.text() ).toBeTruthy();

		const row = await audienceRow( event.eventDateId, email );
		expect( row.removal_blockers ).toEqual( [] );
		expect( await records( row.id, participantId ) ).toMatchObject( {
			relationship: 1,
			activities: 1,
			relationships: 2,
			participant: 1,
		} );

		const removed = await remove( event.eventDateId, participantId );
		expect( removed.status, JSON.stringify( removed.body ) ).toBe( 200 );
		expect( removed.body.removed ).toBe( true );

		expect( await audienceRow( event.eventDateId, email ) ).toBeUndefined();
		// The activity went with the relationship; the profile and the
		// participant's other date stayed.
		expect( await records( row.id, participantId ) ).toMatchObject( {
			relationship: 0,
			activities: 0,
			relationships: 1,
			participant: 1,
		} );
		expect( await audienceRow( other.eventDateId, email ) ).toBeTruthy();

		// Nothing is left to remove a second time.
		expect(
			( await remove( event.eventDateId, participantId ) ).status
		).toBe( 404 );
	} );

	test( 'refuses while a registration stands, and removes once it is deleted', async () => {
		const event = await createEvent();
		const buyer = await purchase( event );
		const row = await audienceRow( event.eventDateId, buyer.email );

		expect( await blockerCodes( event.eventDateId, buyer.email ) ).toEqual(
			[ 'registration' ]
		);

		const refused = await remove( event.eventDateId, buyer.participantId );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'removal_blocked' );
		expect( refused.body.message ).toContain( 'List tab' );
		expect(
			refused.body.data.blockers.map( ( blocker ) => blocker.code )
		).toEqual( [ 'registration' ] );

		// Nothing was cancelled, deleted or removed.
		expect( await records( row.id, buyer.participantId ) ).toMatchObject( {
			relationship: 1,
			signups: 1,
			tickets: 1,
		} );

		// The organizer deletes the registration on the List tab.
		const deleted = await api.delete(
			`/wp-json/fair-events/v1/get-tickets/${ buyer.signupId }`,
			{ headers: adminHeaders }
		);
		expect( deleted.ok() ).toBeTruthy();
		expect( await blockerCodes( event.eventDateId, buyer.email ) ).toEqual(
			[]
		);

		expect(
			( await remove( event.eventDateId, buyer.participantId ) ).status
		).toBe( 200 );
		expect( await records( row.id, buyer.participantId ) ).toMatchObject( {
			relationship: 0,
			participant: 1,
		} );
	} );

	test( 'refuses for a ticket someone was given, until it is cancelled and deleted', async () => {
		const event = await createEvent();
		const buyer = await purchase( event, 2 );
		const companion = await addByHand( [] );
		const [ , givenTicketId ] = buyer.ticketIds;

		await ticketAction(
			'post',
			event.eventDateId,
			givenTicketId,
			'/assign',
			{ participant_id: companion.participantId }
		);

		// The companion holds a ticket the buyer's registration owns.
		expect(
			await blockerCodes( event.eventDateId, companion.email )
		).toEqual( [ 'tickets' ] );
		const holding = await remove(
			event.eventDateId,
			companion.participantId
		);
		expect( holding.status ).toBe( 409 );
		expect( holding.body.message ).toContain( 'holds 1 ticket' );

		await ticketAction(
			'post',
			event.eventDateId,
			givenTicketId,
			'/cancel'
		);
		expect(
			await blockerCodes( event.eventDateId, companion.email )
		).toEqual( [ 'cancelled_tickets' ] );
		expect(
			( await remove( event.eventDateId, companion.participantId ) )
				.status
		).toBe( 409 );

		await ticketAction( 'delete', event.eventDateId, givenTicketId, '' );
		expect(
			await blockerCodes( event.eventDateId, companion.email )
		).toEqual( [] );
		expect(
			( await remove( event.eventDateId, companion.participantId ) )
				.status
		).toBe( 200 );

		// The buyer, their registration and their own ticket are untouched.
		expect( await blockerCodes( event.eventDateId, buyer.email ) ).toEqual(
			[ 'registration' ]
		);
	} );

	test( 'refuses a purchaser whose only ticket someone else holds', async () => {
		const event = await createEvent();
		const buyer = await purchase( event );
		const companion = await addByHand( [] );

		await ticketAction(
			'post',
			event.eventDateId,
			buyer.ticketIds[ 0 ],
			'/assign',
			{ participant_id: companion.participantId }
		);

		// The buyer holds nothing, but the registration is still theirs.
		const row = await audienceRow( event.eventDateId, buyer.email );
		expect( row.tickets ).toEqual( [] );
		expect( row.removal_blockers.map( ( b ) => b.code ) ).toEqual( [
			'registration',
		] );

		const refused = await remove( event.eventDateId, buyer.participantId );
		expect( refused.status ).toBe( 409 );
		expect(
			await audienceRow( event.eventDateId, buyer.email )
		).toBeTruthy();
		// The companion's ticket still admits them.
		expect(
			( await audienceRow( event.eventDateId, companion.email ) ).tickets
		).toHaveLength( 1 );
	} );

	test( 'checks again when the removal is requested', async () => {
		const event = await createEvent();
		const { participantId, email } = await addByHand( [
			event.eventDateId,
		] );

		// A purchase whose payment hold ran out binds nothing.
		await fixture( 'pending-signup', {
			event_date_id: event.eventDateId,
			participant_id: participantId,
			email,
			expires_in: -60,
		} );
		expect( await blockerCodes( event.eventDateId, email ) ).toEqual( [] );

		// The list was read; then a purchase started.
		await fixture( 'pending-signup', {
			event_date_id: event.eventDateId,
			participant_id: participantId,
			email,
			expires_in: 600,
		} );

		const refused = await remove( event.eventDateId, participantId );
		expect( refused.status ).toBe( 409 );
		expect(
			refused.body.data.blockers.map( ( blocker ) => blocker.code )
		).toEqual( [ 'payment_in_progress' ] );
		expect( await audienceRow( event.eventDateId, email ) ).toBeTruthy();
	} );

	test( 'rolls back when a write fails', async () => {
		const event = await createEvent( [
			{ name: 'Workshop', price: 0, capacity: null },
		] );
		const { participantId, email } = await addByHand(
			[ event.eventDateId ],
			'signed_up'
		);
		await api.put( participantsUrl( event.eventDateId, participantId ), {
			headers: adminHeaders,
			data: { ticket_option_ids: [ event.optionIds[ 0 ] ] },
		} );
		const row = await audienceRow( event.eventDateId, email );

		await fixture( 'fail', { enabled: true } );
		try {
			expect(
				( await remove( event.eventDateId, participantId ) ).status
			).toBe( 500 );
		} finally {
			await fixture( 'fail', { enabled: false } );
		}

		// Neither the relationship nor its activity was removed.
		expect( await records( row.id, participantId ) ).toMatchObject( {
			relationship: 1,
			activities: 1,
		} );
		expect(
			( await audienceRow( event.eventDateId, email ) ).ticket_option_ids
		).toEqual( [ event.optionIds[ 0 ] ] );

		// The removal can be tried again.
		expect(
			( await remove( event.eventDateId, participantId ) ).status
		).toBe( 200 );
		expect( await records( row.id, participantId ) ).toMatchObject( {
			relationship: 0,
			activities: 0,
		} );
	} );

	test( 'guards the batch route the same way', async () => {
		const event = await createEvent();
		const buyer = await purchase( event );
		const byHand = await addByHand( [ event.eventDateId ] );

		const res = await api.delete(
			`${ participantsUrl( event.eventDateId ) }/batch`,
			{
				headers: adminHeaders,
				data: {
					participant_ids: [
						byHand.participantId,
						buyer.participantId,
					],
				},
			}
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.removed ).toBe( 1 );
		expect( body.failed ).toBe( 1 );
		expect( body.errors[ 0 ] ).toContain( 'List tab' );
		// Who was kept and why, for the removal popup (#1775).
		expect( body.failures ).toHaveLength( 1 );
		expect( body.failures[ 0 ] ).toMatchObject( {
			participant_id: buyer.participantId,
			code: 'removal_blocked',
		} );
		expect( body.failures[ 0 ].message ).toContain( 'List tab' );
		expect(
			body.failures[ 0 ].blockers.map( ( blocker ) => blocker.code )
		).toContain( 'registration' );

		expect(
			await audienceRow( event.eventDateId, byHand.email )
		).toBeUndefined();
		expect(
			await audienceRow( event.eventDateId, buyer.email )
		).toBeTruthy();
	} );
} );
