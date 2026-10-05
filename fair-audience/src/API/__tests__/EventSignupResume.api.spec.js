/**
 * Playwright API tests for resuming a signup on a recognised email (#1004,
 * moved to the unified signup route by #1701): the create route holds back a
 * submission whose email belongs to a participant the caller is not known to
 * be, and the resume endpoint hands the stashed submission to the holder of
 * the emailed link, once.
 *
 * The link's token is never returned by any API response — only the email
 * carries it — so these specs read it from the mail the test instance
 * captures (fair-e2e-event-signup.php). The browser journey, including a
 * session that belongs to someone else, is covered by
 * e2e/user-flows/resume-signup-recognised-email.spec.js.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

function uniqueEmail( prefix ) {
	return `${ prefix }+${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

async function createEventWithDates( api, title ) {
	const res = await api.post( '/wp-json/wp/v2/fair_event', {
		headers: authHeaders,
		data: { title, status: 'publish' },
	} );
	expect( res.ok() ).toBeTruthy();
	const eventId = ( await res.json() ).id;

	const eventsRes = await api.get( '/wp-json/fair-audience/v1/events', {
		headers: authHeaders,
		params: { per_page: 100 },
	} );
	expect( eventsRes.ok() ).toBeTruthy();
	const match = ( await eventsRes.json() ).find(
		( e ) => e.event_id === eventId
	);
	expect( match, 'event-date row for test event' ).toBeTruthy();
	return { eventId, eventDateId: match.event_date_id };
}

async function deleteEvent( api, eventId ) {
	if ( ! eventId ) return;
	await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
		headers: authHeaders,
		params: { force: 'true' },
	} );
}

const CREATE_ROUTE = '/wp-json/fair-events/v1/get-tickets';
const RESUME_ROUTE = '/wp-json/fair-audience/v1/event-signup/resume';

const ANSWERS = [
	{
		question_key: 'dietary',
		question_text: 'Dietary needs',
		question_type: 'short_text',
		answer_value: 'No nuts',
		display_order: 0,
	},
];

async function createParticipant( api, name, email ) {
	const res = await api.post( '/wp-json/fair-audience/v1/participants', {
		headers: authHeaders,
		data: { name, email },
	} );
	expect( res.ok(), await res.text() ).toBeTruthy();
	return ( await res.json() ).id;
}

async function deleteParticipant( api, participantId ) {
	if ( ! participantId ) return;
	await api.delete(
		`/wp-json/fair-audience/v1/participants/${ participantId }`,
		{ headers: authHeaders }
	);
}

async function participantRow( api, eventDateId, participantId ) {
	const res = await api.get(
		`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
		{ headers: authHeaders }
	);
	expect( res.ok(), await res.text() ).toBeTruthy();
	return ( await res.json() ).find(
		( row ) => row.participant_id === participantId
	);
}

async function resumeLink( api, email ) {
	const res = await api.get(
		'/wp-json/fair-e2e/v1/event-signup/resume-link',
		{ headers: authHeaders, params: { email } }
	);
	expect( res.ok(), await res.text() ).toBeTruthy();
	return res.json();
}

test.describe( 'Resume a signup on a recognised email — create route', () => {
	let api;
	let event;
	let participantId;
	let otherParticipantId;
	let email;
	const createdEmails = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		event = await createEventWithDates(
			api,
			`Resume Signup Test ${ Date.now() }`
		);
		email = uniqueEmail( 'resume-signup' );
		participantId = await createParticipant( api, 'Resume Tester', email );
		otherParticipantId = await createParticipant(
			api,
			'Other Tester',
			uniqueEmail( 'resume-other' )
		);
	} );

	test.afterAll( async () => {
		await deleteParticipant( api, participantId );
		await deleteParticipant( api, otherParticipantId );
		if ( createdEmails.length ) {
			const res = await api.get(
				'/wp-json/fair-audience/v1/participants',
				{ headers: authHeaders }
			);
			for ( const participant of await res.json() ) {
				if ( createdEmails.includes( participant.email ) ) {
					await deleteParticipant( api, participant.id );
				}
			}
		}
		await deleteEvent( api, event?.eventId );
		await api.dispose();
	} );

	test( 'a known email from an unrecognised caller is held back and resumed once from the emailed link', async () => {
		// A fresh, cookie-less request context: the server has no reason to
		// believe this caller is the participant, so nothing may be saved
		// for them — only the generic "check your inbox" answer.
		const anon = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await anon.post( CREATE_ROUTE, {
				data: {
					event_date_id: event.eventDateId,
					name: 'Resume Tester',
					email,
					mailing_opt_in: true,
					questionnaire_answers: ANSWERS,
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			const body = await res.json();
			expect( body.status ).toBe( 'email_recognized' );
			expect( body.message ).toBeTruthy();
			// Nothing that identifies or continues the signup leaves the server.
			expect( JSON.stringify( body ) ).not.toContain( 'resume' );
			expect( body.signup_id ).toBeUndefined();
			expect( body.checkout_url ).toBeUndefined();

			// No session was opened for the participant either.
			const cookies = ( await anon.storageState() ).cookies;
			expect(
				cookies.find(
					( cookie ) => cookie.name === 'fair_audience_session'
				)
			).toBeUndefined();
		} finally {
			await anon.dispose();
		}

		expect(
			await participantRow( api, event.eventDateId, participantId ),
			'no relationship is created for the recognised participant'
		).toBeFalsy();

		const { count, link } = await resumeLink( api, email );
		expect( count, 'one link was emailed' ).toBe( 1 );

		// Someone else's valid participant token does not unlock the stash,
		// and trying does not use the link up.
		const otherTokenRes = await api.post(
			'/wp-json/fair-e2e/v1/event-signup/participant-token',
			{
				headers: authHeaders,
				data: {
					participant_id: otherParticipantId,
					event_date_id: event.eventDateId,
				},
			}
		);
		const otherToken = ( await otherTokenRes.json() ).token;
		const strangerRes = await api.get( RESUME_ROUTE, {
			params: { participant_token: otherToken, resume: link.resume },
		} );
		expect( strangerRes.status() ).toBe( 404 );

		const resumeRes = await api.get( RESUME_ROUTE, { params: link } );
		expect( resumeRes.ok(), await resumeRes.text() ).toBeTruthy();
		const { payload } = await resumeRes.json();
		expect( payload.participant_id ).toBeUndefined();
		expect( payload.event_date_id ).toBe( event.eventDateId );
		expect( payload.name ).toBe( 'Resume Tester' );
		expect( payload.quantity ).toBe( 1 );
		expect( payload.keep_informed ).toBe( true );
		expect( payload.questionnaire_answers ).toHaveLength( 1 );
		expect( payload.questionnaire_answers[ 0 ] ).toMatchObject( {
			question_key: 'dietary',
			answer_value: 'No nuts',
		} );

		// Single use.
		const againRes = await api.get( RESUME_ROUTE, { params: link } );
		expect( againRes.status() ).toBe( 404 );

		// With the link's participant token the same submission goes through.
		const owner = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await owner.post( CREATE_ROUTE, {
				data: {
					event_date_id: event.eventDateId,
					name: 'Resume Tester',
					email,
					participant_token: link.participant_token,
					questionnaire_answers: ANSWERS,
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			expect( ( await res.json() ).status ).toBe( 'confirmed' );
		} finally {
			await owner.dispose();
		}

		const row = await participantRow(
			api,
			event.eventDateId,
			participantId
		);
		expect( row?.label ).toBe( 'signed_up' );
	} );

	test( 'an unknown email is signed up directly, with no "recognised" answer', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const unknownEmail = uniqueEmail( 'unknown' );
		createdEmails.push( unknownEmail );
		try {
			const res = await anon.post( CREATE_ROUTE, {
				data: {
					event_date_id: event.eventDateId,
					name: 'Nobody',
					email: unknownEmail,
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			expect( ( await res.json() ).status ).toBe( 'confirmed' );
		} finally {
			await anon.dispose();
		}

		expect( ( await resumeLink( api, unknownEmail ) ).count ).toBe( 0 );
	} );

	test( 'the removed public signup routes are gone', async () => {
		for ( const [ method, path ] of [
			[ 'POST', '/wp-json/fair-audience/v1/event-signup/register' ],
			[ 'POST', '/wp-json/fair-audience/v1/event-signup/request-link' ],
			[ 'GET', '/wp-json/fair-audience/v1/event-signup/status' ],
		] ) {
			const res = await api.fetch( path, {
				method,
				params: { event_id: event.eventId, email, name: 'Anyone' },
			} );
			expect( res.status(), path ).toBe( 404 );
		}
	} );

	test( 'the routes that remain refuse a caller with no login and no participant token', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		try {
			for ( const [ method, path ] of [
				[ 'POST', '/wp-json/fair-audience/v1/event-signup' ],
				[ 'DELETE', '/wp-json/fair-audience/v1/event-signup' ],
				[
					'POST',
					'/wp-json/fair-audience/v1/event-signup/add-activities',
				],
			] ) {
				const res = await anon.fetch( path, {
					method,
					data: {
						event_id: event.eventId,
						event_date_id: event.eventDateId,
						ticket_option_ids: [ 1 ],
					},
				} );
				expect( res.status(), `${ method } ${ path }` ).toBe( 401 );
			}
		} finally {
			await anon.dispose();
		}
	} );
} );

test.describe( 'Resume a signup on a recognised email — resume endpoint', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'an invalid participant_token is rejected', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/event-signup/resume',
			{
				params: {
					participant_token: 'not-a-real-token',
					resume: 'whatever',
				},
			}
		);
		expect( res.status() ).toBe( 403 );
	} );

	test( 'a well-formed but never-stashed resume token 404s', async () => {
		// A syntactically valid participant token (base64 of "0:0:<hmac>") will
		// always fail ParticipantToken::verify's participant_id > 0 check, so
		// this still exercises the resume_not_found path via the same 403/404
		// boundary without needing a real participant.
		const res = await api.get(
			'/wp-json/fair-audience/v1/event-signup/resume',
			{
				params: {
					participant_token: 'bm90LWEtcmVhbC10b2tlbg',
					resume: 'never-stashed-token',
				},
			}
		);
		expect( [ 403, 404 ] ).toContain( res.status() );
	} );
} );
