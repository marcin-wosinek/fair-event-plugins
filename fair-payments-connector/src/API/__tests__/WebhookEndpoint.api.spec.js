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
const ENDPOINT = '/wp-json/fair-payments-connector/v1/webhook';

test.describe( 'WebhookEndpoint — POST /webhook', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'returns 400 when id param is missing', async () => {
		const res = await api.post( ENDPOINT, { data: {} } );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'missing_payment_id' );
	} );

	test( 'returns 404 for an unknown mollie payment id', async () => {
		const res = await api.post( ENDPOINT, {
			data: { id: 'tr_nonexistent_test_id' },
		} );
		expect( res.status() ).toBe( 404 );
		const body = await res.json();
		expect( body.code ).toBe( 'transaction_not_found' );
	} );
} );

test.describe( 'WebhookEndpoint — handler failure (#860)', () => {
	// Exception message the fixture in e2e/mu-plugins/fair-e2e-error-responses.php
	// throws: a private path and a marker.
	const DIAGNOSTIC =
		'E2E-DIAGNOSTIC-860 in /srv/private/fair-payments/secret.php';
	const CLIENT = '203.0.113.86';

	let api;
	let page;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		page = await createPaymentPage( api );
	} );

	test.afterAll( async () => {
		await deletePaymentPage( api, page.page_id );
		await api.dispose();
	} );

	test( 'acknowledges with a generic error and logs the exception class without its message', async () => {
		const { nonce } = await (
			await api.get( NONCE_ENDPOINT, { headers: fromClient( CLIENT ) } )
		).json();
		const paid = await api.post( PAYMENTS_ENDPOINT, {
			headers: fromClient( CLIENT ),
			data: {
				amount: '5.00',
				post_id: page.page_id,
				block_id: page.block_id,
				nonce,
			},
		} );
		expect( paid.status(), await paid.text() ).toBe( 201 );
		const { mollie_payment_id: molliePaymentId } = await paid.json();

		const res = await api.post( ENDPOINT, {
			headers: fromClient( CLIENT, {
				'X-Fair-E2E-Fail-Diagnostic': DIAGNOSTIC,
			} ),
			data: { id: molliePaymentId },
		} );
		expect( res.status() ).toBe( 200 );
		const text = await res.text();
		expect( JSON.parse( text ) ).toEqual( {
			success: false,
			error: 'The payment update could not be processed.',
		} );
		expect( text ).not.toContain( 'E2E-DIAGNOSTIC-860' );
		expect( text ).not.toContain( '/srv/private' );

		const log = await api.get( '/wp-json/fair-payments-connector/v1/log', {
			headers: adminAuth,
			params: { event: 'webhook_failed', limit: 20 },
		} );
		expect( log.status(), await log.text() ).toBe( 200 );
		const entry = ( await log.json() ).find(
			( row ) => row.context?.mollie_payment_id === molliePaymentId
		);
		expect( entry ).toBeDefined();
		expect( entry.level ).toBe( 'error' );
		expect( entry.message ).toBe( 'Webhook handler raised an exception' );
		expect( entry.context.exception_class ).toBe( 'RuntimeException' );
		expect( JSON.stringify( entry ) ).not.toContain( 'E2E-DIAGNOSTIC-860' );
	} );
} );

test.describe( 'WebhookEndpoint — invalid-request rate limit (#855)', () => {
	// Each test sends dozens of sequential requests.
	test.describe.configure( { mode: 'serial', timeout: 120_000 } );

	let api;
	let page;

	const CLIENT = '203.0.113.20';
	const OTHER_CLIENT = '203.0.113.21';

	async function webhook( ip, data ) {
		return api.post( ENDPOINT, { headers: fromClient( ip ), data } );
	}

	async function unknown( ip ) {
		return webhook( ip, {
			id: `tr_unknown${ Math.random().toString( 36 ).slice( 2, 10 ) }`,
		} );
	}

	async function exhaustInvalid( ip ) {
		for ( let i = 0; i < LIMITS.invalid_webhook; i++ ) {
			const res = await unknown( ip );
			expect( res.status(), `request ${ i + 1 }` ).toBe( 404 );
			expect( ( await res.json() ).code ).toBe( 'transaction_not_found' );
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

	test( 'unknown IDs never reach Mollie and are refused after 30 a minute', async () => {
		const before = await state( api );
		await exhaustInvalid( CLIENT );
		const atLimit = await state( api );

		expect( atLimit.mollie_gets ).toBe( before.mollie_gets );
		// Each answered request is still logged (received + failed).
		expect( atLimit.payment_logs ).toBe(
			before.payment_logs + 2 * LIMITS.invalid_webhook
		);

		for ( let i = 0; i < 5; i++ ) {
			await expectRateLimited( await unknown( CLIENT ) );
		}
		const after = await state( api );

		// Throttled requests are neither logged nor sent to Mollie.
		expect( after.payment_logs ).toBe( atLimit.payment_logs );
		expect( after.mollie_gets ).toBe( before.mollie_gets );
	} );

	test( 'missing and malformed IDs count against the same budget', async () => {
		const missing = await webhook( CLIENT, {} );
		expect( missing.status() ).toBe( 400 );
		expect( ( await missing.json() ).code ).toBe( 'missing_payment_id' );

		for ( const id of [ 'tr_with spaces', 'x'.repeat( 65 ), [ 'tr_a' ] ] ) {
			const res = await webhook( CLIENT, { id } );
			expect( res.status(), JSON.stringify( id ) ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'invalid_payment_id' );
		}

		expect(
			( await state( api, { bucket: 'invalid_webhook', ip: CLIENT } ) )
				.count
		).toBe( 4 );
	} );

	test( 'a valid webhook is processed even when its source is throttled', async () => {
		const { nonce } = await (
			await api.get( NONCE_ENDPOINT, {
				headers: fromClient( '198.51.100.251' ),
			} )
		).json();
		const paid = await api.post( PAYMENTS_ENDPOINT, {
			headers: fromClient( '198.51.100.251' ),
			data: {
				amount: '5.00',
				post_id: page.page_id,
				block_id: page.block_id,
				nonce,
			},
		} );
		expect( paid.status(), await paid.text() ).toBe( 201 );
		const { mollie_payment_id: molliePaymentId } = await paid.json();

		await exhaustInvalid( CLIENT );
		await expectRateLimited( await unknown( CLIENT ) );

		const before = await state( api );
		const res = await webhook( CLIENT, { id: molliePaymentId } );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await res.json() ).success ).toBe( true );
		expect( ( await state( api ) ).mollie_gets ).toBe(
			before.mollie_gets + 1
		);
	} );

	test( 'each address has its own budget, which comes back after the window', async () => {
		await exhaustInvalid( CLIENT );
		await expectRateLimited( await unknown( CLIENT ) );

		expect( ( await unknown( OTHER_CLIENT ) ).status() ).toBe( 404 );

		await elapse( api, 'invalid_webhook', CLIENT, WINDOW );
		expect( ( await unknown( CLIENT ) ).status() ).toBe( 404 );
	} );
} );
