/**
 * Playwright API tests for VenueController.
 *
 * Verifies that the venues endpoint returns `maps_url` (computed) and does not
 * expose the removed `google_maps_link` field.
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

		test( 'requires manage_options', async () => {
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
} );
