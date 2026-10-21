import { test, expect, request } from '@playwright/test';
import {
	LIMITS,
	NONCE_ENDPOINT,
	PAYMENTS_ENDPOINT,
	WINDOW,
	adminAuth,
	createPaymentPage,
	deletePaymentPage,
	elapse,
	expectRateLimited,
	fromClient,
	resetCounters,
	state,
} from './helpers/payment-rate-limit.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';

test.describe( 'PaymentEndpoint — GET /nonce', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'returns a nonce string', async () => {
		const res = await api.get( NONCE_ENDPOINT );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( typeof body.nonce ).toBe( 'string' );
		expect( body.nonce.length ).toBeGreaterThan( 0 );
	} );
} );

test.describe( 'PaymentEndpoint — POST /payments security checks', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'returns 400 when nonce param is missing', async () => {
		const res = await api.post( PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'some-block-id',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'returns 403 for an invalid nonce', async () => {
		const res = await api.post( PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'some-block-id',
				nonce: 'invalid_nonce_value',
			},
		} );
		expect( res.status() ).toBe( 403 );
		const body = await res.json();
		expect( body.code ).toBe( 'invalid_nonce' );
	} );

	test( 'returns 400 when block_id param is missing', async () => {
		const res = await api.post( PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				nonce: 'some_nonce',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'returns 403 for a valid nonce but missing post_id', async () => {
		const nonceRes = await api.get( NONCE_ENDPOINT );
		const { nonce } = await nonceRes.json();

		const res = await api.post( PAYMENTS_ENDPOINT, {
			data: {
				amount: '10',
				currency: 'EUR',
				block_id: 'non-existent-block-id',
				nonce,
			},
		} );
		expect( res.status() ).toBe( 403 );
		const body = await res.json();
		expect( body.code ).toBe( 'invalid_block' );
	} );
} );

test.describe( 'PaymentEndpoint — GET /payments/:id/status token gating', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	// Any caller can enumerate transaction IDs, so a missing transaction and a
	// token mismatch on a real one must be indistinguishable (both 404) —
	// see get_transaction_status_permissions_check().

	test( 'returns 404 for a non-existent transaction id without a token', async () => {
		const res = await api.get( `${ PAYMENTS_ENDPOINT }/999999999/status` );
		expect( res.status() ).toBe( 404 );
		const body = await res.json();
		expect( body.code ).toBe( 'transaction_not_found' );
	} );

	test( 'returns 404 for a non-existent transaction id with a token', async () => {
		const res = await api.get(
			`${ PAYMENTS_ENDPOINT }/999999999/status?token=anything`
		);
		expect( res.status() ).toBe( 404 );
		const body = await res.json();
		expect( body.code ).toBe( 'transaction_not_found' );
	} );
} );

