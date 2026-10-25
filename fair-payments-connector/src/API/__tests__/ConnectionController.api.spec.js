import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const OVERVIEW_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/connection/overview';

const STATUS_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/status';

const TEST_CONNECTION_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/test-connection';

// Test-only route in e2e/mu-plugins/fair-e2e-error-responses.php.
const ERROR_RESPONSES_ENDPOINT = '/wp-json/fair-e2e/v1/error-responses';

// Exception message the fixture throws: a private path and a marker.
const DIAGNOSTIC =
	'E2E-DIAGNOSTIC-860 in /srv/private/fair-payments/secret.php';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Return Basic-auth headers for the WP admin account.
 */
function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASS }` ).toString(
				'base64'
			),
	};
}

test.describe( 'ConnectionController', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test.describe( 'GET /oauth/status (#1693)', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.get( STATUS_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'reports the connection and its permissions to an admin, without credentials', async () => {
			const res = await api.get( STATUS_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();

			expect( Object.keys( body ).sort() ).toEqual( [
				'connected',
				'credential_status',
				'credentials_encrypted',
				'granted_scopes',
				'payments_available',
				'scopes_known',
				'settlement_access',
				'settlement_access_requested',
			] );
			expect( typeof body.connected ).toBe( 'boolean' );
			// #1318: whether the stored tokens can be used, never the tokens.
			expect( [
				'available',
				'encryption_unavailable',
				'unrecoverable',
			] ).toContain( body.credential_status );
			expect( typeof body.credentials_encrypted ).toBe( 'boolean' );
			expect( typeof body.payments_available ).toBe( 'boolean' );
			expect( typeof body.scopes_known ).toBe( 'boolean' );
			expect( Array.isArray( body.granted_scopes ) ).toBe( true );
			expect( typeof body.settlement_access ).toBe( 'boolean' );
			// Settlement access is never inferred from the request for it:
			// it needs the exact granted scope.
			expect( body.settlement_access ).toBe(
				body.granted_scopes.includes( 'settlements.read' )
			);
			// Fair Finance is active on the test site (.wp-env.json).
			expect( body.settlement_access_requested ).toBe( true );
		} );
	} );

	test.describe( 'POST /test-connection (#860)', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.post( TEST_CONNECTION_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'answers a failure generically, with diagnostics only under WP_DEBUG', async () => {
			const { wp_debug: wpDebug } = await (
				await api.get( ERROR_RESPONSES_ENDPOINT, {
					headers: adminAuth(),
				} )
			).json();

			const res = await api.post( TEST_CONNECTION_ENDPOINT, {
				headers: {
					...adminAuth(),
					'X-Fair-E2E-Fail-Diagnostic': DIAGNOSTIC,
				},
			} );
			expect( res.status() ).toBe( 500 );
			const text = await res.text();
			const body = JSON.parse( text );

			expect( body.code ).toBe( 'connection_failed' );
			expect( body.message ).toBe( 'Connection test failed.' );
			expect( body.data.status ).toBe( 500 );

			if ( wpDebug ) {
				expect( body.data.details.message ).toBe( DIAGNOSTIC );
				expect( typeof body.data.details.file ).toBe( 'string' );
				expect( typeof body.data.details.line ).toBe( 'number' );
			} else {
				expect( body.data ).toEqual( { status: 500 } );
				expect( text ).not.toContain( 'E2E-DIAGNOSTIC-860' );
				expect( text ).not.toContain( '/srv/private' );
			}
		} );
	} );

	test.describe( 'GET /connection/overview', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.get( OVERVIEW_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'returns a graceful error for an authenticated admin when not connected', async () => {
			test.skip(
				true,
				'Skipped pending #1405 — the shared e2e test env forces a connected Mollie state'
			);
			// This suite runs before any spec establishes an OAuth connection, so
			// the site is expected to be disconnected here. The live-Mollie
			// success path can't be exercised in CI (no real Mollie creds).
			const res = await api.get( OVERVIEW_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 400 );
			const body = await res.json();
			expect( body.code ).toBe( 'not_connected' );
		} );
	} );
} );
