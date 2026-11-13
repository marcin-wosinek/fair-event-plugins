/**
 * Playwright API tests for the retry-payment route of Fair Audience's
 * purchase route. Payment webhooks first resolved the registration(s) a
 * transaction belongs to through the Fair Audience ledger (#1112) instead of
 * the mutable event_participants.transaction_id column. Fair Events' payment
 * links replaced that ledger (#2251), and it is no longer written (#2254);
 * the paid and failed paths are covered by the payment lifecycle specs.
 *
 * This suite covers what is reachable over HTTP without Mollie: the
 * retry-payment endpoint's permission boundary, mirroring the pattern in
 * EventSignupResume.api.spec.js.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ENDPOINT = '/wp-json/fair-audience/v1/event-signup/retry-payment';

test.describe( 'EventSignupController retry-payment — permission boundary', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'rejects a missing transaction_id', async () => {
		const res = await api.post( ENDPOINT, { data: {} } );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects an invalid transaction_id with 400', async () => {
		const res = await api.post( ENDPOINT, { data: { transaction_id: 0 } } );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'invalid_transaction' );
	} );

	test( 'an unknown transaction_id 404s', async () => {
		const res = await api.post( ENDPOINT, {
			data: {
				transaction_id: 999999999,
				signature: 'not-a-real-signature',
			},
		} );
		expect( res.status() ).toBe( 404 );
		const body = await res.json();
		expect( body.code ).toBe( 'transaction_not_found' );
	} );
} );
