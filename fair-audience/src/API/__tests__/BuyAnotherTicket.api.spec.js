/**
 * Playwright API tests for a recognised participant buying another ticket
 * for themselves on a date they already hold one for (#1526).
 *
 * The participant's own browser is one request context: the first purchase
 * through fair-events/v1/get-tickets sets the audience session the later
 * requests are recognised by. Free ticket types and activities keep every
 * purchase on the confirmed path; paid purchases, their ledger entries and a
 * failed payment are covered by RepeatPurchases.api.spec.js. Captured mail
 * and participant tokens are read through the test-only fair-e2e/v1 routes.
 */

import { randomUUID } from 'node:crypto';
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
const SIGNUP_ROUTE = '/wp-json/fair-audience/v1/event-signup';

test.describe
	.serial( 'A recognised participant buys another ticket for themselves', () => {
	let api;
	let visitor;
	let postId;
	let eventDateId;
	let standardId;
	let communityId;
	let beginnerId;
	let socialId;
	let participantId;
	let legacyParticipantId;

	const email = `buy-another-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

	async function buy( data ) {
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'Another Ticket Buyer',
				email,
				_honeypot: '',
				...data,
			},
		} );
		return { status: res.status(), body: await res.json() };
	}

	async function viewerContext( context, params = {} ) {
		const res = await context.get( VIEWER_CONTEXT, {
			params: { event_date_id: eventDateId, ...params },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	}

	async function signups() {
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() )
			.filter( ( row ) => row.email === email )
			.sort( ( a, b ) => a.id - b.id );
	}

	async function relationship( id ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).filter(
			( row ) => Number( row.participant_id ) === id
		);
	}

	async function tokenFor( id ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/event-signup/participant-token',
			{
				headers: adminHeaders,
				data: { participant_id: id, event_date_id: eventDateId },
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		return ( await res.json() ).token;
	}

	async function confirmationMails() {
		const res = await api.get( '/wp-json/fair-e2e/v1/checkout-keys/mail', {
			headers: adminHeaders,
			params: { email },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).filter( ( mail ) =>
			mail.subject.includes( 'Signup confirmed' )
		);
	}

	// The card's list items, one per held ticket.
	const heldTickets = ( html ) =>
		html
			.split( '<ul class="fair-events-signed-up-tickets">' )[ 1 ]
			.split( '<li><strong>' )
			.slice( 1 );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		visitor = await request.newContext( { baseURL: BASE_URL } );

		const title = `Buy another ticket ${ Date.now() }`;
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
				start_datetime: '2035-12-03 10:00:00',
				end_datetime: '2035-12-03 12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		eventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const type = ( name, capacity ) => ( {
			name,
			capacity,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			minimum_instances: 1,
			group_ids: [],
		} );
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						type( 'Standard entry', 3 ),
						type( 'Community entry', null ),
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
						{
							ticket_type_index: 1,
							sale_period_index: 0,
							price: 0,
						},
					],
					options: [
						{ name: 'Beginner class', price: 0, capacity: null },
						{ name: 'Evening social', price: 0, capacity: null },
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		[ standardId, communityId ] = ticketsBody.ticket_types.map(
			( ticketType ) => ticketType.id
		);
		beginnerId = ticketsBody.options.find(
			( option ) => option.name === 'Beginner class'
		).id;
		socialId = ticketsBody.options.find(
			( option ) => option.name === 'Evening social'
		).id;
	} );

	test.afterAll( async () => {
		for ( const signup of eventDateId ? await signups() : [] ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
				{ headers: adminHeaders }
			);
		}
		for ( const id of [ participantId, legacyParticipantId ] ) {
			if ( id ) {
				await api.delete(
					`/wp-json/fair-audience/v1/participants/${ id }`,
					{ headers: adminHeaders }
				);
			}
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await visitor.dispose();
		await api.dispose();
	} );

	test( 'the recognised view keeps the ticket held and offers the purchase form', async () => {
		const first = await buy( {
			ticket_type_id: standardId,
			quantity: 1,
			ticket_option_ids: [ beginnerId ],
			idempotency_key: randomUUID(),
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		expect( first.body.status ).toBe( 'confirmed' );
		participantId = Number( ( await signups() )[ 0 ].participant_id );
		expect( participantId ).toBeGreaterThan( 0 );

		const context = await viewerContext( visitor );
		expect( context.viewer_resolved ).toBe( true );
		// Replaced by the signed-up card before #1526.
		expect( context.suppress_form ).toBe( false );
		expect( context.ticket_type_fieldset_html ).toContain(
			'Community entry'
		);
		expect( context.prefill_email ).toBe( email );

		// What is held, apart from the form's fragments.
		expect( context.existing_signup_html ).toContain(
			'You are signed up for this date.'
		);
		const [ held ] = heldTickets( context.existing_signup_html );
		expect( held ).toContain( 'Standard entry' );
		expect( held ).toContain( 'Beginner class' );
		expect( context.before_form_html ).not.toContain(
			'fair-events-signed-up-card'
		);

		// The form is headed as another purchase by the same participant,
		// with the identity reset as its own, separate action.
		expect( context.before_form_html ).toContain(
			'Buy another ticket for yourself'
		);
		expect( context.before_form_html ).toContain( email );
		expect( context.before_form_html ).toContain( 'Not you? Start fresh' );

		// Tickets back this admission, so the broad cancellation is not offered.
		expect( context.existing_signup_html ).not.toContain(
			'fair-events-cancel-signup-button'
		);
	} );

	test( 'none of it reaches a visitor who is not recognised', async () => {
		const stranger = await request.newContext( { baseURL: BASE_URL } );
		try {
			const context = await viewerContext( stranger );
			expect( context.viewer_resolved ).toBe( false );
			expect( context.existing_signup_html ).toBeNull();
			expect( context.before_form_html ).toBeNull();
			expect( context.prefill_name ).toBe( '' );
			expect( context.prefill_email ).toBe( '' );
			expect( JSON.stringify( context ) ).not.toContain( email );

			// Nor a made-up token.
			const forged = await viewerContext( stranger, {
				participant_token: 'not-a-token',
			} );
			expect( forged.viewer_resolved ).toBe( false );
			expect( forged.existing_signup_html ).toBeNull();
		} finally {
			await stranger.dispose();
		}
	} );

	test( 'the additional purchase takes places like any other', async () => {
		// One of the three Standard places is held; three more do not fit.
		const tooMany = await buy( {
			ticket_type_id: standardId,
			quantity: 3,
			idempotency_key: randomUUID(),
		} );
		expect( tooMany.status, JSON.stringify( tooMany.body ) ).toBe( 409 );
		expect( await signups() ).toHaveLength( 1 );
	} );

	test( 'a deliberate second purchase has its own signup, ticket and selection', async () => {
		const key = randomUUID();
		const purchase = {
			ticket_type_id: communityId,
			quantity: 1,
			ticket_option_ids: [ socialId ],
			idempotency_key: key,
		};

		const second = await buy( purchase );
		expect( second.status, JSON.stringify( second.body ) ).toBe( 200 );
		expect( second.body.status ).toBe( 'confirmed' );

		// Sent again while in flight, it is still that one purchase.
		const again = await buy( purchase );
		expect( again.status ).toBe( 200 );

		const rows = await signups();
		expect( rows ).toHaveLength( 2 );
		expect( rows.map( ( row ) => Number( row.participant_id ) ) ).toEqual( [
			participantId,
			participantId,
		] );
		expect( rows.map( ( row ) => Number( row.event_date_id ) ) ).toEqual( [
			eventDateId,
			eventDateId,
		] );
		expect( rows[ 0 ].tickets ).toHaveLength( 1 );
		expect( rows[ 1 ].tickets ).toHaveLength( 1 );
		expect( Number( rows[ 1 ].ticket_type_id ) ).toBe( communityId );

		// One relationship, however many purchases.
		const rel = await relationship( participantId );
		expect( rel ).toHaveLength( 1 );
		expect( rel[ 0 ].label ).toBe( 'signed_up' );

		// Each ticket is listed with its own type and activities; nothing of
		// the first purchase was carried into the second.
		const context = await viewerContext( visitor );
		expect( context.suppress_form ).toBe( false );
		const held = heldTickets( context.existing_signup_html );
		expect( held ).toHaveLength( 2 );
		expect( held[ 0 ] ).toContain( 'Standard entry' );
		expect( held[ 0 ] ).toContain( 'Beginner class' );
		expect( held[ 0 ] ).not.toContain( 'Evening social' );
		expect( held[ 1 ] ).toContain( 'Community entry' );
		expect( held[ 1 ] ).toContain( 'Evening social' );
		expect( held[ 1 ] ).not.toContain( 'Beginner class' );
	} );

	test( 'each confirmation describes its own purchase', async () => {
		const mails = await confirmationMails();
		expect( mails ).toHaveLength( 2 );
		expect( mails[ 0 ].body ).toContain( 'Standard entry' );
		expect( mails[ 0 ].body ).toContain( 'Beginner class' );
		expect( mails[ 0 ].body ).not.toContain( 'Evening social' );
		// Not the ticket type or activity the relationship carries from the
		// first purchase.
		expect( mails[ 1 ].body ).toContain( 'Community entry' );
		expect( mails[ 1 ].body ).toContain( 'Evening social' );
		expect( mails[ 1 ].body ).not.toContain( 'Standard entry' );
		expect( mails[ 1 ].body ).not.toContain( 'Beginner class' );
	} );

	test( 'the broad cancellation cannot remove a relationship its tickets rest on', async () => {
		const token = await tokenFor( participantId );
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await anonymous.delete( SIGNUP_ROUTE, {
				data: {
					event_id: postId,
					event_date_id: eventDateId,
					participant_token: token,
				},
			} );
			expect( res.status(), await res.text() ).toBe( 409 );
			expect( ( await res.json() ).code ).toBe( 'signup_has_tickets' );
		} finally {
			await anonymous.dispose();
		}

		// Both tickets, the relationship and the recognition are as they were.
		const rows = await signups();
		expect( rows.map( ( row ) => row.status ) ).toEqual( [
			'confirmed',
			'confirmed',
		] );
		expect(
			rows.flatMap( ( row ) => row.tickets.map( ( t ) => t.status ) )
		).toEqual( [ 'confirmed', 'confirmed' ] );
		const rel = await relationship( participantId );
		expect( rel ).toHaveLength( 1 );
		expect( rel[ 0 ].label ).toBe( 'signed_up' );
		expect( ( await viewerContext( visitor ) ).viewer_resolved ).toBe(
			true
		);
	} );

	test( 'an admission without tickets can still be cancelled', async () => {
		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Legacy',
					surname: 'Admission',
					email: `buy-another-legacy-${ Date.now() }@example.test`,
				},
			}
		);
		expect( participantRes.ok(), await participantRes.text() ).toBeTruthy();
		legacyParticipantId = ( await participantRes.json() ).id;
		const token = await tokenFor( legacyParticipantId );

		// fair-audience's own signup route keeps a relationship only.
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		try {
			const signupRes = await anonymous.post( SIGNUP_ROUTE, {
				data: {
					event_id: postId,
					event_date_id: eventDateId,
					ticket_type_id: communityId,
					participant_token: token,
				},
			} );
			expect( signupRes.ok(), await signupRes.text() ).toBeTruthy();
			const [ before ] = await relationship( legacyParticipantId );
			expect( before.label ).toBe( 'signed_up' );
			expect( before.tickets ?? [] ).toHaveLength( 0 );

			const context = await viewerContext( anonymous, {
				participant_token: token,
			} );
			expect( context.suppress_form ).toBe( false );
			expect( context.existing_signup_html ).toContain(
				'fair-events-cancel-signup-button'
			);
			// Relationship details stand in where there are no ticket units.
			expect( context.existing_signup_html ).toContain(
				'Community entry'
			);

			const cancelRes = await anonymous.delete( SIGNUP_ROUTE, {
				data: {
					event_id: postId,
					event_date_id: eventDateId,
					participant_token: token,
				},
			} );
			expect( cancelRes.ok(), await cancelRes.text() ).toBeTruthy();
			expect( await relationship( legacyParticipantId ) ).toHaveLength(
				0
			);
		} finally {
			await anonymous.dispose();
		}
	} );
} );
