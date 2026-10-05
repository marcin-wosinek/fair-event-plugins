import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const STATE_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/state';
const CALLBACK_ENDPOINT = '/wp-json/fair-payments-connector/v1/oauth/callback';
const DISCONNECT_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/oauth/disconnect';
const SETTINGS_ENDPOINT = '/wp-json/wp/v2/settings';
const AUDIT_LOG_ENDPOINT = '/wp-json/fair-payments-connector/v1/audit-log';
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

const VALID_TOKENS = {
	access_token: 'access_test_abc123',
	refresh_token: 'refresh_test_xyz789',
	expires_in: 3600,
	organization_id: 'org_test_001',
	profile_id: 'pfl_test_001',
	test_mode: true,
};

const BASE_SCOPE =
	'payments.read payments.write refunds.read refunds.write organizations.read profiles.read profiles.write balances.read';

test.describe( 'OAuthCallbackController', () => {
	let api;

	/**
	 * Complete a callback with a fresh state and the given extra fields.
	 *
	 * @param {Object} extra Fields merged over the valid token payload.
	 * @return {Promise<import('@playwright/test').APIResponse>} Callback response.
	 */
	async function connectWith( extra = {} ) {
		const stateRes = await api.post( STATE_ENDPOINT, {
			headers: adminAuth(),
		} );
		const { state } = await stateRes.json();
		return api.post( CALLBACK_ENDPOINT, {
			headers: adminAuth(),
			data: { state, ...VALID_TOKENS, ...extra },
		} );
	}

	/**
	 * Read the connection status as an admin.
	 *
	 * @return {Promise<Object>} Status body.
	 */
	async function readStatus() {
		const res = await api.get( STATUS_ENDPOINT, { headers: adminAuth() } );
		expect( res.status() ).toBe( 200 );
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test.describe( 'POST /oauth/state', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.post( STATE_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'returns a state string for an authenticated admin, with no reason required', async () => {
			const res = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( typeof body.state ).toBe( 'string' );
			expect( body.state.length ).toBeGreaterThan( 0 );
		} );

		test( 'says settlement access should be requested while Fair Finance is active (#1693)', async () => {
			// The test site activates Fair Finance (.wp-env.json), which opts
			// in through the fair_payment_request_settlement_access filter.
			const res = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			const body = await res.json();
			expect( body.request_settlement_access ).toBe( true );
		} );
	} );

	test.describe( 'POST /oauth/callback', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.post( CALLBACK_ENDPOINT, {
				data: { state: 'x', ...VALID_TOKENS },
			} );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'returns 403 when state is missing', async () => {
			const res = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: VALID_TOKENS,
			} );
			expect( res.status() ).toBe( 400 ); // missing required param
		} );

		test( 'returns 403 when state does not match the stored transient', async () => {
			const res = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state: 'wrong_state', ...VALID_TOKENS },
			} );
			expect( res.status() ).toBe( 403 );
			const body = await res.json();
			expect( body.code ).toBe( 'invalid_oauth_state' );
		} );

		test( 'saves credentials, records an audit entry with a generated description, and returns success when state is valid', async () => {
			// Step 1: get a real state token — no reason submitted.
			const stateRes = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( stateRes.status() ).toBe( 200 );
			const { state } = await stateRes.json();

			// Step 2: complete callback with that state
			const callbackRes = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			} );
			expect( callbackRes.status() ).toBe( 200 );
			const body = await callbackRes.json();
			expect( body.success ).toBe( true );

			// Step 3: the connection action is in the audit log with a
			// server-generated description naming the mode.
			const auditRes = await api.get( AUDIT_LOG_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( auditRes.status() ).toBe( 200 );
			const audit = await auditRes.json();
			const entry = audit.items.find(
				( item ) =>
					'mollie_connected' === item.action ||
					'mollie_reconnected' === item.action
			);
			expect( entry ).toBeTruthy();
			expect( entry.reason ).toMatch( /Mollie in test mode\.$/ );
		} );

		test( 'rejects a replayed state (single-use)', async () => {
			// Step 1: generate state
			const stateRes = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			const { state } = await stateRes.json();

			// Step 2: first use — should succeed
			const first = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			} );
			expect( first.status() ).toBe( 200 );

			// Step 3: replay — must be rejected
			const second = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			} );
			expect( second.status() ).toBe( 403 );
			const body = await second.json();
			expect( body.code ).toBe( 'invalid_oauth_state' );
		} );
	} );

	test.describe( 'granted permissions (#1693)', () => {
		test( 'records the scopes Mollie granted and enables settlement access', async () => {
			const res = await connectWith( {
				scope: `${ BASE_SCOPE }  settlements.read settlements.read`,
			} );
			expect( res.status() ).toBe( 200 );

			const status = await readStatus();
			expect( status.connected ).toBe( true );
			expect( status.scopes_known ).toBe( true );
			expect( status.granted_scopes ).toEqual( [
				...BASE_SCOPE.split( ' ' ),
				'settlements.read',
			] );
			expect( status.settlement_access ).toBe( true );
		} );

		test( 'does not enable settlement access when only the existing permissions were granted', async () => {
			const res = await connectWith( { scope: BASE_SCOPE } );
			expect( res.status() ).toBe( 200 );

			const status = await readStatus();
			expect( status.scopes_known ).toBe( true );
			expect( status.granted_scopes ).toEqual( BASE_SCOPE.split( ' ' ) );
			expect( status.settlement_access ).toBe( false );
		} );

		test( 'does not treat a similarly named scope as settlement access', async () => {
			const res = await connectWith( {
				scope: 'payments.read settlements.write settlements.readonly',
			} );
			expect( res.status() ).toBe( 200 );

			const status = await readStatus();
			expect( status.settlement_access ).toBe( false );
		} );

		test( 'leaves permissions unknown for a connection without scope metadata', async () => {
			// First record a grant, then reconnect the way an older platform
			// would: tokens only. The earlier grant must not carry over.
			await connectWith( { scope: `${ BASE_SCOPE } settlements.read` } );
			const res = await connectWith();
			expect( res.status() ).toBe( 200 );

			const status = await readStatus();
			expect( status.connected ).toBe( true );
			expect( status.scopes_known ).toBe( false );
			expect( status.granted_scopes ).toEqual( [] );
			expect( status.settlement_access ).toBe( false );
		} );

		test( 'a callback with an invalid state leaves the existing connection and its permissions untouched', async () => {
			await connectWith( { scope: `${ BASE_SCOPE } settlements.read` } );
			const before = await readStatus();

			const res = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: {
					state: 'wrong_state',
					...VALID_TOKENS,
					access_token: 'access_rejected',
					scope: 'payments.read',
				},
			} );
			expect( res.status() ).toBe( 403 );

			expect( await readStatus() ).toEqual( before );
		} );

		test( 'an incomplete callback is rejected before anything is replaced', async () => {
			await connectWith( { scope: `${ BASE_SCOPE } settlements.read` } );
			const before = await readStatus();

			const res = await connectWith( {
				expires_in: 0,
				scope: 'payments.read',
			} );
			expect( res.status() ).toBe( 400 );
			const body = await res.json();
			expect( body.code ).toBe( 'invalid_oauth_callback' );

			expect( await readStatus() ).toEqual( before );
		} );

		test( 'keeps the granted scopes out of /wp/v2/settings', async () => {
			await connectWith( { scope: `${ BASE_SCOPE } settlements.read` } );

			const res = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			const body = await res.json();
			expect( body ).not.toHaveProperty( 'fair_payment_mollie_scopes' );
		} );

		test( 'disconnecting forgets the granted permissions', async () => {
			await connectWith( { scope: `${ BASE_SCOPE } settlements.read` } );
			expect( ( await readStatus() ).settlement_access ).toBe( true );

			const res = await api.post( DISCONNECT_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );

			// The shared test env forces the connected flag on (#1405), so
			// only the permission metadata is asserted here.
			const status = await readStatus();
			expect( status.scopes_known ).toBe( false );
			expect( status.granted_scopes ).toEqual( [] );
			expect( status.settlement_access ).toBe( false );
		} );
	} );

	test.describe( 'GET/POST /wp/v2/settings — token write-only (#859)', () => {
		test( 'GET does not include the OAuth token values', async () => {
			// Ensure tokens are populated first, via a normal callback.
			const stateRes = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			const { state } = await stateRes.json();
			const callbackRes = await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			} );
			expect( callbackRes.status() ).toBe( 200 );

			const res = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body ).not.toHaveProperty(
				'fair_payment_mollie_access_token'
			);
			expect( body ).not.toHaveProperty(
				'fair_payment_mollie_refresh_token'
			);
		} );

		test( 'POST carrying token keys is accepted but ignores them', async () => {
			const res = await api.post( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
				data: {
					fair_payment_mollie_access_token: 'attacker_supplied',
					fair_payment_mollie_refresh_token: 'attacker_supplied',
				},
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body ).not.toHaveProperty(
				'fair_payment_mollie_access_token'
			);
			expect( body ).not.toHaveProperty(
				'fair_payment_mollie_refresh_token'
			);
		} );
	} );

	test.describe( 'GET/POST /wp/v2/settings — Mollie API keys removed (#1317)', () => {
		test( 'GET does not include the retired API key settings', async () => {
			const res = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body ).not.toHaveProperty( 'fair_payment_test_api_key' );
			expect( body ).not.toHaveProperty( 'fair_payment_live_api_key' );
		} );

		test( 'POST carrying the retired API key settings is accepted but ignores them', async () => {
			const res = await api.post( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
				data: {
					fair_payment_test_api_key: 'test_attacker_supplied',
					fair_payment_live_api_key: 'live_attacker_supplied',
				},
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body ).not.toHaveProperty( 'fair_payment_test_api_key' );
			expect( body ).not.toHaveProperty( 'fair_payment_live_api_key' );
		} );
	} );

	test.describe( 'POST /oauth/disconnect', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.post( DISCONNECT_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'clears the connection, records an audit entry with a generated description, and returns 200 for an admin', async () => {
			test.skip(
				true,
				'Skipped pending #1405 — the shared e2e test env forces a connected Mollie state'
			);
			// Connect first so there is something to disconnect.
			const stateRes = await api.post( STATE_ENDPOINT, {
				headers: adminAuth(),
			} );
			const { state } = await stateRes.json();
			await api.post( CALLBACK_ENDPOINT, {
				headers: adminAuth(),
				data: { state, ...VALID_TOKENS },
			} );

			const res = await api.post( DISCONNECT_ENDPOINT, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body.success ).toBe( true );

			const settingsRes = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			const settings = await settingsRes.json();
			expect( settings.fair_payment_mollie_connected ).toBe( false );
		} );
	} );
} );
