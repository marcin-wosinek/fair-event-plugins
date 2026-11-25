/**
 * Fair Audience's purchase route, activity add-ons and series upgrades with
 * Fair Events' payment links authoritative (#2140, stage 4 of #2111;
 * PAYMENT_HISTORY_MIGRATION.md §8.12) and no cutover activation recorded
 * (#2251): every attempt is recorded in Fair
 * Events before the buyer pays, Fair Events applies the paid notification
 * to its purchase once, and Fair Audience follows what it committed. An
 * upgrade is priced from the purchase's own paid allocations, a delayed
 * add-on failure leaves a newer attempt's holds alone, and an interrupted
 * projection is finished by the retry cron.
 *
 * Purchases go through the public routes against the Mollie double, as the
 * admin's linked participant. Payment notifications and the retry cron run
 * through the payment-lifecycle.php WP-CLI fixture, which also stashes any
 * recorded activation for the suite and restores it afterwards.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const cents = ( amount ) => Math.round( Number( amount ) * 100 );

// Fixtures run without blocking the event loop, so idle keep-alive
// connections aren't closed unnoticed between requests.
async function lifecycle( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-lifecycle.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_PAYMENT_LIFECYCLE:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_LIFECYCLE output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

test.describe.serial( 'Fair Audience purchase lifecycle', () => {
	// Every check drives the site through WP-CLI calls that take seconds.
	test.describe.configure( { timeout: 180 * 1000 } );

	let api;
	let participantId;
	const createdPostIds = [];
	const transactionIds = [];
	const signupIds = [];

	async function createEvent( { ticketTypes, activities = [], rrule } ) {
		const title = `Audience lifecycle ${ Date.now() } ${ Math.random() }`;
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
				start_date: '2035-11-01',
				start_time: '10:00:00',
				end_date: '2035-11-01',
				end_time: '12:00:00',
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
						price: type.price,
					} ) ),
					options: activities.map( ( activity ) => ( {
						name: activity.name,
						price: activity.price,
						capacity: activity.capacity ?? null,
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
			occurrenceIds: [
				eventDateId,
				...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
			].sort( ( a, b ) => a - b ),
			typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
			optionIds,
		};
	}

	async function post( path, data ) {
		const res = await api.post( path, { headers: authHeaders, data } );
		const body = await res.json();
		return { status: res.status(), body };
	}

	// A request that sends the buyer to pay; its attempt is tracked.
	async function startPayment( path, data ) {
		const result = await post( path, data );
		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.status ).toBe( 'payment_required' );
		transactionIds.push( Number( result.body.transaction_id ) );
		return result.body;
	}

	async function state() {
		const current = await lifecycle( 'state', {
			signupIds,
			transactionIds,
		} );
		for ( const id of Object.keys( current.purchases ) ) {
			if ( ! signupIds.includes( Number( id ) ) ) {
				signupIds.push( Number( id ) );
			}
		}
		return current;
	}

	function settle( transactionId, status, extra = {} ) {
		return lifecycle( 'settle', { transactionId, status, ...extra } );
	}

	const linksOf = ( current, transactionId ) =>
		current.transactions[ transactionId ].links;
	const purchaseOf = ( current, transactionId ) =>
		current.purchases[ linksOf( current, transactionId )[ 0 ].signup_id ];
	const retriesOf = async ( transactionId ) =>
		( await lifecycle( 'retries', { transactionId } ) ).transaction_ids;
	const signupIdsOf = ( current, transactionId ) =>
		linksOf( current, transactionId )
			.map( ( link ) => Number( link.signup_id ) )
			.sort( ( a, b ) => a - b );

	// Current ticket prices by ticket type ID, as a pricing extension would
	// set them (fair-e2e-line-item-totals.php); none restores them.
	async function armPrices( ticketTypes = {} ) {
		const res = await api.put(
			'/wp-json/fair-e2e/v1/line-item-totals/fixture',
			{ headers: authHeaders, data: { ticket_types: ticketTypes } }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	// A signup or add-on attempt the provider reported failed, before its
	// notification arrived.
	async function failedAttempt( path, data ) {
		const body = await startPayment( path, data );
		const transactionId = Number( body.transaction_id );
		await lifecycle( 'status', { transactionId, status: 'failed' } );
		return transactionId;
	}

	// The retry is a new attempt of the same purchase at the original
	// amount, currency and lines.
	function expectSameCharge( current, retryId, originalId ) {
		const retry = current.transactions[ retryId ];
		const original = current.transactions[ originalId ];
		expect( retry.retry_of ).toBe( originalId );
		expect( retry.currency ).toBe( original.currency );
		expect( cents( retry.amount ) ).toBe( cents( original.amount ) );
		expect( retry.line_items ).toEqual( original.line_items );
	}

	const activity = ( purchase, optionId ) =>
		purchase.activities.find(
			( row ) => Number( row.ticket_option_id ) === optionId
		);

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
					name: 'Lifecycle Tester',
					email: `audience-lifecycle-${ Date.now() }@example.test`,
					wp_user_id: ( await meRes.json() ).id,
				},
			}
		);
		expect(
			participantRes.ok(),
			'admin must not be pre-linked to a participant'
		).toBeTruthy();
		participantId = ( await participantRes.json() ).id;

		expect( ( await lifecycle( 'clear' ) ).cutover ).toBe( false );
	} );

	test.afterAll( async () => {
		await lifecycle( 'faults' );
		await armPrices();
		await lifecycle( 'restore' );
		await lifecycle( 'cleanup', { signupIds, transactionIds } );
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

	let event;

	test( 'a paid signup is recorded before payment and confirmed once from its links', async () => {
		event = await createEvent( {
			ticketTypes: [ { name: 'Entry', price: 8 } ],
			activities: [
				{ name: 'Workshop', price: 5 },
				{ name: 'Lunch', price: 6 },
				{ name: 'Tour', price: 7 },
			],
		} );

		const body = await startPayment( EVENT_SIGNUP, {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_type_id: event.typeIds[ 0 ],
		} );
		const transactionId = Number( body.transaction_id );

		// Linked to its Events purchase before the buyer was sent to pay.
		let current = await state();
		expect( linksOf( current, transactionId ) ).toEqual( [
			expect.objectContaining( {
				role: 'charge',
				allocated_amount: '8.00',
				attribution: 'live',
			} ),
		] );
		let purchase = purchaseOf( current, transactionId );
		expect( purchase.purchase.status ).toBe( 'pending_payment' );
		expect( purchase.relationship.label ).toBe( 'pending_payment' );

		const paid = await settle( transactionId, 'paid' );
		expect( paid.announcements.applied ).toBe( 1 );
		current = await state();
		purchase = purchaseOf( current, transactionId );
		expect( purchase.purchase.status ).toBe( 'confirmed' );
		expect( purchase.relationship.label ).toBe( 'signed_up' );
		expect( purchase.relationship.payment_expires_at ).toBeNull();

		// A replayed notification changes and announces nothing.
		const replay = await settle( transactionId, 'paid' );
		expect( replay.announcements.applied ).toBe( 0 );
		current = await state();
		expect( linksOf( current, transactionId ) ).toHaveLength( 1 );
		expect( purchaseOf( current, transactionId ).purchase.status ).toBe(
			'confirmed'
		);
	} );

	test( 'a paid add-on is confirmed on the purchase’s ticket once', async () => {
		const body = await startPayment( `${ EVENT_SIGNUP }/add-activities`, {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_option_ids: [ event.optionIds.Workshop ],
		} );
		const transactionId = Number( body.transaction_id );

		let current = await state();
		expect( linksOf( current, transactionId ) ).toEqual( [
			expect.objectContaining( {
				role: 'additional_charge',
				allocated_amount: '5.00',
			} ),
		] );
		expect(
			activity(
				purchaseOf( current, transactionId ),
				event.optionIds.Workshop
			).status
		).toBe( 'pending_payment' );

		expect(
			( await settle( transactionId, 'paid' ) ).announcements.applied
		).toBe( 1 );
		expect(
			( await settle( transactionId, 'paid' ) ).announcements.applied
		).toBe( 0 );

		current = await state();
		expect(
			activity(
				purchaseOf( current, transactionId ),
				event.optionIds.Workshop
			).status
		).toBe( 'confirmed' );
	} );

	test( 'an interrupted projection is finished by the retry cron', async () => {
		const body = await startPayment( `${ EVENT_SIGNUP }/add-activities`, {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_option_ids: [ event.optionIds.Lunch ],
		} );
		const transactionId = Number( body.transaction_id );

		const interrupted = await settle( transactionId, 'paid', {
			throwOnApplied: true,
		} );
		expect( interrupted.threw ).toBe( true );
		let current = await state();
		expect(
			activity(
				purchaseOf( current, transactionId ),
				event.optionIds.Lunch
			).status
		).toBe( 'confirmed' );
		expect(
			current.transactions[ transactionId ].projection_work
		).toBeTruthy();

		const due = await lifecycle( 'due' );
		expect( due.announcements.applied ).toBe( 1 );
		current = await state();
		expect( current.transactions[ transactionId ].projection_work ).toBe(
			null
		);
	} );

	test( 'a delayed add-on failure leaves the retry’s hold alone', async () => {
		const first = await startPayment( `${ EVENT_SIGNUP }/add-activities`, {
			event_id: event.eventId,
			event_date_id: event.eventDateId,
			ticket_option_ids: [ event.optionIds.Tour ],
		} );
		const firstId = Number( first.transaction_id );

		// The attempt failed at the provider; its notification is late.
		await lifecycle( 'status', {
			transactionId: firstId,
			status: 'failed',
		} );
		const retried = await startPayment( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		const retryId = Number( retried.transaction_id );

		let current = await state();
		expect( linksOf( current, retryId ) ).toEqual( [
			expect.objectContaining( { role: 'additional_charge' } ),
		] );
		expectSameCharge( current, retryId, firstId );
		expect( signupIdsOf( current, retryId ) ).toEqual(
			signupIdsOf( current, firstId )
		);

		await settle( firstId, 'failed' );
		current = await state();
		expect(
			activity( purchaseOf( current, retryId ), event.optionIds.Tour )
				.status
		).toBe( 'pending_payment' );

		await settle( retryId, 'paid' );
		current = await state();
		expect(
			activity( purchaseOf( current, retryId ), event.optionIds.Tour )
				.status
		).toBe( 'confirmed' );
	} );

	test( 'a series upgrade is priced from the purchase and upgrades it', async () => {
		const series = await createEvent( {
			ticketTypes: [
				{ name: 'Drop-In', price: 8 },
				{ name: 'Series Pass', price: 20, scope: 'whole_series' },
			],
		} );
		const signup = {
			event_id: series.eventId,
			event_date_id: series.eventDateId,
		};

		// A failed attempt pays nothing; only the paid one is credited.
		const failed = await startPayment( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: series.typeIds[ 0 ],
		} );
		await settle( Number( failed.transaction_id ), 'failed' );
		const dropIn = await startPayment( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: Number( failed.transaction_id ),
		} );
		await settle( Number( dropIn.transaction_id ), 'paid' );

		const upgrade = await startPayment( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: series.typeIds[ 1 ],
		} );
		expect( cents( upgrade.amount ) ).toBe( cents( 12 ) );
		const upgradeId = Number( upgrade.transaction_id );

		let current = await state();
		expect( linksOf( current, upgradeId ) ).toEqual( [
			expect.objectContaining( {
				role: 'upgrade',
				allocated_amount: '12.00',
				signup_id: linksOf(
					current,
					Number( dropIn.transaction_id )
				)[ 0 ].signup_id,
			} ),
		] );

		expect(
			( await settle( upgradeId, 'paid' ) ).announcements.applied
		).toBe( 1 );
		expect(
			( await settle( upgradeId, 'paid' ) ).announcements.applied
		).toBe( 0 );

		current = await state();
		const purchase = purchaseOf( current, upgradeId );
		expect( Number( purchase.purchase.ticket_type_id ) ).toBe(
			series.typeIds[ 1 ]
		);
		expect( Number( purchase.relationship.ticket_type_id ) ).toBe(
			series.typeIds[ 1 ]
		);
		// The original charge stays linked as it was.
		expect(
			linksOf( current, Number( dropIn.transaction_id ) )
		).toHaveLength( 1 );
	} );

	test( 'a free signup gets its purchase at once, and a free upgrade upgrades it', async () => {
		const series = await createEvent( {
			ticketTypes: [
				{ name: 'Free Drop-In', price: 0 },
				{ name: 'Free Pass', price: 0, scope: 'whole_series' },
			],
		} );
		const signup = {
			event_id: series.eventId,
			event_date_id: series.eventDateId,
		};
		const purchases = async () => {
			const res = await api.get(
				`/wp-json/fair-events/v1/get-tickets?event_date=${ series.eventDateId }`,
				{ headers: authHeaders }
			);
			expect( res.status() ).toBe( 200 );
			const rows = await res.json();
			signupIds.push( ...rows.map( ( row ) => Number( row.id ) ) );
			return rows;
		};

		// No sweep has run: the purchase, and so its place, exist already.
		const free = await post( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: series.typeIds[ 0 ],
		} );
		expect( free.status, JSON.stringify( free.body ) ).toBe( 200 );
		expect( free.body.status ).toBe( 'signed_up' );
		let rows = await purchases();
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].status ).toBe( 'confirmed' );
		expect( Number( rows[ 0 ].ticket_type_id ) ).toBe(
			series.typeIds[ 0 ]
		);

		// Nothing to pay: the same purchase becomes the pass.
		const upgrade = await post( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: series.typeIds[ 1 ],
		} );
		expect( upgrade.status, JSON.stringify( upgrade.body ) ).toBe( 200 );
		expect( upgrade.body.status ).toBe( 'signed_up' );
		rows = await purchases();
		expect( rows ).toHaveLength( 1 );
		expect( Number( rows[ 0 ].ticket_type_id ) ).toBe(
			series.typeIds[ 1 ]
		);
	} );
	test( 'a signup retry charges the original lines after a price change, on the same purchase', async () => {
		const priced = await createEvent( {
			ticketTypes: [ { name: 'Entry', price: 8 } ],
			activities: [ { name: 'Workshop', price: 5 } ],
		} );
		const signup = {
			event_id: priced.eventId,
			event_date_id: priced.eventDateId,
		};
		const firstId = await failedAttempt( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: priced.typeIds[ 0 ],
			ticket_option_ids: [ priced.optionIds.Workshop ],
		} );

		await armPrices( { [ priced.typeIds[ 0 ] ]: 11 } );
		let retried;
		try {
			retried = await startPayment( `${ EVENT_SIGNUP }/retry-payment`, {
				transaction_id: firstId,
			} );
		} finally {
			await armPrices();
		}
		const retryId = Number( retried.transaction_id );
		expect( cents( retried.amount ) ).toBe( cents( 13 ) );

		let current = await state();
		expectSameCharge( current, retryId, firstId );
		expect( linksOf( current, retryId ) ).toEqual( [
			expect.objectContaining( { role: 'charge' } ),
		] );
		expect( signupIdsOf( current, retryId ) ).toEqual(
			signupIdsOf( current, firstId )
		);
		// The original attempt stays in the purchase's history.
		expect( linksOf( current, firstId ) ).toHaveLength( 1 );

		await settle( retryId, 'paid' );
		current = await state();
		expect( purchaseOf( current, retryId ).purchase.status ).toBe(
			'confirmed'
		);

		// Retrying the old attempt of a paid purchase starts nothing.
		const again = await post( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		expect( again.status, JSON.stringify( again.body ) ).toBe( 200 );
		expect( again.body.status ).toBe( 'already_signed_up' );
		expect( await retriesOf( firstId ) ).toEqual( [ retryId ] );
	} );

	test( 'a retry for several occurrences keeps every line and the whole purchase set', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
			ticketTypes: [
				{ name: 'Pick dates', price: 8, scope: 'multiple_instances' },
			],
		} );
		const firstId = await failedAttempt( EVENT_SIGNUP, {
			event_id: series.eventId,
			event_date_id: series.eventDateId,
			ticket_type_id: series.typeIds[ 0 ],
			event_date_ids: series.occurrenceIds.slice( 0, 2 ),
		} );

		await armPrices( { [ series.typeIds[ 0 ] ]: 11 } );
		let retried;
		try {
			retried = await startPayment( `${ EVENT_SIGNUP }/retry-payment`, {
				transaction_id: firstId,
			} );
		} finally {
			await armPrices();
		}
		const retryId = Number( retried.transaction_id );

		let current = await state();
		expectSameCharge( current, retryId, firstId );
		expect( current.transactions[ retryId ].line_items ).toHaveLength( 2 );
		expect( linksOf( current, retryId ) ).toEqual( [
			expect.objectContaining( {
				role: 'charge',
				allocated_amount: '8.00',
			} ),
			expect.objectContaining( {
				role: 'charge',
				allocated_amount: '8.00',
			} ),
		] );
		expect( signupIdsOf( current, retryId ) ).toEqual(
			signupIdsOf( current, firstId )
		);
		expect( linksOf( current, firstId ) ).toHaveLength( 2 );

		await settle( retryId, 'paid' );
		current = await state();
		for ( const signupId of signupIdsOf( current, retryId ) ) {
			expect( current.purchases[ signupId ].purchase.status ).toBe(
				'confirmed'
			);
		}

		const again = await post( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		expect( again.status, JSON.stringify( again.body ) ).toBe( 200 );
		expect( again.body.status ).toBe( 'already_signed_up' );
		expect( await retriesOf( firstId ) ).toEqual( [ retryId ] );
	} );

	test( 'an add-on retry whose lapsed places were taken is refused before payment', async () => {
		const limited = await createEvent( {
			ticketTypes: [ { name: 'Free Entry', price: 0 } ],
			activities: [ { name: 'Seminar', price: 7, capacity: 1 } ],
		} );
		const signup = {
			event_id: limited.eventId,
			event_date_id: limited.eventDateId,
		};
		const free = await post( EVENT_SIGNUP, {
			...signup,
			ticket_type_id: limited.typeIds[ 0 ],
		} );
		expect( free.body.status ).toBe( 'signed_up' );
		const firstId = await failedAttempt(
			`${ EVENT_SIGNUP }/add-activities`,
			{
				...signup,
				ticket_option_ids: [ limited.optionIds.Seminar ],
			}
		);
		const current = await state();
		const { ticket_id: ticketId } = activity(
			purchaseOf( current, firstId ),
			limited.optionIds.Seminar
		);

		// The hold runs out and another buyer takes the only place.
		const expired = await api.post(
			'/wp-json/fair-e2e/v1/ticket-activities/expire-addon',
			{ headers: authHeaders, data: { ticket_id: Number( ticketId ) } }
		);
		expect( expired.ok() ).toBeTruthy();
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const taker = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: limited.eventDateId,
					ticket_type_id: limited.typeIds[ 0 ],
					name: 'Place Taker',
					email: `audience-lifecycle-taker-${ Date.now() }@example.test`,
					ticket_option_ids: [ limited.optionIds.Seminar ],
					_honeypot: '',
				},
			}
		);
		const takerBody = await taker.json();
		await visitor.dispose();
		expect( taker.status(), JSON.stringify( takerBody ) ).toBe( 200 );
		if ( takerBody.transaction_id ) {
			transactionIds.push( Number( takerBody.transaction_id ) );
		}

		const { mollie_creates: creates } = await lifecycle( 'faults' );
		const refused = await post( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		expect( refused.status, JSON.stringify( refused.body ) ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_option_full' );
		const after = await lifecycle( 'retries', { transactionId: firstId } );
		expect( after.transaction_ids ).toEqual( [] );
		expect( after.mollie_creates ).toBe( creates );
	} );

	test( 'a legacy attempt without lines is refused and leaves its hold alone', async () => {
		const legacy = await createEvent( {
			ticketTypes: [ { name: 'Entry', price: 8 } ],
		} );
		const firstId = await failedAttempt( EVENT_SIGNUP, {
			event_id: legacy.eventId,
			event_date_id: legacy.eventDateId,
			ticket_type_id: legacy.typeIds[ 0 ],
		} );
		const before = purchaseOf( await state(), firstId ).relationship;
		expect(
			( await lifecycle( 'drop-lines', { transactionId: firstId } ) )
				.deleted
		).toBeGreaterThan( 0 );

		const refused = await post( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		expect( refused.status, JSON.stringify( refused.body ) ).toBe( 500 );
		expect( refused.body.code ).toBe( 'invalid_retry_state' );
		expect( purchaseOf( await state(), firstId ).relationship ).toEqual(
			before
		);
		expect( await retriesOf( firstId ) ).toEqual( [] );
	} );

	test( 'a retry stops at the step that fails, and only the buyer may retry', async () => {
		const faulty = await createEvent( {
			ticketTypes: [ { name: 'Entry', price: 8 } ],
		} );
		const firstId = await failedAttempt( EVENT_SIGNUP, {
			event_id: faulty.eventId,
			event_date_id: faulty.eventDateId,
			ticket_type_id: faulty.typeIds[ 0 ],
		} );
		const retry = () =>
			post( `${ EVENT_SIGNUP }/retry-payment`, {
				transaction_id: firstId,
			} );

		// Someone else's request is refused before anything starts.
		const stranger = await request.newContext( { baseURL: BASE_URL } );
		const foreign = await stranger.post(
			`${ EVENT_SIGNUP }/retry-payment`,
			{ data: { transaction_id: firstId } }
		);
		await stranger.dispose();
		expect( [ 401, 403 ] ).toContain( foreign.status() );
		const { mollie_creates: creates } = await lifecycle( 'faults' );
		expect( await retriesOf( firstId ) ).toEqual( [] );

		// Creation refused: nothing is created or recorded.
		await lifecycle( 'faults', { refuseCreates: 1 } );
		const notCreated = await retry();
		expect( notCreated.status ).toBeGreaterThanOrEqual( 400 );
		expect( await retriesOf( firstId ) ).toEqual( [] );

		// Recording refused: the attempt exists, but no payment starts.
		await lifecycle( 'faults', { unrecordable: 1 } );
		const notRecorded = await retry();
		expect( notRecorded.status, JSON.stringify( notRecorded.body ) ).toBe(
			503
		);
		expect( notRecorded.body.code ).toBe( 'payment_not_recorded' );
		const [ unrecordedId ] = await retriesOf( firstId );
		transactionIds.push( unrecordedId );
		let current = await state();
		expect( linksOf( current, unrecordedId ) ).toEqual( [] );

		// The provider refuses: the error is returned and the recorded
		// attempt stays linked for recovery.
		await lifecycle( 'faults', { failMollieCreates: 1 } );
		const notPaid = await retry();
		expect( notPaid.status ).toBeGreaterThanOrEqual( 400 );
		expect( notPaid.body.status ).not.toBe( 'payment_required' );
		const unpaidId = ( await retriesOf( firstId ) ).at( -1 );
		expect( unpaidId ).not.toBe( unrecordedId );
		transactionIds.push( unpaidId );
		current = await state();
		expectSameCharge( current, unpaidId, firstId );
		expect( linksOf( current, unpaidId ) ).toEqual( [
			expect.objectContaining( { role: 'charge' } ),
		] );
		expect( signupIdsOf( current, unpaidId ) ).toEqual(
			signupIdsOf( current, firstId )
		);
		expect(
			( await lifecycle( 'retries', { transactionId: firstId } ) )
				.mollie_creates
		).toBe( creates );

		// Once nothing fails, the buyer is sent to pay.
		await lifecycle( 'faults' );
		const paid = await startPayment( `${ EVENT_SIGNUP }/retry-payment`, {
			transaction_id: firstId,
		} );
		current = await state();
		expectSameCharge( current, Number( paid.transaction_id ), firstId );
		expect(
			( await lifecycle( 'retries', { transactionId: firstId } ) )
				.mollie_creates
		).toBe( creates + 1 );
	} );
} );
