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

test.describe( 'PaymentEndpoint — status access token transport (#858)', () => {
	test.describe.configure( { mode: 'serial' } );

	const CLIENT = '203.0.113.30';
	const TOKEN_HEADER = 'X-Fair-Payment-Token';
	const OWNER = {
		username: `e2e_payment_owner_${ Date.now() }`,
		password: 'e2e-owner-password-858',
	};
	const ownerAuth = {
		Authorization:
			'Basic ' +
			Buffer.from( `${ OWNER.username }:${ OWNER.password }` ).toString(
				'base64'
			),
	};

	let api;
	let page;
	let ownerId;
	let anonymous;
	let owned;

	async function createPayment( authHeaders = {} ) {
		const headers = fromClient( CLIENT, authHeaders );
		const nonceRes = await api.get( NONCE_ENDPOINT, { headers } );
		expect( nonceRes.status() ).toBe( 200 );
		const { nonce } = await nonceRes.json();

		const res = await api.post( PAYMENTS_ENDPOINT, {
			headers,
			data: {
				amount: '5.00',
				post_id: page.page_id,
				block_id: page.block_id,
				nonce,
			},
		} );
		expect( res.status(), await res.text() ).toBe( 201 );
		return { res, body: await res.json() };
	}

	function statusUrl( transactionId ) {
		return `${ PAYMENTS_ENDPOINT }/${ transactionId }/status`;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await resetCounters( api );
		page = await createPaymentPage( api );

		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminAuth,
			data: {
				username: OWNER.username,
				password: OWNER.password,
				email: `${ OWNER.username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.status(), await userRes.text() ).toBe( 201 );
		ownerId = ( await userRes.json() ).id;

		anonymous = await createPayment();
		owned = await createPayment( ownerAuth );
	} );

	test.afterAll( async () => {
		await resetCounters( api );
		await deletePaymentPage( api, page.page_id );
		if ( ownerId ) {
			await api.delete( `/wp-json/wp/v2/users/${ ownerId }`, {
				headers: adminAuth,
				params: { force: true, reassign: 1 },
			} );
		}
		await api.dispose();
	} );

	test( 'payment creation returns the token in the body, not the checkout URL', async () => {
		const { res, body } = anonymous;

		expect( typeof body.access_token ).toBe( 'string' );
		expect( body.access_token.length ).toBeGreaterThan( 0 );
		expect( body.checkout_url ).not.toContain( body.access_token );
		expect( body.checkout_url ).not.toMatch( /[?&]token=/ );
		expect( res.headers()[ 'cache-control' ] ).toContain( 'no-store' );
	} );

	test( 'the header token reads the status without a token in the URL', async () => {
		const { body } = anonymous;

		const res = await api.get( statusUrl( body.transaction_id ), {
			headers: { [ TOKEN_HEADER ]: body.access_token },
		} );

		expect( res.status(), await res.text() ).toBe( 200 );
		expect( res.url() ).not.toContain( body.access_token );
		expect( res.headers()[ 'cache-control' ] ).toContain( 'no-store' );
		const status = await res.json();
		expect( Number( status.transaction_id ) ).toBe(
			Number( body.transaction_id )
		);
		expect( status.lifecycle_status ).toBe( 'processing' );
	} );

	test( 'a missing or wrong credential is the same 404 as a missing transaction', async () => {
		const { body } = anonymous;
		const missing = await api.get(
			`${ PAYMENTS_ENDPOINT }/999999999/status`
		);
		const expected = await missing.json();

		for ( const headers of [
			{},
			{ [ TOKEN_HEADER ]: 'not-the-token' },
			{ [ TOKEN_HEADER ]: '' },
		] ) {
			const res = await api.get( statusUrl( body.transaction_id ), {
				headers,
			} );
			expect( res.status() ).toBe( 404 );
			expect( await res.json() ).toEqual( expected );
		}
	} );

	test( 'a wrong header wins over a correct query token', async () => {
		const { body } = anonymous;

		const res = await api.get( statusUrl( body.transaction_id ), {
			headers: { [ TOKEN_HEADER ]: 'not-the-token' },
			params: { token: body.access_token },
		} );

		expect( res.status() ).toBe( 404 );
	} );

	test( 'the query token still works as a deprecated fallback', async () => {
		const { body } = anonymous;

		const res = await api.get( statusUrl( body.transaction_id ), {
			params: { token: body.access_token },
		} );

		expect( res.status() ).toBe( 200 );
	} );

	test( 'an admin reads any status without a token', async () => {
		const res = await api.get( statusUrl( anonymous.body.transaction_id ), {
			headers: adminAuth,
		} );

		expect( res.status() ).toBe( 200 );
	} );

	test( 'the signed-in owner reads their own status without a token', async () => {
		const own = await api.get( statusUrl( owned.body.transaction_id ), {
			headers: ownerAuth,
		} );
		expect( own.status() ).toBe( 200 );

		const other = await api.get(
			statusUrl( anonymous.body.transaction_id ),
			{ headers: ownerAuth }
		);
		expect( other.status() ).toBe( 404 );
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
