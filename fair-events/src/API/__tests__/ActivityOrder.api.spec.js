/**
 * Playwright API tests for reordering activities in the Tickets editor (#1728).
 *
 * The editor's "Move to top" action only reorders the options array sent to
 * PUT /tickets. The save must keep every activity's identity (so existing
 * signups keep their selections) and return the new order on reload.
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

test.describe( 'Tickets — activity order (#1728)', () => {
	let api;
	let postId;
	let eventDateId;
	let typeId;
	let ticketsPath;

	const ticketsPayload = ( options ) => ( {
		capacity: null,
		ticket_types: [
			{
				...( typeId ? { id: typeId } : {} ),
				name: 'Regular',
				capacity: null,
				minimum_activities: 0,
				maximum_activities: null,
				activities_enabled: true,
				disable_at: null,
				recurrence_scope: 'single_instance',
				minimum_instances: 1,
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
		prices: [ { ticket_type_index: 0, sale_period_index: 0, price: 0 } ],
		options,
		settings: {},
	} );

	const summary = ( options ) =>
		options.map( ( { id, name } ) => ( { id: Number( id ), name } ) );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Activity order ${ Date.now() }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-12-01 10:00:00',
				end_datetime: '2035-12-01 12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		eventDateId = edBody.id;
		ticketsPath = `/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
				headers: adminHeaders,
				params: { event_date: eventDateId },
			} );
			for ( const signup of res.ok() ? await res.json() : [] ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test( 'moving an activity to the top keeps IDs and existing selections', async () => {
		const createRes = await api.put( ticketsPath, {
			headers: adminHeaders,
			data: ticketsPayload( [
				{ name: 'Yoga', price: 0, capacity: null },
				{ name: 'Dinner', price: 0, capacity: null },
				{ name: 'Hike', price: 0, capacity: null },
			] ),
		} );
		const created = await createRes.json();
		expect( createRes.ok(), JSON.stringify( created ) ).toBeTruthy();
		typeId = created.ticket_types[ 0 ].id;
		const [ yoga, dinner, hike ] = created.options;
		expect( summary( created.options ).map( ( o ) => o.name ) ).toEqual( [
			'Yoga',
			'Dinner',
			'Hike',
		] );

		// An existing signup that picked two of the activities.
		const email = `activity-order-${ Date.now() }@example.test`;
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const buyRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					name: 'Activity Order',
					_honeypot: '',
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email,
					ticket_option_ids: [
						Number( dinner.id ),
						Number( hike.id ),
					],
				},
			}
		);
		const buyBody = await buyRes.json();
		await visitor.dispose();
		expect( buyRes.status(), JSON.stringify( buyBody ) ).toBe( 200 );

		const signupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{ headers: adminHeaders, params: { event_date: eventDateId } }
		);
		const signupId = ( await signupsRes.json() ).find(
			( row ) => row.email === email
		).id;

		const selectedActivities = async () => {
			const res = await api.get(
				`/wp-json/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ signupId }`,
				{ headers: adminHeaders }
			);
			expect( res.ok() ).toBeTruthy();
			return ( await res.json() ).tickets.map( ( ticket ) =>
				ticket.activities
					.map( ( a ) => Number( a.ticket_option_id ) )
					.sort( ( a, b ) => a - b )
			);
		};
		const before = await selectedActivities();
		expect( before ).toEqual( [
			[ Number( dinner.id ), Number( hike.id ) ].sort(
				( a, b ) => a - b
			),
		] );

		// "Move to top" on Hike: the editor sends the same options, reordered.
		const reordered = [ hike, yoga, dinner ];
		const saveRes = await api.put( ticketsPath, {
			headers: adminHeaders,
			data: ticketsPayload(
				reordered.map( ( o, index ) => ( { ...o, sort_order: index } ) )
			),
		} );
		const saved = await saveRes.json();
		expect( saveRes.ok(), JSON.stringify( saved ) ).toBeTruthy();
		expect( summary( saved.options ) ).toEqual( summary( reordered ) );

		const reloadRes = await api.get( ticketsPath, {
			headers: adminHeaders,
		} );
		const reloaded = await reloadRes.json();
		expect( reloadRes.ok() ).toBeTruthy();
		expect( summary( reloaded.options ) ).toEqual( summary( reordered ) );

		expect( await selectedActivities() ).toEqual( before );
	} );
} );