test.describe( 'PaymentEndpoint — per-IP rate limits (#855)', () => {
	// Each test sends dozens of sequential requests.
	test.describe.configure( { mode: 'serial', timeout: 120_000 } );

	let api;
	let page;

	const CLIENT = '203.0.113.10';
	const OTHER_CLIENT = '203.0.113.11';

	async function getNonce( ip ) {
		return api.get( NONCE_ENDPOINT, { headers: fromClient( ip ) } );
	}

	async function validNonce() {
		// From an address no test exhausts, so it never eats a test's budget.
		const res = await getNonce( '198.51.100.250' );
		expect( res.status() ).toBe( 200 );
		return ( await res.json() ).nonce;
	}

	async function pay( ip, nonce, extraHeaders = {} ) {
		return api.post( PAYMENTS_ENDPOINT, {
			headers: fromClient( ip, extraHeaders ),
			data: {
				amount: '5.00',
				post_id: page.page_id,
				block_id: page.block_id,
				nonce,
			},
		} );
	}

	// Use up a client's payment budget with requests the endpoint refuses on
	// its own (bad nonce), proving they are still answered as before.
	async function exhaustPayments( ip, extraHeaders = {} ) {
		for ( let i = 0; i < LIMITS.payment; i++ ) {
			const res = await pay( ip, 'invalid_nonce_value', extraHeaders );
			expect( res.status(), `attempt ${ i + 1 }` ).toBe( 403 );
			expect( ( await res.json() ).code ).toBe( 'invalid_nonce' );
		}
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		page = await createPaymentPage( api );
	} );

	test.beforeEach( async () => {
		await resetCounters( api );
	} );

	test.afterAll( async () => {
		await resetCounters( api );
		await deletePaymentPage( api, page.page_id );
		await api.dispose();
	} );

	test( 'GET /nonce answers 60 requests a minute, then 429', async () => {
		for ( let i = 0; i < LIMITS.nonce; i++ ) {
			const res = await getNonce( CLIENT );
			expect( res.status(), `request ${ i + 1 }` ).toBe( 200 );
			expect( typeof ( await res.json() ).nonce ).toBe( 'string' );
		}

		await expectRateLimited( await getNonce( CLIENT ) );
		expect(
			( await state( api, { bucket: 'nonce', ip: CLIENT } ) ).count
		).toBe( LIMITS.nonce );
	} );

	test( 'POST /payments allows 10 attempts a minute; the 11th creates nothing', async () => {
		const nonce = await validNonce();

		// Below the limit, a valid payment works exactly as before.
		const first = await pay( CLIENT, nonce );
		expect( first.status(), await first.text() ).toBe( 201 );
		const created = await first.json();
		expect( created.success ).toBe( true );
		expect( typeof created.checkout_url ).toBe( 'string' );

		for ( let i = 1; i < LIMITS.payment; i++ ) {
			expect(
				( await pay( CLIENT, 'invalid_nonce_value' ) ).status()
			).toBe( 403 );
		}

		const before = await state( api );
		await expectRateLimited( await pay( CLIENT, nonce ) );
		const after = await state( api );

		expect( after.transactions ).toBe( before.transactions );
		expect( after.payment_logs ).toBe( before.payment_logs );
		expect( after.mollie_creates ).toBe( before.mollie_creates );
	} );

	test( 'payment and nonce budgets are independent', async () => {
		await exhaustPayments( CLIENT );
		await expectRateLimited( await pay( CLIENT, 'invalid_nonce_value' ) );
		expect( ( await getNonce( CLIENT ) ).status() ).toBe( 200 );

		await resetCounters( api );
		for ( let i = 0; i < LIMITS.nonce; i++ ) {
			await getNonce( CLIENT );
		}
		await expectRateLimited( await getNonce( CLIENT ) );
		expect( ( await pay( CLIENT, 'invalid_nonce_value' ) ).status() ).toBe(
			403
		);
	} );

	test( 'each address has its own budget; forwarded headers are no way out', async () => {
		await exhaustPayments( CLIENT );

		const spoofed = await pay( CLIENT, 'invalid_nonce_value', {
			'X-Forwarded-For': OTHER_CLIENT,
			'X-Real-IP': OTHER_CLIENT,
			'Client-IP': OTHER_CLIENT,
		} );
		await expectRateLimited( spoofed );

		expect(
			( await pay( OTHER_CLIENT, 'invalid_nonce_value' ) ).status()
		).toBe( 403 );
	} );

	test( 'the window is fixed: rejections do not extend it, and it ends on time', async () => {
		await exhaustPayments( CLIENT );
		const start = await state( api, { bucket: 'payment', ip: CLIENT } );
		expect( start.count ).toBe( LIMITS.payment );

		await elapse( api, 'payment', CLIENT, 30 );
		await expectRateLimited( await pay( CLIENT, 'invalid_nonce_value' ) );
		const middle = await state( api, { bucket: 'payment', ip: CLIENT } );
		expect( middle.count ).toBe( LIMITS.payment );
		expect( middle.expires_in ).toBeLessThanOrEqual(
			start.expires_in - 30
		);

		await elapse( api, 'payment', CLIENT, WINDOW );
		expect( ( await pay( CLIENT, 'invalid_nonce_value' ) ).status() ).toBe(
			403
		);
		expect(
			( await state( api, { bucket: 'payment', ip: CLIENT } ) ).count
		).toBe( 1 );
	} );

	test( 'requests without a client address share one fallback budget', async () => {
		await exhaustPayments( 'none' );
		await expectRateLimited( await pay( 'none', 'invalid_nonce_value' ) );
		expect(
			( await state( api, { bucket: 'payment', ip: 'none' } ) ).count
		).toBe( LIMITS.payment );
	} );

	test( 'signed-in callers are limited too', async () => {
		await exhaustPayments( CLIENT, adminAuth );
		await expectRateLimited(
			await pay( CLIENT, 'invalid_nonce_value', adminAuth )
		);
	} );
} );
