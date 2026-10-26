/**
 * Playwright API tests for group-restricted ticket types while group
 * membership can't be verified (#1298).
 *
 * Restrictions are stored by Fair Events, but checking a buyer against them
 * needs Fair Audience and Fair Audience Experimental. Without either one a
 * restricted tier fails closed: fair-events/v1/get-tickets refuses it with
 * 403 ticket_type_restricted — on the single- and multiple-occurrence paths
 * alike — and writes no signup, while unrestricted tiers sell as before.
 * Fair Events Experimental plays no part, so every case runs with it both
 * active and inactive. The last case checks the restriction survived all the
 * toggling and is checked normally once both plugins are back.
 *
 * The restricted tiers name a group that doesn't exist, so nobody can be a
 * member of it: membership itself is covered by fair-audience's
 * EventSignupGroupPricing.api.spec.js.
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

const AUDIENCE = 'fair-audience/fair-audience';
const AUDIENCE_EXPERIMENTAL =
	'fair-audience-experimental/fair-audience-experimental';
const EVENTS_EXPERIMENTAL = 'fair-events-experimental/fair-events-experimental';

// No group has this ID, so no buyer can belong to it.
const MISSING_GROUP_ID = 987654321;

const ALWAYS_ON = {
	name: 'Always on',
	sale_start: '2020-01-01 00:00:00',
	sale_end: '2099-01-01 00:00:00',
};

function uniqueEmail( prefix ) {
	return `${ prefix }+${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

async function setPluginStatus( api, plugin, status ) {
	const res = await api.put( `/wp-json/wp/v2/plugins/${ plugin }`, {
		headers: adminHeaders,
		data: { status },
	} );
	expect( res.ok(), await res.text() ).toBeTruthy();
}

/**
 * Put the companions in the given state. Fair Audience Experimental
 * requires Fair Audience, so it goes off first and comes back last.
 */
async function setCompanions( api, { audience, audienceExperimental } ) {
	if ( ! audienceExperimental ) {
		await setPluginStatus( api, AUDIENCE_EXPERIMENTAL, 'inactive' );
	}
	await setPluginStatus( api, AUDIENCE, audience ? 'active' : 'inactive' );
	if ( audienceExperimental ) {
		await setPluginStatus( api, AUDIENCE_EXPERIMENTAL, 'active' );
	}
}

async function createEventDate( api, title, extra = {} ) {
	const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
		headers: adminHeaders,
		data: { title, status: 'publish' },
	} );
	expect( postRes.ok() ).toBeTruthy();
	const eventId = ( await postRes.json() ).id;

	const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
		headers: adminHeaders,
		data: {
			title,
			link_type: 'post',
			start_date: '2035-05-01',
			start_time: '10:00:00',
			end_date: '2035-05-01',
			end_time: '12:00:00',
			...extra,
		},
	} );
	expect( edRes.ok(), await edRes.text() ).toBeTruthy();
	const edBody = await edRes.json();

	// The create endpoint doesn't link the post; a PUT does.
	const linkRes = await api.put(
		`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
		{ headers: adminHeaders, data: { event_id: eventId } }
	);
	expect( linkRes.ok() ).toBeTruthy();

	return {
		eventId,
		eventDateId: edBody.id,
		occurrenceIds: [
			edBody.id,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		],
	};
}

async function saveTickets( api, eventDateId, ticketTypes ) {
	const res = await api.put(
		`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		{
			headers: adminHeaders,
			data: {
				ticket_types: ticketTypes,
				sale_periods: [ ALWAYS_ON ],
				prices: ticketTypes.map( ( _, index ) => ( {
					ticket_type_index: index,
					sale_period_index: 0,
					price: 0,
				} ) ),
				settings: {},
			},
		}
	);
	expect( res.ok(), await res.text() ).toBeTruthy();
	const types = ( await res.json() ).ticket_types || [];
	return Object.fromEntries( types.map( ( t ) => [ t.name, t.id ] ) );
}

async function signupTypeIds( api, eventDateId ) {
	const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
		headers: adminHeaders,
		params: { event_date: eventDateId },
	} );
	expect( res.ok(), await res.text() ).toBeTruthy();
	return ( await res.json() ).map( ( signup ) => signup.ticket_type_id );
}

