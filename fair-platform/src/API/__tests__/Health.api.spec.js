/**
 * OAuth proxy health signal and the post-deploy probe (#2290).
 *
 * Credentials, outbound-request refusal and a paused plugin are set per
 * request with headers; see e2e/mu-plugins/fair-e2e-platform-health.php and
 * e2e/mu-plugins/fair-e2e-shared-loader.php.
 */
import { test, expect } from '@playwright/test';

import { verifyProxy } from '../../../../scripts/verify-oauth-proxy.mjs';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const HEALTH = '/wp-json/fair-platform/v1/health';

const CONFIGURED = { 'X-Fair-E2E-Platform-Credentials': 'set' };
const EMPTY_CREDENTIALS = { 'X-Fair-E2E-Platform-Credentials': 'empty' };
// A shipped Fair Timetable release that loads an old shared class early
// pauses every updated Fair plugin, as on fair-event-plugins.com (#2290).
const PAUSED = {
	'X-Fair-E2E-Legacy-Shared': '0.8.0',
	'X-Fair-E2E-Legacy-Order': 'last',
	'X-Fair-E2E-Legacy-Early': '1',
};

function expectNoStore( response ) {
	expect( response.headers()[ 'cache-control' ] ).toContain( 'no-store' );
}

test.describe( 'Fair Platform health', () => {
	test( 'a configured proxy answers healthy to an anonymous request', async ( {
		request,
	} ) => {
		const response = await request.get( `${ BASE_URL }${ HEALTH }`, {
			headers: CONFIGURED,
			maxRedirects: 0,
		} );

		expect( response.status() ).toBe( 200 );
		expect( response.headers()[ 'content-type' ] ).toContain(
			'application/json'
		);
		expectNoStore( response );
		expect( await response.json() ).toEqual( {
			service: 'fair-platform-oauth-proxy',
			status: 'ok',
		} );
		expect( await response.text() ).not.toContain( 'e2e_health' );
	} );

	for ( const [ name, headers ] of [
		[ 'missing', {} ],
		[ 'empty', EMPTY_CREDENTIALS ],
	] ) {
		test( `${ name } credentials answer unhealthy without the cause`, async ( {
			request,
		} ) => {
			const response = await request.get( `${ BASE_URL }${ HEALTH }`, {
				headers,
				maxRedirects: 0,
			} );

			expect( response.status() ).toBe( 503 );
			expectNoStore( response );
			expect( await response.json() ).toEqual( {
				service: 'fair-platform-oauth-proxy',
				status: 'unhealthy',
			} );
		} );
	}

	test( 'a paused plugin has no health route, not a homepage', async ( {
		request,
	} ) => {
		const response = await request.get( `${ BASE_URL }${ HEALTH }`, {
			headers: { ...CONFIGURED, ...PAUSED },
			maxRedirects: 0,
		} );

		expect( response.status() ).toBe( 404 );
		expect( ( await response.json() ).code ).toBe( 'rest_no_route' );
	} );

	test( 'an empty refresh is refused without contacting Mollie', async ( {
		request,
	} ) => {
		const response = await request.post( `${ BASE_URL }/oauth/refresh`, {
			headers: {
				...CONFIGURED,
				'X-Fair-E2E-Platform-Outbound': '1',
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			data: '',
			maxRedirects: 0,
		} );

		expect( response.status() ).toBe( 400 );
		expect( response.headers()[ 'x-fair-e2e-outbound-http' ] ).toBe(
			undefined
		);
		expect( await response.json() ).toEqual( {
			success: false,
			data: { message: 'Missing refresh_token' },
		} );
	} );

	test( 'the post-deploy probe passes on a healthy proxy and fails otherwise', async () => {
		const options = { baseUrl: BASE_URL, attempts: 1, log: () => {} };

		expect(
			await verifyProxy( { ...options, headers: CONFIGURED } )
		).toEqual( { ok: true, failures: [] } );

		const unhealthy = await verifyProxy( options );
		expect( unhealthy.ok ).toBe( false );
		expect( unhealthy.failures[ 0 ] ).toContain( 'unhealthy' );

		const paused = await verifyProxy( {
			...options,
			headers: { ...CONFIGURED, ...PAUSED },
		} );
		expect( paused.ok ).toBe( false );
		expect( paused.failures[ 0 ] ).toContain( 'paused' );
	} );
} );
