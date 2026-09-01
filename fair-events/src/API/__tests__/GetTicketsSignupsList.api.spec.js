/**
 * Playwright API tests for the get-tickets admin signups list (#1346):
 * GetTicketsController::get_items() must embed a resolved ticket_type_name
 * on each signup row, so the admin signups table/CSV export can show the
 * name instead of a meaningless numeric ID.
 *
 * Covers:
 *   - a signup with a valid ticket type gets its name attached.
 *   - a signup whose ticket type has since been deleted gets ticket_type_name
 *     null instead of an error or the stale ID.
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

test.describe( 'GetTicketsController — admin signups list ticket_type_name', () => {
	let api;
	let eventPostId;
	let eventDateId;
	let ticketTypeId;
	let signupEmails;
	let signupIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets signups list test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets signups list test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
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
		expect( ticketsRes.ok() ).toBeTruthy();
		const ticketsBody = await ticketsRes.json();
		ticketTypeId = ticketsBody.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();

		signupEmails = {
			checked: `signups-list-checked-${ Date.now() }@example.test`,
			unchecked: `signups-list-unchecked-${ Date.now() }@example.test`,
		};
		const signupResponses = await Promise.all(
			Object.entries( signupEmails ).map( ( [ consent, email ] ) =>
				api.post( '/wp-json/fair-events/v1/get-tickets', {
					data: {
						event_date_id: eventDateId,
						name: `Signups List ${ consent } Tester`,
						email,
						ticket_type_id: ticketTypeId,
						quantity: 1,
						mailing_opt_in: consent === 'checked',
					},
				} )
			)
		);
		expect(
			signupResponses.every( ( response ) => response.ok() )
		).toBeTruthy();
	} );

	test.afterAll( async () => {
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
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

	test( 'a signup with a valid ticket type gets ticket_type_name resolved', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const signup = signups.find(
			( s ) => s.email === signupEmails.checked
		);
		expect( signup ).toBeTruthy();
		signupIds = signups.map( ( item ) => item.id );
		expect( signup.ticket_type_name ).toBe( 'General Admission' );
	} );

	test( 'mailing consent persists and is serialized as explicit booleans', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const checked = signups.find(
			( signup ) => signup.email === signupEmails.checked
		);
		const unchecked = signups.find(
			( signup ) => signup.email === signupEmails.unchecked
		);

		expect( checked?.mailing_opt_in ).toBe( true );
		expect( unchecked?.mailing_opt_in ).toBe( false );
		signupIds = signups.map( ( signup ) => signup.id );
	} );

	test( 'a signup referencing a deleted ticket type gets ticket_type_name null', async () => {
		const deleteRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect( deleteRes.ok() ).toBeTruthy();

		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const signup = signups.find(
			( s ) => s.email === signupEmails.checked
		);
		expect( signup ).toBeTruthy();
		expect( signup.ticket_type_name ).toBeNull();
	} );
} );
