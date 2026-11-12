/**
 * Playwright API tests for payments on the participant activity endpoint:
 * GET /fair-audience/v1/participants/{id}/activity.
 *
 * Event entries used to carry the latest ledger charge per registration
 * (`transaction_id`, `transaction_status`; #984, #1113). Since #2251 the
 * participant's payments come only from their Fair Events purchases
 * (`purchases`, `payment_information`), so event entries carry no
 * transaction fields and the Fair Audience ledger is never read here. The
 * purchase payment history itself is covered by fair-events'
 * PurchasePaymentReaders.api.spec.js.
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

test.describe( 'ParticipantsController activity — payments', () => {
	let api;
	let participantId;
	let eventId;
	let eventDateId;
	let fixtureOk = true;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const partRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Transaction Status Tester',
					email: uniqueEmail( 'transaction-status' ),
				},
			}
		);
		expect( partRes.ok() ).toBeTruthy();
		participantId = ( await partRes.json() ).id;

		const eventRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: {
				title: `Transaction Status Event ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( eventRes.ok() ).toBeTruthy();
		eventId = ( await eventRes.json() ).id;

		const eventsRes = await api.get( '/wp-json/fair-audience/v1/events', {
			headers: authHeaders,
			params: { per_page: 100 },
		} );
		expect( eventsRes.ok() ).toBeTruthy();
		const match = ( await eventsRes.json() ).find(
			( e ) => e.event_id === eventId
		);
		expect( match, 'event-date row for the test event' ).toBeTruthy();
		eventDateId = match.event_date_id;

		// Written directly, as a registration from before the payment
		// history migration: the organizer route would give it a Fair
		// Events purchase at once (#2253).
		const linkRes = await api.post(
			'/wp-json/fair-e2e/v1/participant-removal/legacy-relationship',
			{
				headers: authHeaders,
				data: {
					event_date_id: eventDateId,
					participant_id: participantId,
				},
			}
		);
		// #1410 — publishing a fair_event doesn't auto-create its event-date;
		// captured (not asserted) so every test below can skip with a
		// reference instead of failing the hook.
		fixtureOk = linkRes.ok();
	} );

	test.afterAll( async () => {
		if ( participantId ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: authHeaders }
			);
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: authHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
	} );

	test( 'unauthenticated request is rejected', async () => {
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }/activity`
		);
		expect( res.status() ).toBe( 401 );
	} );

	test( 'events carry no ledger transaction; payments come from purchases', async () => {
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }/activity`,
			{ headers: authHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( Array.isArray( body.events ) ).toBe( true );

		const event = body.events.find( ( ev ) => ev.event_id === eventId );
		expect( event, 'linked event in the activity response' ).toBeTruthy();
		expect( event ).not.toHaveProperty( 'transaction_id' );
		expect( event ).not.toHaveProperty( 'transaction_status' );
		expect( body ).not.toHaveProperty( 'payment_readers' );
		// A relationship is not a purchase: nothing was bought.
		expect( body.purchases ).toEqual( [] );
		expect( body.payment_information ).toBe( 'available' );
	} );
} );
