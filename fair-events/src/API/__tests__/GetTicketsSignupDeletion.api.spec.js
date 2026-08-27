/**
 * Playwright API tests for exact-ID signup deletion (#1464).
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

test.describe( 'GetTicketsController — signup deletion', () => {
	let api;
	let eventDateId;
	let firstSignupId;
	let secondSignupId;
	let sharedEmail;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const eventDateResponse = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Signup deletion test ${ Date.now() }`,
					start_datetime: '2035-07-01 10:00:00',
					end_datetime: '2035-07-01 12:00:00',
				},
			}
		);
		const eventDateBody = await eventDateResponse.json();
		expect(
			eventDateResponse.ok(),
			JSON.stringify( eventDateBody )
		).toBeTruthy();
		eventDateId = eventDateBody.id;

		sharedEmail = `shared-signup-${ Date.now() }-${ Math.random() }@example.test`;
		for ( const suffix of [ 'first', 'second' ] ) {
			const signupResponse = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDateId,
						name: 'Shared Signup Person',
						email: sharedEmail,
						quantity: 1,
						_honeypot: '',
					},
				}
			);
			expect( signupResponse.ok(), suffix ).toBeTruthy();
		}

		const listResponse = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: eventDateId },
			}
		);
		expect( listResponse.ok() ).toBeTruthy();
		const matchingSignups = ( await listResponse.json() ).filter(
			( signup ) => signup.email === sharedEmail
		);
		expect( matchingSignups ).toHaveLength( 2 );
		[ firstSignupId, secondSignupId ] = matchingSignups.map(
			( signup ) => signup.id
		);
	} );

	test.afterAll( async () => {
		for ( const signupId of [ firstSignupId, secondSignupId ] ) {
			if ( signupId ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
					{ headers: adminHeaders }
				);
			}
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'rejects an unauthenticated deletion', async () => {
		const response = await api.delete(
			`/wp-json/fair-events/v1/get-tickets/${ firstSignupId }`
		);
		expect( response.status() ).toBe( 401 );
	} );

	test( 'returns 404 for a missing signup', async () => {
		const response = await api.delete(
			'/wp-json/fair-events/v1/get-tickets/2147483647',
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 404 );
	} );

	test( 'deletes a confirmed signup by exact ID and leaves its duplicate', async () => {
		const before = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		const beforeRows = await before.json();
		expect(
			beforeRows.find( ( signup ) => signup.id === firstSignupId ).status
		).toBe( 'confirmed' );

		const response = await api.delete(
			`/wp-json/fair-events/v1/get-tickets/${ firstSignupId }`,
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 200 );
		const result = await response.json();
		expect( result.deleted ).toBe( true );
		expect( result.signup.id ).toBe( firstSignupId );

		const after = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		const afterRows = await after.json();
		expect(
			afterRows.some( ( signup ) => signup.id === firstSignupId )
		).toBe( false );
		expect(
			afterRows.some( ( signup ) => signup.id === secondSignupId )
		).toBe( true );
	} );
} );
