/**
 * Playwright API tests for Connected Site availability (#1619):
 * connected sites can be disabled and re-enabled without losing their
 * configuration, default to enabled (including pre-existing records with no
 * stored `enabled` key), and a disabled site's import route is rejected
 * server-side before any remote call is attempted.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'ConnectedSitesController — availability (#1619)', () => {
	let api;
	const siteIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const siteId of siteIds ) {
			await api.delete(
				`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ siteId }`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	const createSite = async ( data = {} ) => {
		const res = await api.post(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{
				headers: adminHeaders,
				data: {
					label: `Test site ${ Date.now() }-${ Math.random() }`,
					base_url: 'https://example.test',
					token: 'test-token',
					...data,
				},
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const body = await res.json();
		siteIds.push( body.id );
		return body;
	};

	test( 'a newly created site is enabled by default', async () => {
		const site = await createSite();
		expect( site.enabled ).toBe( true );
	} );

	test( 'a site can be disabled and re-enabled, keeping its other fields', async () => {
		const site = await createSite();

		const disableRes = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: false } }
		);
		expect( disableRes.ok(), await disableRes.text() ).toBeTruthy();
		const disabled = await disableRes.json();
		expect( disabled.enabled ).toBe( false );
		expect( disabled.label ).toBe( site.label );
		expect( disabled.base_url ).toBe( site.base_url );

		const enableRes = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: true } }
		);
		expect( enableRes.ok(), await enableRes.text() ).toBeTruthy();
		expect( ( await enableRes.json() ).enabled ).toBe( true );
	} );

	test( 'omitting enabled on an unrelated update leaves it untouched', async () => {
		const site = await createSite();
		await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: false } }
		);

		const renameRes = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{
				headers: adminHeaders,
				data: { label: 'Renamed, availability untouched' },
			}
		);
		expect( renameRes.ok(), await renameRes.text() ).toBeTruthy();
		expect( ( await renameRes.json() ).enabled ).toBe( false );
	} );

	test( 'an invalid boolean value for enabled is rejected', async () => {
		const site = await createSite();
		const res = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: 'not-a-boolean' } }
		);
		expect( res.status() ).toBe( 400 );
	} );

	test( 'importing from a disabled site is rejected without contacting the remote site', async () => {
		const site = await createSite( {
			// An unreachable host: if the controller attempted a remote call
			// before checking availability, this would time out or 502
			// instead of failing fast with 403.
			base_url: 'https://connected-site-enabled-test.invalid',
		} );
		await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: false } }
		);

		const importRes = await api.post(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }/import-transactions`,
			{ headers: adminHeaders }
		);
		expect( importRes.status() ).toBe( 403 );
	} );

	test( 're-enabling a site restores its normal import path', async () => {
		const site = await createSite( {
			base_url: 'https://connected-site-enabled-test.invalid',
		} );
		await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: false } }
		);
		const disabledImportRes = await api.post(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }/import-transactions`,
			{ headers: adminHeaders }
		);
		expect( disabledImportRes.status() ).toBe( 403 );

		await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{ headers: adminHeaders, data: { enabled: true } }
		);
		const enabledImportRes = await api.post(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }/import-transactions`,
			{ headers: adminHeaders }
		);
		// The remote host is unreachable, so this fails at the network call —
		// but with 502 (unreachable), not 403 (disabled): proof the
		// availability check no longer blocks the request.
		expect( enabledImportRes.status() ).toBe( 502 );
	} );
} );
