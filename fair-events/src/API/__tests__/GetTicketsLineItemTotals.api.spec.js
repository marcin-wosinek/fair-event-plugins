/**
 * Playwright API tests for the one rounding policy of get-tickets purchases
 * (#1366): the amount saved on the signup, the free-or-paid decision, the
 * transaction amount and the finance-ledger line items all come from the
 * same line items, rounded to two decimals half up — per unit amount, per
 * line, and for the total.
 *
 * Ticket and activity prices are stored with two decimals, so prices with a
 * fraction of a cent (and discounts) are put in place by the test-only
 * fair-e2e/v1/line-item-totals fixture, which overrides the resolved prices
 * the way a pricing extension would. Paid purchases run against the Mollie
 * double from e2e/mu-plugins.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const GET_TICKETS = '/wp-json/fair-events/v1/get-tickets';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const uniqueEmail = ( label ) =>
	`totals-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

// Whole cents of a stored decimal string or a response number.
const cents = ( amount ) => Math.round( Number( amount ) * 100 );

test.describe( 'Line-item totals of get-tickets purchases', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	/**
	 * Create a post-linked event (optionally a series) with ticket types
	 * and activities at ordinary prices.
	 *
	 * @param {Object}   options
	 * @param {Object[]} [options.ticketTypes] { name, price, scope }.
	 * @param {Object[]} [options.activities]  { name, price }.
	 * @param {string}   [options.rrule]       Recurrence rule for a series.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeIds, optionIds.
	 */
	async function createEvent( {
		ticketTypes = [],
		activities = [],
		rrule,
	} = {} ) {
		const title = `Line item totals ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		createdPostIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-11-01 10:00:00',
				end_datetime: '2035-11-01 12:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const occurrenceIds = [
			eventDateId,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
		createdEventDateIds.push( ...occurrenceIds );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					capacity: null,
					ticket_types: ticketTypes.map( ( type ) => ( {
						name: type.name,
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: type.scope || 'single_instance',
						minimum_instances: 1,
						group_ids: [],
					} ) ),
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: ticketTypes.map( ( type, index ) => ( {
						ticket_type_index: index,
						sale_period_index: 0,
						price: type.price || 0,
					} ) ),
					options: activities.map( ( activity ) => ( {
						name: activity.name,
						price: activity.price || 0,
						capacity: null,
					} ) ),
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		const optionIds = {};
		for ( const option of ticketsBody.options || [] ) {
			optionIds[ option.name ] = option.id;
		}

		return {
			eventDateId,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
			optionIds,
		};
	}

	/**
	 * Arm the price fixture. Whatever is left out is switched off.
	 *
	 * @param {Object} fixture ticket_types, options, extra_line, total_delta.
	 */
	async function arm( fixture = {} ) {
		const res = await api.put(
			'/wp-json/fair-e2e/v1/line-item-totals/fixture',
			{ headers: adminHeaders, data: fixture }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	/**
	 * Submit the purchase form's request as a fresh, anonymous visitor.
	 *
	 * @param {Object} data Request payload.
	 * @return {Promise<{status: number, body: Object}>} Response.
	 */
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await visitor.post( GET_TICKETS, {
				data: {
					name: 'Totals Buyer',
					email: uniqueEmail( 'buyer' ),
					quantity: 1,
					_honeypot: '',
					...data,
				},
			} );
			const text = await res.text();
			let body;
			try {
				body = JSON.parse( text );
			} catch ( error ) {
				body = { raw: text.slice( 0, 300 ) };
			}
			return { status: res.status(), body };
		} finally {
			await visitor.dispose();
		}
	}

	/**
	 * What purchases stored for the given event dates.
	 *
	 * @param {number|number[]} eventDateIds Event date ID(s).
	 * @return {Promise<Object>} signups and transactions with line items.
	 */
	async function stored( eventDateIds ) {
		const params = new URLSearchParams();
		[]
			.concat( eventDateIds )
			.forEach( ( id ) => params.append( 'event_date_ids[]', id ) );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/line-item-totals?${ params }`,
			{ headers: adminHeaders }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	/**
	 * Buy, expect a payment for the given amount, and check that the
	 * response, the signup rows, the transaction and its ledger line items
	 * all hold that amount.
	 *
	 * @param {Object}          options
	 * @param {Object}          options.purchase     Request payload.
	 * @param {number|number[]} options.eventDateIds Event date(s) the signup rows are on.
	 * @param {string}          options.amount       Expected total, e.g. '30.03'.
	 * @param {string[][]}      options.lines        Expected ledger lines: [ quantity, unit, total ].
	 * @param {string[]}        [options.signups]    Expected amount of each signup row; the total by default.
	 */
	async function expectPaidAgreement( {
		purchase,
		eventDateIds,
		amount,
		lines,
		signups: signupAmounts = [ amount ],
	} ) {
		const result = await buy( purchase );
		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.status ).toBe( 'payment_required' );
		expect( cents( result.body.amount ) ).toBe( cents( amount ) );

		const { signups, transactions } = await stored( eventDateIds );
		expect( signups.map( ( signup ) => signup.amount ) ).toEqual(
			signupAmounts
		);
		expect(
			signups.every( ( signup ) => signup.status === 'pending_payment' )
		).toBe( true );

		expect( transactions ).toHaveLength( 1 );
		const [ transaction ] = transactions;
		expect( transaction.id ).toBe( result.body.transaction_id );
		expect( transaction.amount ).toBe( amount );
		expect(
			transaction.line_items.map( ( line ) => [
				String( line.quantity ),
				line.unit_amount,
				line.total_amount,
			] )
		).toEqual( lines );

		// Agreement, to the cent: signup rows, transaction, ledger.
		const sum = ( values ) =>
			values.reduce( ( total, value ) => total + cents( value ), 0 );
		expect( sum( signups.map( ( signup ) => signup.amount ) ) ).toBe(
			cents( amount )
		);
		expect(
			sum( transaction.line_items.map( ( line ) => line.total_amount ) )
		).toBe( cents( amount ) );
	}

	/**
	 * Buy and expect an immediate confirmation with nothing to pay.
	 *
	 * @param {Object}          purchase     Request payload.
	 * @param {number|number[]} eventDateIds Event date(s) the signup rows are on.
	 * @param {number}          rows         Number of signup rows expected.
	 */
	async function expectFree( purchase, eventDateIds, rows = 1 ) {
		const result = await buy( purchase );
		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.status ).toBe( 'confirmed' );

		const { signups, transactions } = await stored( eventDateIds );
		expect( signups ).toHaveLength( rows );
		for ( const signup of signups ) {
			expect( signup.amount ).toBe( '0.00' );
			expect( signup.status ).toBe( 'confirmed' );
			expect( signup.transaction_id ).toBeNull();
		}
		expect( transactions ).toEqual( [] );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		// Leave no price override behind for other specs.
		await arm();
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			const res = await api.get( GET_TICKETS, {
				headers: adminHeaders,
				params: { event_date: dateId },
			} );
			for ( const signup of res.ok() ? await res.json() : [] ) {
				await api.delete( `${ GET_TICKETS }/${ signup.id }`, {
					headers: adminHeaders,
				} );
			}
		}
		for ( const postId of createdPostIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test.describe( 'single signup', () => {
		test( 'ordinary two-decimal prices are unchanged', async () => {
			const { eventDateId, typeIds, optionIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 12.5 } ],
				activities: [ { name: 'Workshop', price: 5 } ],
			} );

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					quantity: 2,
					ticket_activities: [ [ optionIds.Workshop ], [] ],
				},
				eventDateIds: eventDateId,
				amount: '30.00',
				lines: [
					[ '2', '12.50', '25.00' ],
					[ '1', '5.00', '5.00' ],
				],
			} );
		} );

		test( 'a half-cent unit price is rounded up before the quantity applies', async () => {
			const { eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 10.005 } } );

			// 3 × 10.005 is 30.015 unrounded; rounded per unit it is 3 × 10.01.
			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					quantity: 3,
				},
				eventDateIds: eventDateId,
				amount: '30.03',
				lines: [ [ '3', '10.01', '30.03' ] ],
			} );
		} );

		test( 'a ticket and its activities are each rounded on their own', async () => {
			const { eventDateId, typeIds, optionIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
				activities: [
					{ name: 'Workshop', price: 5 },
					{ name: 'Lunch', price: 1 },
				],
			} );
			await arm( {
				ticket_types: { [ typeIds[ 0 ] ]: 10.004 },
				options: {
					[ optionIds.Workshop ]: 5.005,
					[ optionIds.Lunch ]: 0.004,
				},
			} );

			// Unrounded: 2 × 10.004 + 2 × 5.005 + 0.004 = 30.022. Rounded
			// per unit: 2 × 10.00 + 2 × 5.01, and a Lunch that costs nothing
			// gets no line.
			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					quantity: 2,
					ticket_activities: [
						[ optionIds.Workshop, optionIds.Lunch ],
						[ optionIds.Workshop ],
					],
				},
				eventDateIds: eventDateId,
				amount: '30.02',
				lines: [
					[ '2', '10.00', '20.00' ],
					[ '2', '5.01', '10.02' ],
				],
			} );
		} );

		test( 'an activity-only purchase charges the activity alone', async () => {
			const { eventDateId, typeIds, optionIds } = await createEvent( {
				ticketTypes: [ { name: 'Free entry', price: 0 } ],
				activities: [ { name: 'Workshop', price: 7 } ],
			} );
			await arm( { options: { [ optionIds.Workshop ]: 7.005 } } );

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					ticket_option_ids: [ optionIds.Workshop ],
				},
				eventDateIds: eventDateId,
				amount: '7.01',
				lines: [ [ '1', '7.01', '7.01' ] ],
			} );
		} );

		test( 'a discount line lowers the total it is part of', async () => {
			const { eventDateId, typeIds, optionIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
				activities: [ { name: 'Solidarity discount', price: 1 } ],
			} );
			await arm( {
				options: { [ optionIds[ 'Solidarity discount' ] ]: -2.505 },
			} );

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					ticket_option_ids: [ optionIds[ 'Solidarity discount' ] ],
				},
				eventDateIds: eventDateId,
				amount: '7.49',
				lines: [
					[ '1', '10.00', '10.00' ],
					[ '1', '-2.51', '-2.51' ],
				],
			} );
		} );

		test( 'a total below half a cent is free and confirmed at once', async () => {
			const { eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 0.004 } } );

			// 2 × 0.004 is 0.008 unrounded, which would round to a cent.
			await expectFree(
				{
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					quantity: 2,
				},
				eventDateId
			);
		} );

		test( 'a total of half a cent is one cent to pay', async () => {
			const { eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 0.005 } } );

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
				},
				eventDateIds: eventDateId,
				amount: '0.01',
				lines: [ [ '1', '0.01', '0.01' ] ],
			} );
		} );

		test( 'a discount cancelling the price exactly is free', async () => {
			const { eventDateId, typeIds, optionIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 0.3 } ],
				activities: [ { name: 'Full discount', price: 1 } ],
			} );
			await arm( {
				ticket_types: { [ typeIds[ 0 ] ]: 0.1 },
				options: { [ optionIds[ 'Full discount' ] ]: -0.3 },
			} );

			// 3 × 0.1 − 0.3 is not exactly zero in floating point.
			await expectFree(
				{
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					quantity: 3,
					ticket_activities: [
						[ optionIds[ 'Full discount' ] ],
						[],
						[],
					],
				},
				eventDateId
			);
		} );
	} );

	test.describe( 'payment filters', () => {
		test( 'line items changed after the signup amount was decided are refused', async () => {
			const { eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { extra_line: -1 } );

			const result = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeIds[ 0 ],
			} );
			expect( result.status, JSON.stringify( result.body ) ).toBe( 409 );
			expect( result.body.code ).toBe( 'transaction_amount_mismatch' );

			// Nothing is charged for an amount the signup does not hold.
			const { signups, transactions } = await stored( eventDateId );
			expect( signups ).toHaveLength( 1 );
			expect( signups[ 0 ].amount ).toBe( '10.00' );
			expect( signups[ 0 ].transaction_id ).toBeNull();
			expect( transactions ).toEqual( [] );
		} );

		test( 'a total changed without its line items is refused', async () => {
			const { eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { total_delta: -1 } );

			const result = await buy( {
				event_date_id: eventDateId,
				ticket_type_id: typeIds[ 0 ],
			} );
			expect( result.status, JSON.stringify( result.body ) ).toBe( 500 );
			expect( result.body.code ).toBe( 'transaction_total_mismatch' );

			const { signups, transactions } = await stored( eventDateId );
			expect( signups ).toHaveLength( 1 );
			expect( signups[ 0 ].transaction_id ).toBeNull();
			expect( transactions ).toEqual( [] );
		} );
	} );

	test.describe( 'several occurrences', () => {
		const series = () =>
			createEvent( {
				rrule: 'FREQ=WEEKLY;COUNT=3',
				ticketTypes: [
					{
						name: 'Pick dates',
						price: 8,
						scope: 'multiple_instances',
					},
				],
			} );

		test( 'each occurrence row holds its rounded line and the rows add up to the transaction', async () => {
			const { eventDateId, occurrenceIds, typeIds } = await series();
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 10.005 } } );

			// 3 × 10.005 is 30.015 unrounded; each occurrence is 10.01.
			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds,
				},
				eventDateIds: occurrenceIds,
				amount: '30.03',
				signups: [ '10.01', '10.01', '10.01' ],
				lines: [
					[ '1', '10.01', '10.01' ],
					[ '1', '10.01', '10.01' ],
					[ '1', '10.01', '10.01' ],
				],
			} );
		} );

		test( 'ordinary prices are unchanged', async () => {
			const { eventDateId, occurrenceIds, typeIds } = await series();

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds.slice( 0, 2 ),
				},
				eventDateIds: occurrenceIds,
				amount: '16.00',
				signups: [ '8.00', '8.00' ],
				lines: [
					[ '1', '8.00', '8.00' ],
					[ '1', '8.00', '8.00' ],
				],
			} );
		} );

		test( 'occurrences below half a cent each are free, however many', async () => {
			const { eventDateId, occurrenceIds, typeIds } = await series();
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 0.004 } } );

			// 3 × 0.004 is 0.012 unrounded, which would round to a cent.
			await expectFree(
				{
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds,
				},
				occurrenceIds,
				3
			);
		} );

		test( 'occurrences of half a cent each are a cent each to pay', async () => {
			const { eventDateId, occurrenceIds, typeIds } = await series();
			await arm( { ticket_types: { [ typeIds[ 0 ] ]: 0.005 } } );

			await expectPaidAgreement( {
				purchase: {
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds.slice( 0, 2 ),
				},
				eventDateIds: occurrenceIds,
				amount: '0.02',
				signups: [ '0.01', '0.01' ],
				lines: [
					[ '1', '0.01', '0.01' ],
					[ '1', '0.01', '0.01' ],
				],
			} );
		} );
	} );
} );
