/**
 * Playwright API tests for the get-tickets viewer-context endpoint (#1300):
 * the request-time personalization the Event Signup block's cache-safe
 * baseline render can no longer compute itself, since a full-page cache
 * stores and replays it.
 *
 * These assertions hold whether or not fair-audience (the only current
 * consumer of fair_events_signup_viewer_context) is active on the stack
 * this suite runs against: an anonymous caller — and an authenticated admin
 * who isn't linked to any fair-audience participant — both resolve to no
 * viewer, so `viewer_resolved` is false and the response is the same
 * no-op payload either way. That is also exactly the guarantee the ticket's
 * "discloses nothing about a participant other than the current viewer"
 * acceptance criterion needs: nothing here can be used to enumerate or infer
 * another visitor's identity.
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

const VIEWER_CONTEXT_PATH =
	'/wp-json/fair-events/v1/get-tickets/viewer-context';

test.describe( 'GetTicketsController — viewer-context', () => {
	let api;
	let eventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets viewer-context test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		const eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets viewer-context test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: eventPostId },
			}
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General',
							recurrence_scope: 'single_instance',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
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
							price: 15,
						},
					],
					settings: {},
				},
			}
		);
		expect( ticketsRes.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'requires event_date_id', async () => {
		const res = await api.get( VIEWER_CONTEXT_PATH );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'an unknown event_date_id 404s', async () => {
		const res = await api.get( VIEWER_CONTEXT_PATH, {
			params: { event_date_id: 999999999 },
		} );
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'invalid_event_date' );
	} );

	test( 'an anonymous caller gets a no-op payload — no fieldsets, no prefill, not signed up', async () => {
		const res = await api.get( VIEWER_CONTEXT_PATH, {
			params: { event_date_id: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.viewer_resolved ).toBe( false );
		expect( body.suppress_form ).toBe( false );
		expect( body.ticket_type_fieldset_html ).toBeNull();
		expect( body.ticket_options_fieldset_html ).toBeNull();
		expect( body.before_form_html ).toBeNull();
		expect( body.before_submit_html ).toBeNull();
		expect( body.after_form_html ).toBeNull();
		expect( body.occurrences_signed_up ).toEqual( [] );
		expect( body.prefill_name ).toBe( '' );
		expect( body.prefill_email ).toBe( '' );
	} );

	test( 'an authenticated admin with no linked participant gets the same no-op payload as an anonymous caller — no enumeration', async () => {
		const res = await api.get( VIEWER_CONTEXT_PATH, {
			headers: adminHeaders,
			params: { event_date_id: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.viewer_resolved ).toBe( false );
		expect( body.prefill_name ).toBe( '' );
		expect( body.prefill_email ).toBe( '' );
	} );

	test( 'display flags round-trip without affecting viewer_resolved', async () => {
		const res = await api.get( VIEWER_CONTEXT_PATH, {
			params: {
				event_date_id: eventDateId,
				show_ticket_price: '0',
				show_option_prices: '0',
			},
		} );
		expect( res.ok() ).toBeTruthy();
		expect( ( await res.json() ).viewer_resolved ).toBe( false );
	} );
} );
