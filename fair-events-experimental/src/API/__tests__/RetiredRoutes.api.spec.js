/**
 * Playwright API tests for routes this plugin no longer registers.
 *
 * `GET /fair-events/v1/weekly-events` served only Fair Audience
 * Experimental's Weekly Schedule page and was removed with it (#1809). The
 * weekly data itself stays available to PHP through
 * `FairEvents\Services\WeeklyEventsProvider`.
 */

import { test, expect, request } from '@playwright/test';
import { wpCli } from '../../../../e2e/support/wp-cli.js';

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

test.describe( 'Retired event tools with legacy settings', () => {
	let api;
	let originalFeatures;
	let source;
	const headers = adminHeaders;

	test.beforeAll( async () => {
		api = await request.newContext( {
			baseURL: BASE_URL,
			extraHTTPHeaders: headers,
		} );
		const settings = await api.get( '/wp-json/wp/v2/settings' );
		expect( settings.ok() ).toBe( true );
		originalFeatures = ( await settings.json() )
			.fair_events_experimental_features;
		// Bypass current sanitization to represent an option saved before the update.
		wpCli(
			`option update fair_events_experimental_features '{"event-tools":true}' --format=json`
		);
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				data: {
					title: 'Retired tools source',
					start_datetime: '2040-01-01 10:00:00',
					link_type: 'none',
				},
			}
		);
		expect( response.ok() ).toBe( true );
		source = await response.json();
	} );

	test.afterAll( async () => {
		if ( source ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ source.id }`
			);
		}
		if ( originalFeatures !== undefined ) {
			await api.post( '/wp-json/wp/v2/settings', {
				data: { fair_events_experimental_features: originalFeatures },
			} );
		}
		await api.dispose();
	} );

	for ( const authenticated of [ false, true ] ) {
		for ( const [ suffix, method ] of [
			[ 'clone-posts', 'POST' ],
			[ 'merge-preview', 'GET' ],
			[ 'merge', 'POST' ],
		] ) {
			test( `${ method } ${ suffix } is unavailable (${ authenticated ? 'administrator' : 'anonymous' })`, async () => {
				const client = authenticated
					? api
					: await request.newContext( { baseURL: BASE_URL } );
				try {
					const before = await (
						await api.get(
							`/wp-json/fair-events/v1/event-dates/${ source.id }`
						)
					).json();
					const response = await client.fetch(
						`/wp-json/fair-events/v1/event-dates/${ source.id }/${ suffix }`,
						{
							method,
							...( method === 'POST'
								? {
										data: {
											target_event_date_id: source.id,
											target_id: source.id,
										},
									}
								: {} ),
						}
					);
					expect( response.status() ).toBe( 404 );
					expect( ( await response.json() ).code ).toBe(
						'rest_no_route'
					);
					expect(
						await (
							await api.get(
								`/wp-json/fair-events/v1/event-dates/${ source.id }`
							)
						).json()
					).toEqual( before );
				} finally {
					if ( ! authenticated ) {
						await client.dispose();
					}
				}
			} );
		}
	}
} );
