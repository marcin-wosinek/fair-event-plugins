import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const OVERVIEW_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/connection/overview';

const STATUS_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/status';

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
				'granted_scopes',
				'scopes_known',
				'settlement_access',
				'settlement_access_requested',
			] );
			expect( typeof body.connected ).toBe( 'boolean' );
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
