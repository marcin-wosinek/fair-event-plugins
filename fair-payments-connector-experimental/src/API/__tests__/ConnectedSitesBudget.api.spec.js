/**
 * Playwright API tests for Connected Site budget associations (#1612):
 * POST/PUT /fair-payments-connector/v1/admin/connected-sites can link a
 * Connected Site to a Fair Finance budget, clear it, and never keeps
 * pointing at a deleted budget. Also covers the persistent id counter that
 * stops a deleted site's id from being reused.
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

test.describe( 'ConnectedSitesController — budget association (#1612)', () => {
	let api;
	const siteIds = [];
	const budgetIds = [];

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
		for ( const budgetId of budgetIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	const createBudget = async () => {
		const res = await api.post( '/wp-json/fair-finance/v1/budgets', {
			headers: adminHeaders,
			data: {
				name: `Connected site test ${ Date.now() }-${ Math.random() }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const budgetId = ( await res.json() ).id;
		budgetIds.push( budgetId );
		return budgetId;
	};

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

	test( 'creating a site with a valid budget_id returns it in the record', async () => {
		const budgetId = await createBudget();
		const site = await createSite( { budget_id: budgetId } );
		expect( site.budget_id ).toBe( budgetId );
	} );

	test( 'creating a site with a nonexistent budget_id is rejected', async () => {
		const res = await api.post(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{
				headers: adminHeaders,
				data: {
					label: 'Invalid budget site',
					base_url: 'https://example.test',
					token: 'test-token',
					budget_id: 999999999,
				},
			}
		);
		expect( res.status() ).toBe( 400 );
	} );

	test( 'a site can be created without a budget, then linked, then cleared', async () => {
		const site = await createSite();
		expect( site.budget_id ).toBeNull();

		const budgetId = await createBudget();
		const linkRes = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{
				headers: adminHeaders,
				data: {
					label: site.label,
					base_url: site.base_url,
					budget_id: budgetId,
				},
			}
		);
		expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();
		expect( ( await linkRes.json() ).budget_id ).toBe( budgetId );

		const clearRes = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{
				headers: adminHeaders,
				data: {
					label: site.label,
					base_url: site.base_url,
					budget_id: null,
				},
			}
		);
		expect( clearRes.ok(), await clearRes.text() ).toBeTruthy();
		expect( ( await clearRes.json() ).budget_id ).toBeNull();
	} );

	test( 'updating a site with a nonexistent budget_id is rejected and leaves the association untouched', async () => {
		const budgetId = await createBudget();
		const site = await createSite( { budget_id: budgetId } );

		const res = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{
				headers: adminHeaders,
				data: {
					label: site.label,
					base_url: site.base_url,
					budget_id: 999999999,
				},
			}
		);
		expect( res.status() ).toBe( 400 );

		const getRes = await api.get(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{ headers: adminHeaders }
		);
		const stillLinked = ( await getRes.json() ).find(
			( s ) => s.id === site.id
		);
		expect( stillLinked.budget_id ).toBe( budgetId );
	} );

	test( 'omitting budget_id on update leaves an existing association untouched', async () => {
		const budgetId = await createBudget();
		const site = await createSite( { budget_id: budgetId } );

		const res = await api.put(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ site.id }`,
			{
				headers: adminHeaders,
				data: { label: 'Renamed, budget untouched' },
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		expect( ( await res.json() ).budget_id ).toBe( budgetId );
	} );

	test( 'deleting the linked budget clears the association', async () => {
		const budgetId = await createBudget();
		const site = await createSite( { budget_id: budgetId } );

		const deleteRes = await api.delete(
			`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.ok(), await deleteRes.text() ).toBeTruthy();
		budgetIds.splice( budgetIds.indexOf( budgetId ), 1 );

		const getRes = await api.get(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{ headers: adminHeaders }
		);
		const afterDelete = ( await getRes.json() ).find(
			( s ) => s.id === site.id
		);
		expect( afterDelete.budget_id ).toBeNull();
	} );

	test( 'a deleted site’s id is never reused by a later site', async () => {
		const first = await createSite();
		const deleteRes = await api.delete(
			`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ first.id }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.ok(), await deleteRes.text() ).toBeTruthy();
		siteIds.splice( siteIds.indexOf( first.id ), 1 );

		const second = await createSite();
		expect( second.id ).toBeGreaterThan( first.id );
	} );
} );