async function savedGroupIds( api, eventDateId, ticketTypeId ) {
	const res = await api.get(
		`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		{ headers: adminHeaders }
	);
	expect( res.ok(), await res.text() ).toBeTruthy();
	const type = ( ( await res.json() ).ticket_types || [] ).find(
		( t ) => t.id === ticketTypeId
	);
	return type?.group_ids;
}

const UNAVAILABLE = [
	{
		label: 'Fair Audience inactive',
		audience: false,
		audienceExperimental: false,
	},
	{
		label: 'Fair Audience Experimental inactive',
		audience: true,
		audienceExperimental: false,
	},
];

test.describe( 'Group-restricted tiers without membership support', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let originalStatus;
	let single;
	let series;
	let singleTypes;
	let seriesTypes;

	async function restorePlugins() {
		await setCompanions( api, {
			audience: true,
			audienceExperimental: true,
		} );
		await setPluginStatus(
			api,
			EVENTS_EXPERIMENTAL,
			originalStatus[ EVENTS_EXPERIMENTAL ] || 'active'
		);
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		expect( pluginsRes.ok() ).toBeTruthy();
		const plugins = await pluginsRes.json();
		originalStatus = Object.fromEntries(
			plugins.map( ( p ) => [ p.plugin, p.status ] )
		);
		await restorePlugins();

		single = await createEventDate(
			api,
			`Restricted tier fallback ${ Date.now() }`
		);
		singleTypes = await saveTickets( api, single.eventDateId, [
			{
				name: 'Members Only',
				capacity: null,
				recurrence_scope: 'single_instance',
				group_ids: [ MISSING_GROUP_ID ],
			},
			{
				name: 'Open',
				capacity: null,
				recurrence_scope: 'single_instance',
				group_ids: [],
			},
		] );

		series = await createEventDate(
			api,
			`Restricted tier fallback series ${ Date.now() }`,
			{ rrule: 'FREQ=WEEKLY;COUNT=3' }
		);
		seriesTypes = await saveTickets( api, series.eventDateId, [
			{
				name: 'Members Pick Sessions',
				capacity: null,
				recurrence_scope: 'multiple_instances',
				minimum_instances: 1,
				group_ids: [ MISSING_GROUP_ID ],
			},
		] );
	} );

	test.afterEach( async () => {
		await restorePlugins();
	} );

	test.afterAll( async () => {
		await restorePlugins();
		for ( const fixture of [ single, series ] ) {
			if ( fixture?.eventId ) {
				await api.delete(
					`/wp-json/wp/v2/fair_event/${ fixture.eventId }`,
					{ headers: adminHeaders, params: { force: 'true' } }
				);
			}
		}
		await api.dispose();
	} );

	for ( const companions of UNAVAILABLE ) {
		for ( const eventsExperimental of [ 'active', 'inactive' ] ) {
			test( `${ companions.label }, Fair Events Experimental ${ eventsExperimental }: restricted tiers are refused, open tiers sell`, async () => {
				await setPluginStatus(
					api,
					EVENTS_EXPERIMENTAL,
					eventsExperimental
				);
				await setCompanions( api, companions );

				const buyer = await request.newContext( { baseURL: BASE_URL } );
				try {
					const restricted = await buyer.post(
						'/wp-json/fair-events/v1/get-tickets',
						{
							data: {
								event_date_id: single.eventDateId,
								ticket_type_id: singleTypes[ 'Members Only' ],
								name: 'Restricted Buyer',
								email: uniqueEmail( 'restricted' ),
							},
						}
					);
					expect( restricted.status() ).toBe( 403 );
					expect( ( await restricted.json() ).code ).toBe(
						'ticket_type_restricted'
					);

					const restrictedSeries = await buyer.post(
						'/wp-json/fair-events/v1/get-tickets',
						{
							data: {
								event_date_id: series.eventDateId,
								ticket_type_id:
									seriesTypes[ 'Members Pick Sessions' ],
								event_date_ids: series.occurrenceIds.slice(
									0,
									2
								),
								name: 'Restricted Series Buyer',
								email: uniqueEmail( 'restricted-series' ),
							},
						}
					);
					expect( restrictedSeries.status() ).toBe( 403 );
					expect( ( await restrictedSeries.json() ).code ).toBe(
						'ticket_type_restricted'
					);

					const open = await buyer.post(
						'/wp-json/fair-events/v1/get-tickets',
						{
							data: {
								event_date_id: single.eventDateId,
								ticket_type_id: singleTypes.Open,
								name: 'Open Buyer',
								email: uniqueEmail( 'open' ),
							},
						}
					);
					expect( open.ok(), await open.text() ).toBeTruthy();
					expect( ( await open.json() ).status ).toBe( 'confirmed' );
				} finally {
					await buyer.dispose();
				}

				expect(
					await signupTypeIds( api, single.eventDateId )
				).not.toContain( singleTypes[ 'Members Only' ] );
				for ( const occurrenceId of series.occurrenceIds ) {
					expect(
						await signupTypeIds( api, occurrenceId )
					).not.toContain( seriesTypes[ 'Members Pick Sessions' ] );
				}
			} );
		}
	}

	test( 'restrictions survive the toggling and are checked normally again', async () => {
		expect(
			await savedGroupIds(
				api,
				single.eventDateId,
				singleTypes[ 'Members Only' ]
			)
		).toEqual( [ MISSING_GROUP_ID ] );
		expect(
			await savedGroupIds(
				api,
				series.eventDateId,
				seriesTypes[ 'Members Pick Sessions' ]
			)
		).toEqual( [ MISSING_GROUP_ID ] );

		// Membership support is back: a non-member is still refused, now by
		// Fair Audience's own membership check.
		const buyer = await request.newContext( { baseURL: BASE_URL } );
		try {
			const restricted = await buyer.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: single.eventDateId,
						ticket_type_id: singleTypes[ 'Members Only' ],
						name: 'Restricted Buyer',
						email: uniqueEmail( 'restricted-restored' ),
					},
				}
			);
			expect( restricted.status() ).toBe( 403 );
			expect( ( await restricted.json() ).code ).toBe(
				'ticket_type_restricted'
			);
		} finally {
			await buyer.dispose();
		}
	} );
} );
