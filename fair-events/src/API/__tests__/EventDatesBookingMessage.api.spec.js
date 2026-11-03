/**
 * Playwright API tests for the booking confirmation message (#2126):
 * GET/PUT /fair-events/v1/event-dates/{id}/booking-message, and the message
 * reaching (or not reaching) the buyer's confirmation email.
 *
 * Bookable events are linked to a post: with Fair Audience active (as in
 * this environment) it sends the confirmation, and only for linked events.
 *
 * Purchases go through the public fair-events/v1/get-tickets route; payment
 * outcomes are driven through the test-only fair-e2e/v1/ticket-capacity
 * routes, and mail is read back from fair-e2e/v1/captured-mail (both in
 * e2e/mu-plugins).
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const GET_TICKETS = '/wp-json/fair-events/v1/get-tickets';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const messagePath = ( id ) =>
	`/wp-json/fair-events/v1/event-dates/${ id }/booking-message`;

const uniqueEmail = ( label ) =>
	`booking-message-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Booking confirmation message', () => {
	let api;
	const postIds = [];
	const eventDateIds = [];
	const userIds = [];
	let subscriberHeaders;
	let authorHeaders;

	const createUser = async ( role ) => {
		const login = `booking-msg-${ role }-${ Date.now() }`;
		const password = 'Test-password-2126!';
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password,
				roles: [ role ],
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		userIds.push( ( await res.json() ).id );
		return basic( login, password );
	};

	/**
	 * Create an event date, optionally linked to an admin-owned post, a
	 * series, or bookable with one ticket type at the given price.
	 *
	 * @param {Object}  options
	 * @param {boolean} [options.linked] Link to a new fair_event post.
	 * @param {string}  [options.rrule]  Recurrence rule for a series.
	 * @param {?number} [options.price]  Ticket price; null for no tickets.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeId.
	 */
	const createEvent = async ( {
		linked = false,
		rrule,
		price = null,
	} = {} ) => {
		const title = `Booking message ${ Date.now() } ${ Math.random() }`;
		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				start_date: '2035-10-01',
				start_time: '10:00:00',
				end_date: '2035-10-01',
				end_time: '12:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;
		const occurrenceIds = ( edBody.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( eventDateId, ...occurrenceIds );

		if ( linked ) {
			const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
				headers: adminHeaders,
				data: { title, status: 'publish' },
			} );
			expect( postRes.ok() ).toBeTruthy();
			const postId = ( await postRes.json() ).id;
			postIds.push( postId );
			const linkRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{
					headers: adminHeaders,
					data: { event_id: postId, link_type: 'post' },
				}
			);
			expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();
		}

		let typeId = null;
		if ( price !== null ) {
			const ticketsRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
				{
					headers: adminHeaders,
					data: {
						capacity: null,
						ticket_types: [
							{
								name: 'Entry',
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
								price,
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
			typeId = ticketsBody.ticket_types[ 0 ].id;
		}

		return { eventDateId, occurrenceIds, typeId };
	};

	const saveMessage = async ( id, message, headers = adminHeaders ) =>
		api.put( messagePath( id ), { headers, data: { message } } );

	const book = async ( eventDateId, typeId, email ) => {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( GET_TICKETS, {
			data: {
				name: 'Message Buyer',
				_honeypot: '',
				email,
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				quantity: 1,
				idempotency_key: randomUUID(),
			},
		} );
		const text = await res.text();
		await visitor.dispose();
		expect( res.ok(), text ).toBeTruthy();
		return JSON.parse( text );
	};

	const mailTo = async ( email ) => {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/captured-mail?to=${ encodeURIComponent(
				email
			) }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const signupIdFor = async ( eventDateId ) => {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/checkout-keys?event_date_ids[]=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.signups ).toHaveLength( 1 );
		return body.signups[ 0 ].id;
	};

	// Two paragraphs and a link, as the classic editor saves them.
	const RICH_MESSAGE =
		'<p>Doors open at 9.</p>\n<p>Find us at the <a href="https://example.com/venue">venue</a>.</p>';

	const occurrences = ( body, needle ) => body.split( needle ).length - 1;

	/**
	 * Captured mails to `email` that carry `needle`, with how many times
	 * each carries it.
	 *
	 * @param {string} email  Recipient.
	 * @param {string} needle Saved message HTML.
	 * @return {Promise<number[]>} Per-mail occurrence counts.
	 */
	const messageCounts = async ( email, needle ) =>
		( await mailTo( email ) )
			.map( ( mail ) => occurrences( mail.body, needle ) )
			.filter( ( count ) => count > 0 );

	const fixture = async ( path, data ) => {
		const res = await api.post( `/wp-json/fair-e2e/v1/${ path }`, {
			headers: adminHeaders,
			data,
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		subscriberHeaders = await createUser( 'subscriber' );
		authorHeaders = await createUser( 'author' );
	} );

	test.afterAll( async () => {
		for ( const id of eventDateIds ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of userIds ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'saves, reloads and clears a message scoped to its event', async () => {
		const { eventDateId } = await createEvent();
		const { eventDateId: otherId } = await createEvent();

		const fresh = await api.get( messagePath( eventDateId ), {
			headers: adminHeaders,
		} );
		expect( fresh.ok() ).toBeTruthy();
		expect( await fresh.json() ).toEqual( {
			message: '',
			series_event_date_id: null,
		} );

		const message =
			'<p>Bring <strong>shoes</strong>. <a href="https://example.com/map">Map</a></p>';
		const saveRes = await saveMessage( eventDateId, message );
		expect( saveRes.ok(), await saveRes.text() ).toBeTruthy();
		expect( ( await saveRes.json() ).message ).toBe( message );

		const reloaded = await api.get( messagePath( eventDateId ), {
			headers: adminHeaders,
		} );
		expect( ( await reloaded.json() ).message ).toBe( message );

		const other = await api.get( messagePath( otherId ), {
			headers: adminHeaders,
		} );
		expect( ( await other.json() ).message ).toBe( '' );

		// Not part of the event date responses.
		const eventDate = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( JSON.stringify( await eventDate.json() ) ).not.toContain(
			'Bring'
		);

		const cleared = await saveMessage( eventDateId, '<p>&nbsp;</p>' );
		expect( ( await cleared.json() ).message ).toBe( '' );
		const afterClear = await api.get( messagePath( eventDateId ), {
			headers: adminHeaders,
		} );
		expect( ( await afterClear.json() ).message ).toBe( '' );
	} );

	test( 'strips unsafe markup and link protocols', async () => {
		const { eventDateId } = await createEvent();

		const res = await saveMessage(
			eventDateId,
			'<p onclick="evil()" style="color:red">Hi <a href="javascript:alert(1)">bad</a> <a href="mailto:info@example.com" onmouseover="x()">mail</a></p><script>alert(2)</script><img src="x" onerror="alert(3)"><p>[gallery]</p>'
		);
		expect( res.ok() ).toBeTruthy();
		const { message } = await res.json();

		expect( message ).not.toMatch(
			/script|onclick|onerror|onmouseover|javascript:|style=|<img|alert\(2\)/
		);
		expect( message ).toContain(
			'<a href="mailto:info@example.com">mail</a>'
		);
		// Shortcodes stay literal text.
		expect( message ).toContain( '<p>[gallery]</p>' );
	} );

	test( 'answers 404 for a missing event date', async () => {
		const res = await api.get( messagePath( 999999999 ), {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 404 );
	} );

	test( 'rejects users who cannot edit the event', async () => {
		const { eventDateId: linkedId } = await createEvent( { linked: true } );
		const { eventDateId: unlinkedId } = await createEvent();

		const anonymous = await api.get( messagePath( linkedId ) );
		expect( anonymous.status() ).toBe( 401 );

		const subscriber = await saveMessage(
			unlinkedId,
			'<p>x</p>',
			subscriberHeaders
		);
		expect( subscriber.status() ).toBe( 403 );

		// An author manages events but cannot edit another user's linked page.
		const authorLinked = await saveMessage(
			linkedId,
			'<p>x</p>',
			authorHeaders
		);
		expect( authorLinked.status() ).toBe( 403 );
		const authorRead = await api.get( messagePath( linkedId ), {
			headers: authorHeaders,
		} );
		expect( authorRead.status() ).toBe( 403 );

		const authorUnlinked = await saveMessage(
			unlinkedId,
			'<p>Author note</p>',
			authorHeaders
		);
		expect( authorUnlinked.ok(), await authorUnlinked.text() ).toBeTruthy();
	} );

	test( 'a series date inherits the series message and cannot override it', async () => {
		const { eventDateId: masterId, occurrenceIds } = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		expect( occurrenceIds.length ).toBe( 1 );
		const occurrenceId = occurrenceIds[ 0 ];

		await saveMessage( masterId, '<p>Series note</p>' );

		const res = await api.get( messagePath( occurrenceId ), {
			headers: adminHeaders,
		} );
		expect( await res.json() ).toEqual( {
			message: '<p>Series note</p>',
			series_event_date_id: masterId,
		} );

		const put = await saveMessage( occurrenceId, '<p>Own note</p>' );
		expect( put.status() ).toBe( 409 );
	} );

	test( 'a free booking emails the message right away', async () => {
		const { eventDateId, typeId } = await createEvent( {
			linked: true,
			price: 0,
		} );
		const saved = await saveMessage( eventDateId, RICH_MESSAGE );
		const { message } = await saved.json();
		expect( message ).toContain(
			'<a href="https://example.com/venue">venue</a>'
		);
		const email = uniqueEmail( 'free' );

		const body = await book( eventDateId, typeId, email );
		expect( body.status ).toBe( 'confirmed' );

		// One confirmation, carrying the saved paragraphs and link once.
		expect( await messageCounts( email, message ) ).toEqual( [ 1 ] );
	} );

	test( 'an event without a message sends the standard confirmation', async () => {
		const { eventDateId, typeId } = await createEvent( {
			linked: true,
			price: 0,
		} );
		const email = uniqueEmail( 'none' );

		await book( eventDateId, typeId, email );

		const mail = await mailTo( email );
		expect( mail.length ).toBeGreaterThan( 0 );
		expect(
			mail.some( ( entry ) =>
				entry.body.includes(
					'<div style="margin: 0 0 20px 0; font-size: 16px;">'
				)
			)
		).toBe( false );
	} );

	test( 'a paid booking emails the message once, only after payment', async () => {
		const { eventDateId, typeId } = await createEvent( {
			linked: true,
			price: 12,
		} );
		const saved = await saveMessage( eventDateId, RICH_MESSAGE );
		const { message } = await saved.json();
		const email = uniqueEmail( 'paid' );

		const body = await book( eventDateId, typeId, email );
		expect( body.status ).toBe( 'payment_required' );
		const signupId = await signupIdFor( eventDateId );

		expect( await messageCounts( email, message ) ).toEqual( [] );

		await fixture( 'ticket-capacity/pay', { signup_id: signupId } );
		expect( await messageCounts( email, message ) ).toEqual( [ 1 ] );

		// A repeated payment notification sends nothing new.
		await fixture( 'ticket-capacity/pay', { signup_id: signupId } );
		expect( await messageCounts( email, message ) ).toEqual( [ 1 ] );
	} );

	test( 'a failed payment never gets the message', async () => {
		const { eventDateId, typeId } = await createEvent( {
			linked: true,
			price: 12,
		} );
		await saveMessage( eventDateId, '<p>Failed note</p>' );
		const email = uniqueEmail( 'failed' );

		await book( eventDateId, typeId, email );
		const signupId = await signupIdFor( eventDateId );

		await fixture( 'ticket-capacity/fail', { signup_id: signupId } );

		const mail = await mailTo( email );
		expect(
			mail.some( ( entry ) => entry.body.includes( 'Failed note' ) )
		).toBe( false );
	} );

	test( 'editing the message emails nobody who already booked', async () => {
		const { eventDateId, typeId } = await createEvent( {
			linked: true,
			price: 0,
		} );
		const email = uniqueEmail( 'retro' );
		await book( eventDateId, typeId, email );
		const before = ( await mailTo( email ) ).length;

		await saveMessage( eventDateId, '<p>Late note</p>' );

		expect( ( await mailTo( email ) ).length ).toBe( before );
	} );
} );
