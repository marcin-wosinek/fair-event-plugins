/**
 * Live API coverage for event sales statistics: the canonical fair-events
 * route and the fair-audience path it moved from (#1726), and the capacity
 * figures it reports beside them (#1711).
 */

import { test, expect, request } from '@playwright/test';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

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

function runFixture( script, args, marker ) {
	const output = execFileSync(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			`wp-content/mu-plugins/scripts/${ script }`,
			...args,
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = output.match( new RegExp( `${ marker }:(\\{.*\\})` ) );
	if ( ! match ) {
		throw new Error( `Expected ${ marker } output, got:\n${ output }` );
	}
	return JSON.parse( match[ 1 ] );
}

function ticketFixture( action, data ) {
	return runFixture(
		'seed-event-statistics-tickets.php',
		[ action, JSON.stringify( data ) ],
		'E2E_EVENT_STATISTICS_TICKETS'
	);
}

// The same fixture without blocking the event loop. A long run of blocking
// fixture calls leaves the server time to close the idle keep-alive
// connections unnoticed, and the next request then fails with "socket hang
// up".
async function ticketFixtureAsync( action, data ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/seed-event-statistics-tickets.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_EVENT_STATISTICS_TICKETS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Expected fixture output, got:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

const NAMESPACES = [ 'fair-events/v1', 'fair-audience/v1' ];

const statisticsPath = ( namespace, eventDateId ) =>
	`/wp-json/${ namespace }/event-dates/${ eventDateId }/statistics`;

const confirmed = ( ...activities ) => ( {
	status: 'confirmed',
	activities,
} );

test.describe( 'EventStatisticsController', () => {
	// Several tests seed through a dozen or more sequential WP-CLI fixture
	// calls, each taking seconds, which overruns the default 30s budget.
	test.describe.configure( { timeout: 120 * 1000 } );

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
	let series;
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

	async function addRelationship( eventDateId, label = 'signed_up' ) {
		const participant = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Statistics ticket holder',
					email: `statistics-ticket-${ Date.now() }-${
						participantIds.length
					}@example.test`,
				},
			}
		);
		expect( participant.ok() ).toBeTruthy();
		const participantId = ( await participant.json() ).id;
		participantIds.push( participantId );
		if ( ! eventDateId ) {
			return { participantId };
		}
		const relationship = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{
				headers: adminHeaders,
				data: { participant_id: participantId, label },
			}
		);
		expect( relationship.ok() ).toBeTruthy();
		return {
			participantId,
			relationshipId: ( await relationship.json() ).id,
		};
	}

	// Every assertion runs against the canonical route; the compatibility
	// alias must answer with the same body.
	async function getStatistics( eventDateId ) {
		const [ canonical, legacy ] = await Promise.all(
			NAMESPACES.map( async ( namespace ) => {
				const response = await api.get(
					statisticsPath( namespace, eventDateId ),
					{ headers: adminHeaders }
				);
				expect( response.ok() ).toBeTruthy();
				return response.json();
			} )
		);
		expect( legacy ).toEqual( canonical );
		return canonical;
	}

	// What TicketCapacity itself counts, through the test-only route.
	async function capacityCounts( {
		eventDateIds = [],
		ticketTypeIds = [],
		options = [],
	} ) {
		const params = new URLSearchParams();
		eventDateIds.forEach( ( id ) =>
			params.append( 'event_date_ids[]', id )
		);
		ticketTypeIds.forEach( ( id ) =>
			params.append( 'ticket_type_ids[]', id )
		);
		options.forEach( ( pair ) => params.append( 'options[]', pair ) );
		const response = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?${ params }`,
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
		occurrences.tickets = await createOccurrence( 'tickets', 10 );
		occurrences.capacity = await createOccurrence( 'capacity', 10 );

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
		ticketFixture( 'cleanup', {
			eventDateIds: Object.values( occurrences ).map(
				( occurrence ) => occurrence.eventDateId
			),
			configuredEventDateIds: occurrences.capacity
				? [ occurrences.capacity.eventDateId ]
				: [],
		} );
		if ( series ) {
			ticketFixture( 'cleanup', { eventDateIds: series.occurrenceIds } );
			runFixture(
				'cleanup-event.php',
				[ String( series.eventId ), String( series.eventDateId ) ],
				'E2E_CLEANUP'
			);
		}
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

	test( 'counts confirmed tickets, historical admissions, and per-ticket activities', async () => {
		const eventDateId = occurrences.tickets.eventDateId;
		const at = ( offset, time = '12:00:00' ) =>
			`${ addDays( today, offset ) } ${ time }`;
		const signup = ( participantId, createdAt, units, extra = {} ) =>
			ticketFixture( 'signup', {
				eventDateId,
				participantId,
				quantity: units.length,
				createdAt,
				units,
				...extra,
			} );
		const yoga = { optionId: 900001, name: 'Yoga' };
		const acro = { optionId: 900002, name: 'Acro' };
		const thai = { optionId: 900003, name: 'Thai' };
		const otherYoga = { optionId: 900005, name: 'Yoga' };

		// One participant, two purchases: three tickets, then one more.
		const buyer = await addRelationship( eventDateId );
		const threeTickets = signup( buyer.participantId, at( -6 ), [
			confirmed( yoga, acro ),
			confirmed( yoga ),
			confirmed(),
		] );
		const oneMore = signup( buyer.participantId, at( -4 ), [
			confirmed( acro ),
		] );
		// A refunded sibling and a pending activity hold do not count; an
		// activity with the same name but another ID stays separate.
		signup(
			( await addRelationship( eventDateId ) ).participantId,
			at( -4 ),
			[
				confirmed( otherYoga, { ...thai, status: 'pending_payment' } ),
				{ status: 'refunded', activities: [ acro ] },
			]
		);
		// Pending, failed and expired tickets are not confirmed sales.
		const unpaid = ( await addRelationship( eventDateId ) ).participantId;
		signup( unpaid, at( -5 ), [
			{ status: 'pending_payment' },
			{ status: 'failed' },
		] );
		signup( unpaid, at( -5 ), [ { status: 'expired' } ] );
		signup( unpaid, at( -5 ), [], {
			quantity: 1,
			status: 'pending_payment',
		} );
		// Historical signups without ticket rows count by quantity: before
		// the chart window, with no activities...
		signup( null, at( -30 ), [], { quantity: 2 } );
		// ...one ticket with participant-scoped activities...
		const single = await addRelationship( eventDateId );
		signup( single.participantId, at( -2 ), [], { quantity: 1 } );
		ticketFixture( 'participant-option', {
			relationshipId: single.relationshipId,
			...yoga,
		} );
		// ...and two tickets whose activities cannot be attributed.
		const ambiguous = await addRelationship( eventDateId );
		signup( ambiguous.participantId, at( -2 ), [], { quantity: 2 } );
		ticketFixture( 'participant-option', {
			relationshipId: ambiguous.relationshipId,
			...acro,
		} );
		// A partial backfill counts its rows only, at a late local hour.
		signup( null, at( -1, '23:30:00' ), [ confirmed(), confirmed() ], {
			quantity: 3,
		} );
		// A relationship with no signup is one historical admission.
		const legacy = await addRelationship( eventDateId );
		setParticipantCreatedAt(
			eventDateId,
			legacy.participantId,
			addDays( today, -3 )
		);
		ticketFixture( 'participant-option', {
			relationshipId: legacy.relationshipId,
			...thai,
		} );
		addTransaction(
			legacy.relationshipId,
			20,
			'EUR',
			'paid',
			'charge',
			addDays( today, -3 )
		);

		let body = await getStatistics( eventDateId );
		expect( body.total_tickets ).toBe( 13 );
		expect( body.total_sales ).toBe( body.total_tickets );
		expect( body.total_sales_amount ).toBe( 20 );
		expect( body.tickets_without_activity_assignment ).toBe( 2 );
		expect( body.incomplete_ticket_backfills ).toBe( 1 );
		const totalOn = ( offset ) =>
			body.series.find(
				( point ) => point.date === addDays( today, offset )
			).total;
		expect( body.series[ 0 ].total ).toBe( 2 );
		expect( totalOn( -6 ) ).toBe( 5 );
		expect( totalOn( -5 ) ).toBe( 5 );
		expect( totalOn( -4 ) ).toBe( 7 );
		expect( totalOn( -3 ) ).toBe( 8 );
		expect( totalOn( -2 ) ).toBe( 11 );
		expect( totalOn( -1 ) ).toBe( 13 );
		expect( totalOn( 0 ) ).toBe( 13 );
		expect( body.tickets_per_activity ).toEqual( [
			{ id: 900001, name: 'Yoga', count: 3 },
			{ id: 900002, name: 'Acro', count: 2 },
			{ id: 900003, name: 'Thai', count: 1 },
			{ id: 900005, name: 'Yoga', count: 1 },
		] );
		expect( body.activities_per_ticket ).toEqual( [
			{ activities: 0, tickets: 5 },
			{ activities: 1, tickets: 5 },
			{ activities: 2, tickets: 1 },
		] );
		expect( JSON.stringify( body ) ).not.toMatch( /@example\.test/ );

		// A transfer changes nothing; each cancellation or refund removes one.
		const second = await addRelationship( null );
		ticketFixture( 'transfer', {
			ticketId: threeTickets.ticketIds[ 1 ],
			holderParticipantId: second.participantId,
		} );
		expect( ( await getStatistics( eventDateId ) ).total_tickets ).toBe(
			13
		);
		ticketFixture( 'ticket-status', {
			ticketId: threeTickets.ticketIds[ 2 ],
			status: 'cancelled',
		} );
		body = await getStatistics( eventDateId );
		expect( body.total_tickets ).toBe( 12 );
		expect( body.activities_per_ticket[ 0 ] ).toEqual( {
			activities: 0,
			tickets: 4,
		} );
		ticketFixture( 'ticket-status', {
			ticketId: oneMore.ticketIds[ 0 ],
			status: 'refunded',
		} );
		body = await getStatistics( eventDateId );
		expect( body.total_tickets ).toBe( 11 );
		expect( body.total_sales_amount ).toBe( 20 );
		expect(
			body.tickets_per_activity.find( ( row ) => row.id === 900002 ).count
		).toBe( 1 );
	} );

	test( 'counts whole-series tickets once on each applicable occurrence', async () => {
		series = runFixture(
			'seed-event.php',
			[ 'three-ticket-scopes', JSON.stringify( { omitMulti: true } ) ],
			'E2E_SEED'
		);
		const [ masterId, firstId, secondId ] = series.occurrenceIds;
		const starts = {};
		for ( const id of series.occurrenceIds ) {
			const response = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ id }`,
				{ headers: adminHeaders }
			);
			expect( response.ok() ).toBeTruthy();
			starts[ id ] = ( await response.json() ).start_datetime;
		}
		const [ wholeSeriesTypeId ] = series.extraTypeIds;
		const hourAfter = ( datetime ) =>
			datetime.replace(
				/ (\d\d):/,
				( _, hour ) =>
					` ${ String( Number( hour ) + 1 ).padStart( 2, '0' ) }:`
			);
		const dayBefore = ( datetime ) =>
			`${ addDays( datetime.slice( 0, 10 ), -1 ) } 12:00:00`;

		// Bought before the series starts: applies to every occurrence.
		ticketFixture( 'signup', {
			eventDateId: masterId,
			participantId: ( await addRelationship( null ) ).participantId,
			ticketTypeId: wholeSeriesTypeId,
			quantity: 2,
			createdAt: dayBefore( starts[ masterId ] ),
			units: [
				confirmed( { optionId: 900001, name: 'Yoga' } ),
				confirmed(),
			],
		} );
		// Bought from the second occurrence after it started: third only.
		ticketFixture( 'signup', {
			eventDateId: firstId,
			participantId: ( await addRelationship( null ) ).participantId,
			ticketTypeId: wholeSeriesTypeId,
			quantity: 1,
			createdAt: hourAfter( starts[ firstId ] ),
			units: [ confirmed() ],
		} );
		// A single-session ticket stays on its own occurrence.
		ticketFixture( 'signup', {
			eventDateId: firstId,
			participantId: ( await addRelationship( null ) ).participantId,
			ticketTypeId: series.ticketTypeId,
			quantity: 1,
			createdAt: dayBefore( starts[ masterId ] ),
			units: [ confirmed() ],
		} );

		const master = await getStatistics( masterId );
		const first = await getStatistics( firstId );
		const second = await getStatistics( secondId );
		expect( master.total_tickets ).toBe( 2 );
		expect( first.total_tickets ).toBe( 3 );
		expect( second.total_tickets ).toBe( 3 );
		expect( second.tickets_per_activity ).toEqual( [
			{ id: 900001, name: 'Yoga', count: 1 },
		] );
		expect( second.activities_per_ticket ).toEqual( [
			{ activities: 0, tickets: 2 },
			{ activities: 1, tickets: 1 },
		] );

		// Capacity (#1711): limits are configured on the series master. The
		// event and activity limits apply to each date on its own; a ticket
		// type's limit is one pool for the whole series.
		const [ workshopId ] = ticketFixture( 'configure', {
			eventDateId: masterId,
			eventCapacity: 3,
			options: [ { name: 'Series workshop', capacity: 2 } ],
		} ).optionIds;
		ticketFixture( 'ticket-type-limit', {
			ticketTypeId: wholeSeriesTypeId,
			capacity: 2,
		} );
		const workshop = { optionId: workshopId, name: 'Series workshop' };
		// Another pass bought before the series starts: every date.
		ticketFixture( 'signup', {
			eventDateId: masterId,
			participantId: null,
			ticketTypeId: wholeSeriesTypeId,
			quantity: 1,
			createdAt: dayBefore( starts[ masterId ] ),
			units: [ confirmed( workshop ) ],
		} );
		// A single-session ticket on the second date.
		ticketFixture( 'signup', {
			eventDateId: firstId,
			participantId: null,
			ticketTypeId: series.ticketTypeId,
			quantity: 1,
			createdAt: dayBefore( starts[ masterId ] ),
			units: [ confirmed( workshop ) ],
		} );
		// A single-session ticket on the third date, held for payment.
		ticketFixture( 'signup', {
			eventDateId: secondId,
			participantId: null,
			ticketTypeId: series.ticketTypeId,
			quantity: 1,
			status: 'pending_payment',
			holdMinutes: 30,
			createdAt: dayBefore( starts[ masterId ] ),
			units: [ { status: 'pending_payment', activities: [ workshop ] } ],
		} );

		const counts = await capacityCounts( {
			eventDateIds: series.occurrenceIds,
			ticketTypeIds: [ series.ticketTypeId, wholeSeriesTypeId ],
			options: series.occurrenceIds.map(
				( id ) => `${ workshopId }:${ id }`
			),
		} );
		const expectedEvent = {
			[ masterId ]: { taken: 3, capacity: 3, remaining: 0, over: 0 },
			[ firstId ]: { taken: 5, capacity: 3, remaining: 0, over: 2 },
			[ secondId ]: { taken: 5, capacity: 3, remaining: 0, over: 2 },
		};
		const expectedWorkshop = {
			[ masterId ]: { taken: 1, capacity: 2, remaining: 1, over: 0 },
			[ firstId ]: { taken: 2, capacity: 2, remaining: 0, over: 0 },
			[ secondId ]: { taken: 2, capacity: 2, remaining: 0, over: 0 },
		};
		for ( const id of series.occurrenceIds ) {
			const body = await getStatistics( id );
			expect( body.event_capacity ).toEqual( expectedEvent[ id ] );
			expect( body.event_capacity.taken ).toBe(
				counts.event_dates[ id ]
			);
			// The same shared pools, whichever date is selected.
			expect( body.ticket_type_capacity ).toEqual( [
				{
					id: series.ticketTypeId,
					name: 'Single Session',
					series_wide: true,
					taken: 3,
					capacity: null,
					remaining: null,
					over: 0,
				},
				{
					id: wholeSeriesTypeId,
					name: 'Full Series Pass',
					series_wide: true,
					taken: 4,
					capacity: 2,
					remaining: 0,
					over: 2,
				},
			] );
			for ( const row of body.ticket_type_capacity ) {
				expect( row.taken ).toBe( counts.ticket_types[ row.id ] );
			}
			expect( body.activity_capacity ).toEqual( [
				{
					id: workshopId,
					name: 'Series workshop',
					...expectedWorkshop[ id ],
				},
			] );
			expect( body.activity_capacity[ 0 ].taken ).toBe(
				counts.ticket_options[ `${ workshopId }:${ id }` ]
			);
		}
	} );

	test( 'reports places taken against event, ticket type, and activity limits', async () => {
		const eventDateId = occurrences.capacity.eventDateId;
		const createdAt = `${ addDays( today, -1 ) } 12:00:00`;
		const {
			ticketTypeIds: [ limitedId, openId ],
			optionIds: [ workshopId, floorId ],
		} = await ticketFixtureAsync( 'configure', {
			eventDateId,
			eventCapacity: 5,
			ticketTypes: [
				{ name: 'Limited', capacity: 3 },
				{ name: 'Open', capacity: null },
			],
			options: [
				{ name: 'Workshop', capacity: 2 },
				{ name: 'Open floor', capacity: null },
			],
		} );
		const workshop = { optionId: workshopId, name: 'Workshop' };
		const floor = { optionId: floorId, name: 'Open floor' };
		const signup = ( ticketTypeId, units, extra = {} ) =>
			ticketFixtureAsync( 'signup', {
				eventDateId,
				participantId: null,
				ticketTypeId,
				quantity: units.length,
				createdAt,
				units,
				...extra,
			} );

		// Two tickets of one purchase choosing the same activity take one
		// place each.
		const pair = await signup( limitedId, [
			confirmed( workshop ),
			confirmed( workshop ),
		] );
		// A running payment hold takes its places; a lapsed one does not.
		await signup(
			limitedId,
			[ { status: 'pending_payment', activities: [ floor ] } ],
			{ status: 'pending_payment', holdMinutes: 30 }
		);
		await signup(
			limitedId,
			[ { status: 'pending_payment', activities: [ workshop ] } ],
			{ status: 'pending_payment', holdMinutes: -5 }
		);
		// Cancelled and refunded tickets release their places.
		await signup( openId, [
			confirmed(),
			{ status: 'cancelled', activities: [ workshop ] },
			{ status: 'refunded' },
		] );
		// A booking past the activity's and the event's limit, and an
		// activity hold that ran out.
		await signup( openId, [
			confirmed( workshop ),
			confirmed( {
				...workshop,
				status: 'pending_payment',
				holdMinutes: -5,
			} ),
		] );

		let body = await getStatistics( eventDateId );
		// Confirmed sales leave the payment hold out; capacity counts it.
		expect( body.total_tickets ).toBe( 5 );
		expect( body.event_capacity ).toEqual( {
			taken: 6,
			capacity: 5,
			remaining: 0,
			over: 1,
		} );
		expect( body.ticket_type_capacity ).toEqual( [
			{
				id: limitedId,
				name: 'Limited',
				series_wide: false,
				taken: 3,
				capacity: 3,
				remaining: 0,
				over: 0,
			},
			{
				id: openId,
				name: 'Open',
				series_wide: false,
				taken: 3,
				capacity: null,
				remaining: null,
				over: 0,
			},
		] );
		expect( body.activity_capacity ).toEqual( [
			{
				id: workshopId,
				name: 'Workshop',
				taken: 3,
				capacity: 2,
				remaining: 0,
				over: 1,
			},
			{
				id: floorId,
				name: 'Open floor',
				taken: 1,
				capacity: null,
				remaining: null,
				over: 0,
			},
		] );

		// The figures are the capacity service's own counts.
		const counts = await capacityCounts( {
			eventDateIds: [ eventDateId ],
			ticketTypeIds: [ limitedId, openId ],
			options: [ workshopId, floorId ].map(
				( id ) => `${ id }:${ eventDateId }`
			),
		} );
		expect( body.event_capacity.taken ).toBe(
			counts.event_dates[ eventDateId ]
		);
		for ( const row of body.ticket_type_capacity ) {
			expect( row.taken ).toBe( counts.ticket_types[ row.id ] );
		}
		for ( const row of body.activity_capacity ) {
			expect( row.taken ).toBe(
				counts.ticket_options[ `${ row.id }:${ eventDateId }` ]
			);
		}

		// Aggregates only: no buyer details.
		expect( JSON.stringify( body ) ).not.toMatch(
			/@example\.test|Statistics buyer/
		);

		// Cancelling a ticket releases its event, type and activity places.
		await ticketFixtureAsync( 'ticket-status', {
			ticketId: pair.ticketIds[ 0 ],
			status: 'cancelled',
		} );
		body = await getStatistics( eventDateId );
		expect( body.event_capacity ).toEqual( {
			taken: 5,
			capacity: 5,
			remaining: 0,
			over: 0,
		} );
		expect( body.ticket_type_capacity[ 0 ] ).toMatchObject( {
			taken: 2,
			remaining: 1,
			over: 0,
		} );
		expect( body.activity_capacity[ 0 ] ).toMatchObject( {
			taken: 2,
			remaining: 0,
			over: 0,
		} );
	} );

	test( 'reports unlimited, empty capacity for an event without limits', async () => {
		const body = await getStatistics( occurrences.farFuture.eventDateId );
		expect( body.event_capacity ).toEqual( {
			taken: 0,
			capacity: null,
			remaining: null,
			over: 0,
		} );
		expect( body.ticket_type_capacity ).toEqual( [] );
		expect( body.activity_capacity ).toEqual( [] );
	} );

	test( 'includes the event display name for chart labels', async () => {
		const body = await getStatistics( occurrences.upcoming.eventDateId );
		expect( typeof body.event_name ).toBe( 'string' );
		expect( body.event_name ).toMatch( /^Statistics upcoming/ );
		expect( body.event_name ).toBe( body.event_name.trim() );
	} );

	for ( const namespace of NAMESPACES ) {
		test( `rejects anonymous and insufficient-capability requests on ${ namespace }`, async () => {
			const endpoint = statisticsPath(
				namespace,
				occurrences.upcoming.eventDateId
			);
			expect( ( await anonymousApi.get( endpoint ) ).status() ).toBe(
				401
			);
			expect(
				(
					await subscriberApi.get( endpoint, {
						headers: subscriberHeaders,
					} )
				).status()
			).toBe( 403 );
		} );

		test( `returns 404 for a missing occurrence on ${ namespace }`, async () => {
			const response = await api.get(
				statisticsPath( namespace, 999999999 ),
				{ headers: adminHeaders }
			);
			expect( response.status() ).toBe( 404 );
		} );

		test( `registers a single GET handler on ${ namespace }`, async () => {
			const response = await api.get( `/wp-json/${ namespace }`, {
				headers: adminHeaders,
			} );
			expect( response.ok() ).toBeTruthy();
			const { routes } = await response.json();
			const route =
				routes[
					`/${ namespace }/event-dates/(?P<event_date_id>\\d+)/statistics`
				];
			expect( route ).toBeDefined();
			expect(
				route.endpoints.filter( ( endpoint ) =>
					endpoint.methods.includes( 'GET' )
				)
			).toHaveLength( 1 );
		} );
	}

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
