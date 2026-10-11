/**
 * Playwright API tests for routes this plugin no longer registers.
 *
 * `GET /fair-events/v1/weekly-events` served only Fair Audience
 * Experimental's Weekly Schedule page and was removed with it (#1809). The
 * weekly data itself stays available to PHP through
 * `FairEvents\Services\WeeklyEventsProvider`.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'Retired routes', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'weekly-events is not registered', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/weekly-events?source=any&week=2026-W41',
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 404 );

		const body = await res.json();
		expect( body.code ).toBe( 'rest_no_route' );
	} );
} );
