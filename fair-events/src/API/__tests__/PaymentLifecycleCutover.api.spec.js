/**
 * The get-tickets lifecycle once payment links are authoritative (#2140,
 * stage 4 of #2111; PAYMENT_HISTORY_MIGRATION.md §8.11): attempts are
 * linked before the buyer pays, and payment notifications resolve their
 * purchases from those links: a late payment for a superseded attempt is
 * honoured, replays and concurrent notifications confirm once, delayed
 * failures change nothing they shouldn't, and an interrupted confirmation
 * is finished by the retry cron.
 *
 * Purchases go through the public route against the Mollie double; the
 * cutover activation, payment notifications and the retry cron run through
 * the payment-lifecycle.php WP-CLI fixture. The activation is restored after
 * the suite, so no other spec runs with it.
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

test.describe.serial( 'Payment lifecycle after the cutover', () => {
	// Every check drives the site through WP-CLI calls that take seconds.
	test.describe.configure( { timeout: 180 * 1000 } );

	let api;
	let eventId;
	let eventDateId;
	let ticketTypeId;
	const signupIds = [];
	const transactionIds = [];
	const participantIds = [];
	const run = Date.now();

	async function signupFor( email ) {
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const [ signup ] = ( await res.json() ).filter(
			( row ) => row.email === email
		);
		if ( ! signupIds.includes( Number( signup.id ) ) ) {
			signupIds.push( Number( signup.id ) );
			if ( signup.participant_id ) {
				participantIds.push( Number( signup.participant_id ) );
			}
		}
		return Number( signup.id );
	}

	// A paid checkout by a new buyer, in its own browser context.
	async function checkout( email ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				ticket_type_id: ticketTypeId,
				quantity: 1,
				name: 'Lifecycle Buyer',
				email,
				idempotency_key: randomUUID(),
				_honeypot: '',
			},
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		expect( body.status ).toBe( 'payment_required' );
		transactionIds.push( body.transaction_id );
		return {
			visitor,
			transactionId: body.transaction_id,
			token: new URL( body.checkout_url ).searchParams.get( 'token' ),
			signupId: await signupFor( email ),
		};
	}

	async function retry( visitor, transactionId, token ) {
		const res = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets/retry-payment',
			{ data: { transaction_id: transactionId, token } }
		);
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		transactionIds.push( body.transaction_id );
		return {
			transactionId: body.transaction_id,
			token: new URL( body.checkout_url ).searchParams.get( 'token' ),
		};
	}

	async function state() {
		return lifecycle( 'state', { signupIds, transactionIds } );
	}

	function settle( transactionId, status, extra = {} ) {
		return lifecycle( 'settle', { transactionId, status, ...extra } );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const title = `Lifecycle cutover ${ run }`;
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
				start_date: '2035-11-19',
				start_time: '10:00:00',
				end_date: '2035-11-19',
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

		expect( ( await lifecycle( 'activate' ) ).cutover ).toBe( true );
	} );

	test.afterAll( async () => {
		await lifecycle( 'deactivate' ).catch( () => {} );
		await lifecycle( 'cleanup', { signupIds, transactionIds } ).catch(
			() => {}
		);
		for ( const id of signupIds ) {
			await api.delete( `/wp-json/fair-events/v1/get-tickets/${ id }`, {
				headers: adminHeaders,
			} );
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

	let late;

	test( 'a checkout records its attempt before the buyer pays', async () => {
		late = await checkout( `lifecycle-late-${ run }@example.test` );

		const after = await state();
		expect( after.transactions[ late.transactionId ].links ).toEqual( [
			{
				signup_id: String( late.signupId ),
				role: 'charge',
				allocated_amount: '20.00',
				attribution: 'live',
			},
		] );
		// Written by the request itself; nothing is left for the shadow writer.
		expect(
			after.transactions[ late.transactionId ].transaction_work
		).toBeNull();
		expect( after.signups[ late.signupId ].signup.status ).toBe(
			'pending_payment'
		);
	} );

	test( 'a late payment for a superseded attempt confirms the purchase once, and every paid attempt counts', async () => {
		const failed = await settle( late.transactionId, 'failed' );
		expect( failed.announcements ).toEqual( {
			confirmed: 0,
			failed: 1,
			applied: 0,
		} );

		const second = await retry(
			late.visitor,
			late.transactionId,
			late.token
		);
		await late.visitor.dispose();
		let after = await state();
		expect( after.transactions[ second.transactionId ].links ).toEqual( [
			expect.objectContaining( {
				signup_id: String( late.signupId ),
				role: 'charge',
				attribution: 'live',
			} ),
		] );
		expect( after.signups[ late.signupId ].signup ).toMatchObject( {
			status: 'pending_payment',
			transaction_id: String( second.transactionId ),
		} );

		// The first attempt is paid after all, although the purchase moved on.
		const paid = await settle( late.transactionId, 'paid' );
		expect( paid.announcements.confirmed ).toBe( 1 );
		after = await state();
		expect( after.signups[ late.signupId ].signup.status ).toBe(
			'confirmed'
		);
		expect( after.signups[ late.signupId ].confirmation_work ).toBeNull();

		// A replayed notification confirms nothing twice.
		expect(
			( await settle( late.transactionId, 'paid' ) ).announcements
		).toEqual( { confirmed: 0, failed: 0, applied: 0 } );

		// The retry is paid too: both are money received, and reported.
		expect(
			( await settle( second.transactionId, 'paid' ) ).announcements
				.confirmed
		).toBe( 0 );
		after = await state();
		expect( after.signups[ late.signupId ].multiple_paid_attempts ).toEqual(
			{
				status: 'open',
				detail: {
					role: 'charge',
					transaction_ids: [
						late.transactionId,
						second.transactionId,
					].sort( ( a, b ) => a - b ),
				},
			}
		);
		expect( after.transactions[ late.transactionId ].links ).toHaveLength(
			1
		);
		expect( after.transactions[ second.transactionId ].links ).toHaveLength(
			1
		);

		// A delayed failure never undoes the confirmation.
		const delayed = await settle( second.transactionId, 'failed' );
		expect( delayed.announcements.failed ).toBe( 0 );
		expect( ( await state() ).signups[ late.signupId ].signup.status ).toBe(
			'confirmed'
		);
	} );

	test( 'a delayed failure of an older attempt leaves the newer one alone, and cancelling releases it', async () => {
		const buyer = await checkout(
			`lifecycle-cancel-${ run }@example.test`
		);
		await settle( buyer.transactionId, 'failed' );
		const second = await retry(
			buyer.visitor,
			buyer.transactionId,
			buyer.token
		);

		const delayed = await settle( buyer.transactionId, 'failed' );
		expect( delayed.announcements.failed ).toBe( 0 );
		expect(
			( await state() ).signups[ buyer.signupId ].signup
		).toMatchObject( {
			status: 'pending_payment',
			transaction_id: String( second.transactionId ),
		} );

		// Cancelling syncs the payment first; the provider still has it open.
		await lifecycle( 'mollie-status', { status: 'open' } );
		let cancel;
		try {
			cancel = await buyer.visitor.post(
				'/wp-json/fair-events/v1/get-tickets/cancel-payment',
				{
					data: {
						transaction_id: second.transactionId,
						token: second.token,
					},
				}
			);
		} finally {
			await lifecycle( 'mollie-status' );
		}
		const cancelBody = await cancel.json();
		await buyer.visitor.dispose();
		expect( cancel.status(), JSON.stringify( cancelBody ) ).toBe( 200 );
		expect( cancelBody ).toEqual( { success: true } );
		const released = ( await state() ).signups[ buyer.signupId ].signup;
		expect( released.status ).toBe( 'failed' );
		expect( released.payment_expires_at ).toBeNull();
	} );

	test( 'concurrent paid notifications confirm the purchase once', async () => {
		const buyer = await checkout(
			`lifecycle-concurrent-${ run }@example.test`
		);
		await buyer.visitor.dispose();

		const { results } = await lifecycle( 'parallel', {
			runs: [ 0, 0, 0 ].map( () => ( {
				action: 'settle',
				data: { transactionId: buyer.transactionId, status: 'paid' },
			} ) ),
		} );
		expect(
			results.reduce(
				( sum, result ) => sum + result.announcements.confirmed,
				0
			)
		).toBe( 1 );
		const after = ( await state() ).signups[ buyer.signupId ];
		expect( after.signup.status ).toBe( 'confirmed' );
		expect( after.confirmation_work ).toBeNull();
	} );

	test( 'a confirmation interrupted before it was announced is finished by the retry cron', async () => {
		const buyer = await checkout(
			`lifecycle-interrupted-${ run }@example.test`
		);
		await buyer.visitor.dispose();

		const interrupted = await settle( buyer.transactionId, 'paid', {
			throwOnConfirmed: true,
		} );
		expect( interrupted.threw ).toBe( true );
		let after = ( await state() ).signups[ buyer.signupId ];
		expect( after.signup.status ).toBe( 'confirmed' );
		expect( after.confirmation_work ).toMatchObject( {
			kind: 'confirmation',
		} );

		// A replay doesn't drop the pending announcement.
		await settle( buyer.transactionId, 'paid' );
		expect(
			( await state() ).signups[ buyer.signupId ].confirmation_work
		).not.toBeNull();

		const due = await lifecycle( 'due' );
		expect( due.announcements.confirmed ).toBe( 1 );
		after = ( await state() ).signups[ buyer.signupId ];
		expect( after.confirmation_work ).toBeNull();

		// Finished work stays finished.
		expect( ( await lifecycle( 'due' ) ).announcements.confirmed ).toBe(
			0
		);
	} );
} );
