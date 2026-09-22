/**
 * Playwright API tests for VenueController.
 *
 * Verifies that the venues endpoint returns `maps_url` (computed) and does not
 * expose the removed `google_maps_link` field.
 *
 * Also verifies (#1621) that an event editor (who can `edit_posts` but not
 * `manage_options`) can list, create, update, and preview a map link for
 * venues, but cannot delete one; a subscriber (lacking `edit_posts`) is
 * rejected for all of those.
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

/**
 * Create a temporary user with the given role and return its id and Basic
 * auth header, so permission checks can be exercised as that user.
 *
 * @param {import('@playwright/test').APIRequestContext} api  Admin-authenticated API context.
 * @param {string}                                        role WordPress role slug.
 * @return {Promise<{id: number, headers: Object}>} Created user id and auth headers.
 */
async function createTestUser( api, role ) {
	const userLogin = `venue-${ role }-${ Date.now() }`;
	const password = 'Test-password-1460!';
	const response = await api.post( '/wp-json/wp/v2/users', {
		headers: authHeader,
		data: {
			username: userLogin,
			email: `${ userLogin }@example.com`,
			password,
			roles: [ role ],
		},
	} );
	expect( response.ok() ).toBeTruthy();
	const id = ( await response.json() ).id;

	return {
		id,
		headers: {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:${ password }` ).toString(
					'base64'
				),
		},
	};
}

test.describe( 'VenueController', () => {
	let api;
	let venueId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		if ( venueId ) {
			await api.delete( `/wp-json/fair-events/v1/venues/${ venueId }`, {
				headers: authHeader,
			} );
		}
		await api.dispose();
	} );

	test( 'creates a venue with coordinates and returns maps_url pointing to lat/lng', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue ${ Date.now() }`,
				address: 'Gran Via 1, Valencia',
				latitude: '39.4878023',
				longitude: '-0.3613204',
			},
		} );

		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		venueId = body.id;

		expect( body ).not.toHaveProperty( 'google_maps_link' );
		expect( body ).toHaveProperty( 'maps_url' );
		expect( body.maps_url ).toContain( '39.4878023' );
		expect( body.maps_url ).toContain( '-0.3613204' );
	} );

	test( 'creates a venue with address only and returns maps_url from address', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue Address ${ Date.now() }`,
				address: 'Calle Mayor 10, Madrid',
			},
		} );

		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		// Clean up immediately.
		await api.delete( `/wp-json/fair-events/v1/venues/${ body.id }`, {
			headers: authHeader,
		} );

		expect( body ).not.toHaveProperty( 'google_maps_link' );
		expect( body ).toHaveProperty( 'maps_url' );
		expect( body.maps_url ).not.toBeNull();
		expect( body.maps_url ).toContain( 'Calle' );
	} );

	test( 'creates a venue with no location and returns null maps_url', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue No Location ${ Date.now() }`,
			},
		} );

		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		// Clean up immediately.
		await api.delete( `/wp-json/fair-events/v1/venues/${ body.id }`, {
			headers: authHeader,
		} );

		expect( body ).not.toHaveProperty( 'google_maps_link' );
		expect( body.maps_url ).toBeNull();
	} );

	test( 'creates a venue with a decimal-comma pair and stores it normalized to dots', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue Comma ${ Date.now() }`,
				latitude: '39,48',
				longitude: '-0,36',
			},
		} );

		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		await api.delete( `/wp-json/fair-events/v1/venues/${ body.id }`, {
			headers: authHeader,
		} );

		expect( body.latitude ).toBe( '39.48' );
		expect( body.longitude ).toBe( '-0.36' );
	} );

	test.describe( 'rejected coordinates on POST', () => {
		const invalidCases = [
			{
				label: 'out-of-range latitude',
				data: { latitude: '200', longitude: '0' },
			},
			{
				label: 'out-of-range longitude',
				data: { latitude: '0', longitude: '200' },
			},
			{
				label: 'only latitude filled',
				data: { latitude: '39.4878023', longitude: '' },
			},
			{
				label: 'only longitude filled',
				data: { latitude: '', longitude: '-0.3613204' },
			},
			{
				label: 'non-numeric latitude',
				data: { latitude: 'not-a-number', longitude: '0' },
			},
			{
				label: 'coordinate exceeding stored length',
				data: { latitude: '0.1234567890123456789', longitude: '0' },
			},
		];

		for ( const { label, data } of invalidCases ) {
			test( `rejects ${ label }`, async () => {
				const res = await api.post( '/wp-json/fair-events/v1/venues', {
					headers: authHeader,
					data: {
						name: `API Test Venue Invalid ${ Date.now() }`,
						...data,
					},
				} );

				expect( res.status() ).toBe( 400 );
				const body = await res.json();
				expect( body.code ).toBe( 'rest_invalid_coordinates' );
			} );
		}
	} );

	test( 'rejects invalid coordinates on PUT', async () => {
		const createRes = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue Update ${ Date.now() }`,
			},
		} );
		const created = await createRes.json();

		const res = await api.put(
			`/wp-json/fair-events/v1/venues/${ created.id }`,
			{
				headers: authHeader,
				data: {
					name: created.name,
					latitude: '39.4878023',
					longitude: '',
				},
			}
		);

		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'rest_invalid_coordinates' );

		await api.delete( `/wp-json/fair-events/v1/venues/${ created.id }`, {
			headers: authHeader,
		} );
	} );

	test.describe( 'map URL preview', () => {
		test( 'previews normalized coordinates with precedence over address', async () => {
			const res = await api.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{
					headers: authHeader,
					data: {
						address: 'Fallback Address',
						latitude: '39,48',
						longitude: '-0,36',
					},
				}
			);

			expect( res.ok() ).toBeTruthy();
			expect( await res.json() ).toEqual( {
				maps_url:
					'https://www.google.com/maps/search/?api=1&query=39.48%2C-0.36',
			} );
		} );

		test( 'previews an encoded address and returns null for empty input', async () => {
			const addressRes = await api.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{
					headers: authHeader,
					data: { address: 'Gran Via 1, Valencia' },
				}
			);
			expect( await addressRes.json() ).toEqual( {
				maps_url:
					'https://www.google.com/maps/search/?api=1&query=Gran%20Via%201%2C%20Valencia',
			} );

			const emptyRes = await api.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{ headers: authHeader, data: {} }
			);
			expect( await emptyRes.json() ).toEqual( { maps_url: null } );
		} );

		test( 'rejects incomplete and invalid coordinates', async () => {
			for ( const data of [
				{ address: 'Fallback', latitude: '39', longitude: '' },
				{ address: 'Fallback', latitude: '91', longitude: '0' },
			] ) {
				const res = await api.post(
					'/wp-json/fair-events/v1/venues/maps-url',
					{ headers: authHeader, data }
				);
				expect( res.status() ).toBe( 400 );
				expect( ( await res.json() ).code ).toBe(
					'rest_invalid_coordinates'
				);
			}
		} );

		test( 'requires being logged in', async () => {
			const res = await api.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{ data: { address: 'Gran Via 1' } }
			);
			expect( res.status() ).toBe( 401 );
		} );

		test( 'matches saved venue serialization for identical inputs', async () => {
			const data = {
				address: 'Fallback Address',
				latitude: '0',
				longitude: '0',
			};
			const previewRes = await api.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{ headers: authHeader, data }
			);
			const createRes = await api.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: authHeader,
					data: { name: `Preview parity ${ Date.now() }`, ...data },
				}
			);
			const preview = await previewRes.json();
			const venue = await createRes.json();
			await api.delete( `/wp-json/fair-events/v1/venues/${ venue.id }`, {
				headers: authHeader,
			} );

			expect( preview.maps_url ).toBe( venue.maps_url );
		} );
	} );

	test.describe( 'role-based permissions (#1621)', () => {
		let roleApi;
		let editor;
		let subscriber;
		const roleCreatedVenueIds = [];

		test.beforeAll( async () => {
			roleApi = await request.newContext( { baseURL: BASE_URL } );
			// "contributor" has edit_posts without manage_options, which is
			// the event-editor boundary this ticket cares about.
			editor = await createTestUser( roleApi, 'contributor' );
			subscriber = await createTestUser( roleApi, 'subscriber' );
		} );

		test.afterAll( async () => {
			for ( const id of roleCreatedVenueIds ) {
				await roleApi.delete(
					`/wp-json/fair-events/v1/venues/${ id }`,
					{
						headers: authHeader,
					}
				);
			}
			for ( const user of [ editor, subscriber ] ) {
				await roleApi.delete(
					`/wp-json/wp/v2/users/${ user.id }?force=true&reassign=1`,
					{ headers: authHeader }
				);
			}
			await roleApi.dispose();
		} );

		test( 'lets an event editor list venues', async () => {
			const res = await roleApi.get( '/wp-json/fair-events/v1/venues', {
				headers: editor.headers,
			} );
			expect( res.status() ).toBe( 200 );
		} );

		test( 'lets an event editor create a venue', async () => {
			const res = await roleApi.post( '/wp-json/fair-events/v1/venues', {
				headers: editor.headers,
				data: { name: `Editor Venue ${ Date.now() }` },
			} );
			expect( res.status() ).toBe( 201 );
			const body = await res.json();
			roleCreatedVenueIds.push( body.id );
		} );

		test( 'lets an event editor update a venue', async () => {
			const createRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: authHeader,
					data: { name: `Editor Update Target ${ Date.now() }` },
				}
			);
			const created = await createRes.json();
			roleCreatedVenueIds.push( created.id );

			const res = await roleApi.put(
				`/wp-json/fair-events/v1/venues/${ created.id }`,
				{
					headers: editor.headers,
					data: { name: `Editor Updated Name ${ Date.now() }` },
				}
			);
			expect( res.status() ).toBe( 200 );
		} );

		test( 'lets an event editor preview a map link', async () => {
			const res = await roleApi.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{
					headers: editor.headers,
					data: { address: 'Gran Via 1, Valencia' },
				}
			);
			expect( res.status() ).toBe( 200 );
		} );

		test( 'rejects an event editor deleting a venue', async () => {
			const createRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: authHeader,
					data: { name: `Editor Delete Target ${ Date.now() }` },
				}
			);
			const created = await createRes.json();
			roleCreatedVenueIds.push( created.id );

			const res = await roleApi.delete(
				`/wp-json/fair-events/v1/venues/${ created.id }`,
				{ headers: editor.headers }
			);
			expect( res.status() ).toBe( 403 );
		} );

		test( 'rejects a subscriber listing, creating, updating, previewing, and deleting venues', async () => {
			const listRes = await roleApi.get(
				'/wp-json/fair-events/v1/venues',
				{ headers: subscriber.headers }
			);
			expect( listRes.status() ).toBe( 403 );

			const createRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: subscriber.headers,
					data: { name: `Subscriber Attempt ${ Date.now() }` },
				}
			);
			expect( createRes.status() ).toBe( 403 );

			const previewRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues/maps-url',
				{
					headers: subscriber.headers,
					data: { address: 'Gran Via 1, Valencia' },
				}
			);
			expect( previewRes.status() ).toBe( 403 );

			const existingRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: authHeader,
					data: { name: `Subscriber Target ${ Date.now() }` },
				}
			);
			const existing = await existingRes.json();
			roleCreatedVenueIds.push( existing.id );

			const updateRes = await roleApi.put(
				`/wp-json/fair-events/v1/venues/${ existing.id }`,
				{
					headers: subscriber.headers,
					data: { name: `Subscriber Update Attempt ${ Date.now() }` },
				}
			);
			expect( updateRes.status() ).toBe( 403 );

			const deleteRes = await roleApi.delete(
				`/wp-json/fair-events/v1/venues/${ existing.id }`,
				{ headers: subscriber.headers }
			);
			expect( deleteRes.status() ).toBe( 403 );
		} );

		test( 'still lets an administrator delete a venue', async () => {
			const createRes = await roleApi.post(
				'/wp-json/fair-events/v1/venues',
				{
					headers: authHeader,
					data: { name: `Admin Delete Check ${ Date.now() }` },
				}
			);
			const created = await createRes.json();

			const res = await roleApi.delete(
				`/wp-json/fair-events/v1/venues/${ created.id }`,
				{ headers: authHeader }
			);
			expect( res.status() ).toBe( 200 );
		} );
	} );
} );
