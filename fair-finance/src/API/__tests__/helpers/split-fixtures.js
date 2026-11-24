/**
 * Shared fixtures for API specs that create and split financial entries.
 *
 * Each describe block gets its own request context and its own list of
 * created entries, which `close()` unsplits and deletes.
 */

import { expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

export const ENTRIES_API = '/wp-json/fair-finance/v1/financial-entries';

export const ADMIN_HEADERS = {
	Authorization: `Basic ${ Buffer.from(
		`${ ADMIN_USER }:${ ADMIN_PASSWORD }`
	).toString( 'base64' ) }`,
};

/**
 * @param {Object} entryDefaults Fields every created entry starts from.
 * @return {Object} Fixture helpers; `api` is set once `open()` resolves.
 */
export function splitFixtures( entryDefaults ) {
	const created = [];
	const fixtures = {
		api: null,

		async open() {
			fixtures.api = await request.newContext( { baseURL: BASE_URL } );
		},

		async close() {
			for ( const id of created ) {
				await fixtures.api.delete( `${ ENTRIES_API }/${ id }/split`, {
					headers: ADMIN_HEADERS,
				} );
				await fixtures.api.delete( `${ ENTRIES_API }/${ id }`, {
					headers: ADMIN_HEADERS,
				} );
			}
			await fixtures.api.dispose();
		},

		async createEntry( data = {} ) {
			const res = await fixtures.api.post( ENTRIES_API, {
				headers: ADMIN_HEADERS,
				data: {
					amount: 100,
					entry_type: 'cost',
					...entryDefaults,
					...data,
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			const { id } = await res.json();
			created.push( id );
			return id;
		},

		split( id, allocations, method = 'post' ) {
			return fixtures.api[ method ]( `${ ENTRIES_API }/${ id }/split`, {
				headers: ADMIN_HEADERS,
				data: { allocations },
			} );
		},

		// The focused list returns a split parent with its allocations.
		async focused( id ) {
			const res = await fixtures.api.get(
				`${ ENTRIES_API }?entry_id=${ id }`,
				{ headers: ADMIN_HEADERS }
			);
			expect( res.ok() ).toBeTruthy();
			return ( await res.json() ).entries[ 0 ];
		},
	};

	return fixtures;
}
