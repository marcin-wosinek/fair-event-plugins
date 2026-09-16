/**
 * AuditLogController — read-only, paginated access to the settings/connection
 * audit log (#1575).
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const AUDIT_LOG_ENDPOINT = '/wp-json/fair-payments-connector/v1/audit-log';
const SETTINGS_WRITE_ENDPOINT = '/wp-json/fair-payments-connector/v1/settings';

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

test.describe( 'AuditLogController', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test.describe( 'GET /audit-log', () => {
		test( 'returns 401 for unauthenticated requests', async () => {
			const res = await api.get( AUDIT_LOG_ENDPOINT );
			expect( res.status() ).toBe( 401 );
		} );

		test( 'returns a paginated shape with items newest first', async () => {
			// Ensure there's at least one entry to page through.
			await api.post( SETTINGS_WRITE_ENDPOINT, {
				headers: adminAuth(),
				data: {
					settings: { fair_payment_currency: 'EUR' },
					reason: 'Seed an audit entry for the pagination check.',
				},
			} );

			const res = await api.get( `${ AUDIT_LOG_ENDPOINT }?per_page=1`, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();

			expect( Array.isArray( body.items ) ).toBe( true );
			expect( body.items.length ).toBe( 1 );
			expect( typeof body.total ).toBe( 'number' );
			expect( typeof body.pages ).toBe( 'number' );
			expect( body.page ).toBe( 1 );

			const entry = body.items[ 0 ];
			expect( entry ).toHaveProperty( 'id' );
			expect( entry ).toHaveProperty( 'created_at' );
			expect( entry ).toHaveProperty( 'action' );
			expect( entry ).toHaveProperty( 'actor_display_name' );
			expect( entry ).toHaveProperty( 'reason' );

			if ( body.total > 1 ) {
				const page2 = await (
					await api.get(
						`${ AUDIT_LOG_ENDPOINT }?per_page=1&page=2`,
						{
							headers: adminAuth(),
						}
					)
				).json();
				expect( page2.items[ 0 ].id ).not.toBe( entry.id );
			}
		} );

		test( 'never exposes a value for a redacted (protected) entry', async () => {
			const res = await api.get( `${ AUDIT_LOG_ENDPOINT }?per_page=50`, {
				headers: adminAuth(),
			} );
			expect( res.status() ).toBe( 200 );
			const body = await res.json();

			for ( const entry of body.items ) {
				if ( entry.is_protected ) {
					expect( entry.old_value ).toBeNull();
					expect( entry.new_value ).toBeNull();
				}
			}
		} );
	} );
} );
