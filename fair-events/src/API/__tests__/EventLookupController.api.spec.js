/**
 * Playwright API tests for EventLookupController.
 *
 * Verifies POST /fair-events/v1/lookup-url rejects non-http(s) URLs,
 * enforces the permission check, and fetches metadata from a live page.
 * The Meetup cases fetch captured pages served by the test-only
 * e2e/mu-plugins/lib/meetup-page-http-double.php, so they never reach Meetup.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeader = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'EventLookupController', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'rejects a non-http(s) URL', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: 'ftp://example.com/event' },
		} );

		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects requests without permission', async () => {
		const anonymousApi = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymousApi.post(
			'/wp-json/fair-events/v1/lookup-url',
			{
				data: { url: 'https://example.com' },
			}
		);

		expect( [ 401, 403 ] ).toContain( res.status() );
		await anonymousApi.dispose();
	} );

	test( 'fetches and extracts metadata from a known page', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: 'https://example.com' },
		} );

		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body.title ).toBeTruthy();
		expect( body ).toHaveProperty( 'found' );
	} );

	const meetupUrl = ( group ) =>
		`https://www.meetup.com/${ group }/events/317238692/?eventOrigin=group_calendar`;

	// November 2, 2026, 10:00–11:00 in Europe/Madrid, as the tests site's
	// local time (the controller converts to the site timezone).
	const expectReportedTiming = ( body ) => {
		expect( body ).toMatchObject( {
			title: 'Morning yoga in the park 🌞🌿',
			all_day: false,
			location: 'Puente del Mar',
			found: [ 'title', 'start', 'end', 'location' ],
		} );
		expect( body.start_date ).toMatch( /^\d{4}-\d{2}-\d{2}$/ );
		expect( body.start_time ).toMatch( /^\d{2}:\d{2}:\d{2}$/ );
		// One hour long, and the combined fields agree with the split ones.
		expect( body.start_datetime ).toBe(
			`${ body.start_date } ${ body.start_time }`
		);
		expect( body.end_datetime ).toBe(
			`${ body.end_date } ${ body.end_time }`
		);
		expect(
			Date.parse( body.end_datetime.replace( ' ', 'T' ) + 'Z' ) -
				Date.parse( body.start_datetime.replace( ' ', 'T' ) + 'Z' )
		).toBe( 60 * 60 * 1000 );
	};

	test( 'extracts a Meetup event from its SportsEvent schema (#2124)', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: meetupUrl( 'fair-e2e-meetup' ) },
		} );

		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.source ).toBe( 'schema' );
		expectReportedTiming( body );
	} );

	test( 'falls back to the matching embedded Meetup event (#2124)', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: meetupUrl( 'fair-e2e-meetup-embedded' ) },
		} );

		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.source ).toBe( 'meetup' );
		expectReportedTiming( body );
	} );

	test( 'reports a Meetup page that refuses access (#2124)', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/lookup-url', {
			headers: authHeader,
			data: { url: meetupUrl( 'fair-e2e-meetup-blocked' ) },
		} );

		expect( res.status() ).toBe( 502 );
		const body = await res.json();
		expect( body.code ).toBe( 'rest_lookup_bad_status' );
	} );
} );
