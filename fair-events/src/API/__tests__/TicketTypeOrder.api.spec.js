/**
 * Playwright API tests for reordering ticket types in the Tickets editor
 * (#1757).
 *
 * The editor's "Move to top" action only reorders the ticket_types array sent
 * to PUT /tickets (prices follow by index). The save must keep every type's
 * identity — its configuration, prices, group restrictions, and existing
 * signups — and return the new order on reload and to people signing up.
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

test.describe( 'Tickets — ticket type order (#1757)', () => {
	let api;
	let postId;
	let eventDateId;
	let groupId;
	let signupPageId;
	let ticketsPath;

	const salePeriod = {
		name: 'Always on',
		sale_start: '2020-01-01 00:00:00',
		sale_end: '2099-01-01 00:00:00',
	};

	const ticketType = ( name, extra = {} ) => ( {
		name,
		capacity: null,
		minimum_activities: 0,
		maximum_activities: null,
		activities_enabled: true,
		disable_at: null,
		recurrence_scope: 'single_instance',
		minimum_instances: 0,
		group_ids: [],
		...extra,
	} );

	const typeIds = ( data ) =>
		data.ticket_types.map( ( type ) => Number( type.id ) );

	// Everything stored on a type except its position.
	const configById = ( data ) =>
		Object.fromEntries(
			data.ticket_types.map( ( { sort_order: _order, ...type } ) => [
				Number( type.id ),
				type,
			] )
		);

	const pricesByTypeId = ( data ) =>
		Object.fromEntries(
			data.prices.map( ( price ) => [
				Number( price.ticket_type_id ),
				{
					price: Number( price.price ),
					capacity:
						price.capacity === null
							? null
							: Number( price.capacity ),
				},
			] )
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Ticket type order ${ Date.now() }`;

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
				start_datetime: '2035-12-02 10:00:00',
				end_datetime: '2035-12-02 12:00:00',
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

		const groupRes = await api.post( '/wp-json/fair-audience/v1/groups', {
			headers: adminHeaders,
			data: { name: `Ticket order members ${ Date.now() }` },
		} );
		const groupBody = await groupRes.json();
		expect( groupRes.ok(), JSON.stringify( groupBody ) ).toBeTruthy();
		groupId = Number( groupBody.id );
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
		if ( groupId ) {
			await api.delete( `/wp-json/fair-audience/v1/groups/${ groupId }`, {
				headers: adminHeaders,
			} );
		}
		if ( signupPageId ) {
			await api.delete(
				`/wp-json/wp/v2/pages/${ signupPageId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
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

	test( 'moving a ticket type to the top keeps IDs, configuration, prices, restrictions and signups', async () => {
		const createRes = await api.put( ticketsPath, {
			headers: adminHeaders,
			data: {
				capacity: null,
				ticket_types: [
					ticketType( 'Standard', {
						capacity: 10,
						activities_enabled: false,
					} ),
					ticketType( 'Members', {
						capacity: 20,
						disable_at: '2098-01-01 00:00:00',
						group_ids: [ groupId ],
					} ),
					ticketType( 'Supporter', { capacity: 30 } ),
				],
				sale_periods: [ salePeriod ],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 20 },
					{
						ticket_type_index: 1,
						sale_period_index: 0,
						price: 12.5,
					},
					{
						ticket_type_index: 2,
						sale_period_index: 0,
						price: 0,
						capacity: 7,
					},
				],
				options: [],
				settings: { show_ticket_type_capacity: true },
			},
		} );
		const created = await createRes.json();
		expect( createRes.ok(), JSON.stringify( created ) ).toBeTruthy();
		const [ standard, members, supporter ] = created.ticket_types;
		expect( created.ticket_types.map( ( t ) => t.name ) ).toEqual( [
			'Standard',
			'Members',
			'Supporter',
		] );
		expect( members.group_ids.map( Number ) ).toEqual( [ groupId ] );
		expect( pricesByTypeId( created ) ).toEqual( {
			[ standard.id ]: { price: 20, capacity: null },
			[ members.id ]: { price: 12.5, capacity: null },
			[ supporter.id ]: { price: 0, capacity: 7 },
		} );

		// An existing signup on the type that is about to move.
		const email = `ticket-type-order-${ Date.now() }@example.test`;
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const buyRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					name: 'Ticket Type Order',
					_honeypot: '',
					event_date_id: eventDateId,
					ticket_type_id: supporter.id,
					email,
				},
			}
		);
		const buyBody = await buyRes.json();
		expect( buyRes.status(), JSON.stringify( buyBody ) ).toBe( 200 );

		const signupType = async () => {
			const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
				headers: adminHeaders,
				params: { event_date: eventDateId },
			} );
			expect( res.ok() ).toBeTruthy();
			const row = ( await res.json() ).find(
				( signup ) => signup.email === email
			);
			return {
				id: Number( row.ticket_type_id ),
				name: row.ticket_type_name,
			};
		};
		expect( await signupType() ).toEqual( {
			id: Number( supporter.id ),
			name: 'Supporter',
		} );

		// The order of the ticket choices on the public signup form.
		const pageRes = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: {
				title: `Ticket type order page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		const pageBody = await pageRes.json();
		expect( pageRes.ok(), JSON.stringify( pageBody ) ).toBeTruthy();
		signupPageId = pageBody.id;

		const signupChoices = async () => {
			const res = await visitor.get( `/?page_id=${ signupPageId }` );
			expect( res.ok() ).toBeTruthy();
			return Array.from(
				( await res.text() ).matchAll(
					/<input[^>]*name="ticket_type_id"[^>]*>/g
				),
				( [ input ] ) => Number( input.match( /value="(\d+)"/ )[ 1 ] )
			);
		};
		const choicesBefore = await signupChoices();
		expect( choicesBefore ).toContain( Number( supporter.id ) );
		expect( choicesBefore ).toEqual(
			typeIds( created ).filter( ( id ) => choicesBefore.includes( id ) )
		);

		// Reload so the payload matches what the editor holds (has_sales etc.).
		const loadedRes = await api.get( ticketsPath, {
			headers: adminHeaders,
		} );
		const loaded = await loadedRes.json();
		expect( loadedRes.ok() ).toBeTruthy();
		const configBefore = configById( loaded );
		const pricesBefore = pricesByTypeId( loaded );

		// "Move to top" on Supporter: the editor sends the same types,
		// reordered, with prices addressed by the new row index.
		const reordered = [
			loaded.ticket_types[ 2 ],
			loaded.ticket_types[ 0 ],
			loaded.ticket_types[ 1 ],
		];
		const reorderedIds = reordered.map( ( type ) => Number( type.id ) );
		const saveRes = await api.put( ticketsPath, {
			headers: adminHeaders,
			data: {
				capacity: loaded.capacity,
				ticket_types: reordered.map( ( type, index ) => ( {
					...type,
					sort_order: index,
				} ) ),
				sale_periods: loaded.sale_periods,
				prices: reordered.map( ( type, index ) => ( {
					ticket_type_index: index,
					sale_period_index: 0,
					...pricesBefore[ Number( type.id ) ],
				} ) ),
				options: loaded.options,
				settings: loaded.settings,
			},
		} );
		const saved = await saveRes.json();
		expect( saveRes.ok(), JSON.stringify( saved ) ).toBeTruthy();
		expect( typeIds( saved ) ).toEqual( reorderedIds );

		const reloadRes = await api.get( ticketsPath, {
			headers: adminHeaders,
		} );
		const reloaded = await reloadRes.json();
		expect( reloadRes.ok() ).toBeTruthy();
		expect( typeIds( reloaded ) ).toEqual( reorderedIds );
		expect( reloaded.ticket_types.map( ( t ) => t.name ) ).toEqual( [
			'Supporter',
			'Standard',
			'Members',
		] );
		expect( configById( reloaded ) ).toEqual( configBefore );
		expect( pricesByTypeId( reloaded ) ).toEqual( pricesBefore );

		expect( await signupType() ).toEqual( {
			id: Number( supporter.id ),
			name: 'Supporter',
		} );

		const choicesAfter = await signupChoices();
		expect( [ ...choicesAfter ].sort() ).toEqual(
			[ ...choicesBefore ].sort()
		);
		expect( choicesAfter[ 0 ] ).toBe( Number( supporter.id ) );
		expect( choicesAfter ).toEqual(
			reorderedIds.filter( ( id ) => choicesAfter.includes( id ) )
		);
		await visitor.dispose();
	} );
} );
