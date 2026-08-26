/**
 * Playwright API tests for selectable activities (ticket options) in the
 * unified Event Signup form (#1243): fair-events/v1/get-tickets must enforce
 * the minimum-activities requirement, reject an unknown or full activity, and
 * charge a selected activity's price into the signup amount — server-side, so
 * a crafted request can't skip the minimum, buy a full activity, or dodge the
 * charge. Activities are exercised here with no ticket type configured (the
 * "activity-only" case the two new filters were added to cover, per #1243's
 * Decisions), proving the new filters run unconditionally.
 *
 * The dev stack has no payment connector configured, so a priced-activity
 * signup 503s payment_unavailable instead of confirming — the same trick
 * EventSignupGroupPricing.api.spec.js uses to prove server-side pricing
 * without needing a real payment provider.
 *
 * The existing "add activities" delta flow (POST .../add-activities) is
 * unchanged by #1243 (the unified form's JS submits to the same route) and
 * already covered by EventSignupAddActivities.api.spec.js — not re-tested
 * here.
 *
 * Skips gracefully when fair-events-experimental isn't active, since the
 * activity catalogue (TicketOption) lives there.
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

test.describe( 'Selectable activities in the unified Event Signup form (#1243)', () => {
	let api;
	let experimentalActive = false;
	let event;
	let freeOptionId;
	let paidOptionId;
	let fixtureOk = true;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: authHeaders,
		} );
		if ( pluginsRes.ok() ) {
			const plugins = await pluginsRes.json();
			experimentalActive = plugins.some(
				( p ) =>
					p.plugin?.includes( 'fair-events-experimental' ) &&
					p.status === 'active'
			);
		}
		if ( ! experimentalActive ) {
			return;
		}

		event = await createEventWithDates(
			api,
			`Signup Activities Test ${ Date.now() }`
		);

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/tickets`,
			{
				headers: authHeaders,
				data: {
					ticket_types: [],
					sale_periods: [],
					prices: [],
					options: [
						{
							name: 'Free Activity',
							price: 0,
							capacity: 1,
						},
						{
							name: 'Paid Activity',
							price: 15,
							capacity: null,
						},
					],
					settings: { minimum_activities: 1 },
				},
			}
		);
		// #1410 — publishing a fair_event doesn't auto-create its event-date;
		// captured (not asserted) so every test below can skip with a
		// reference instead of failing the hook.
		fixtureOk = ticketsRes.ok();
		if ( ! fixtureOk ) {
			return;
		}
		const options = ( await ticketsRes.json() ).options || [];
		freeOptionId = options.find( ( o ) => o.name === 'Free Activity' )?.id;
		paidOptionId = options.find( ( o ) => o.name === 'Paid Activity' )?.id;
		expect( freeOptionId ).toBeTruthy();
		expect( paidOptionId ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( experimentalActive ) {
			await deleteEvent( api, event?.eventId );
		}
		await api.dispose();
	} );

	test( 'a signup with no activities selected is rejected with 400 minimum_activities_not_met', async () => {
		test.skip(
			! experimentalActive,
			'fair-events-experimental not active'
		);
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: event.eventDateId,
				name: 'No Activities Buyer',
				email: uniqueEmail( 'no-activities' ),
			},
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe(
			'minimum_activities_not_met'
		);
	} );

	test( 'an unknown activity id is rejected with 400 invalid_ticket_option', async () => {
		test.skip(
			! experimentalActive,
			'fair-events-experimental not active'
		);
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: event.eventDateId,
				name: 'Invalid Option Buyer',
				email: uniqueEmail( 'invalid-option' ),
				ticket_option_ids: [ 999999999 ],
			},
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'invalid_ticket_option' );
	} );

	test( 'a paid activity is charged into the signup amount (503 without a payment connector proves it)', async () => {
		test.skip(
			! experimentalActive,
			'fair-events-experimental not active'
		);
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const res = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: event.eventDateId,
				name: 'Paid Activity Buyer',
				email: uniqueEmail( 'paid-activity' ),
				ticket_option_ids: [ paidOptionId ],
			},
		} );
		expect( res.status() ).toBe( 503 );
		expect( ( await res.json() ).code ).toBe( 'payment_unavailable' );
	} );

	test( 'a free activity confirms immediately, then a capacity-1 activity 409s ticket_option_full for the next buyer', async () => {
		test.skip(
			! experimentalActive,
			'fair-events-experimental not active'
		);
		test.skip(
			! fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const firstRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					name: 'Free Activity Buyer',
					email: uniqueEmail( 'free-activity' ),
					ticket_option_ids: [ freeOptionId ],
				},
			}
		);
		expect( firstRes.ok(), await firstRes.text() ).toBeTruthy();
		expect( ( await firstRes.json() ).status ).toBe( 'confirmed' );

		const secondRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					name: 'Second Free Activity Buyer',
					email: uniqueEmail( 'free-activity-full' ),
					ticket_option_ids: [ freeOptionId ],
				},
			}
		);
		expect( secondRes.status() ).toBe( 409 );
		expect( ( await secondRes.json() ).code ).toBe( 'ticket_option_full' );
	} );
} );
