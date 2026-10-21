/**
 * Helpers for the public payment/nonce/webhook rate limit specs (#855),
 * backed by the test-only routes in e2e/mu-plugins/fair-e2e-payment-rate-limit.php.
 */
import { expect } from '@playwright/test';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CONTROL = '/wp-json/fair-e2e/v1/payment-rate-limit';

export const NONCE_ENDPOINT = '/wp-json/fair-payments-connector/v1/nonce';
export const PAYMENTS_ENDPOINT = '/wp-json/fair-payments-connector/v1/payments';

export const LIMITS = { payment: 10, nonce: 60, invalid_webhook: 30 };
export const WINDOW = 60;

export const adminAuth = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASS }` ).toString( 'base64' ),
};

/**
 * Headers that make a request come from another client address. Each spec
 * uses its own documentation-range addresses so it never touches the
 * counters of the shared address every other spec reaches the site from.
 *
 * @param {string} ip    Address, or "none" for a request without REMOTE_ADDR.
 * @param {Object} extra Further headers.
 * @return {Object} Headers.
 */
export function fromClient( ip, extra = {} ) {
	return { 'X-Fair-E2E-Client-Ip': ip, ...extra };
}

/**
 * Clear every rate-limit counter.
 *
 * @param {import('@playwright/test').APIRequestContext} api Request context.
 */
export async function resetCounters( api ) {
	const res = await api.delete( CONTROL, { headers: adminAuth } );
	expect( res.status(), await res.text() ).toBe( 200 );
}

/**
 * Row and Mollie call counts, plus one counter when bucket and ip are given.
 *
 * @param {import('@playwright/test').APIRequestContext} api    Request context.
 * @param {Object}                                       params { bucket, ip }.
 * @return {Promise<Object>} count, expires_in, transactions, payment_logs, mollie_creates, mollie_gets.
 */
export async function state( api, params = {} ) {
	const res = await api.get( CONTROL, { headers: adminAuth, params } );
	expect( res.status(), await res.text() ).toBe( 200 );
	return res.json();
}

/**
 * Let time pass for one counter's window.
 *
 * @param {import('@playwright/test').APIRequestContext} api     Request context.
 * @param {string}                                       bucket  Bucket.
 * @param {string}                                       ip      Address or "none".
 * @param {number}                                       seconds Seconds.
 * @return {Promise<Object>} { expires_in }.
 */
export async function elapse( api, bucket, ip, seconds ) {
	const res = await api.post( `${ CONTROL }/elapse`, {
		headers: adminAuth,
		data: { bucket, ip, seconds },
	} );
	expect( res.status(), await res.text() ).toBe( 200 );
	return res.json();
}

/**
 * Publish a page with one simple-payment block.
 *
 * @param {import('@playwright/test').APIRequestContext} api Request context.
 * @return {Promise<Object>} { page_id, block_id }.
 */
export async function createPaymentPage( api ) {
	const res = await api.post( `${ CONTROL }/page`, { headers: adminAuth } );
	expect( res.status(), await res.text() ).toBe( 200 );
	return res.json();
}

/**
 * Delete a page made by createPaymentPage().
 *
 * @param {import('@playwright/test').APIRequestContext} api    Request context.
 * @param {number}                                       pageId Page ID.
 */
export async function deletePaymentPage( api, pageId ) {
	await api.delete( `${ CONTROL }/page`, {
		headers: adminAuth,
		params: { page_id: pageId },
	} );
}

/**
 * Expect the generic 429 answer.
 *
 * @param {import('@playwright/test').APIResponse} res Response.
 */
export async function expectRateLimited( res ) {
	expect( res.status() ).toBe( 429 );
	const body = await res.json();
	expect( body.code ).toBe( 'rate_limited' );
	expect( body.data.retry_after ).toBeGreaterThan( 0 );
	expect( body.data.retry_after ).toBeLessThanOrEqual( WINDOW );
	expect( body.message ).toMatch(
		/^Too many requests\. Please try again in \d+ seconds?\.$/
	);
}
