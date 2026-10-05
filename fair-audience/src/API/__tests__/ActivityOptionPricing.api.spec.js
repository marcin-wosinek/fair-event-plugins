/**
 * Playwright API tests for add-on (activity) pricing through fair-audience
 * (#1786). fair-events owns the base prices and selection rules; this suite
 * covers the fair-audience flows that sit on top of them: its own signup
 * and add-activities routes, and group discounts applied to a purchase made
 * through fair-events' get-tickets route. Paid purchases run against the
 * Mollie double from e2e/mu-plugins.
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

// Awaited rather than blocking, so pooled sockets are not left to go stale
// while WP-CLI runs.
async function runScript( file, marker, ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			`wp-content/mu-plugins/scripts/${ file }`,
			...args,
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( new RegExp( `${ marker }:(\\{.*\\})` ) );
	if ( ! match ) {
		throw new Error(
			`Expected ${ marker } in WP-CLI output:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

test.describe( 'Add-on pricing through fair-audience', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];
	const createdParticipantIds = [];

	/**
	 * Create a post-linked event with a 10.00 ticket type, a sale period
	 * that is over and one on sale, and three add-ons: Workshop (5.00 then
	 * 9.00), Lapsed (priced only for the period that is over) and Dinner
	 * (12.00 flat).
	 */
	async function createEvent() {
		const title = `Audience add-on pricing ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const eventId = ( await postRes.json() ).id;
		createdPostIds.push( eventId );

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
		const eventDateId = edBody.id;
		createdEventDateIds.push( eventDateId );

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
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
					sale_periods: [
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
					prices: [ 0, 1 ].map( ( index ) => ( {
						ticket_type_index: 0,
						sale_period_index: index,
						price: 10,
					} ) ),
					options: [
						{
							name: 'Workshop',
							price: 99,
							derive_price_from_sale_period: true,
							period_prices: [
								{ sale_period_index: 0, price: 5 },
								{ sale_period_index: 1, price: 9 },
							],
						},
						{
							name: 'Lapsed',
							price: 7,
							derive_price_from_sale_period: true,
							period_prices: [
								{ sale_period_index: 0, price: 5 },
							],
						},
						{ name: 'Dinner', price: 12 },
					],
					settings: {},
				},
			}
		);
		const config = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( config ) ).toBeTruthy();

		const optionIds = {};
		for ( const option of config.options ) {
			optionIds[ option.name ] = option.id;
		}

		return {
			eventId,
			eventDateId,
			typeId: config.ticket_types[ 0 ].id,
			optionIds,
		};
	}

	// A participant recognised by a signed token, as from an emailed link.
	async function participantFor( eventDateId ) {
		const seeded = await runScript(
			'seed-participant-token.php',
			'E2E_TOKEN',
			String( eventDateId )
		);
		createdParticipantIds.push( seeded.participantId );
		return seeded;
	}

	async function post( path, data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( `/wp-json${ path }`, { data } );
		const body = await res.json();
		await visitor.dispose();
		return { status: res.status(), body };
	}

	async function lineItems( transactionId ) {
		const res = await api.get(
			`/wp-json/fair-payments-connector/v1/transactions/${ transactionId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( ( await res.json() ).line_items || [] ).map( ( item ) => ( {
			name: item.name,
			quantity: Number( item.quantity ),
			amount: Number( item.unit_amount ),
		} ) );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const participantId of createdParticipantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: adminHeaders }
			);
		}
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
	} );

	test( 'the signup route charges a sale-period add-on at the price on sale', async () => {
		const event = await createEvent();
		const { token } = await participantFor( event.eventDateId );

		const signup = await post( '/fair-audience/v1/event-signup', {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_type_id: event.typeId,
			ticket_option_ids: [ event.optionIds.Workshop ],
			participant_token: token,
		} );
		expect( signup.status, JSON.stringify( signup.body ) ).toBe( 200 );
		expect( signup.body.status ).toBe( 'payment_required' );
		// 10.00 ticket + 9.00 for the period on sale, not the 5.00 early price.
		expect( Number( signup.body.amount ) ).toBe( 19 );
	} );

	test( 'the signup route refuses an add-on without a price instead of giving it away', async () => {
		const event = await createEvent();
		const { token } = await participantFor( event.eventDateId );

		const signup = await post( '/fair-audience/v1/event-signup', {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_type_id: event.typeId,
			ticket_option_ids: [ event.optionIds.Lapsed ],
			participant_token: token,
		} );
		expect( signup.status, JSON.stringify( signup.body ) ).toBe( 409 );
		expect( signup.body.code ).toBe( 'ticket_option_unavailable' );
		expect( signup.body.message ).toContain( 'Lapsed' );
	} );

	test( 'adding activities charges the price on sale and refuses one without a price', async () => {
		const event = await createEvent();
		const { token, participantId } = await participantFor(
			event.eventDateId
		);

		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ event.eventDateId }/participants/batch`,
			{
				headers: adminHeaders,
				data: {
					participant_ids: [ participantId ],
					label: 'signed_up',
				},
			}
		);
		expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();

		const unavailable = await post(
			'/fair-audience/v1/event-signup/add-activities',
			{
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				ticket_option_ids: [ event.optionIds.Lapsed ],
				participant_token: token,
			}
		);
		expect( unavailable.status, JSON.stringify( unavailable.body ) ).toBe(
			409
		);
		expect( unavailable.body.code ).toBe( 'ticket_option_unavailable' );

		const added = await post(
			'/fair-audience/v1/event-signup/add-activities',
			{
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				ticket_option_ids: [
					event.optionIds.Workshop,
					event.optionIds.Dinner,
				],
				participant_token: token,
			}
		);
		expect( added.status, JSON.stringify( added.body ) ).toBe( 200 );
		expect( added.body.status ).toBe( 'payment_required' );
		expect( Number( added.body.amount ) ).toBe( 21 );
	} );

	test( 'a group discount lowers the add-on price and it is charged once', async () => {
		const seeded = await runScript(
			'seed-group-discount-note-event.php',
			'E2E_SEED',
			JSON.stringify( {
				price: 20,
				discountType: 'percentage',
				discountValue: 50,
				optionPrice: 10,
			} )
		);

		try {
			const member = await post( '/fair-events/v1/get-tickets', {
				name: 'Group Member',
				email: `addon-member-${ Date.now() }@example.test`,
				_honeypot: '',
				event_date_id: seeded.eventDateId,
				ticket_type_id: seeded.ticketTypeId,
				ticket_option_ids: [ seeded.optionId ],
				participant_token: seeded.token,
			} );
			expect( member.status, JSON.stringify( member.body ) ).toBe( 200 );
			// Half of the 20.00 ticket and half of the 10.00 add-on.
			expect( Number( member.body.amount ) ).toBe( 15 );
			expect(
				( await lineItems( member.body.transaction_id ) ).filter(
					( item ) => item.name === 'Dinner'
				)
			).toEqual( [ { name: 'Dinner', quantity: 1, amount: 5 } ] );

			const stranger = await post( '/fair-events/v1/get-tickets', {
				name: 'Not A Member',
				email: `addon-stranger-${ Date.now() }@example.test`,
				_honeypot: '',
				event_date_id: seeded.eventDateId,
				ticket_type_id: seeded.ticketTypeId,
				ticket_option_ids: [ seeded.optionId ],
			} );
			expect( stranger.status, JSON.stringify( stranger.body ) ).toBe(
				200
			);
			expect( Number( stranger.body.amount ) ).toBe( 30 );
		} finally {
			await runScript(
				'cleanup-group-discount-note-event.php',
				'E2E_CLEANUP',
				String( seeded.eventId ),
				String( seeded.eventDateId ),
				String( seeded.participantId ),
				String( seeded.groupId ),
				String( seeded.ruleId )
			);
		}
	} );
} );
