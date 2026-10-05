/**
 * Playwright API tests for add-on (activity) pricing owned by fair-events
 * (#1786): configuration, flat and sale-period prices, unavailable prices and
 * charged totals, through the admin tickets route and the public get-tickets
 * route (paid purchases against the Mollie double from e2e/mu-plugins).
 *
 * The same purchases run with fair-audience and fair-events-experimental
 * inactive, each active on its own, and both active: the base behaviour must
 * not depend on either. The suite is single-worker, so the plugins it turns
 * off are back on before any other spec runs.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const uniqueEmail = ( label ) =>
	`addon-pricing-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

// Awaited rather than blocking, so pooled sockets are not left to go stale
// while WP-CLI runs.
async function wpCli( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	return stdout;
}

async function setPlugins( { active = [], inactive = [] } ) {
	if ( inactive.length ) {
		await wpCli( 'plugin', 'deactivate', ...inactive );
	}
	if ( active.length ) {
		await wpCli( 'plugin', 'activate', ...active );
	}
}

const OPTIONAL_PLUGINS = [
	'fair-audience-experimental',
	'fair-audience',
	'fair-events-experimental',
];

const COMBINATIONS = [
	{
		label: 'fair-audience and fair-events-experimental inactive',
		active: [],
		full: true,
	},
	{
		label: 'only fair-events-experimental active',
		active: [ 'fair-events-experimental' ],
	},
	{
		label: 'only fair-audience active',
		active: [ 'fair-audience' ],
	},
	{
		label: 'fair-audience and fair-events-experimental active',
		active: [
			'fair-events-experimental',
			'fair-audience',
			'fair-audience-experimental',
		],
	},
];

for ( const combination of COMBINATIONS ) {
	test.describe( `Add-on pricing — ${ combination.label }`, () => {
		let api;
		const createdPostIds = [];
		const createdEventDateIds = [];

		const SALE_PERIODS = {
			always: [
				{
					name: 'Always on',
					sale_start: '2020-01-01 00:00:00',
					sale_end: '2099-01-01 00:00:00',
				},
			],
			// The first period is over; the second is the one on sale now.
			earlyThenRegular: [
				{
					name: 'Early',
					sale_start: '2020-01-01 00:00:00',
					sale_end: '2021-01-01 00:00:00',
				},
				{
					name: 'Regular',
					sale_start: '2021-01-01 00:00:00',
					sale_end: '2099-01-01 00:00:00',
				},
			],
		};

		async function saveTickets( eventDateId, data ) {
			const res = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
				{ headers: adminHeaders, data }
			);
			const body = await res.json();
			expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
			return body;
		}

		/**
		 * Create a post-linked event with one ticket type and its add-ons.
		 *
		 * @param {Object}   options
		 * @param {number}   options.ticketPrice Ticket price in every sale period.
		 * @param {Object[]} options.salePeriods Sale periods.
		 * @param {Object[]} options.addons      { name, price, capacity, periodPrices: { [periodIndex]: price } }.
		 * @return {Promise<Object>} eventDateId, typeId, optionIds, config.
		 */
		async function createEvent( {
			ticketPrice = 0,
			salePeriods = SALE_PERIODS.always,
			addons,
		} ) {
			const title = `Add-on pricing ${ Date.now() } ${ Math.random() }`;
			const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
				headers: adminHeaders,
				data: { title, status: 'publish' },
			} );
			expect( postRes.ok() ).toBeTruthy();
			const postId = ( await postRes.json() ).id;
			createdPostIds.push( postId );

			const edRes = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title,
						link_type: 'post',
						start_datetime: '2035-12-01 10:00:00',
						end_datetime: '2035-12-01 12:00:00',
					},
				}
			);
			const edBody = await edRes.json();
			expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
			const eventDateId = edBody.id;
			createdEventDateIds.push( eventDateId );

			const linkRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders, data: { event_id: postId } }
			);
			expect( linkRes.ok() ).toBeTruthy();

			const config = await saveTickets( eventDateId, {
				capacity: null,
				ticket_types: [
					{
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
				sale_periods: salePeriods,
				prices: salePeriods.map( ( period, index ) => ( {
					ticket_type_index: 0,
					sale_period_index: index,
					price: ticketPrice,
				} ) ),
				options: addons.map( ( addon ) => ( {
					name: addon.name,
					price: addon.price ?? 0,
					capacity: addon.capacity ?? null,
					derive_price_from_sale_period: !! addon.periodPrices,
					period_prices: Object.entries(
						addon.periodPrices || {}
					).map( ( [ index, price ] ) => ( {
						sale_period_index: Number( index ),
						price,
					} ) ),
				} ) ),
				settings: {},
			} );

			const optionIds = {};
			for ( const option of config.options ) {
				optionIds[ option.name ] = option.id;
			}

			return {
				eventDateId,
				typeId: config.ticket_types[ 0 ].id,
				optionIds,
				config,
			};
		}

		// Each purchase is a separate visitor: a session cookie would
		// otherwise make later buyers resolve to the first one.
		async function buy( data ) {
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const res = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets',
				{ data: { name: 'Add-on Buyer', _honeypot: '', ...data } }
			);
			const body = await res.json();
			await visitor.dispose();
			return { status: res.status(), body };
		}

		async function signups( eventDateId ) {
			const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
				headers: adminHeaders,
				params: { event_date: eventDateId },
			} );
			expect( res.ok() ).toBeTruthy();
			return res.json();
		}

		async function lineItems( transactionId ) {
			const res = await api.get(
				`/wp-json/fair-payments-connector/v1/transactions/${ transactionId }`,
				{ headers: adminHeaders }
			);
			expect( res.ok() ).toBeTruthy();
			return ( ( await res.json() ).line_items || [] )
				.map( ( item ) => ( {
					name: item.name,
					quantity: Number( item.quantity ),
					amount: Number( item.unit_amount ),
				} ) )
				.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		}

		test.beforeAll( async () => {
			await setPlugins( {
				inactive: OPTIONAL_PLUGINS.filter(
					( plugin ) => ! combination.active.includes( plugin )
				),
				active: combination.active,
			} );
			api = await request.newContext( { baseURL: BASE_URL } );
		} );

		test.afterAll( async () => {
			for ( const eventDateId of createdEventDateIds ) {
				await api.delete(
					`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
					{ headers: adminHeaders }
				);
			}
			for ( const postId of createdPostIds ) {
				await api.delete(
					`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
					{ headers: adminHeaders }
				);
			}
			await api.dispose();
			await setPlugins( {
				active: [
					'fair-events-experimental',
					'fair-audience',
					'fair-audience-experimental',
				],
			} );
		} );

		test( 'flat-priced add-ons are charged once for every ticket selecting them', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Dinner: dinner, Shirt: shirt },
			} = await createEvent( {
				ticketPrice: 20,
				addons: [
					{ name: 'Dinner', price: 12.5 },
					{ name: 'Shirt', price: 8 },
				],
			} );

			const purchase = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'flat' ),
				quantity: 2,
				ticket_activities: [ [ dinner ], [ dinner, shirt ] ],
			} );
			expect( purchase.status, JSON.stringify( purchase.body ) ).toBe(
				200
			);
			expect( purchase.body.status ).toBe( 'payment_required' );
			// 2 × 20 tickets + 2 × 12.50 dinners + 1 × 8 shirt.
			expect( Number( purchase.body.amount ) ).toBe( 73 );

			const items = await lineItems( purchase.body.transaction_id );
			expect(
				items.filter( ( item ) => item.name === 'Dinner' )
			).toEqual( [ { name: 'Dinner', quantity: 2, amount: 12.5 } ] );
			expect( items.filter( ( item ) => item.name === 'Shirt' ) ).toEqual(
				[ { name: 'Shirt', quantity: 1, amount: 8 } ]
			);
			expect(
				items.reduce(
					( sum, item ) => sum + item.quantity * item.amount,
					0
				)
			).toBe( 73 );

			const [ signup ] = await signups( eventDateId );
			expect( Number( signup.amount ) ).toBe( 73 );
		} );

		test( 'a sale-period add-on is charged at the price of the period on sale', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Workshop: workshop },
			} = await createEvent( {
				ticketPrice: 10,
				salePeriods: SALE_PERIODS.earlyThenRegular,
				addons: [
					{
						name: 'Workshop',
						// The flat price is ignored once period pricing is on.
						price: 99,
						periodPrices: { 0: 5, 1: 9 },
					},
				],
			} );

			const purchase = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'period' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( purchase.status, JSON.stringify( purchase.body ) ).toBe(
				200
			);
			expect( Number( purchase.body.amount ) ).toBe( 19 );
			expect(
				( await lineItems( purchase.body.transaction_id ) ).filter(
					( item ) => item.name === 'Workshop'
				)
			).toEqual( [ { name: 'Workshop', quantity: 1, amount: 9 } ] );
		} );

		if ( ! combination.full ) {
			return;
		}

		test( 'add-on configuration round-trips and keeps its ids on re-save', async () => {
			const { eventDateId, optionIds, config } = await createEvent( {
				ticketPrice: 10,
				salePeriods: SALE_PERIODS.earlyThenRegular,
				addons: [
					{ name: 'Dinner', price: 12.5, capacity: 30 },
					{ name: 'Workshop', periodPrices: { 0: 5, 1: 9 } },
				],
			} );

			const readRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
				{ headers: adminHeaders }
			);
			expect( readRes.ok() ).toBeTruthy();
			const read = await readRes.json();
			const [ early, regular ] = read.sale_periods.map(
				( period ) => period.id
			);
			const byName = Object.fromEntries(
				read.options.map( ( option ) => [ option.name, option ] )
			);

			expect( byName.Dinner ).toMatchObject( {
				id: optionIds.Dinner,
				price: 12.5,
				capacity: 30,
				derive_price_from_sale_period: false,
				period_prices: [],
			} );
			expect( byName.Workshop ).toMatchObject( {
				id: optionIds.Workshop,
				derive_price_from_sale_period: true,
			} );
			expect(
				byName.Workshop.period_prices
					.map( ( row ) => [ row.sale_period_id, row.price ] )
					.sort( ( a, b ) => a[ 0 ] - b[ 0 ] )
			).toEqual( [
				[ early, 5 ],
				[ regular, 9 ],
			] );

			// Saving what was read changes a price and keeps every id.
			const saved = await saveTickets( eventDateId, {
				capacity: read.capacity,
				ticket_types: read.ticket_types,
				sale_periods: read.sale_periods,
				prices: read.sale_periods.map( ( period, index ) => ( {
					ticket_type_index: 0,
					sale_period_index: index,
					price: 10,
				} ) ),
				settings: {},
				options: read.options.map( ( option ) =>
					option.name === 'Dinner' ? { ...option, price: 14 } : option
				),
			} );
			expect( saved.ticket_types[ 0 ].id ).toBe(
				config.ticket_types[ 0 ].id
			);
			const savedByName = Object.fromEntries(
				saved.options.map( ( option ) => [ option.name, option ] )
			);
			expect( savedByName.Dinner.id ).toBe( optionIds.Dinner );
			expect( savedByName.Dinner.price ).toBe( 14 );
			expect( savedByName.Workshop.id ).toBe( optionIds.Workshop );
			expect( savedByName.Workshop.period_prices ).toHaveLength( 2 );
		} );

		test( 'an add-on priced at zero is free and adds no charge', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Tour: tour },
			} = await createEvent( {
				ticketPrice: 15,
				addons: [ { name: 'Tour', price: 0 } ],
			} );

			const paid = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'zero' ),
				ticket_option_ids: [ tour ],
			} );
			expect( paid.status, JSON.stringify( paid.body ) ).toBe( 200 );
			expect( Number( paid.body.amount ) ).toBe( 15 );
			expect(
				( await lineItems( paid.body.transaction_id ) ).some(
					( item ) => item.name === 'Tour'
				)
			).toBe( false );
		} );

		test( 'a free ticket with a free add-on confirms without payment', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Tour: tour },
			} = await createEvent( {
				ticketPrice: 0,
				salePeriods: SALE_PERIODS.earlyThenRegular,
				addons: [ { name: 'Tour', periodPrices: { 1: 0 } } ],
			} );

			const free = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'free' ),
				ticket_option_ids: [ tour ],
			} );
			expect( free.status, JSON.stringify( free.body ) ).toBe( 200 );
			expect( free.body.status ).toBe( 'confirmed' );

			const [ signup ] = await signups( eventDateId );
			expect( signup.status ).toBe( 'confirmed' );
			expect( signup.tickets[ 0 ].activity_ids ).toEqual( [ tour ] );
		} );

		test( 'an add-on without a price for the period on sale is refused, not given away', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Workshop: workshop, Dinner: dinner },
			} = await createEvent( {
				ticketPrice: 0,
				salePeriods: SALE_PERIODS.earlyThenRegular,
				addons: [
					// Priced only for the period that is over.
					{ name: 'Workshop', price: 7, periodPrices: { 0: 5 } },
					{ name: 'Dinner', price: 12 },
				],
			} );

			const refused = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'unavailable' ),
				ticket_option_ids: [ workshop, dinner ],
			} );
			expect( refused.status, JSON.stringify( refused.body ) ).toBe(
				409
			);
			expect( refused.body.code ).toBe( 'ticket_option_unavailable' );
			expect( refused.body.message ).toContain( 'Workshop' );
			expect( await signups( eventDateId ) ).toHaveLength( 0 );
		} );

		test( 'a selection the event does not offer is refused', async () => {
			const first = await createEvent( {
				addons: [ { name: 'Dinner', price: 12 } ],
			} );
			const other = await createEvent( {
				addons: [ { name: 'Elsewhere', price: 3 } ],
			} );

			const foreign = await buy( {
				event_date_id: first.eventDateId,
				ticket_type_id: first.typeId,
				email: uniqueEmail( 'foreign' ),
				ticket_option_ids: [ other.optionIds.Elsewhere ],
			} );
			expect( foreign.status ).toBe( 400 );
			expect( foreign.body.code ).toBe( 'invalid_ticket_option' );
			expect( await signups( first.eventDateId ) ).toHaveLength( 0 );
		} );

		test( 'selection bounds of the ticket type are enforced', async () => {
			const { eventDateId, typeId, optionIds, config } =
				await createEvent( {
					addons: [
						{ name: 'Dinner', price: 0 },
						{ name: 'Shirt', price: 0 },
					],
				} );
			await saveTickets( eventDateId, {
				capacity: null,
				ticket_types: [
					{
						...config.ticket_types[ 0 ],
						minimum_activities: 1,
						maximum_activities: 1,
					},
				],
				sale_periods: config.sale_periods,
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
				],
				options: config.options,
				settings: {},
			} );

			const tooFew = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'too-few' ),
			} );
			expect( tooFew.status ).toBe( 400 );
			expect( tooFew.body.code ).toBe( 'minimum_activities_not_met' );

			const tooMany = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'too-many' ),
				ticket_option_ids: [ optionIds.Dinner, optionIds.Shirt ],
			} );
			expect( tooMany.status ).toBe( 400 );
			expect( tooMany.body.code ).toBe( 'maximum_activities_exceeded' );

			const allowed = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'allowed' ),
				ticket_option_ids: [ optionIds.Dinner ],
			} );
			expect( allowed.status, JSON.stringify( allowed.body ) ).toBe(
				200
			);
		} );

		test( 'a full add-on is refused', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Workshop: workshop },
			} = await createEvent( {
				addons: [ { name: 'Workshop', price: 0, capacity: 1 } ],
			} );

			const first = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'first' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );

			const second = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email: uniqueEmail( 'second' ),
				ticket_option_ids: [ workshop ],
			} );
			expect( second.status ).toBe( 409 );
			expect( second.body.code ).toBe( 'ticket_option_full' );
		} );

		test( 'retrying a pending purchase charges the amounts it was recorded with', async () => {
			const {
				eventDateId,
				typeId,
				optionIds: { Dinner: dinner },
				config,
			} = await createEvent( {
				ticketPrice: 10,
				addons: [ { name: 'Dinner', price: 12 } ],
			} );

			const email = uniqueEmail( 'retry' );
			const first = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeId,
				email,
				ticket_option_ids: [ dinner ],
			} );
			expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
			expect( Number( first.body.amount ) ).toBe( 22 );
			const token = new URL( first.body.checkout_url ).searchParams.get(
				'token'
			);

			const [ signup ] = await signups( eventDateId );
			const failRes = await api.post(
				'/wp-json/fair-e2e/v1/ticket-capacity/fail',
				{ headers: adminHeaders, data: { signup_id: signup.id } }
			);
			expect( failRes.ok() ).toBeTruthy();

			// The organizer raises the add-on price after the purchase was made.
			await saveTickets( eventDateId, {
				capacity: null,
				ticket_types: config.ticket_types,
				sale_periods: config.sale_periods,
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 10 },
				],
				options: config.options.map( ( option ) => ( {
					...option,
					price: 30,
				} ) ),
				settings: {},
			} );

			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const retryRes = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets/retry-payment',
				{ data: { transaction_id: first.body.transaction_id, token } }
			);
			const retry = await retryRes.json();
			await visitor.dispose();
			expect( retryRes.status(), JSON.stringify( retry ) ).toBe( 200 );
			expect( Number( retry.amount ) ).toBe( 22 );
			expect( retry.transaction_id ).not.toBe(
				first.body.transaction_id
			);
			expect(
				( await lineItems( retry.transaction_id ) ).filter(
					( item ) => item.name === 'Dinner'
				)
			).toEqual( [ { name: 'Dinner', quantity: 1, amount: 12 } ] );
		} );

		test.describe( 'while online payments are not configured', () => {
			async function setMollieConnected( connected ) {
				const res = await api.post(
					'/wp-json/fair-e2e/v1/mollie-connection',
					{ headers: adminHeaders, data: { connected } }
				);
				expect( res.ok() ).toBeTruthy();
			}

			test.beforeAll( async () => {
				await setMollieConnected( false );
			} );

			test.afterAll( async () => {
				await setMollieConnected( true );
			} );

			test( 'a free ticket with a paid add-on is refused, a free add-on still confirms', async () => {
				const {
					eventDateId,
					typeId,
					optionIds: { Dinner: dinner, Tour: tour },
				} = await createEvent( {
					ticketPrice: 0,
					addons: [
						{ name: 'Dinner', price: 12 },
						{ name: 'Tour', price: 0 },
					],
				} );

				const refused = await buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email: uniqueEmail( 'no-connector' ),
					ticket_option_ids: [ dinner ],
				} );
				expect( refused.status ).toBe( 503 );
				expect( refused.body.code ).toBe( 'payment_unavailable' );
				expect( await signups( eventDateId ) ).toHaveLength( 0 );

				const free = await buy( {
					event_date_id: eventDateId,
					ticket_type_id: typeId,
					email: uniqueEmail( 'no-connector-free' ),
					ticket_option_ids: [ tour ],
				} );
				expect( free.status, JSON.stringify( free.body ) ).toBe( 200 );
				expect( free.body.status ).toBe( 'confirmed' );
			} );
		} );
	} );
}
