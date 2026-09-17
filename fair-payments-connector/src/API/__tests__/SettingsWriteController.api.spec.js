/**
 * SettingsWriteController — the connector's only write path for its
 * manually-written settings, and the corresponding lockdown of those same
 * keys on the generic /wp/v2/settings endpoint. Administrators no longer
 * supply an audit reason (#1575) — the server generates one.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const SETTINGS_WRITE_ENDPOINT = '/wp-json/fair-payments-connector/v1/settings';
const SETTINGS_ENDPOINT = '/wp-json/wp/v2/settings';
const AUDIT_LOG_ENDPOINT = '/wp-json/fair-payments-connector/v1/audit-log';

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

test.describe( 'SettingsWriteController', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test.describe( 'POST /settings', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.post( SETTINGS_WRITE_ENDPOINT, {
				data: {
					settings: { fair_payment_currency: 'USD' },
				},
			} );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'returns 400 for a setting outside the allowlist', async () => {
			const res = await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: {
						fair_payment_mollie_access_token: 'attacker_supplied',
					},
				},
			} );
			expect( res.status() ).toBe( 400 );
			const body = await res.json();
			expect( body.code ).toBe( 'invalid_setting' );
		} );

		test( 'saves an allowlisted setting with no reason and records an audit entry with old/new values and a generated description', async () => {
			// Establish a known starting value.
			await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
				},
			} );

			const res = await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'USD' },
				},
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body.success ).toBe( true );
			expect( body.settings.fair_payment_currency ).toBe( 'USD' );

			const settingsRes = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			const settings = await settingsRes.json();
			expect( settings.fair_payment_currency ).toBe( 'USD' );

			const auditRes = await api.get(
				`${ AUDIT_LOG_ENDPOINT }?per_page=5`,
				{
					headers: adminAuth(),
				}
			);
			expect( auditRes.status() ).toBe( 200 );
			const audit = await auditRes.json();
			const entry = audit.items.find(
				( item ) => 'fair_payment_currency' === item.setting_key
			);
			expect( entry ).toBeTruthy();
			expect( entry.is_protected ).toBe( false );
			expect( entry.old_value ).toBe( 'EUR' );
			expect( entry.new_value ).toBe( 'USD' );
			expect( entry.reason ).toBe( 'Default currency changed to USD.' );

			// Restore EUR so this spec doesn't leak state into other suites.
			await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
				},
			} );
		} );

		test( 'creates no audit entry for a no-op save (value unchanged)', async () => {
			await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
				},
			} );

			const before = await (
				await api.get( `${ AUDIT_LOG_ENDPOINT }?per_page=1`, {
					headers: adminAuth(),
				} )
			).json();

			const res = await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
				},
			} );
			expect( res.status() ).toBe( 200 );

			const after = await (
				await api.get( `${ AUDIT_LOG_ENDPOINT }?per_page=1`, {
					headers: adminAuth(),
				} )
			).json();

			expect( after.total ).toBe( before.total );
		} );
	} );

	test.describe( 'GET/POST /wp/v2/settings — manually-written settings are locked (#1575)', () => {
		test( 'POST carrying fair_payment_currency is accepted but ignores it', async () => {
			await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
				},
			} );

			const res = await api.post( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
				data: { fair_payment_currency: 'GBP' },
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			expect( body.fair_payment_currency ).toBe( 'EUR' );

			const settingsRes = await api.get( SETTINGS_ENDPOINT, {
				headers: adminAuth(),
			} );
			const settings = await settingsRes.json();
			expect( settings.fair_payment_currency ).toBe( 'EUR' );
		} );
	} );
} );
