/**
 * Live coverage for purchase recovery once the payment history shadow
 * writes are retired (#2253, PAYMENT_HISTORY_MIGRATION.md §8.19): every
 * checkout links its own attempt, an organizer's change to a Fair Audience
 * registration reaches its Fair Events purchase at the end of the request
 * with no periodic sweep, and work a request left behind is finished by the
 * recovery cron without duplicating a purchase, a link or an announcement.
 *
 * Get-tickets purchases go through the public route against the Mollie
 * double. Fair Audience's own purchase route, payment notifications, the
 * upgrade and the recovery cron run through the payment-recovery.php WP-CLI
 * fixture, which finishes each request's queued work as a web request would.
 */

import { randomUUID } from 'node:crypto';
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

// Fixtures run without blocking the event loop, so idle keep-alive
// connections aren't closed unnoticed between requests.
async function recovery( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-recovery.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_PURCHASE_RECOVERY:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PURCHASE_RECOVERY output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

test.describe.serial( 'Purchase recovery', () => {
	// Every check drives the site through WP-CLI calls that take seconds.
	test.describe.configure( { timeout: 120 * 1000 } );

	let api;
	let eventId;
	let eventDateId;
	let ticketTypeId;
	const transactionIds = [];
	const relationshipIds = [];
	const userIds = [];
	const participantIds = [];
	const email = `recovery-checkout-${ Date.now() }@example.test`;

	async function state() {
		return recovery( 'state', { transactionIds, relationshipIds } );
	}

	async function signups() {
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const title = `Purchase recovery ${ Date.now() }`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		eventId = ( await post.json() ).id;

		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-11-12',
				start_time: '10:00:00',
				end_date: '2035-11-12',
				end_time: '12:00:00',
			},
		} );
		const dateBody = await date.json();
		expect( date.ok(), JSON.stringify( dateBody ) ).toBeTruthy();
		eventDateId = dateBody.id;
		expect(
			(
				await api.put(
					`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
					{ headers: adminHeaders, data: { event_id: eventId } }
				)
			).ok()
		).toBeTruthy();

		const tickets = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Standard',
							capacity: null,
							minimum_activities: 0,
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
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 20,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await tickets.json();
		expect( tickets.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		ticketTypeId = ticketsBody.ticket_types[ 0 ].id;
	} );

	test.afterAll( async () => {
		await recovery( 'cleanup', {
			transactionIds,
			relationshipIds,
			userIds,
		} ).catch( () => {} );
		for ( const signup of eventDateId ? await signups() : [] ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
				{ headers: adminHeaders }
			);
		}
		for ( const id of participantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'the upgrade retires the shadow sweep and keeps queued recovery work', async () => {
		const { before, after } = await recovery( 'upgrade' );

		expect( before ).toEqual(
			expect.objectContaining( {
				version: '3.54.0',
				retired: true,
				lifecycle: true,
				relationship: true,
			} )
		);
		expect( after ).toEqual(
			expect.objectContaining( {
				version: '3.55.0',
				retired: false,
				lifecycle: true,
				relationship: true,
				recoveryAfterInit: true,
			} )
		);
	} );

	test( 'every get-tickets attempt is linked to its purchase, the failed one included', async () => {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const first = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					ticket_type_id: ticketTypeId,
					quantity: 1,
					name: 'Recovery Buyer',
					email,
					idempotency_key: randomUUID(),
					_honeypot: '',
				},
			}
		);
		const firstBody = await first.json();
		expect( first.status(), JSON.stringify( firstBody ) ).toBe( 200 );
		expect( firstBody.status ).toBe( 'payment_required' );
		transactionIds.push( firstBody.transaction_id );

		const [ signup ] = ( await signups() ).filter(
			( row ) => row.email === email
		);
		if ( signup.participant_id ) {
			participantIds.push( Number( signup.participant_id ) );
		}

		const recorded = ( await state() ).transactions[
			firstBody.transaction_id
		];
		// Linked by the checkout itself: nothing is left for a shadow writer.
		expect( recorded.work ).toBeNull();
		let links = recorded.links;
		expect( links ).toEqual( [
			expect.objectContaining( {
				signup_id: String( signup.id ),
				role: 'charge',
				allocated_amount: '20.00',
				attribution: 'live',
				evidence: expect.objectContaining( {
					type: 'metadata_signup_id',
					signup_ids: [ Number( signup.id ) ],
				} ),
			} ),
		] );

		await recovery( 'settle', {
			transactionId: firstBody.transaction_id,
			status: 'failed',
		} );
		const token = new URL( firstBody.checkout_url ).searchParams.get(
			'token'
		);
		const retry = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets/retry-payment',
			{ data: { transaction_id: firstBody.transaction_id, token } }
		);
		const retryBody = await retry.json();
		await visitor.dispose();
		expect( retry.status(), JSON.stringify( retryBody ) ).toBe( 200 );
		transactionIds.push( retryBody.transaction_id );

		const after = await state();
		expect( after.transactions[ firstBody.transaction_id ].links ).toEqual(
			links
		);
		links = after.transactions[ retryBody.transaction_id ].links;
		expect( links ).toEqual( [
			expect.objectContaining( {
				signup_id: String( signup.id ),
				role: 'charge',
				allocated_amount: '20.00',
				attribution: 'live',
				evidence: expect.objectContaining( {
					retry_of_transaction_id: firstBody.transaction_id,
				} ),
			} ),
		] );
		expect(
			after.transactions[ retryBody.transaction_id ].work
		).toBeNull();

		// The latest-attempt column keeps its meaning.
		const [ retried ] = ( await signups() ).filter(
			( row ) => row.email === email
		);
		expect( Number( retried.transaction_id ) ).toBe(
			retryBody.transaction_id
		);
	} );

	test( 'an Audience purchase records its own purchase and links before the buyer pays', async () => {
		const takenBefore = ( await recovery( 'capacity', { eventDateId } ) )
			.taken;

		const signup = await recovery( 'audience-signup', {
			eventId,
			eventDateId,
			ticketTypeId,
		} );
		expect( signup.status, JSON.stringify( signup.body ) ).toBe( 200 );
		expect( signup.body.status ).toBe( 'payment_required' );
		transactionIds.push( signup.transactionId );
		relationshipIds.push( signup.relationshipId );
		userIds.push( signup.userId );
		participantIds.push( signup.participantId );

		let current = await state();
		let shadowPurchase = current.relationships[ signup.relationshipId ];
		expect( shadowPurchase.relationship.label ).toBe( 'pending_payment' );
		expect( shadowPurchase.purchase ).toEqual(
			expect.objectContaining( {
				status: 'pending_payment',
				event_date_id: String( eventDateId ),
				ticket_type_id: String( ticketTypeId ),
				participant_id: String( signup.participantId ),
				payment_expires_at:
					shadowPurchase.relationship.payment_expires_at,
				// Never the latest attempt: no Events payment handler acts on it.
				transaction_id: null,
			} )
		);
		expect( shadowPurchase.units ).toHaveLength( 1 );
		expect( shadowPurchase.units[ 0 ].status ).toBe( 'pending_payment' );
		expect( current.transactions[ signup.transactionId ].work ).toBeNull();
		expect( current.transactions[ signup.transactionId ].links ).toEqual( [
			expect.objectContaining( {
				signup_id: shadowPurchase.purchase.id,
				role: 'charge',
				allocated_amount: '20.00',
				attribution: 'live',
				evidence: expect.objectContaining( {
					type: 'audience_signup',
					event_participant_ids: [ signup.relationshipId ],
				} ),
			} ),
		] );

		// The hold counts once: the unit, not the relationship as well.
		expect( ( await recovery( 'capacity', { eventDateId } ) ).taken ).toBe(
			takenBefore + 1
		);

		await recovery( 'settle', {
			transactionId: signup.transactionId,
			status: 'paid',
		} );
		current = await state();
		shadowPurchase = current.relationships[ signup.relationshipId ];
		expect( shadowPurchase.relationship.label ).toBe( 'signed_up' );
		expect( shadowPurchase.purchase ).toEqual(
			expect.objectContaining( {
				status: 'confirmed',
				payment_expires_at: null,
				amount: '20.00',
			} )
		);
		expect( shadowPurchase.units[ 0 ].status ).toBe( 'confirmed' );
		expect( ( await recovery( 'capacity', { eventDateId } ) ).taken ).toBe(
			takenBefore + 1
		);
	} );

	test( 'an organizer-added participant gets a purchase in the same request, which follows the relationship', async () => {
		const participant = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Recovery Guest',
					email: `recovery-guest-${ Date.now() }@example.test`,
				},
			}
		);
		expect( participant.ok() ).toBeTruthy();
		const participantId = ( await participant.json() ).id;
		participantIds.push( participantId );

		const takenBefore = ( await recovery( 'capacity', { eventDateId } ) )
			.taken;
		const added = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{
				headers: adminHeaders,
				data: { participant_id: participantId, label: 'signed_up' },
			}
		);
		expect( added.ok() ).toBeTruthy();
		const relationshipId = ( await added.json() ).id;
		relationshipIds.push( relationshipId );

		// No sweep: the request that added the participant did it.
		let current = ( await state() ).relationships[ relationshipId ];
		expect( current.purchase ).toEqual(
			expect.objectContaining( {
				status: 'confirmed',
				amount: '0.00',
				name: 'Recovery Guest',
				transaction_id: null,
			} )
		);
		expect( current.purchases ).toBe( 1 );
		expect( current.units ).toHaveLength( 1 );
		expect( current.work ).toBeNull();
		expect( ( await recovery( 'capacity', { eventDateId } ) ).taken ).toBe(
			takenBefore + 1
		);

		const relabelled = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants/${ participantId }`,
			{ headers: adminHeaders, data: { label: 'interested' } }
		);
		expect( relabelled.ok(), await relabelled.text() ).toBeTruthy();
		current = ( await state() ).relationships[ relationshipId ];
		expect( current.purchase.status ).toBe( 'cancelled' );
		expect( current.units[ 0 ].status ).toBe( 'cancelled' );
		expect( current.work ).toBeNull();
		expect( ( await recovery( 'capacity', { eventDateId } ) ).taken ).toBe(
			takenBefore
		);
	} );

	test( 'an organizer change interrupted before the end of its request is finished once by the recovery cron', async () => {
		const relationshipId = relationshipIds[ relationshipIds.length - 1 ];
		const takenBefore = ( await recovery( 'capacity', { eventDateId } ) )
			.taken;

		const interrupted = await recovery( 'interrupt', {
			relationshipId,
			label: 'signed_up',
		} );
		expect( interrupted.row ).toEqual(
			expect.objectContaining( { status: 'pending' } )
		);
		let current = ( await state() ).relationships[ relationshipId ];
		expect( current.purchase.status ).toBe( 'cancelled' );
		const purchaseId = current.purchase.id;

		const first = await recovery( 'due' );
		expect( first.processed ).toBeGreaterThanOrEqual( 1 );
		current = ( await state() ).relationships[ relationshipId ];
		expect( current.purchase ).toEqual(
			expect.objectContaining( { id: purchaseId, status: 'confirmed' } )
		);
		expect( current.units[ 0 ].status ).toBe( 'confirmed' );
		expect( current.work ).toBeNull();

		// Recovering again changes nothing and announces nothing.
		const again = await recovery( 'queue', {
			kind: 'relationship',
			sourceId: relationshipId,
		} );
		expect( again ).toEqual( { outcome: 'done', row: null } );
		const second = await recovery( 'due' );
		expect( second.confirmed ).toBe( 0 );
		expect( first.confirmed ).toBe( 0 );
		current = ( await state() ).relationships[ relationshipId ];
		expect( current.purchases ).toBe( 1 );
		expect( current.purchase.id ).toBe( purchaseId );
		expect( current.units ).toHaveLength( 1 );
		expect( ( await recovery( 'capacity', { eventDateId } ) ).taken ).toBe(
			takenBefore + 1
		);
	} );

	test( 'a transaction left queued by the shadow writer is finished without duplicating its links', async () => {
		const [ transactionId ] = transactionIds;
		const before = ( await state() ).transactions[ transactionId ].links;
		expect( before ).toHaveLength( 1 );

		const outcome = await recovery( 'queue', {
			kind: 'transaction',
			sourceId: transactionId,
		} );
		expect( outcome ).toEqual( { outcome: 'done', row: null } );
		expect( ( await state() ).transactions[ transactionId ].links ).toEqual(
			before
		);
	} );

	test( 'work that cannot complete stays queued with its reason for a retry', async () => {
		const missing = 2_000_000_000;
		transactionIds.push( missing );

		const outcome = await recovery( 'queue', {
			kind: 'transaction',
			sourceId: missing,
		} );

		expect( outcome.outcome ).toBe( 'unresolved' );
		expect( outcome.row ).toEqual(
			expect.objectContaining( {
				status: 'unresolved',
				reason: 'missing_transaction',
				attempts: '1',
			} )
		);
		expect(
			Date.parse( `${ outcome.row.next_attempt_at }Z` )
		).toBeGreaterThan( Date.now() );
	} );
} );
