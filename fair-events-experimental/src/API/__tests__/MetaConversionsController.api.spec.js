/**
 * Playwright API tests for MetaConversionsController (#1639): authorization,
 * event_name validation on POST /meta-conversions/test, and the safe
 * fail-closed path when the Test Events code isn't configured yet.
 *
 * These tests never reach the point of calling out to graph.facebook.com —
 * every case here is rejected by permission checks, schema validation, or
 * the missing-configuration guard in Conversions::send_test() before any
 * network request is attempted, so no Meta credentials are needed to run
 * this suite.
 *
 * The `meta-conversions` feature bundle is off by default (Features.php), so
 * MetaConversionsController::register_routes() never runs and every route
 * below 404s until the suite flips it on via the `fair_events_experimental_features`
 * setting — restored to whatever this instance had once the suite finishes.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/meta-conversions';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'MetaConversionsController', () => {
	let api;
	let originalConfig;
	let originalFeatureEnabled;
	let subscriberId;
	let subscriberHeaders;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// The route only registers once the meta-conversions feature bundle is
		// on (off by default) — enable it for this suite and restore whatever
		// this instance had afterward.
		const settingsRes = await api.get( SETTINGS_PATH, {
			headers: adminHeaders,
		} );
		const settings = await settingsRes.json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: { 'meta-conversions': true },
			},
		} );

		const configRes = await api.get( PATH, { headers: adminHeaders } );
		originalConfig = await configRes.json();

		const userLogin = `meta-conversions-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1460!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1460!` ).toString(
					'base64'
				),
		};
	} );

	test.afterAll( async () => {
		// Restore the dataset ID and Test Events code the suite found on
		// entry; the access token is write-only and untouched by any test
		// here, so there's nothing to restore for it.
		await api.post( PATH, {
			headers: adminHeaders,
			data: {
				dataset_id: originalConfig.dataset_id,
				test_event_code: originalConfig.test_event_code,
			},
		} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: {
					'meta-conversions': originalFeatureEnabled,
				},
			},
		} );
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'rejects an unauthenticated read', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const res = await anon.get( PATH );
		expect( res.status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'rejects a non-admin read', async () => {
		const res = await api.get( PATH, { headers: subscriberHeaders } );
		expect( res.status() ).toBe( 403 );
	} );

	test( 'an admin reads the configuration and diagnostics shape', async () => {
		const res = await api.get( PATH, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body ).toHaveProperty( 'dataset_id' );
		expect( body ).toHaveProperty( 'token_configured' );
		expect( body ).toHaveProperty( 'test_event_code' );
		expect( body ).toHaveProperty( 'diagnostics' );
		expect( body ).toHaveProperty( 'test_history' );
		expect( body ).toHaveProperty( 'consent_api_available' );
	} );

	test( 'rejects an unauthenticated test-event send', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const res = await anon.post( `${ PATH }/test`, {
			data: { event_name: 'PageView' },
		} );
		expect( res.status() ).toBe( 401 );
		await anon.dispose();
	} );

	test( 'rejects a non-admin test-event send', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: subscriberHeaders,
			data: { event_name: 'PageView' },
		} );
		expect( res.status() ).toBe( 403 );
	} );

	test( 'rejects an event_name outside the three supported events', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: { event_name: 'NotARealEvent' },
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects a missing event_name', async () => {
		const res = await api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: {},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	for ( const eventName of [ 'PageView', 'InitiateCheckout', 'Purchase' ] ) {
		test( `fails closed for ${ eventName } without a configured Test Events code and names the event in the response`, async () => {
			// Clear the Test Events code so this case is deterministic
			// regardless of what the suite found configured on entry.
			await api.post( PATH, {
				headers: adminHeaders,
				data: { dataset_id: '', test_event_code: '' },
			} );

			const res = await api.post( `${ PATH }/test`, {
				headers: adminHeaders,
				data: { event_name: eventName },
			} );

			expect( res.status() ).toBe( 400 );
			const body = await res.json();
			expect( body.data.code ).toBe( 'missing_test_code' );
			expect( body.data.category ).toBe( 'configuration' );
			expect( body.message ).toContain( eventName );
		} );
	}
} );
