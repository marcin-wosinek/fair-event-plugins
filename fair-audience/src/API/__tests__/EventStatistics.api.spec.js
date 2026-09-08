/**
 * Live API coverage for event sales statistics.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
async function login( api, user, password ) {
	await api.post( '/wp-login.php', {
		form: { log: user, pwd: password, rememberme: 'forever' },
	} );
	const nonce = await api.get( '/wp-admin/admin-ajax.php?action=rest-nonce' );
	expect( nonce.ok() ).toBeTruthy();
	return { 'X-WP-Nonce': await nonce.text() };
}

test.describe( 'EventStatisticsController', () => {
	let api;
	let anonymousApi;
	let subscriberApi;
	let subscriberHeaders;
	let adminHeaders;
	let eventId;
	let eventDateId;
	const participantIds = [];
	const username = `statistics-subscriber-${ Date.now() }`;
	const password = 'Statistics-test-1514!';

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymousApi = await request.newContext( { baseURL: BASE_URL } );
		adminHeaders = await login( api, ADMIN_USER, ADMIN_PASSWORD );
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Statistics API ${ Date.now() }`,
				status: 'publish',
			},
		} );
		if ( ! post.ok() ) {
			throw new Error( `event fixture failed: ${ await post.text() }` );
		}
		eventId = ( await post.json() ).id;

		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: 'Statistics API date',
				start_datetime: '2036-03-30 10:00:00',
				end_datetime: '2036-04-01 22:00:00',
			},
		} );
		expect( date.ok() ).toBeTruthy();
		eventDateId = ( await date.json() ).id;
		const link = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventId } }
		);
		expect( link.ok() ).toBeTruthy();

		const user = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( user.ok() ).toBeTruthy();
		subscriberApi = await request.newContext( { baseURL: BASE_URL } );
		subscriberHeaders = await login( subscriberApi, username, password );
	} );

	test.afterAll( async () => {
		for ( const id of participantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{
					headers: adminHeaders,
				}
			);
		}
		const users = await api.get( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			params: { search: username },
		} );
		if ( users.ok() ) {
			for ( const user of await users.json() ) {
				await api.delete( `/wp-json/wp/v2/users/${ user.id }`, {
					headers: adminHeaders,
					params: { force: 'true', reassign: '1' },
				} );
			}
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
		await anonymousApi.dispose();
		await subscriberApi.dispose();
	} );

	test( 'rejects anonymous and insufficient-capability requests', async () => {
		const endpoint = `/wp-json/fair-audience/v1/event-dates/${ eventDateId }/statistics`;
		expect( ( await anonymousApi.get( endpoint ) ).status() ).toBe( 401 );
		expect(
			(
				await subscriberApi.get( endpoint, {
					headers: subscriberHeaders,
				} )
			).status()
		).toBe( 403 );
	} );

	test( 'returns 404 for a missing occurrence', async () => {
		const response = await api.get(
			'/wp-json/fair-audience/v1/event-dates/999999999/statistics',
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 404 );
	} );

	test( 'returns a timezone-safe empty multi-day series', async () => {
		const response = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/statistics`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		const body = await response.json();
		expect( body.total_sales ).toBe( 0 );
		expect( body.start_date ).toBe( '2036-03-30' );
		expect( body.end_date ).toBe( '2036-04-01' );
		expect( body.series ).toHaveLength( 30 );
		expect( body.series[ 0 ].total ).toBe( 0 );
		expect( body.series.at( -1 ).total ).toBe( 0 );
		expect( body.series.at( -1 ).label ).toContain( '3rd' );
		expect( body.days_until_start ).toBeGreaterThan( 0 );
	} );

	test( 'counts only signed-up rows and carries the cumulative total', async () => {
		for ( const [ index, label ] of [
			'signed_up',
			'interested',
			'collaborator',
		].entries() ) {
			const participant = await api.post(
				'/wp-json/fair-audience/v1/participants',
				{
					headers: adminHeaders,
					data: {
						name: `Statistics ${ label }`,
						email: `statistics-${ Date.now() }-${ index }@example.test`,
					},
				}
			);
			expect( participant.ok() ).toBeTruthy();
			const participantId = ( await participant.json() ).id;
			participantIds.push( participantId );
			const relationship = await api.post(
				`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
				{
					headers: adminHeaders,
					data: { participant_id: participantId, label },
				}
			);
			expect( relationship.ok() ).toBeTruthy();
		}

		const response = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/statistics`,
			{ headers: adminHeaders }
		);
		const body = await response.json();
		expect( body.total_sales ).toBe( 1 );
		// The signup predates the 27-day window, so it seeds the opening value.
		expect( body.series[ 0 ].total ).toBe( 1 );
		expect( body.series.every( ( point ) => point.total === 1 ) ).toBe(
			true
		);
		expect( body.series.at( -1 ).total ).toBe( body.total_sales );
	} );
} );
