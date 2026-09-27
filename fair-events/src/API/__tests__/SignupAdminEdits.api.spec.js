/**
 * Playwright API tests for administrator moves and ticket-type changes on
 * signups, with the capacity override (#1532).
 *
 * Signups are bought through the public get-tickets route (free tickets,
 * confirmed at once). Capacity counts, a signup's units, and a single unit's
 * status use the test-only fair-e2e/v1/ticket-capacity routes.
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
	`admin-edit-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Signup admin edits', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with its capacity and
	 * free ticket types.
	 *
	 * @param {Object}   options
	 * @param {?number}  options.capacity    Event capacity (per occurrence).
	 * @param {Object[]} options.ticketTypes { name, capacity, scope }.
	 * @param {string}   [options.rrule]     Recurrence rule for a series.
	 * @return {Promise<{eventDateId: number, occurrenceIds: number[], typeIds: number[]}>} Created IDs.
	 */
	async function createEvent( { capacity, ticketTypes, rrule } ) {
		const title = `Admin edit ${ Date.now() } ${ Math.random() }`;
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
						price: 0,
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

	// Each purchase is a separate visitor, so each gets its own participant.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Edit Buyer', _honeypot: '', quantity: 1, ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	}

	async function listSignups( eventDateId ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function signupOf( eventDateId, email ) {
		return ( await listSignups( eventDateId ) ).find(
			( row ) => row.email === email
		);
	}

	async function state( signupId ) {
		const res = await api.get(
			'/wp-json/fair-e2e/v1/ticket-capacity/signup',
			{ headers: adminHeaders, params: { signup_id: signupId } }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
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

	async function edit( signupId, data, headers = adminHeaders ) {
		const res = await api.put(
			`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
			{ headers, data }
		);
		return { status: res.status(), body: await res.json() };
	}

	async function audienceParticipantIds( eventDateId ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).map( ( row ) =>
			Number( row.participant_id )
		);
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			for ( const signup of await listSignups( dateId ) ) {
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

	test.describe( 'series', () => {
		let series;
		let first;
		let second;
		let third;
		let singleId;
		let otherSingleId;
		let multipleId;
		let wholeId;

		// A fresh series per test: deleting a signup leaves its fair-audience
		// relationship, which keeps counting as an admission without a signup.
		test.beforeEach( async () => {
			series = await createEvent( {
				capacity: 3,
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{ name: 'One date', scope: 'single_instance' },
					{
						name: 'One date, reduced',
						scope: 'single_instance',
						capacity: 2,
					},
					{ name: 'Pick dates', scope: 'multiple_instances' },
					{ name: 'Whole series', scope: 'whole_series' },
				],
			} );
			[ first, second, third ] = series.occurrenceIds;
			[ singleId, otherSingleId, multipleId, wholeId ] = series.typeIds;
		} );

		test( 'rejects anonymous and non-admin callers', async () => {
			const email = uniqueEmail( 'auth' );
			await buy( {
				event_date_id: first,
				ticket_type_id: singleId,
				email,
			} );
			const signup = await signupOf( first, email );

			const anonymous = await request.newContext( { baseURL: BASE_URL } );
			const anonRes = await anonymous.put(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
				{ data: { event_date_id: second } }
			);
			expect( anonRes.status() ).toBe( 401 );
			const anonTargets = await anonymous.get(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }/targets`
			);
			expect( anonTargets.status() ).toBe( 401 );
			await anonymous.dispose();

			const username = `admin-edit-subscriber-${ Date.now() }`;
			const password = 'Admin-edit-test-1532!';
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

			const forbidden = await edit(
				signup.id,
				{ event_date_id: second },
				basicAuth( username, password )
			);
			expect( forbidden.status ).toBe( 403 );

			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);

			expect( ( await state( signup.id ) ).signup.event_date_id ).toBe(
				String( first )
			);
		} );

		test( 'a move takes the signup, its tickets and the audience relationship along', async () => {
			const email = uniqueEmail( 'move' );
			await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email,
				quantity: 2,
			} );
			const signup = await signupOf( second, email );
			expect( signup.can_move ).toBe( true );
			expect( await audienceParticipantIds( second ) ).toContain(
				Number( signup.participant_id )
			);

			const before = await counts( {
				eventDateIds: [ second, third ],
			} );

			const targets = await api.get(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }/targets`,
				{ headers: adminHeaders }
			);
			const targetsBody = await targets.json();
			expect(
				targetsBody.event_dates.map( ( target ) => target.id )
			).toEqual( [ first, third ] );
			expect(
				targetsBody.ticket_types.map( ( target ) => target.id )
			).toEqual( [ otherSingleId ] );

			const moved = await edit( signup.id, { event_date_id: third } );
			expect( moved.status, JSON.stringify( moved.body ) ).toBe( 200 );
			expect( moved.body.over_capacity ).toBe( false );

			const { signup: row, tickets } = await state( signup.id );
			expect( row.event_date_id ).toBe( String( third ) );
			expect( tickets.map( ( t ) => t.event_date_id ) ).toEqual( [
				String( third ),
				String( third ),
			] );

			const after = await counts( { eventDateIds: [ second, third ] } );
			expect( after.event( second ) ).toBe( before.event( second ) - 2 );
			expect( after.event( third ) ).toBe( before.event( third ) + 2 );

			expect( await audienceParticipantIds( third ) ).toContain(
				Number( signup.participant_id )
			);
			expect( await audienceParticipantIds( second ) ).not.toContain(
				Number( signup.participant_id )
			);
		} );

		test( 'refuses targets outside the series, another scope, and whole-series moves', async () => {
			const email = uniqueEmail( 'invalid' );
			await buy( {
				event_date_id: first,
				ticket_type_id: singleId,
				email,
			} );
			const signup = await signupOf( first, email );

			const other = await createEvent( {
				capacity: null,
				ticketTypes: [ { name: 'Elsewhere' } ],
			} );

			const outside = await edit( signup.id, {
				event_date_id: other.eventDateId,
			} );
			expect( outside.status ).toBe( 400 );
			expect( outside.body.code ).toBe( 'rest_invalid_signup_target' );

			const foreignType = await edit( signup.id, {
				ticket_type_id: other.typeIds[ 0 ],
			} );
			expect( foreignType.status ).toBe( 400 );

			const otherScope = await edit( signup.id, {
				ticket_type_id: multipleId,
			} );
			expect( otherScope.status ).toBe( 400 );
			expect( otherScope.body.code ).toBe( 'rest_invalid_signup_target' );

			const both = await edit( signup.id, {
				event_date_id: second,
				ticket_type_id: otherSingleId,
			} );
			expect( both.status ).toBe( 400 );

			const wholeEmail = uniqueEmail( 'whole' );
			await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: wholeEmail,
			} );
			const whole = await signupOf( series.eventDateId, wholeEmail );
			expect( whole.can_move ).toBe( false );
			const wholeMove = await edit( whole.id, {
				event_date_id: second,
			} );
			expect( wholeMove.status ).toBe( 400 );
			expect( wholeMove.body.code ).toBe( 'signup_not_movable' );
		} );

		test( 'a full target needs a reason, which is audited and flags the signup', async () => {
			// Fill the first occurrence: 3 of 3.
			const fillerEmail = uniqueEmail( 'filler' );
			await buy( {
				event_date_id: first,
				ticket_type_id: singleId,
				email: fillerEmail,
				quantity: 3,
			} );

			const email = uniqueEmail( 'override' );
			await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email,
			} );
			const signup = await signupOf( second, email );

			const refused = await edit( signup.id, { event_date_id: first } );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.code ).toBe( 'capacity_exceeded' );
			expect( refused.body.data.projection ).toMatchObject( {
				scope: 'event_date',
				id: first,
				taken: 3,
				capacity: 3,
				after: 4,
			} );
			expect( refused.body.message ).toMatch(
				/ would have 4 of 3 places taken\.$/
			);
			expect( ( await state( signup.id ) ).signup.event_date_id ).toBe(
				String( second )
			);

			const empty = await edit( signup.id, {
				event_date_id: first,
				override_reason: '   ',
			} );
			expect( empty.status ).toBe( 400 );
			expect( empty.body.code ).toBe( 'override_reason_required' );

			const forced = await edit( signup.id, {
				event_date_id: first,
				override_reason: 'Friend of the organizer',
			} );
			expect( forced.status, JSON.stringify( forced.body ) ).toBe( 200 );
			expect( forced.body.over_capacity ).toBe( true );

			const listed = await signupOf( first, email );
			expect( listed.over_capacity ).toBe( true );
			expect( listed.overrides ).toHaveLength( 1 );
			expect( listed.overrides[ 0 ] ).toMatchObject( {
				action: 'move',
				reason: 'Friend of the organizer',
				user_display_name: expect.any( String ),
			} );
			expect(
				( await counts( { eventDateIds: [ first ] } ) ).event( first )
			).toBe( 4 );

			// Re-saving where it already is never counts it twice.
			const again = await edit( signup.id, { event_date_id: first } );
			expect( again.status ).toBe( 409 );
			expect( again.body.data.projection.taken ).toBe( 3 );
		} );

		test( 'places taken between preview and submit still require a reason', async () => {
			// Two of three places taken on the third occurrence.
			const earlyEmail = uniqueEmail( 'early' );
			await buy( {
				event_date_id: third,
				ticket_type_id: singleId,
				email: earlyEmail,
				quantity: 2,
			} );

			const email = uniqueEmail( 'race' );
			await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email,
			} );
			const signup = await signupOf( second, email );

			const preview = await (
				await api.get(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }/targets`,
					{ headers: adminHeaders }
				)
			).json();
			expect(
				preview.event_dates.find( ( target ) => target.id === third )
					.remaining
			).toBe( 1 );

			// Someone buys the last place before the administrator submits.
			const lateEmail = uniqueEmail( 'late' );
			await buy( {
				event_date_id: third,
				ticket_type_id: singleId,
				email: lateEmail,
			} );

			const refused = await edit( signup.id, { event_date_id: third } );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.data.projection.after ).toBe( 4 );
		} );

		test( 'a cancelled ticket stays behind on a move', async () => {
			const email = uniqueEmail( 'partial' );
			await buy( {
				event_date_id: first,
				ticket_type_id: singleId,
				email,
				quantity: 3,
			} );
			const signup = await signupOf( first, email );

			await api.post(
				'/wp-json/fair-e2e/v1/ticket-capacity/unit-status',
				{
					headers: adminHeaders,
					data: {
						signup_id: signup.id,
						position: 2,
						status: 'cancelled',
					},
				}
			);

			const moved = await edit( signup.id, { event_date_id: second } );
			expect( moved.status, JSON.stringify( moved.body ) ).toBe( 200 );
			expect( moved.body.projection.after ).toBe( 2 );

			const { tickets } = await state( signup.id );
			expect(
				tickets.map( ( t ) => [ t.status, t.event_date_id ] )
			).toEqual( [
				[ 'confirmed', String( second ) ],
				[ 'cancelled', String( first ) ],
				[ 'confirmed', String( second ) ],
			] );

			const c = await counts( { eventDateIds: [ first, second ] } );
			expect( c.event( first ) ).toBe( 0 );
			expect( c.event( second ) ).toBe( 2 );
		} );

		test( 'a type change moves the tickets to the new type and its capacity', async () => {
			// The reduced type has room for 2; one is sold.
			const takenEmail = uniqueEmail( 'reduced' );
			await buy( {
				event_date_id: first,
				ticket_type_id: otherSingleId,
				email: takenEmail,
			} );

			const email = uniqueEmail( 'retype' );
			await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email,
				quantity: 2,
			} );
			const signup = await signupOf( second, email );
			const types = { ticketTypeIds: [ singleId, otherSingleId ] };
			const before = await counts( types );

			const refused = await edit( signup.id, {
				ticket_type_id: otherSingleId,
			} );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.data.projection ).toMatchObject( {
				scope: 'ticket_type',
				id: otherSingleId,
				label: 'One date, reduced',
				taken: 1,
				capacity: 2,
				after: 3,
			} );

			const changed = await edit( signup.id, {
				ticket_type_id: otherSingleId,
				override_reason: 'Upgrade promised',
			} );
			expect( changed.status, JSON.stringify( changed.body ) ).toBe(
				200
			);

			const { signup: row, tickets } = await state( signup.id );
			expect( row.ticket_type_id ).toBe( String( otherSingleId ) );
			expect( row.event_date_id ).toBe( String( second ) );
			expect( tickets.map( ( t ) => t.ticket_type_id ) ).toEqual( [
				String( otherSingleId ),
				String( otherSingleId ),
			] );

			const after = await counts( types );
			expect( after.type( singleId ) ).toBe(
				before.type( singleId ) - 2
			);
			expect( after.type( otherSingleId ) ).toBe(
				before.type( otherSingleId ) + 2
			);

			const listed = await signupOf( second, email );
			expect( listed.ticket_type_name ).toBe( 'One date, reduced' );
			expect( listed.overrides[ 0 ] ).toMatchObject( {
				action: 'change_type',
				reason: 'Upgrade promised',
			} );
		} );
	} );
} );
