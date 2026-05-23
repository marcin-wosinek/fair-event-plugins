/**
 * E2E smoke test for the isolated WordPress harness.
 *
 * Proves the full pipeline works end to end against the `@wordpress/env`
 * `tests` instance (http://localhost:8889 by default):
 *   1. the public homepage responds 200,
 *   2. an admin can log into wp-admin,
 *   3. an activated plugin's admin menu is visible.
 *
 * Credentials match the wp-env defaults (admin / password) and the API-test
 * convention (WP_ADMIN_USER / WP_ADMIN_PASSWORD overrides).
 */

import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

test.describe( 'smoke', () => {
	test( 'homepage responds 200', async ( { page } ) => {
		const response = await page.goto( '/' );
		expect( response, 'homepage navigation should return a response' ).not.toBeNull();
		expect( response.status() ).toBe( 200 );
	} );

	test( 'admin can log in and sees the Fair Audience menu', async ( {
		page,
	} ) => {
		await page.goto( '/wp-login.php' );
		await page.fill( '#user_login', ADMIN_USER );
		await page.fill( '#user_pass', ADMIN_PASSWORD );
		await page.click( '#wp-submit' );

		// Landing on the dashboard confirms authentication succeeded.
		await expect( page ).toHaveURL( /\/wp-admin\/?/ );
		await expect( page.locator( '#adminmenu' ) ).toBeVisible();

		// The Fair Audience top-level menu is registered by the activated
		// plugin (fair-audience/src/Admin/AdminHooks.php).
		await expect(
			page.locator( '#adminmenu' ).getByRole( 'link', {
				name: 'Fair Audience',
				exact: true,
			} )
		).toBeVisible();
	} );
} );
