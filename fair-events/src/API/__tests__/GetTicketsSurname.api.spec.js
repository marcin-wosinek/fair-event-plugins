/**
 * Playwright API tests for a registrant's separate name and surname (#2215).
 *
 * The public get-tickets route stores an optional surname apart from the
 * name; older clients that send only a name keep working. The organizer's
 * list returns both components and the complete name, and the signup edit
 * route changes them: an omitted surname keeps the stored one, an empty one
 * clears it. The surname is part of what an idempotency key stands for.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const GET_TICKETS = '/wp-json/fair-events/v1/get-tickets';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const uniqueEmail = ( label ) =>
	`surname-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Separate name and surname (#2215)', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a published, post-linked free event, optionally a series with
	 * a ticket type for several occurrences.
	 *
	 * @param {Object}  options
	 * @param {string}  [options.rrule] Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds.
	 */
	async function createEvent( { rrule } = {} ) {
		const title = `Surname ${ Date.now() } ${ Math.random() }`;
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
				start_date: '2035-11-01',
				start_time: '10:00:00',
				end_date: '2035-11-01',
				end_time: '12:00:00',
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

		let typeIds = [];
		if ( rrule ) {
			const ticketsRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
				{
					headers: adminHeaders,
					data: {
						capacity: null,
						ticket_types: [
							{
								name: 'Pick dates',
								capacity: null,
								minimum_activities: 0,
								disable_at: null,
								recurrence_scope: 'multiple_instances',
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
						options: [],
						settings: {},
					},
				}
			);
			const ticketsBody = await ticketsRes.json();
			expect(
				ticketsRes.ok(),
				JSON.stringify( ticketsBody )
			).toBeTruthy();
			typeIds = ticketsBody.ticket_types.map( ( type ) => type.id );
		}

		return { eventDateId, occurrenceIds, typeIds };
	}

	/**
	 * Submit the public form's request from a browser of its own.
	 *
	 * @param {Object} data Request payload.
	 * @return {Promise<{status: number, body: Object}>} Response.
	 */
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await visitor.post( GET_TICKETS, {
				data: { _honeypot: '', quantity: 1, ...data },
			} );
			return { status: res.status(), body: await res.json() };
		} finally {
			await visitor.dispose();
		}
	}

	async function list( eventDateId ) {
		const res = await api.get( GET_TICKETS, {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	async function listed( eventDateId, email ) {
		return ( await list( eventDateId ) ).find(
			( signup ) => signup.email === email
		);
	}

	async function edit( signupId, data, headers = adminHeaders ) {
		const res = await api.put( `${ GET_TICKETS }/${ signupId }`, {
			headers,
			data,
		} );
		return { status: res.status(), body: await res.json() };
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			for ( const signup of await list( dateId ).catch( () => [] ) ) {
				await api.delete( `${ GET_TICKETS }/${ signup.id }`, {
					headers: adminHeaders,
				} );
			}
		}
		for ( const postId of createdPostIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'stores a compound, accented name and surname apart and lists the complete name', async () => {
		const { eventDateId } = await createEvent();
		const email = uniqueEmail( 'compound' );

		const res = await buy( {
			event_date_id: eventDateId,
			name: 'María José',
			surname: 'García de la Vega',
			email,
		} );
		expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );

		const signup = await listed( eventDateId, email );
		expect( signup ).toMatchObject( {
			name: 'María José',
			surname: 'García de la Vega',
			full_name: 'María José García de la Vega',
		} );
		expect( signup.tickets[ 0 ].purchaser.name ).toBe(
			'María José García de la Vega'
		);
	} );

	test( 'a name-only client and a registrant without a surname keep working', async () => {
		const { eventDateId } = await createEvent();
		const legacyEmail = uniqueEmail( 'legacy' );
		const emptyEmail = uniqueEmail( 'empty' );

		const legacy = await buy( {
			event_date_id: eventDateId,
			name: 'Ana María López',
			email: legacyEmail,
		} );
		expect( legacy.status, JSON.stringify( legacy.body ) ).toBe( 200 );
		const empty = await buy( {
			event_date_id: eventDateId,
			name: '李小龙',
			surname: '   ',
			email: emptyEmail,
		} );
		expect( empty.status, JSON.stringify( empty.body ) ).toBe( 200 );

		expect( await listed( eventDateId, legacyEmail ) ).toMatchObject( {
			name: 'Ana María López',
			surname: '',
			full_name: 'Ana María López',
		} );
		expect( await listed( eventDateId, emptyEmail ) ).toMatchObject( {
			name: '李小龙',
			surname: '',
			full_name: '李小龙',
		} );
	} );

	test( 'every occurrence of a multiple-dates purchase keeps the surname', async () => {
		const { eventDateId, occurrenceIds, typeIds } = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const email = uniqueEmail( 'multi' );
		const chosen = occurrenceIds.slice( 0, 2 );

		const res = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeIds[ 0 ],
			event_date_ids: chosen,
			name: 'Zoë',
			surname: 'Álvarez',
			email,
		} );
		expect( res.status, JSON.stringify( res.body ) ).toBe( 200 );

		for ( const dateId of chosen ) {
			expect( await listed( dateId, email ) ).toMatchObject( {
				name: 'Zoë',
				surname: 'Álvarez',
				full_name: 'Zoë Álvarez',
			} );
		}
	} );

	test( 'the surname is part of what an idempotency key stands for', async () => {
		const { eventDateId } = await createEvent();
		const email = uniqueEmail( 'key' );
		const purchase = {
			event_date_id: eventDateId,
			name: 'Ana',
			surname: 'López',
			email,
			idempotency_key: randomUUID(),
		};

		const first = await buy( purchase );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );

		const again = await buy( purchase );
		expect( again.status, JSON.stringify( again.body ) ).toBe( 200 );
		expect( again.body ).toEqual( first.body );

		const changed = await buy( { ...purchase, surname: 'Lopes' } );
		expect( changed.status ).toBe( 409 );
		expect( changed.body.code ).toBe( 'idempotency_key_reused' );

		// A name-only purchase replays as before.
		const legacy = {
			event_date_id: eventDateId,
			name: 'Prince',
			email: uniqueEmail( 'key-legacy' ),
			idempotency_key: randomUUID(),
		};
		const legacyFirst = await buy( legacy );
		expect( legacyFirst.status ).toBe( 200 );
		const legacyAgain = await buy( { ...legacy, surname: '' } );
		expect( legacyAgain.status ).toBe( 200 );
		expect( legacyAgain.body ).toEqual( legacyFirst.body );

		const signups = await list( eventDateId );
		expect(
			signups.filter( ( signup ) => signup.email === email )
		).toHaveLength( 1 );
	} );

	test( 'an organizer edits the name and surname separately', async () => {
		const { eventDateId } = await createEvent();
		const email = uniqueEmail( 'edit' );
		await buy( {
			event_date_id: eventDateId,
			name: 'Ana María López',
			email,
		} );
		const { id } = await listed( eventDateId, email );

		const split = await edit( id, {
			name: 'Ana María',
			surname: 'López',
		} );
		expect( split.status, JSON.stringify( split.body ) ).toBe( 200 );
		expect( split.body ).toEqual( {
			id: Number( id ),
			name: 'Ana María',
			surname: 'López',
			full_name: 'Ana María López',
		} );

		// An omitted surname keeps the stored one.
		const renamed = await edit( id, { name: 'Anna María' } );
		expect( renamed.body.full_name ).toBe( 'Anna María López' );

		// An empty surname clears it.
		const cleared = await edit( id, { name: 'Prince', surname: '' } );
		expect( cleared.body ).toMatchObject( {
			name: 'Prince',
			surname: '',
			full_name: 'Prince',
		} );
		expect( await listed( eventDateId, email ) ).toMatchObject( {
			name: 'Prince',
			surname: '',
			full_name: 'Prince',
		} );
	} );

	test( 'a name edit needs a name, stands alone and is for organizers only', async () => {
		const { eventDateId } = await createEvent();
		const email = uniqueEmail( 'edit-guard' );
		await buy( {
			event_date_id: eventDateId,
			name: 'Ada',
			surname: 'Lovelace',
			email,
		} );
		const { id } = await listed( eventDateId, email );

		const blank = await edit( id, { name: '  ', surname: 'Byron' } );
		expect( blank.status ).toBe( 400 );
		expect( blank.body.code ).toBe( 'rest_signup_name_required' );

		const combined = await edit( id, {
			name: 'Ada',
			event_date_id: eventDateId,
		} );
		expect( combined.status ).toBe( 400 );
		expect( combined.body.code ).toBe( 'rest_invalid_signup_edit' );

		const anonymous = await edit( id, { name: 'Mallory' }, {} );
		expect( [ 401, 403 ] ).toContain( anonymous.status );

		const missing = await edit( 999999999, { name: 'Nobody' } );
		expect( missing.status ).toBe( 404 );

		expect( await listed( eventDateId, email ) ).toMatchObject( {
			name: 'Ada',
			surname: 'Lovelace',
		} );
	} );
} );
