/**
 * Playwright API tests for CategoriesController.
 *
 * Verifies POST /fair-events/v1/sources/categories creates a category term,
 * is idempotent for an existing name, and enforces the permission check; and
 * that GET /fair-events/v1/sources/categories supports an all_languages mode
 * for the multilingual category picker (#1627) using the test-only Polylang
 * term-language fixture at fair-e2e/v1/term-languages.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeader = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'CategoriesController', () => {
	let api;
	const createdCategoryIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of createdCategoryIds ) {
			await api.delete( `/wp-json/wp/v2/categories/${ id }?force=true`, {
				headers: authHeader,
			} );
		}
		await api.dispose();
	} );

	test( 'creates a new category and returns its id, name, and slug', async () => {
		const name = `API Test Category ${ Date.now() }`;
		const res = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);

		expect( res.status() ).toBe( 201 );
		const body = await res.json();
		createdCategoryIds.push( body.id );

		expect( body ).toHaveProperty( 'id' );
		expect( body.name ).toBe( name );
		expect( body ).toHaveProperty( 'slug' );
	} );

	test( 'is idempotent when the category name already exists', async () => {
		const name = `API Test Category Dup ${ Date.now() }`;

		const first = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);
		expect( first.status() ).toBe( 201 );
		const firstBody = await first.json();
		createdCategoryIds.push( firstBody.id );

		const second = await api.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				headers: authHeader,
				data: { name },
			}
		);
		expect( second.status() ).toBe( 200 );
		const secondBody = await second.json();

		expect( secondBody.id ).toBe( firstBody.id );
	} );

	test( 'rejects requests without permission', async () => {
		const anonymousApi = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymousApi.post(
			'/wp-json/fair-events/v1/sources/categories',
			{
				data: { name: `API Test Category Unauth ${ Date.now() }` },
			}
		);

		expect( res.status() ).toBe( 401 );
		await anonymousApi.dispose();
	} );

	test.describe( 'GET /sources/categories', () => {
		let getApi;
		const getCreatedCategoryIds = [];

		test.beforeAll( async () => {
			getApi = await request.newContext( { baseURL: BASE_URL } );
		} );

		test.afterAll( async () => {
			await getApi.post( '/wp-json/fair-e2e/v1/term-languages', {
				headers: authHeader,
				data: { languages: {} },
			} );
			for ( const id of getCreatedCategoryIds ) {
				await getApi.delete(
					`/wp-json/wp/v2/categories/${ id }?force=true`,
					{ headers: authHeader }
				);
			}
			await getApi.dispose();
		} );

		test( 'lists categories without language metadata when all_languages is omitted', async () => {
			const create = await getApi.post(
				'/wp-json/fair-events/v1/sources/categories',
				{
					headers: authHeader,
					data: { name: `API Test Category Default ${ Date.now() }` },
				}
			);
			const created = await create.json();
			getCreatedCategoryIds.push( created.id );

			const res = await getApi.get(
				'/wp-json/fair-events/v1/sources/categories',
				{ headers: authHeader }
			);

			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			const item = body.find( ( c ) => c.id === created.id );

			expect( item ).toMatchObject( {
				id: created.id,
				name: created.name,
				slug: created.slug,
			} );
			expect( item ).not.toHaveProperty( 'language' );
		} );

		test( 'rejects unauthenticated requests', async () => {
			const anonymousApi = await request.newContext( {
				baseURL: BASE_URL,
			} );
			const res = await anonymousApi.get(
				'/wp-json/fair-events/v1/sources/categories'
			);

			expect( res.status() ).toBe( 401 );
			await anonymousApi.dispose();
		} );

		test( 'includes each language name when all_languages=true and the Polylang fixture is enabled', async () => {
			const create = await getApi.post(
				'/wp-json/fair-events/v1/sources/categories',
				{
					headers: authHeader,
					data: { name: `Bart ${ Date.now() }` },
				}
			);
			const created = await create.json();
			getCreatedCategoryIds.push( created.id );

			await getApi.post( '/wp-json/fair-e2e/v1/term-languages', {
				headers: authHeader,
				data: {
					languages: {
						[ created.id ]: { slug: 'en', name: 'English' },
					},
				},
			} );

			const res = await getApi.get(
				'/wp-json/fair-events/v1/sources/categories?all_languages=true',
				{ headers: authHeader }
			);

			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			const item = body.find( ( c ) => c.id === created.id );

			expect( item.language ).toBe( 'English' );
		} );

		test( 'omits language metadata for a category the Polylang fixture has no language for', async () => {
			const create = await getApi.post(
				'/wp-json/fair-events/v1/sources/categories',
				{
					headers: authHeader,
					data: {
						name: `API Test Category Unmapped ${ Date.now() }`,
					},
				}
			);
			const created = await create.json();
			getCreatedCategoryIds.push( created.id );

			const res = await getApi.get(
				'/wp-json/fair-events/v1/sources/categories?all_languages=true',
				{ headers: authHeader }
			);

			expect( res.status() ).toBe( 200 );
			const body = await res.json();
			const item = body.find( ( c ) => c.id === created.id );

			expect( item ).not.toHaveProperty( 'language' );
		} );
	} );
} );
