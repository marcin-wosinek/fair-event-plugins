/**
 * Verifies the intentionally public, browser-local audience session reset.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';

test( 'an anonymous visitor can clear only their audience session cookie', async () => {
	const api = await request.newContext( { baseURL: BASE_URL } );
	const response = await api.delete( '/wp-json/fair-audience/v1/session', {
		headers: {
			Cookie: 'fair_audience_session=123.fake.signature',
		},
	} );

	expect( response.ok() ).toBeTruthy();
	expect( await response.json() ).toEqual( { success: true } );
	const setCookie = response.headers()[ 'set-cookie' ] || '';
	expect( setCookie ).toContain( 'fair_audience_session=' );
	expect( setCookie ).toMatch( /expires=/i );

	await api.dispose();
} );
