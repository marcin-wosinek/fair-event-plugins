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
 * Visitor requests go through each test's own `visitor` context (Playwright's
 * test-scoped `request` fixture), so every test starts as a new visitor with no
 * fair_audience_session cookie, whatever order the tests run in. A test that
 * means a returning visitor reuses its own `visitor` across its requests. The
 * shared `api` context carries only administrative setup, assertions and
 * teardown (#2196).
 *
 * Skips gracefully when fair-audience is not active in the test environment.
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

const sessionCookie = async ( context ) =>
	( await context.storageState() ).cookies.find(
		( cookie ) => cookie.name === 'fair_audience_session'
	)?.value;

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
				start_date: '2035-07-01',
				start_time: '10:00:00',
				end_date: '2035-07-01',
				end_time: '12:00:00',
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

	test( 'a signup with no ticket type and no activities selected still completes (#1310: the options filters run unconditionally)', async ( {
		request: visitor,
	} ) => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const guardEmail = `signup-hook-bridge-no-options-${ Date.now() }@example.test`;

		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
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

	test( 'a free signup through the base route creates a linked Participant and EventParticipant', async ( {
		request: visitor,
	} ) => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
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

	test( 'two signups with the same email on the same event date share one participant_id and one EventParticipant row', async ( {
		request: visitor,
	} ) => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const repeatEmail = `signup-hook-bridge-repeat-${ Date.now() }@example.test`;

		const firstRes = await visitor.post(
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
		const secondRes = await visitor.post(
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

	test( 'a viewer already holding a ticket for the date can buy another one (#1534)', async ( {
		request: visitor,
	} ) => {
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

		// A returning visitor: this test's own context starts without a
		// session, and the first purchase gives it the cookie that
		// link_participant() sets. The later purchases resolve the viewer
		// through that cookie (the context carries cookies, like a browser).
		expect( await sessionCookie( visitor ) ).toBeUndefined();
		const firstRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					...purchase,
					idempotency_key: `first-${ Date.now() }-key`,
				},
			}
		);
		expect( firstRes.ok(), await firstRes.text() ).toBeTruthy();
		expect( await sessionCookie( visitor ) ).toBeTruthy();

		const secondKey = `second-${ Date.now() }-key`;
		for ( let i = 0; i < 2; i++ ) {
			const secondRes = await visitor.post(
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

	test( 'the per-email rate limit rejects an 11th signup within the window (#1245, #1769)', async ( {
		request: visitor,
	} ) => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );

		const rateLimitEmail = `signup-hook-bridge-rl-${ Date.now() }@example.test`;

		// No ticket_type_id: a plain signup, so only the rate limiter decides.
		for ( let i = 0; i < 10; i++ ) {
			const res = await visitor.post(
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
			expect( res.ok() ).toBeTruthy();
		}

		const limitedRes = await visitor.post(
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

// #2213 — the confirmation Fair Audience sends lists the extras selected
// with that booking. Mail is captured by e2e/mu-plugins and read back from
// fair-e2e/v1/captured-mail; payment is driven through
// fair-e2e/v1/ticket-capacity/pay.
test.describe( 'SignupHookBridge — confirmation email lists the booking’s extras', () => {
	let api;
	let fairAudienceActive = false;
	const postIds = [];
	const eventDateIds = [];

	const uniqueEmail = ( label ) =>
		`booking-extras-${ label }-${ Date.now() }-${ Math.random()
			.toString( 36 )
			.slice( 2 ) }@example.test`;

	// Mirrors esc_html() for the characters these names use.
	const escHtml = ( text ) =>
		text
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#039;' );

	const listed = ( body, name ) =>
		body.includes( `>${ escHtml( name ) }</li>` );

	/**
	 * A linked, bookable event with one ticket type and four extras.
	 *
	 * @param {number} ticketPrice Ticket type price.
	 * @return {Promise<Object>} eventDateId, typeId and option IDs by name.
	 */
	const createEvent = async ( ticketPrice = 0 ) => {
		const title = `Booking extras ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				start_date: '2035-11-01',
				start_time: '10:00:00',
				end_date: '2035-11-01',
				end_time: '12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;
		eventDateIds.push( eventDateId );

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: postId, link_type: 'post' },
			}
		);
		expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();

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
							price: ticketPrice,
						},
					],
					options: [
						{ name: 'Morning workshop', price: 15, capacity: null },
						{ name: 'Welcome drink', price: 0, capacity: null },
						{ name: 'Tea & "Biscuits"', price: 0, capacity: null },
						{ name: 'Dinner', price: 0, capacity: null },
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		const options = {};
		for ( const option of ticketsBody.options || [] ) {
			options[ option.name ] = option.id;
		}
		expect( Object.keys( options ) ).toHaveLength( 4 );

		return {
			eventDateId,
			typeId: ticketsBody.ticket_types[ 0 ].id,
			options,
		};
	};

	// A fresh visitor per purchase unless one is given, so no buyer session
	// carries over by accident.
	const book = async ( data, browser = null ) => {
		const visitor =
			browser || ( await request.newContext( { baseURL: BASE_URL } ) );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				name: 'Extras Buyer',
				_honeypot: '',
				idempotency_key: randomUUID(),
				...data,
			},
		} );
		const text = await res.text();
		if ( ! browser ) {
			await visitor.dispose();
		}
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

	const confirmations = async ( email ) =>
		( await mailTo( email ) ).filter( ( mail ) =>
			mail.body.includes( 'Registration reference:' )
		);

	const signupIdsFor = async ( eventDateId ) => {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/checkout-keys?event_date_ids[]=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body.signups.map( ( signup ) => signup.id );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( pluginsRes.ok() ) {
			fairAudienceActive = ( await pluginsRes.json() ).some(
				( p ) =>
					p.plugin?.includes( 'fair-audience' ) &&
					p.status === 'active'
			);
		}
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
		await api.dispose();
	} );

	test( 'a free booking lists each of its extras once, escaped', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );
		const { eventDateId, typeId, options } = await createEvent();
		const email = uniqueEmail( 'free' );

		const body = await book( {
			email,
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			quantity: 2,
			ticket_activities: [
				[ options[ 'Welcome drink' ], options[ 'Tea & "Biscuits"' ] ],
				[ options[ 'Welcome drink' ] ],
			],
		} );
		expect( body.status ).toBe( 'confirmed' );

		const mails = await confirmations( email );
		expect( mails ).toHaveLength( 1 );
		const message = mails[ 0 ].body;
		expect( message ).toContain( 'Selected options:' );
		expect( listed( message, 'Welcome drink' ) ).toBe( true );
		expect( listed( message, 'Tea & "Biscuits"' ) ).toBe( true );
		expect( message.split( '>Welcome drink</li>' ) ).toHaveLength( 2 );
		expect( message ).not.toContain( 'Tea & "Biscuits"' );
		expect( listed( message, 'Dinner' ) ).toBe( false );
		expect( listed( message, 'Morning workshop' ) ).toBe( false );
		// Existing details stay intact.
		expect( message ).toContain( 'Ticket type:' );
		expect( message ).toContain( 'Entry' );
	} );

	test( 'a booking without extras has no extras section', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );
		const { eventDateId, typeId } = await createEvent();
		const email = uniqueEmail( 'none' );

		await book( {
			email,
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			quantity: 1,
		} );

		const mails = await confirmations( email );
		expect( mails ).toHaveLength( 1 );
		expect( mails[ 0 ].body ).not.toContain( 'Selected options:' );
	} );

	test( 'a second booking by the same buyer lists only its own extras', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );
		const { eventDateId, typeId, options } = await createEvent();
		const email = uniqueEmail( 'repeat' );
		// The same browser, remembered as the buyer after the first booking.
		const browser = await request.newContext( { baseURL: BASE_URL } );

		try {
			await book(
				{
					email,
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					quantity: 1,
					ticket_option_ids: [ options[ 'Welcome drink' ] ],
				},
				browser
			);
			const second = await book(
				{
					email,
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					quantity: 1,
					ticket_option_ids: [ options.Dinner ],
				},
				browser
			);
			expect( second.status ).toBe( 'confirmed' );
		} finally {
			await browser.dispose();
		}

		const mails = await confirmations( email );
		expect( mails ).toHaveLength( 2 );
		expect( listed( mails[ 0 ].body, 'Welcome drink' ) ).toBe( true );
		expect( listed( mails[ 0 ].body, 'Dinner' ) ).toBe( false );
		expect( listed( mails[ 1 ].body, 'Dinner' ) ).toBe( true );
		expect( listed( mails[ 1 ].body, 'Welcome drink' ) ).toBe( false );
	} );

	test( 'a paid booking lists its paid and free extras once paid', async () => {
		test.skip( ! fairAudienceActive, 'fair-audience not active' );
		const { eventDateId, typeId, options } = await createEvent( 10 );
		const email = uniqueEmail( 'paid' );

		const body = await book( {
			email,
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			quantity: 1,
			ticket_option_ids: [
				options[ 'Morning workshop' ],
				options[ 'Welcome drink' ],
			],
		} );
		expect( body.status ).toBe( 'payment_required' );
		expect( await confirmations( email ) ).toHaveLength( 0 );

		const [ signupId ] = await signupIdsFor( eventDateId );
		const payRes = await api.post(
			'/wp-json/fair-e2e/v1/ticket-capacity/pay',
			{ headers: adminHeaders, data: { signup_id: signupId } }
		);
		expect( payRes.ok(), await payRes.text() ).toBeTruthy();

		const mails = await confirmations( email );
		expect( mails ).toHaveLength( 1 );
		const message = mails[ 0 ].body;
		expect( message ).toContain( 'Selected options:' );
		expect( listed( message, 'Morning workshop' ) ).toBe( true );
		expect( listed( message, 'Welcome drink' ) ).toBe( true );
		expect( listed( message, 'Dinner' ) ).toBe( false );
		expect( message ).toContain( 'Amount paid:' );
	} );
} );
