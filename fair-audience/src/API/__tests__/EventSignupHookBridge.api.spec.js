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

	test.describe( 'registering another person (#1528)', () => {
		const VIEWER_CONTEXT_PATH =
			'/wp-json/fair-events/v1/get-tickets/viewer-context';
		const sessionCookie = async ( context ) =>
			( await context.storageState() ).cookies.find(
				( cookie ) => cookie.name === 'fair_audience_session'
			)?.value;
		const signupsFor = async ( email ) => {
			const res = await api.get(
				`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
				{ headers: adminHeaders }
			);
			expect( res.ok() ).toBeTruthy();
			return ( await res.json() ).filter(
				( row ) => row.email === email
			);
		};
		const participantByEmail = async ( email ) => {
			const res = await api.get(
				'/wp-json/fair-audience/v1/participants',
				{ headers: adminHeaders, params: { search: email } }
			);
			expect( res.ok() ).toBeTruthy();
			return ( await res.json() ).find( ( p ) => p.email === email );
		};

		// A browser remembered as a participant who holds a ticket.
		async function rememberedBrowser( label ) {
			const browser = await request.newContext( { baseURL: BASE_URL } );
			const email = `another-person-${ label }-${ Date.now() }@example.test`;
			const res = await browser.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDateId,
						name: 'Original Holder',
						email,
						ticket_type_id: ticketTypeId,
						quantity: 1,
					},
				}
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
			const cookie = await sessionCookie( browser );
			expect( cookie ).toBeTruthy();
			return { browser, email, cookie };
		}

		test( 'the action is offered to a cookie-recognised ticket holder only', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const { browser, email } = await rememberedBrowser( 'offer' );

			const res = await browser.get( VIEWER_CONTEXT_PATH, {
				params: { event_date_id: eventDateId },
			} );
			const body = await res.json();
			expect( body.prefill_email ).toBe( email );
			expect( body.existing_signup_html ).toContain(
				'fair-events-register-another-button'
			);
			// "Not you? Start fresh" stays a separate action of the form.
			expect( body.before_form_html ).toContain(
				'fair-events-not-you-button'
			);

			// The same participant through a signed link: a stronger
			// identity, so the action is not offered.
			const participant = await participantByEmail( email );
			const tokenRes = await api.post(
				'/wp-json/fair-e2e/v1/event-signup/participant-token',
				{
					headers: adminHeaders,
					data: {
						participant_id: participant.id,
						event_date_id: eventDateId,
					},
				}
			);
			expect( tokenRes.ok() ).toBeTruthy();
			const { token } = await tokenRes.json();
			const linked = await request.newContext( { baseURL: BASE_URL } );
			const linkedRes = await linked.get( VIEWER_CONTEXT_PATH, {
				params: {
					event_date_id: eventDateId,
					participant_token: token,
				},
			} );
			const linkedBody = await linkedRes.json();
			expect( linkedBody.token_identity_validated ).toBe( true );
			expect( linkedBody.existing_signup_html ).toContain(
				'fair-events-signed-up-card'
			);
			expect( linkedBody.existing_signup_html ).not.toContain(
				'fair-events-register-another-button'
			);

			// A signed-in account that also carries the cookie.
			const signedInRes = await browser.get( VIEWER_CONTEXT_PATH, {
				headers: adminHeaders,
				params: { event_date_id: eventDateId },
			} );
			const signedInHtml =
				( await signedInRes.json() ).existing_signup_html || '';
			expect( signedInHtml ).not.toContain(
				'fair-events-register-another-button'
			);

			await linked.dispose();
			await browser.dispose();
		} );

		test( 'the fresh form inherits nothing from the remembered participant', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const { browser, email, cookie } =
				await rememberedBrowser( 'context' );

			const res = await browser.get( VIEWER_CONTEXT_PATH, {
				params: {
					event_date_id: eventDateId,
					register_another_person: '1',
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			const text = await res.text();
			const body = JSON.parse( text );

			expect( body.register_another_person ).toBe( true );
			expect( body.viewer_resolved ).toBe( false );
			expect( body.prefill_name ).toBe( '' );
			expect( body.prefill_email ).toBe( '' );
			expect( body.existing_signup_html ).toBeNull();
			expect( body.before_form_html ).toBeNull();
			expect( body.ticket_type_fieldset_html ).toContain(
				'General admission'
			);
			expect( text ).not.toContain( email );
			expect( text ).not.toContain( 'Original Holder' );
			expect( await sessionCookie( browser ) ).toBe( cookie );

			await browser.dispose();
		} );

		test( 'the new signup belongs to the other person and the session stays the original participant’s', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const { browser, email, cookie } =
				await rememberedBrowser( 'purchase' );
			const original = await participantByEmail( email );
			const otherEmail = `another-person-other-${ Date.now() }@example.test`;

			const res = await browser.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDateId,
						name: 'Other Person',
						email: otherEmail,
						ticket_type_id: ticketTypeId,
						quantity: 1,
						register_another_person: true,
						idempotency_key: `another-person-${ Date.now() }-key`,
					},
				}
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
			expect( ( await res.json() ).status ).toBe( 'confirmed' );

			// The other person is a participant of their own…
			const other = await participantByEmail( otherEmail );
			expect( other ).toBeTruthy();
			expect( other.id ).not.toBe( original.id );
			const otherSignups = await signupsFor( otherEmail );
			expect( otherSignups ).toHaveLength( 1 );
			expect( Number( otherSignups[ 0 ].participant_id ) ).toBe(
				other.id
			);

			// …the original participant's ticket is as it was…
			const originalSignups = await signupsFor( email );
			expect( originalSignups ).toHaveLength( 1 );
			expect( Number( originalSignups[ 0 ].participant_id ) ).toBe(
				original.id
			);

			// …and the browser is still remembered as them.
			expect( await sessionCookie( browser ) ).toBe( cookie );
			const contextRes = await browser.get( VIEWER_CONTEXT_PATH, {
				params: { event_date_id: eventDateId },
			} );
			const context = await contextRes.json();
			expect( context.prefill_email ).toBe( email );
			expect( context.existing_signup_html ).not.toContain(
				'Other Person'
			);

			await browser.dispose();
		} );

		test( 'an existing participant’s email — the remembered one’s included — is verified by email, not registered', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const { browser, email, cookie } =
				await rememberedBrowser( 'recognised' );

			// Without the flag the remembered participant buys again as
			// themselves; with it they are nobody the server knows.
			const res = await browser.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDateId,
						name: 'Someone Else',
						email,
						ticket_type_id: ticketTypeId,
						quantity: 1,
						register_another_person: true,
					},
				}
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
			expect( ( await res.json() ).status ).toBe( 'email_recognized' );
			expect( await signupsFor( email ) ).toHaveLength( 1 );
			expect( await sessionCookie( browser ) ).toBe( cookie );

			await browser.dispose();
		} );

		test( 'a stronger identity cannot be combined with registering another person', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const purchase = {
				event_date_id: eventDateId,
				name: 'Other Person',
				ticket_type_id: ticketTypeId,
				quantity: 1,
				register_another_person: true,
			};
			const anon = await request.newContext( { baseURL: BASE_URL } );

			const tokenEmail = `another-person-token-${ Date.now() }@example.test`;
			const withToken = await anon.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						...purchase,
						email: tokenEmail,
						participant_token: 'any-token',
					},
				}
			);
			expect( withToken.status() ).toBe( 400 );
			expect( ( await withToken.json() ).code ).toBe(
				'register_another_person_unavailable'
			);

			const accountEmail = `another-person-account-${ Date.now() }@example.test`;
			const signedIn = await anon.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					headers: adminHeaders,
					data: { ...purchase, email: accountEmail },
				}
			);
			expect( signedIn.status() ).toBe( 400 );
			expect( ( await signedIn.json() ).code ).toBe(
				'register_another_person_unavailable'
			);

			expect( await signupsFor( tokenEmail ) ).toHaveLength( 0 );
			expect( await signupsFor( accountEmail ) ).toHaveLength( 0 );
			await anon.dispose();
		} );

		test( 'a key used for the visitor’s own purchase never answers one for another person', async () => {
			test.skip( ! fairAudienceActive, 'fair-audience not active' );
			const { browser, email } = await rememberedBrowser( 'key' );
			const key = `another-person-shared-${ Date.now() }-key`;
			const purchase = {
				event_date_id: eventDateId,
				name: 'Original Holder',
				email,
				ticket_type_id: ticketTypeId,
				quantity: 1,
				idempotency_key: key,
			};

			const own = await browser.post(
				'/wp-json/fair-events/v1/get-tickets',
				{ data: purchase }
			);
			expect( own.ok(), await own.text() ).toBeTruthy();

			const another = await browser.post(
				'/wp-json/fair-events/v1/get-tickets',
				{ data: { ...purchase, register_another_person: true } }
			);
			expect( another.status() ).toBe( 409 );
			expect( ( await another.json() ).code ).toBe(
				'idempotency_key_reused'
			);

			await browser.dispose();
		} );
	} );

	test( 'the per-email rate limit rejects an 11th signup within the window (#1245, #1769)', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const rateLimitEmail = `signup-hook-bridge-rl-${ Date.now() }@example.test`;

		// No ticket_type_id: a plain signup, so only the rate limiter decides.
		for ( let i = 0; i < 10; i++ ) {
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

		const limitedRes = await api.post(
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
		expect( limitedRes.status() ).toBe( 429 );
		expect( ( await limitedRes.json() ).code ).toBe( 'rate_limited' );
	} );
} );
