/**
 * Playwright API tests for the one rounding policy of fair-audience's own
 * signup routes (#1366): the free-or-paid decision, the amount returned to
 * the buyer, the transaction amount and the finance-ledger line items all
 * come from the same line items, rounded to two decimals half up — per unit
 * amount, per line, and for the total.
 *
 * These routes keep no signup amount of their own, so agreement is checked
 * between the returned amount, the transaction and its ledger line items.
 * Ticket prices with a fraction of a cent are put in place by the test-only
 * fair-e2e/v1/line-item-totals fixture, which overrides the resolved price
 * the way a pricing extension would; activity prices stay ordinary. Paid
 * signups run against the Mollie double from e2e/mu-plugins.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const EVENT_SIGNUP = '/wp-json/fair-audience/v1/event-signup';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

// Whole cents of a stored decimal string or a response number.
const cents = ( amount ) => Math.round( Number( amount ) * 100 );

test.describe( 'Line-item totals of fair-audience signups', () => {
	// One participant, linked to the admin account, signs up for every
	// event: the tests share it and must not run side by side.
	test.describe.configure( { mode: 'serial' } );

	let api;
	let participantId;
	const createdPostIds = [];

	/**
	 * Create a post-linked event (optionally a series) with ticket types
	 * and activities at ordinary prices.
	 *
	 * @param {Object}   options
	 * @param {Object[]} [options.ticketTypes] { name, price, scope }.
	 * @param {Object[]} [options.activities]  { name, price }.
	 * @param {string}   [options.rrule]       Recurrence rule for a series.
	 * @return {Promise<Object>} eventId, eventDateId, occurrenceIds, typeIds, optionIds.
	 */
	async function createEvent( {
		ticketTypes = [],
		activities = [],
		rrule,
	} = {} ) {
		const title = `Audience totals ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const eventId = ( await postRes.json() ).id;
		createdPostIds.push( eventId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: authHeaders,
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
			{ headers: authHeaders, data: { event_id: eventId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const occurrenceIds = [
			eventDateId,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: authHeaders,
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
			eventId,
			eventDateId,
			occurrenceIds,
			typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
			optionIds,
		};
	}

	/**
	 * Override resolved ticket prices by ticket type ID. Whatever is left
	 * out is switched off.
	 *
	 * @param {Object} ticketTypes Price by ticket type ID.
	 */
	async function arm( ticketTypes = {} ) {
		const res = await api.put(
			'/wp-json/fair-e2e/v1/line-item-totals/fixture',
			{ headers: authHeaders, data: { ticket_types: ticketTypes } }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	async function post( path, data ) {
		const res = await api.post( path, { headers: authHeaders, data } );
		const text = await res.text();
		let body;
		try {
			body = JSON.parse( text );
		} catch ( error ) {
			body = { raw: text.slice( 0, 300 ) };
		}
		return { status: res.status(), body };
	}

	/**
	 * Expect a response that sends the buyer to pay the given amount, and a
	 * transaction and ledger line items that hold the same amount.
	 *
	 * @param {Object}     result Response of the signup request.
	 * @param {string}     amount Expected total, e.g. '30.03'.
	 * @param {string[][]} lines  Expected ledger lines: [ quantity, unit, total ].
	 */
	async function expectPaidAgreement( result, amount, lines ) {
		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.status ).toBe( 'payment_required' );
		expect( cents( result.body.amount ) ).toBe( cents( amount ) );

		const res = await api.get(
			`/wp-json/fair-e2e/v1/line-item-totals?transaction_ids[]=${ result.body.transaction_id }`,
			{ headers: authHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const { transactions } = await res.json();
		expect( transactions ).toHaveLength( 1 );

		const [ transaction ] = transactions;
		expect( transaction.amount ).toBe( amount );
		expect(
			transaction.line_items.map( ( line ) => [
				String( line.quantity ),
				line.unit_amount,
				line.total_amount,
			] )
		).toEqual( lines );
		expect(
			transaction.line_items.reduce(
				( total, line ) => total + cents( line.total_amount ),
				0
			)
		).toBe( cents( amount ) );
	}

	/**
	 * Expect a response that signed the participant up with nothing to pay.
	 *
	 * @param {Object} result Response of the signup request.
	 */
	function expectFree( result ) {
		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.status ).toBe( 'signed_up' );
		expect( result.body.transaction_id ).toBeUndefined();
		expect( result.body.checkout_url ).toBeUndefined();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const meRes = await api.get( '/wp-json/wp/v2/users/me', {
			headers: authHeaders,
		} );
		expect( meRes.ok() ).toBeTruthy();

		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Totals Tester',
					email: `audience-totals-${ Date.now() }@example.test`,
					wp_user_id: ( await meRes.json() ).id,
				},
			}
		);
		expect(
			participantRes.ok(),
			'admin must not be pre-linked to a participant'
		).toBeTruthy();
		participantId = ( await participantRes.json() ).id;
	} );

	test.afterEach( async () => {
		// Leave no price override behind for other specs.
		await arm();
	} );

	test.afterAll( async () => {
		if ( participantId ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: authHeaders }
			);
		}
		for ( const postId of createdPostIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{ headers: authHeaders }
			);
		}
		await api.dispose();
	} );

	test.describe( 'ticket with activities', () => {
		test( 'ordinary two-decimal prices are unchanged', async () => {
			const { eventId, eventDateId, typeIds, optionIds } =
				await createEvent( {
					ticketTypes: [ { name: 'Standard', price: 12.5 } ],
					activities: [ { name: 'Workshop', price: 5 } ],
				} );

			await expectPaidAgreement(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					ticket_option_ids: [ optionIds.Workshop ],
				} ),
				'17.50',
				[
					[ '1', '12.50', '12.50' ],
					[ '1', '5.00', '5.00' ],
				]
			);
		} );

		test( 'a half-cent ticket price is rounded up on its own line', async () => {
			const { eventId, eventDateId, typeIds, optionIds } =
				await createEvent( {
					ticketTypes: [ { name: 'Standard', price: 10 } ],
					activities: [ { name: 'Workshop', price: 5 } ],
				} );
			await arm( { [ typeIds[ 0 ] ]: 10.005 } );

			await expectPaidAgreement(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					ticket_option_ids: [ optionIds.Workshop ],
				} ),
				'15.01',
				[
					[ '1', '10.01', '10.01' ],
					[ '1', '5.00', '5.00' ],
				]
			);
		} );

		test( 'an activity-only signup charges the activity alone', async () => {
			const { eventId, eventDateId, typeIds, optionIds } =
				await createEvent( {
					ticketTypes: [ { name: 'Standard', price: 10 } ],
					activities: [ { name: 'Workshop', price: 5 } ],
				} );
			// A ticket below half a cent costs nothing and gets no line.
			await arm( { [ typeIds[ 0 ] ]: 0.004 } );

			await expectPaidAgreement(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					ticket_option_ids: [ optionIds.Workshop ],
				} ),
				'5.00',
				[ [ '1', '5.00', '5.00' ] ]
			);
		} );

		test( 'a total below half a cent is free and signed up at once', async () => {
			const { eventId, eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { [ typeIds[ 0 ] ]: 0.004 } );

			expectFree(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
				} )
			);
		} );

		test( 'a total of half a cent is one cent to pay', async () => {
			const { eventId, eventDateId, typeIds } = await createEvent( {
				ticketTypes: [ { name: 'Standard', price: 10 } ],
			} );
			await arm( { [ typeIds[ 0 ] ]: 0.005 } );

			await expectPaidAgreement(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
				} ),
				'0.01',
				[ [ '1', '0.01', '0.01' ] ]
			);
		} );
	} );

	test.describe( 'added activities', () => {
		test( 'the add-on amount, transaction and ledger agree', async () => {
			const { eventId, eventDateId, typeIds, optionIds } =
				await createEvent( {
					ticketTypes: [ { name: 'Free entry', price: 0 } ],
					activities: [
						{ name: 'Workshop', price: 7.5 },
						{ name: 'Lunch', price: 4.25 },
						{ name: 'Tour', price: 0 },
					],
				} );

			expectFree(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
				} )
			);

			// The free Tour is added with the paid ones and gets no line.
			await expectPaidAgreement(
				await post( `${ EVENT_SIGNUP }/add-activities`, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_option_ids: [
						optionIds.Workshop,
						optionIds.Lunch,
						optionIds.Tour,
					],
				} ),
				'11.75',
				[
					[ '1', '7.50', '7.50' ],
					[ '1', '4.25', '4.25' ],
				]
			);
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

		test( 'each occurrence is rounded on its own line', async () => {
			const { eventId, eventDateId, occurrenceIds, typeIds } =
				await series();
			await arm( { [ typeIds[ 0 ] ]: 10.005 } );

			// 3 × 10.005 is 30.015 unrounded; each occurrence is 10.01.
			await expectPaidAgreement(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds,
				} ),
				'30.03',
				[
					[ '1', '10.01', '10.01' ],
					[ '1', '10.01', '10.01' ],
					[ '1', '10.01', '10.01' ],
				]
			);
		} );

		test( 'occurrences below half a cent each are free, however many', async () => {
			const { eventId, eventDateId, occurrenceIds, typeIds } =
				await series();
			await arm( { [ typeIds[ 0 ] ]: 0.004 } );

			// 3 × 0.004 is 0.012 unrounded, which would round to a cent.
			expectFree(
				await post( EVENT_SIGNUP, {
					event_id: eventId,
					event_date_id: eventDateId,
					ticket_type_id: typeIds[ 0 ],
					event_date_ids: occurrenceIds,
				} )
			);
		} );
	} );

	test.describe( 'series upgrade', () => {
		const dropInAndPass = () =>
			createEvent( {
				ticketTypes: [
					{ name: 'Drop-In', price: 0 },
					{ name: 'Series Pass', price: 20, scope: 'whole_series' },
				],
			} );

		async function signUpAndUpgrade( passPrice ) {
			const { eventId, eventDateId, typeIds } = await dropInAndPass();
			const signup = {
				event_id: eventId,
				event_date_id: eventDateId,
			};

			expectFree(
				await post( EVENT_SIGNUP, {
					...signup,
					ticket_type_id: typeIds[ 0 ],
				} )
			);

			await arm( { [ typeIds[ 1 ] ]: passPrice } );
			const result = await post( EVENT_SIGNUP, {
				...signup,
				ticket_type_id: typeIds[ 1 ],
			} );

			return { result, eventDateId, passTypeId: typeIds[ 1 ] };
		}

		test( 'a difference below half a cent converts the registration without payment', async () => {
			const { result, eventDateId, passTypeId } =
				await signUpAndUpgrade( 0.004 );
			expectFree( result );

			const participantsRes = await api.get(
				`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
				{ headers: authHeaders }
			);
			expect( participantsRes.ok() ).toBeTruthy();
			const row = ( await participantsRes.json() ).find(
				( participant ) => participant.participant_id === participantId
			);
			expect( row.label ).toBe( 'signed_up' );
			expect( row.ticket_type_id ).toBe( passTypeId );
		} );

		test( 'a difference of half a cent is one cent to pay', async () => {
			const { result } = await signUpAndUpgrade( 0.005 );

			await expectPaidAgreement( result, '0.01', [
				[ '1', '0.01', '0.01' ],
			] );
		} );

		test( 'an ordinary difference is charged as it is', async () => {
			const { result } = await signUpAndUpgrade( 20 );

			await expectPaidAgreement( result, '20.00', [
				[ '1', '20.00', '20.00' ],
			] );
		} );
	} );
} );
