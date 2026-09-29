/**
 * Playwright API tests for the get-tickets return-from-payment routes
 * (#1244): payment-state, retry-payment, cancel-payment.
 *
 * The dev stack this suite runs against has no payment connector configured
 * (same assumption as GetTicketsPaymentUnavailable.api.spec.js), so a real
 * paid/failed transaction can't be produced by driving the actual create/
 * checkout flow here — that's covered by the e2e return-and-retry spec,
 * which runs against a Mollie double. What IS testable at this layer,
 * without any payment provider, is the ownership boundary every one of
 * these routes shares: SignupPaymentSession::get() resolve_transaction_from_request()
 * must 404 — never a more specific error — for any transaction_id it can't
 * verify, so an anonymous caller can't enumerate other visitors' payments.
 *
 * "Cancel and start over" on an owned attempt (#1707) is covered below with
 * attempts seeded through the test-only fair-e2e/v1/payment-attempts routes
 * (e2e/mu-plugins/fair-e2e-payment-attempts.php): a Mollie-backed
 * transaction whose status the Mollie double reports on the forced sync.
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

// Astronomically unlikely to collide with a real row in the test DB.
const BOGUS_TRANSACTION_ID = 999999999;

test.describe( 'GetTicketsController — payment-state / retry-payment / cancel-payment', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'payment-state with no transaction_id and no session cookie 404s', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/get-tickets/payment-state'
		);
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'transaction_not_found' );
	} );

	test( 'payment-state with an unknown transaction_id 404s', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/get-tickets/payment-state',
			{ params: { transaction_id: BOGUS_TRANSACTION_ID, token: 'wrong' } }
		);
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'transaction_not_found' );
	} );

	test( 'retry-payment requires a transaction_id', async () => {
		const res = await api.post(
			'/wp-json/fair-events/v1/get-tickets/retry-payment',
			{ data: {} }
		);
		expect( res.status() ).toBe( 400 );
	} );

	test( 'retry-payment with an unknown transaction_id 404s, never a more specific error', async () => {
		const res = await api.post(
			'/wp-json/fair-events/v1/get-tickets/retry-payment',
			{ data: { transaction_id: BOGUS_TRANSACTION_ID, token: 'wrong' } }
		);
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'transaction_not_found' );
	} );

	test( 'cancel-payment requires a transaction_id', async () => {
		const res = await api.post(
			'/wp-json/fair-events/v1/get-tickets/cancel-payment',
			{ data: {} }
		);
		expect( res.status() ).toBe( 400 );
	} );

	test( 'cancel-payment with an unknown transaction_id 404s, never a more specific error', async () => {
		const res = await api.post(
			'/wp-json/fair-events/v1/get-tickets/cancel-payment',
			{ data: { transaction_id: BOGUS_TRANSACTION_ID, token: 'wrong' } }
		);
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'transaction_not_found' );
	} );

	test( 'admins get the same 404 as anyone else for an unknown transaction_id', async () => {
		// signup_payment_permissions_check() has no manage_options carve-out
		// (unlike PaymentEndpoint's own status check) — ownership of a
		// get-tickets signup is never an admin concern, so this stays a
		// plain 404 even for an authenticated admin.
		const res = await api.get(
			'/wp-json/fair-events/v1/get-tickets/payment-state',
			{
				headers: adminHeaders,
				params: { transaction_id: BOGUS_TRANSACTION_ID },
			}
		);
		expect( res.status() ).toBe( 404 );
	} );
} );

test.describe( 'GetTicketsController — cancel-payment on an owned attempt', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let eventPostId;
	let eventDateId;
	const transactionIds = [];

	async function setMollieStatus( status ) {
		const res = await api.put( '/wp-json/fair-e2e/v1/mollie-status', {
			headers: adminHeaders,
			data: { status },
		} );
		expect( res.ok() ).toBeTruthy();
	}

	async function seedAttempt( transactionStatus, signupStatuses ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/payment-attempts', {
			headers: adminHeaders,
			data: {
				event_date_id: eventDateId,
				transaction_status: transactionStatus,
				signup_statuses: signupStatuses,
			},
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		transactionIds.push( body.transaction_id );
		return body;
	}

	async function attemptState( transactionId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/payment-attempts/${ transactionId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	// Each call is a fresh anonymous visitor holding only the callback token.
	async function cancel( attempt ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets/cancel-payment',
			{
				data: {
					transaction_id: attempt.transaction_id,
					token: attempt.token,
				},
			}
		);
		const body = await res.json();
		const clearsSession = res
			.headersArray()
			.some(
				( { name, value } ) =>
					name.toLowerCase() === 'set-cookie' &&
					value.startsWith( 'fair_events_signup_payment=' )
			);
		await visitor.dispose();
		return { status: res.status(), body, clearsSession };
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Cancel payment ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const dateRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: 'Cancel payment',
				start_datetime: '2035-10-01 10:00:00',
				end_datetime: '2035-10-01 12:00:00',
				link_type: 'post',
			},
		} );
		const dateBody = await dateRes.json();
		expect( dateRes.ok(), JSON.stringify( dateBody ) ).toBeTruthy();
		eventDateId = dateBody.id;
	} );

	test.afterEach( async () => {
		// Leave the double reporting "paid" for every other spec's assumption.
		await setMollieStatus( 'paid' );
	} );

	test.afterAll( async () => {
		for ( const transactionId of transactionIds ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/payment-attempts/${ transactionId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	for ( const providerStatus of [ 'failed', 'canceled', 'expired' ] ) {
		test( `a payment the provider marked ${ providerStatus } is released and the session cleared`, async () => {
			await setMollieStatus( providerStatus );
			// The payment hook already failed the signup; its hold is still set.
			const attempt = await seedAttempt( providerStatus, [ 'failed' ] );
			expect( attempt.signups[ 0 ].payment_expires_at ).toBeTruthy();

			const result = await cancel( attempt );

			expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
			expect( result.body ).toEqual( { success: true } );
			expect( result.clearsSession ).toBe( true );

			const state = await attemptState( attempt.transaction_id );
			expect( state.signups ).toHaveLength( 1 );
			expect( state.signups[ 0 ].status ).toBe( 'failed' );
			expect( state.signups[ 0 ].payment_expires_at ).toBeNull();

			// The released attempt can no longer be retried.
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const retry = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets/retry-payment',
				{
					data: {
						transaction_id: attempt.transaction_id,
						token: attempt.token,
					},
				}
			);
			expect( retry.status() ).toBe( 409 );
			await visitor.dispose();

			// Cancelling again is harmless.
			const again = await cancel( attempt );
			expect( again.status ).toBe( 200 );
		} );
	}

	test( 'a payment the provider failed after the card rendered is released', async () => {
		// Locally still open; the provider reports failure on the forced sync.
		await setMollieStatus( 'failed' );
		const attempt = await seedAttempt( 'open', [ 'pending_payment' ] );

		const result = await cancel( attempt );

		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body ).toEqual( { success: true } );
		const state = await attemptState( attempt.transaction_id );
		expect( state.transaction_status ).toBe( 'failed' );
		expect( state.signups[ 0 ].status ).toBe( 'failed' );
		expect( state.signups[ 0 ].payment_expires_at ).toBeNull();
		expect( state.signups[ 0 ].ticket_statuses ).toEqual( [ 'failed' ] );
	} );

	test( 'every row of a multi-row payment is released together', async () => {
		await setMollieStatus( 'open' );
		const attempt = await seedAttempt( 'open', [
			'pending_payment',
			'pending_payment',
		] );

		const result = await cancel( attempt );

		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		const state = await attemptState( attempt.transaction_id );
		for ( const signup of state.signups ) {
			expect( signup.status ).toBe( 'failed' );
			expect( signup.payment_expires_at ).toBeNull();
		}
	} );

	test( 'a payment that became paid is confirmed, never cancelled', async () => {
		await setMollieStatus( 'paid' );
		const attempt = await seedAttempt( 'open', [ 'pending_payment' ] );

		const result = await cancel( attempt );

		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.lifecycle_status ).toBe( 'confirmed' );
		expect( result.clearsSession ).toBe( true );
		const state = await attemptState( attempt.transaction_id );
		expect( state.transaction_status ).toBe( 'paid' );
		expect( state.signups[ 0 ].status ).toBe( 'confirmed' );
	} );

	test( 'a row confirmed while cancelling keeps the whole payment confirmed', async () => {
		// The paid notification confirmed one row; the provider still
		// reports the payment open to this request.
		await setMollieStatus( 'open' );
		const attempt = await seedAttempt( 'open', [
			'pending_payment',
			'confirmed',
		] );

		const result = await cancel( attempt );

		expect( result.status, JSON.stringify( result.body ) ).toBe( 200 );
		expect( result.body.state ).toBe( 'confirmed' );
		expect( result.body.lifecycle_status ).toBe( 'confirmed' );
		const state = await attemptState( attempt.transaction_id );
		expect( state.signups.map( ( s ) => s.status ) ).toEqual( [
			'pending_payment',
			'confirmed',
		] );
		expect( state.signups[ 0 ].payment_expires_at ).toBeTruthy();
	} );

	test( 'an unsafe multi-row release changes nothing and can be retried', async () => {
		await setMollieStatus( 'open' );
		const attempt = await seedAttempt( 'open', [
			'pending_payment',
			'cancelled',
		] );

		const result = await cancel( attempt );

		expect( result.status ).toBe( 409 );
		expect( result.body.code ).toBe( 'invalid_cancel_state' );
		expect( result.clearsSession ).toBe( false );
		const state = await attemptState( attempt.transaction_id );
		expect( state.signups.map( ( s ) => s.status ) ).toEqual( [
			'pending_payment',
			'cancelled',
		] );
		expect( state.signups[ 0 ].payment_expires_at ).toBeTruthy();
		expect( state.signups[ 0 ].ticket_statuses ).toEqual( [
			'pending_payment',
		] );

		// The recovery state is intact: the visitor can still act on it.
		const again = await cancel( attempt );
		expect( again.status ).toBe( 409 );
		expect( again.body.code ).toBe( 'invalid_cancel_state' );
	} );
} );
