/**
 * Playwright API tests for the newsletter consent the admin signups list
 * reports for the printed List (#1842).
 *
 * GetTicketsController::get_items() adds a read-only `newsletter_consent` to
 * each signup: what the linked Fair Audience participant consents to now,
 * which the registration's own historical `mailing_opt_in` cannot tell.
 *
 * Covers:
 *   - current participant consent differing from the registration's opt-in,
 *     in all three states, leaving `mailing_opt_in` as it was recorded.
 *   - several signups linked to one participant.
 *   - signups without a participant, or whose participant no longer exists.
 *   - the list staying restricted to administrators.
 *
 * Fair Audience being inactive is covered by GetTicketsControllerTest.php.
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

test.describe( 'GetTicketsController — newsletter consent of the List (#1842)', () => {
	let api;
	let eventPostId;
	let eventDateId;
	// Registrations by the opt-in they recorded.
	let optedIn;
	let optedOut;
	let alsoOptedIn;
	// Participants by their current email profile.
	const participants = {};
	const createdParticipantIds = new Set();
	const signupIds = new Set();
	const stamp = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;

	async function list() {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		signups.forEach( ( signup ) => {
			signupIds.add( signup.id );
			if ( signup.participant_id ) {
				createdParticipantIds.add( Number( signup.participant_id ) );
			}
		} );
		return signups;
	}

	const listed = async ( signupId ) =>
		( await list() ).find( ( signup ) => signup.id === signupId );

	// Each registration is a separate visitor.
	async function register( label, mailingOptIn, ticketTypeId ) {
		const email = `consent-${ label }-${ stamp }@example.test`;
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				ticket_type_id: ticketTypeId,
				name: `Consent ${ label }`,
				email,
				quantity: 1,
				mailing_opt_in: mailingOptIn,
				_honeypot: '',
			},
		} );
		const body = await res.text();
		await visitor.dispose();
		expect( res.ok(), body ).toBeTruthy();
		return ( await list() ).find( ( signup ) => signup.email === email );
	}

	async function createParticipant( emailProfile ) {
		const res = await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: {
				name: 'Consent',
				surname: emailProfile,
				email: `consent-profile-${ emailProfile }-${ stamp }@example.test`,
				email_profile: emailProfile,
			},
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.id ).toBeTruthy();
		createdParticipantIds.add( Number( body.id ) );
		return Number( body.id );
	}

	async function link( signup, participantId ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/transaction-participants/signup',
			{
				headers: adminHeaders,
				data: { signup_id: signup.id, participant_id: participantId },
			}
		);
		expect( res.ok() ).toBeTruthy();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Newsletter consent ${ stamp }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-06-01',
				start_time: '10:00:00',
				end_date: '2035-06-01',
				end_time: '12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General Admission',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: 'Always available',
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
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		const ticketTypeId = ticketsBody.ticket_types[ 0 ].id;

		optedIn = await register( 'opted-in', true, ticketTypeId );
		optedOut = await register( 'opted-out', false, ticketTypeId );
		alsoOptedIn = await register( 'also-opted-in', true, ticketTypeId );
		expect( optedIn && optedOut && alsoOptedIn ).toBeTruthy();

		for ( const profile of [ 'marketing', 'declined', 'minimal' ] ) {
			participants[ profile ] = await createParticipant( profile );
		}
	} );

	test.afterAll( async () => {
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const participantId of createdParticipantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'reports the participant’s current consent, whatever the registration recorded', async () => {
		await link( optedIn, participants.declined );
		await link( optedOut, participants.marketing );
		await link( alsoOptedIn, participants.minimal );

		const signups = await list();
		const byId = ( signup ) =>
			signups.find( ( item ) => item.id === signup.id );

		expect( byId( optedIn ) ).toMatchObject( {
			mailing_opt_in: true,
			newsletter_consent: 'declined',
		} );
		expect( byId( optedOut ) ).toMatchObject( {
			mailing_opt_in: false,
			newsletter_consent: 'granted',
		} );
		expect( byId( alsoOptedIn ) ).toMatchObject( {
			mailing_opt_in: true,
			newsletter_consent: 'unspecified',
		} );
	} );

	test( 'gives every signup of one participant that participant’s consent', async () => {
		await link( optedIn, participants.declined );
		await link( optedOut, participants.declined );
		await link( alsoOptedIn, participants.marketing );

		const signups = await list();
		const consents = [ optedIn, optedOut, alsoOptedIn ].map(
			( signup ) =>
				signups.find( ( item ) => item.id === signup.id )
					.newsletter_consent
		);
		expect( consents ).toEqual( [ 'declined', 'declined', 'granted' ] );
	} );

	test( 'reports no current consent without a participant to ask', async () => {
		await link( optedIn, 0 );
		// A participant that no longer exists.
		await link( optedOut, 2147483000 );

		expect( await listed( optedIn.id ) ).toMatchObject( {
			mailing_opt_in: true,
			newsletter_consent: null,
		} );
		expect( await listed( optedOut.id ) ).toMatchObject( {
			mailing_opt_in: false,
			newsletter_consent: null,
		} );

		// Left without links, so cleanup removes the signups on their own.
		await link( optedOut, 0 );
		await link( alsoOptedIn, 0 );
	} );

	test( 'stays restricted to administrators', async () => {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.get( '/wp-json/fair-events/v1/get-tickets', {
			params: { event_date: eventDateId },
		} );
		const body = await res.text();
		await visitor.dispose();

		expect( res.status() ).toBe( 401 );
		expect( body ).not.toContain( 'newsletter_consent' );
		expect( body ).not.toContain( '@example.test' );
	} );
} );
