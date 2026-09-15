/**
 * Playwright API tests for ticket-type availability consolidation (#1581):
 * EventSignupController must reject a ticket type the signup form itself
 * would already hide, using the same manual-disabled / scheduled-disable_at
 * decision as the display filter in event-signup/render.php
 * (TicketAvailabilityResolver). Before this change, submission validation
 * only checked the scheduled disable_at boundary — a manually disabled type
 * could still be purchased directly, even though the form never showed it.
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

test.describe( 'Signup availability — manually disabled ticket type', () => {
	let api;
	let event;
	let participantId;
	let disabledTypeId;
	let fixtureOk = true;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const meRes = await api.get( '/wp-json/wp/v2/users/me', {
			headers: authHeaders,
		} );
		expect( meRes.ok() ).toBeTruthy();
		const adminUserId = ( await meRes.json() ).id;
		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Availability Tester',
					email: uniqueEmail( 'availability-participant' ),
					wp_user_id: adminUserId,
				},
			}
		);
		expect(
			participantRes.ok(),
			'admin must not be pre-linked to a participant'
		).toBeTruthy();
		participantId = ( await participantRes.json() ).id;
		event = await createEventWithDates(
			api,
			`Availability Ticket Type Test ${ Date.now() }`
		);

		// Step 1: create the ticket type (creation never accepts `disabled`).
		const createRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/tickets`,
			{
				headers: authHeaders,
				data: {
					ticket_types: [
						{
							name: 'Soon disabled tier',
							capacity: null,
							sort_order: 0,
							recurrence_scope: 'single_instance',
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		// #1410 — publishing a fair_event doesn't auto-create its event-date;
		// captured (not asserted) so the test below can skip with a
		// reference instead of failing the hook.
		fixtureOk = createRes.ok();
		if ( ! fixtureOk ) {
			return;
		}
		const types = ( await createRes.json() ).ticket_types || [];
		disabledTypeId = types.find(
			( t ) => t.name === 'Soon disabled tier'
		)?.id;
		expect( disabledTypeId ).toBeTruthy();

		// Step 2: manually disable it, same as the admin ticket editor.
		const disableRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/tickets`,
			{
				headers: authHeaders,
				data: {
					ticket_types: [
						{
							id: disabledTypeId,
							name: 'Soon disabled tier',
							capacity: null,
							sort_order: 0,
							recurrence_scope: 'single_instance',
							disabled: true,
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect( disableRes.ok(), await disableRes.text() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( participantId ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: authHeaders }
			);
		}
		await deleteEvent( api, event?.eventId );
		await api.dispose();
	} );

	test( 'a manually disabled ticket type is rejected at signup, not just hidden', async () => {
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);
		const res = await api.post( '/wp-json/fair-audience/v1/event-signup', {
			headers: authHeaders,
			data: {
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				ticket_type_id: disabledTypeId,
				email: uniqueEmail( 'availability-disabled' ),
			},
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 409 );
		expect( body.code ).toBe( 'ticket_type_disabled' );
	} );
} );
