/**
 * Playwright API tests for #2187: the Event Prices block now keeps a ticket
 * type visible after its "Stop selling on" deadline passes, but that is
 * display-only. A direct get-tickets submission for an expired ticket type
 * must still be rejected with 409 ticket_type_disabled, while a ticket type
 * whose deadline is still ahead stays purchasable.
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

/**
 * Creates an event date with one always-on sale period and two free ticket
 * types: "Expired" (deadline in the past) and "Current" (deadline in the
 * future). Free prices keep acceptance independent of payment setup.
 *
 * @param {import('@playwright/test').APIRequestContext} api Request context.
 * @return {Promise<{eventDateId: number, expiredTypeId: number, currentTypeId: number}>} Created IDs.
 */
async function createEventWithExpiredType( api ) {
	const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
		headers: adminHeaders,
		data: {
			title: `Expired ticket type test ${ Date.now() }-${ Math.random() }`,
			start_date: '2035-06-01',
			start_time: '10:00:00',
			end_date: '2035-06-01',
			end_time: '12:00:00',
		},
	} );
	expect( edRes.ok() ).toBeTruthy();
	const eventDateId = ( await edRes.json() ).id;

	const ticketsRes = await api.put(
		`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		{
			headers: adminHeaders,
			data: {
				ticket_types: [
					{
						name: 'Expired',
						capacity: null,
						minimum_activities: 0,
						disable_at: '2020-01-15 18:30:00',
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
					{
						name: 'Current',
						capacity: null,
						minimum_activities: 0,
						disable_at: '2099-01-01 00:00:00',
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 0 },
				],
				settings: {},
			},
		}
	);
	expect( ticketsRes.ok() ).toBeTruthy();
	const body = await ticketsRes.json();
	const expiredTypeId = body.ticket_types?.[ 0 ]?.id;
	const currentTypeId = body.ticket_types?.[ 1 ]?.id;
	expect( expiredTypeId ).toBeTruthy();
	expect( currentTypeId ).toBeTruthy();
	expect( body.ticket_types[ 0 ].disable_at ).toBe( '2020-01-15 18:30:00' );

	return { eventDateId, expiredTypeId, currentTypeId };
}

function purchase( api, eventDateId, ticketTypeId ) {
	return api.post( '/wp-json/fair-events/v1/get-tickets', {
		data: {
			event_date_id: eventDateId,
			name: 'Expired Ticket Tester',
			email: `expired-ticket-${ Date.now() }-${ Math.random() }@example.test`,
			ticket_type_id: ticketTypeId,
			quantity: 1,
		},
	} );
}

test.describe( 'GetTicketsController — expired ticket types stay unpurchasable (#2187)', () => {
	let api;
	const createdEventDateIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of createdEventDateIds ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'a direct submission for a ticket type past its deadline is rejected with 409 ticket_type_disabled', async () => {
		const { eventDateId, expiredTypeId } =
			await createEventWithExpiredType( api );
		createdEventDateIds.push( eventDateId );

		const res = await purchase( api, eventDateId, expiredTypeId );
		expect( res.status() ).toBe( 409 );
		expect( ( await res.json() ).code ).toBe( 'ticket_type_disabled' );
	} );

	test( 'a ticket type whose deadline is still ahead is accepted', async () => {
		const { eventDateId, currentTypeId } =
			await createEventWithExpiredType( api );
		createdEventDateIds.push( eventDateId );

		const res = await purchase( api, eventDateId, currentTypeId );
		expect( res.ok() ).toBeTruthy();
	} );
} );
