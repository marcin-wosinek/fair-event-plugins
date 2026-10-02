/**
 * Playwright API tests for SignupHookBridge (#1083, PR 2 + PR 3): a signup
 * created through fair-events' unified route (fair-events/v1/get-tickets)
 * must, when fair-audience is active, also create/link a fair-audience
 * Participant and EventParticipant record via the fair_events_signup_created
 * action, and write the participant back onto the fair_events_signups row
 * (PR 3, "canonical signup store").
 *
 * The paid-confirmation half of PR 3 — a webhook flipping a base-route
 * signup to 'confirmed' via fair_events_signup_confirmed, which
 * SignupHookBridge::handle_signup_confirmed() then uses to flip the matching
 * EventParticipant to signed_up and record a ledger entry — needs a real
 * Mollie payment; the dev stack has no Mollie double for API-spec tests
 * (only e2e does, per TESTING.md). That path was verified via the WP-CLI
 * eval-file manual check (TESTING.md) alongside this change, following the
 * precedent in EventSignupLedgerResolution.api.spec.js.
 *
 * Skips gracefully when fair-audience is not active in the test environment.
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

test.describe( 'SignupHookBridge — base get-tickets route links a Participant', () => {
	let api;
	let fairAudienceActive = false;
	let eventPostId;
	let eventDateId;
	let ticketTypeId;
	const buyerEmail = `signup-hook-bridge-${ Date.now() }@example.test`;
	const buyerName = 'Signup Hook Bridge Tester';

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( pluginsRes.ok() ) {
			const plugins = await pluginsRes.json();
			fairAudienceActive = plugins.some(
				( p ) =>
					p.plugin?.includes( 'fair-audience' ) &&
					p.status === 'active'
			);
		}
		if ( ! fairAudienceActive ) {
			return;
		}

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Signup hook bridge test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Signup hook bridge test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		// The create endpoint doesn't wire event_id through — a PUT is needed
		// to actually link the post (see CalendarFeedController.api.spec.js
		// for the same quirk). Needed here so link_participant()'s
		// get_resolved_event_id() resolves to a real post.
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: eventPostId },
			}
		);
		expect( linkRes.ok() ).toBeTruthy();

		// A free ticket type, on sale, for the repeat-purchase test (#1534).
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General admission',
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
					settings: {},
				},
			}
		);
		expect( ticketsRes.ok() ).toBeTruthy();
		ticketTypeId = ( await ticketsRes.json() ).ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( fairAudienceActive && eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'a signup with no ticket type and no activities selected still completes (#1310: the options filters run unconditionally)', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const guardEmail = `signup-hook-bridge-no-options-${ Date.now() }@example.test`;

		const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'No Options Buyer',
				email: guardEmail,
				quantity: 1,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( body.status ).toBe( 'confirmed' );
	} );

	test( 'a free signup through the base route creates a linked Participant and EventParticipant', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: buyerName,
				email: buyerEmail,
				quantity: 1,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( body.status ).toBe( 'confirmed' );

		// The fair_events_signups row exists (base plugin's own record).
		const signupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: eventDateId },
			}
		);
		expect( signupsRes.ok() ).toBeTruthy();
		const signups = await signupsRes.json();
		expect( signups.some( ( s ) => s.email === buyerEmail ) ).toBeTruthy();

		// SignupHookBridge linked a fair-audience Participant by email.
		const participantsRes = await api.get(
			'/wp-json/fair-audience/v1/participants',
			{ headers: adminHeaders, params: { search: buyerEmail } }
		);
		expect( participantsRes.ok() ).toBeTruthy();
		const participantsBody = await participantsRes.json();
		const participant = participantsBody.find(
			( p ) => p.email === buyerEmail
		);
		expect( participant ).toBeTruthy();

		// ...and an EventParticipant row ties that participant to this event date.
		const eventParticipantsRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( eventParticipantsRes.ok() ).toBeTruthy();
		const eventParticipants = await eventParticipantsRes.json();
		const items = Array.isArray( eventParticipants )
			? eventParticipants
			: eventParticipants.items || [];
		expect(
			items.some( ( ep ) => ep.participant_id === participant.id )
		).toBeTruthy();

		// PR 3: the signup row itself is linked back to the participant.
		const linkedSignup = signups.find( ( s ) => s.email === buyerEmail );
		expect( Number( linkedSignup.participant_id ) ).toBe( participant.id );
	} );

	test( 'two signups with the same email on the same event date share one participant_id and one EventParticipant row', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const repeatEmail = `signup-hook-bridge-repeat-${ Date.now() }@example.test`;

		const firstRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					name: 'Repeat Buyer',
					email: repeatEmail,
					quantity: 1,
				},
			}
		);
		expect( firstRes.ok() ).toBeTruthy();

		// A second, independent purchase under the same email/event date — the
		// series-master scenario (#1083 PR 3): a whole-series pass bought
		// again, or a companion ticket, must not be treated as a duplicate.
		const secondRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					name: 'Repeat Buyer',
					email: repeatEmail,
					quantity: 1,
				},
			}
		);
		expect( secondRes.ok() ).toBeTruthy();

		const signupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: eventDateId },
			}
		);
		expect( signupsRes.ok() ).toBeTruthy();
		const signups = await signupsRes.json();
		const repeatSignups = signups.filter(
			( s ) => s.email === repeatEmail
		);

		// Two purchase records...
		expect( repeatSignups.length ).toBe( 2 );
		// ...sharing one participant_id.
		expect( repeatSignups[ 0 ].participant_id ).toBeTruthy();
		expect( repeatSignups[ 1 ].participant_id ).toBe(
			repeatSignups[ 0 ].participant_id
		);

		// ...and exactly one EventParticipant (operational) row, never downgraded.
		const eventParticipantsRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( eventParticipantsRes.ok() ).toBeTruthy();
		const eventParticipantsBody = await eventParticipantsRes.json();
		const items = Array.isArray( eventParticipantsBody )
			? eventParticipantsBody
			: eventParticipantsBody.items || [];
		const matching = items.filter(
			( ep ) =>
				Number( ep.participant_id ) ===
				Number( repeatSignups[ 0 ].participant_id )
		);
		expect( matching.length ).toBe( 1 );
		expect( matching[ 0 ].label ).toBe( 'signed_up' );
	} );

	test( 'a viewer already holding a ticket for the date can buy another one (#1534)', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		// Until #1534 a recognised viewer whose relationship was signed_up
		// with a ticket type got 409 already_signed_up here. A relationship
		// records participation; each checkout is its own purchase, and an
		// accidental repeat is stopped by the idempotency key instead.
		const ticketEmail = `signup-hook-bridge-repeat-${ Date.now() }@example.test`;
		const purchase = {
			event_date_id: eventDateId,
			name: 'Repeat Ticket Buyer',
			email: ticketEmail,
			ticket_type_id: ticketTypeId,
			quantity: 1,
		};

		// Resolved as the returning viewer via the session cookie
		// link_participant() set on the first request (this Playwright
		// request context carries cookies across requests, like a browser).
		const firstRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					...purchase,
					idempotency_key: `first-${ Date.now() }-key`,
				},
			}
		);
		expect( firstRes.ok(), await firstRes.text() ).toBeTruthy();

		const secondKey = `second-${ Date.now() }-key`;
		for ( let i = 0; i < 2; i++ ) {
			const secondRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{ data: { ...purchase, idempotency_key: secondKey } }
			);
			expect( secondRes.ok(), await secondRes.text() ).toBeTruthy();
			expect( ( await secondRes.json() ).status ).toBe( 'confirmed' );
		}

		// Two purchases — the repeated key added none — under one
		// relationship.
		const signupsRes = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const signups = ( await signupsRes.json() ).filter(
			( row ) => row.email === ticketEmail
		);
		expect( signups ).toHaveLength( 2 );
		expect(
			new Set( signups.map( ( row ) => row.participant_id ) ).size
		).toBe( 1 );

		const participantsRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		const relationships = ( await participantsRes.json() ).filter(
			( row ) =>
				String( row.participant_id ) ===
				String( signups[ 0 ].participant_id )
		);
		expect( relationships ).toHaveLength( 1 );
		expect( relationships[ 0 ].label ).toBe( 'signed_up' );
	} );

	test( 'the per-email rate limit rejects a 4th signup within the window (#1245)', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const rateLimitEmail = `signup-hook-bridge-rl-${ Date.now() }@example.test`;

		// No ticket_type_id: a plain signup, so only the rate limiter decides.
		for ( let i = 0; i < 3; i++ ) {
			const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
				data: {
					event_date_id: eventDateId,
					name: 'Rate Limit Tester',
					email: rateLimitEmail,
					quantity: 1,
				},
			} );
			expect( res.ok() ).toBeTruthy();
		}

		const fourthRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					name: 'Rate Limit Tester',
					email: rateLimitEmail,
					quantity: 1,
				},
			}
		);
		expect( fourthRes.status() ).toBe( 429 );
		expect( ( await fourthRes.json() ).code ).toBe( 'rate_limited' );
	} );
} );
