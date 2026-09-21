/**
 * Live API coverage for event sales statistics.
 */

import { test, expect, request } from '@playwright/test';
import { execFileSync } from 'node:child_process';

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

function dateInTimezone( timezone ) {
	const parts = new Intl.DateTimeFormat( 'en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	} ).formatToParts( new Date() );
	const value = ( type ) =>
		parts.find( ( part ) => part.type === type ).value;
	return `${ value( 'year' ) }-${ value( 'month' ) }-${ value( 'day' ) }`;
}

function addDays( date, days ) {
	const value = new Date( `${ date }T12:00:00Z` );
	value.setUTCDate( value.getUTCDate() + days );
	return value.toISOString().slice( 0, 10 );
}

function setParticipantCreatedAt( eventDateId, participantId, createdAt ) {
	const output = execFileSync(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/set-event-participant-created-at.php',
			String( eventDateId ),
			String( participantId ),
			`${ createdAt }T12:00:00`,
		],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	const match = output.match( /E2E_EVENT_STATISTICS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Expected fixture output, got:\n${ output }` );
	}
	return JSON.parse( match[ 1 ] );
}

function addTransaction(
	relationshipId,
	amount,
	currency,
	status,
	kind,
	date,
	transactionId = 0
) {
	const output = execFileSync(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/seed-event-statistics-transaction.php',
			String( relationshipId ),
			String( amount ),
			currency,
			status,
			kind,
			`${ date } 12:00:00`,
			String( transactionId ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = output.match( /E2E_EVENT_STATISTICS_TRANSACTION:(\{.*\})/ );
	if ( ! match )
		throw new Error(
			`Expected transaction fixture output, got:\n${ output }`
		);
	return JSON.parse( match[ 1 ] ).transactionId;
}

test.describe( 'EventStatisticsController', () => {
	let api;
	let anonymousApi;
	let subscriberApi;
	let subscriberHeaders;
	let adminHeaders;
	let originalTimezone;
	let today;
	const eventIds = [];
	const participantIds = [];
	const occurrences = {};
	const username = `statistics-subscriber-${ Date.now() }`;
	const password = 'Statistics-test-1514!';

	async function createOccurrence(
		name,
		startOffset,
		endOffset = startOffset
	) {
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Statistics ${ name } ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( post.ok() ).toBeTruthy();
		const eventId = ( await post.json() ).id;
		eventIds.push( eventId );

		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Statistics ${ name } date`,
				start_datetime: `${ addDays( today, startOffset ) } 10:00:00`,
				end_datetime: `${ addDays( today, endOffset ) } 22:00:00`,
			},
		} );
		expect( date.ok() ).toBeTruthy();
		const eventDateId = ( await date.json() ).id;
		const link = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventId } }
		);
		expect( link.ok() ).toBeTruthy();
		return { eventId, eventDateId };
	}

	async function addParticipant( eventDateId, label, createdAt = null ) {
		const participant = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: `Statistics ${ label }`,
					email: `statistics-${ Date.now() }-${
						participantIds.length
					}@example.test`,
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
		const relationshipData = await relationship.json();
		if ( createdAt ) {
			const result = setParticipantCreatedAt(
				eventDateId,
				participantId,
				createdAt
			);
			expect( result.updated ).toBe( 1 );
		}
		return relationshipData.id;
	}

	async function getStatistics( eventDateId ) {
		const response = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/statistics`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		return response.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymousApi = await request.newContext( { baseURL: BASE_URL } );
		adminHeaders = await login( api, ADMIN_USER, ADMIN_PASSWORD );

		const settingsResponse = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		expect( settingsResponse.ok() ).toBeTruthy();
		originalTimezone = ( await settingsResponse.json() ).timezone;
		const utcHour = new Date().getUTCHours();
		const testTimezone =
			utcHour < 10 ? 'Pacific/Honolulu' : 'Pacific/Kiritimati';
		const updateSettings = await api.post( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
			data: { timezone: testTimezone },
		} );
		expect( updateSettings.ok() ).toBeTruthy();
		today = dateInTimezone( testTimezone );
		expect( today ).not.toBe( new Date().toISOString().slice( 0, 10 ) );

		occurrences.upcoming = await createOccurrence( 'upcoming', 10 );
		occurrences.farFuture = await createOccurrence( 'far future', 40 );
		occurrences.ongoing = await createOccurrence( 'ongoing', -2, 2 );
		occurrences.completed = await createOccurrence( 'completed', -5, -3 );
		occurrences.qualifying = await createOccurrence( 'qualifying', 12 );

		occurrences.upcoming.firstRelationshipId = await addParticipant(
			occurrences.upcoming.eventDateId,
			'signed_up',
			addDays( today, -20 )
		);
		occurrences.upcoming.secondRelationshipId = await addParticipant(
			occurrences.upcoming.eventDateId,
			'signed_up',
			today
		);
		for ( const label of [ 'signed_up', 'interested', 'collaborator' ] ) {
			await addParticipant( occurrences.qualifying.eventDateId, label );
		}

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

	test( 'aggregates payment history and excludes inconsistent currencies', async () => {
		const first = occurrences.upcoming.firstRelationshipId;
		const second = occurrences.upcoming.secondRelationshipId;
		const sharedCharge = addTransaction(
			first,
			10,
			'EUR',
			'paid',
			'charge',
			addDays( today, -25 )
		);
		addTransaction(
			first,
			7.5,
			'EUR',
			'paid',
			'charge',
			addDays( today, -5 )
		);
		addTransaction(
			first,
			2.5,
			'EUR',
			'paid',
			'refund',
			addDays( today, -2 )
		);
		addTransaction(
			first,
			99,
			'EUR',
			'failed',
			'charge',
			addDays( today, -1 )
		);
		addTransaction( first, 30, 'USD', 'paid', 'charge', today );
		addTransaction(
			second,
			10,
			'EUR',
			'paid',
			'charge',
			addDays( today, -25 ),
			sharedCharge
		);

		const body = await getStatistics( occurrences.upcoming.eventDateId );
		expect( body.currency ).toBe( 'EUR' );
		expect( body.total_sales ).toBe( 2 );
		expect( body.total_sales_amount ).toBe( 15 );
		expect( body.excluded_currencies ).toEqual( [ 'USD' ] );
		expect( body.amount_series.map( ( point ) => point.date ) ).toEqual(
			body.series.map( ( point ) => point.date )
		);
		expect( body.amount_series.map( ( point ) => point.label ) ).toEqual(
			body.series.map( ( point ) => point.label )
		);
		expect( body.amount_series[ 0 ].amount ).toBe( 10 );
		expect(
			body.amount_series.find(
				( point ) => point.date === addDays( today, -5 )
			).amount
		).toBe( 17.5 );
		expect(
			body.amount_series.find(
				( point ) => point.date === addDays( today, -2 )
			).amount
		).toBe( 15 );
		expect(
			body.amount_series.findLast(
				( point ) => typeof point.amount === 'number'
			).amount
		).toBe( body.total_sales_amount );
		expect( body.amount_series.at( -1 ).amount ).toBeNull();
	} );

	test.afterAll( async () => {
		if ( adminHeaders && originalTimezone !== undefined ) {
			await api.post( '/wp-json/wp/v2/settings', {
				headers: adminHeaders,
				data: { timezone: originalTimezone },
			} );
		}
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
		for ( const eventId of eventIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await api?.dispose();
		await anonymousApi?.dispose();
		await subscriberApi?.dispose();
	} );

	test( 'includes the event display name for chart labels', async () => {
		const body = await getStatistics( occurrences.upcoming.eventDateId );
		expect( typeof body.event_name ).toBe( 'string' );
		expect( body.event_name ).toMatch( /^Statistics upcoming/ );
		expect( body.event_name ).toBe( body.event_name.trim() );
	} );

	test( 'rejects anonymous and insufficient-capability requests', async () => {
		const endpoint = `/wp-json/fair-audience/v1/event-dates/${ occurrences.upcoming.eventDateId }/statistics`;
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

	test( 'keeps an upcoming event horizon with null future totals', async () => {
		const body = await getStatistics( occurrences.upcoming.eventDateId );
		expect( body.start_date ).toBe( addDays( today, 10 ) );
		expect( body.end_date ).toBe( addDays( today, 10 ) );
		expect( body.series[ 0 ].date ).toBe( addDays( today, -17 ) );
		expect( body.series[ 0 ].total ).toBe( 1 );
		const lastRecorded = body.series.findLast(
			( point ) => typeof point.total === 'number'
		);
		expect( lastRecorded ).toMatchObject( {
			date: today,
			total: 2,
		} );
		expect( lastRecorded.label ).toContain( '10 days before' );
		expect( body.series.at( -1 ) ).toMatchObject( {
			date: addDays( today, 10 ),
			label: 'Day of the event',
			total: null,
		} );
		expect( body.total_sales ).toBe( 2 );
		expect( lastRecorded.total ).toBe( body.total_sales );
		expect(
			body.series
				.filter( ( point ) => point.date > today )
				.every( ( point ) => point.total === null )
		).toBe( true );
	} );

	test( 'starts a far-future range today and ends on the event day', async () => {
		const body = await getStatistics( occurrences.farFuture.eventDateId );
		expect( body.total_sales ).toBe( 0 );
		expect( body.series[ 0 ] ).toEqual( {
			date: today,
			label: '40 days before the event',
			total: 0,
		} );
		expect( body.series.at( -1 ) ).toEqual( {
			date: addDays( today, 40 ),
			label: 'Day of the event',
			total: null,
		} );
		expect( body.series ).toHaveLength( 41 );
	} );

	test( 'keeps remaining ongoing event days as null points', async () => {
		const body = await getStatistics( occurrences.ongoing.eventDateId );
		expect( body.end_date ).toBe( addDays( today, 2 ) );
		const lastRecorded = body.series.findLast(
			( point ) => typeof point.total === 'number'
		);
		expect( lastRecorded.date ).toBe( today );
		expect( lastRecorded.label ).toContain( '3rd day' );
		expect( lastRecorded.total ).toBe( body.total_sales );
		expect( body.series.at( -1 ) ).toMatchObject( {
			date: addDays( today, 2 ),
			label: '5th day of the event',
			total: null,
		} );
	} );

	test( 'keeps a completed event through its configured final day', async () => {
		const body = await getStatistics( occurrences.completed.eventDateId );
		expect( body.end_date ).toBe( addDays( today, -3 ) );
		expect( body.series.at( -1 ).date ).toBe( addDays( today, -3 ) );
		expect( body.series.at( -1 ).label ).toContain( '3rd day' );
		expect( body.series.at( -1 ).total ).toBe( body.total_sales );
	} );

	test( 'counts only signed-up rows and preserves the final total', async () => {
		const body = await getStatistics( occurrences.qualifying.eventDateId );
		expect( body.total_sales ).toBe( 1 );
		expect(
			body.series.findLast( ( point ) => typeof point.total === 'number' )
				.total
		).toBe( body.total_sales );
	} );
} );
