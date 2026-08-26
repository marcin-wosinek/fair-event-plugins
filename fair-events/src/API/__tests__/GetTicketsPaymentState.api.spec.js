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
