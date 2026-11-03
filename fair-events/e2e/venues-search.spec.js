import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/**
 * Verifies (#2123) the Venues admin search: partial, accent-insensitive
 * matching on name and address, clearing, the no-matches message, selection
 * reset on search change, export limited to matching venues, and editing a
 * venue found through the search.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error( result.error );
	}
	return result.data;
}

test.describe( 'Venues admin search', () => {
	test( 'searches, clears, resets selection, and exports only matches', async ( {
		page,
	} ) => {
		test.setTimeout( 60_000 );

		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-venues' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const suffix = Date.now();
		const fixtures = [
			{
				name: `Árboles Botella E2E ${ suffix }`,
				address: `Calle Mayor ${ suffix }, Valencia`,
			},
			{
				name: `Mutable E2E ${ suffix }`,
				address: `Carrer Sueca ${ suffix }, Valencia`,
			},
			{
				name: `Plaza E2E ${ suffix }`,
				address: '',
			},
		];
		const created = [];

		try {
			for ( const data of fixtures ) {
				created.push(
					await apiFetch( page, {
						path: '/fair-events/v1/venues',
						method: 'POST',
						data,
					} )
				);
			}

			await page.reload();
			const root = page.locator( '#fair-events-venues-root' );
			const search = root.getByLabel( 'Search venues' );
			const rows = root.locator( 'tbody tr' );
			const rowFor = ( name ) => root.locator( 'tr', { hasText: name } );
			const exportButton = root.getByRole( 'button', {
				name: 'Export Selected',
			} );

			// Partial, accent- and case-insensitive name match.
			await search.fill( `ARBOLES BOTELLA E2E ${ suffix }` );
			await expect( rows ).toHaveCount( 1 );
			await expect( rowFor( fixtures[ 0 ].name ) ).toBeVisible();

			// Address match.
			await search.fill( `sueca ${ suffix }` );
			await expect( rows ).toHaveCount( 1 );
			await expect( rowFor( fixtures[ 1 ].name ) ).toBeVisible();

			// No matches keeps the search usable.
			await search.fill( `no venue ${ suffix }` );
			await expect(
				root.getByText( 'No matching venues.' )
			).toBeVisible();
			await expect( root.locator( 'table' ) ).toHaveCount( 0 );
			await expect( search ).toBeEditable();

			// All three fixtures share the suffix; selecting one then
			// changing the search clears the selection.
			await search.fill( `E2E ${ suffix }` );
			await expect( rows ).toHaveCount( 3 );
			await rowFor( fixtures[ 2 ].name ).getByRole( 'checkbox' ).check();
			await expect( exportButton ).toBeVisible();

			await search.fill( `valencia` );
			await expect(
				rowFor( fixtures[ 0 ].name ).getByRole( 'checkbox' )
			).not.toBeChecked();
			await expect( exportButton ).toHaveCount( 0 );

			// Select all only selects matches; the export holds only them.
			await search.fill( `${ suffix }, valencia` );
			await expect( rows ).toHaveCount( 2 );
			await root
				.getByRole( 'checkbox', { name: 'Select all matching venues' } )
				.check();

			const downloadPromise = page.waitForEvent( 'download' );
			await exportButton.click();
			const download = await downloadPromise;
			const exported = JSON.parse(
				await readFile( await download.path(), 'utf8' )
			);
			expect( exported.map( ( v ) => v.name ).sort() ).toEqual(
				[ fixtures[ 0 ].name, fixtures[ 1 ].name ].sort()
			);

			// Clearing restores the full list, without the selection.
			await search.fill( '' );
			await expect( rowFor( fixtures[ 2 ].name ) ).toBeVisible();
			await expect( exportButton ).toHaveCount( 0 );

			// Editing a filtered venue opens that venue, and the query
			// survives the save.
			await search.fill( `mutable e2e ${ suffix }` );
			await rowFor( fixtures[ 1 ].name )
				.getByRole( 'button', { name: 'Edit' } )
				.click();
			await expect( page.getByLabel( 'Name' ) ).toHaveValue(
				fixtures[ 1 ].name
			);
			await page
				.getByLabel( 'Address' )
				.fill( `Carrer Sueca ${ suffix }, Valencia (updated)` );
			await page.getByRole( 'button', { name: 'Update Venue' } ).click();
			await expect(
				root.getByText( 'Venue updated successfully.' )
			).toBeVisible();
			await expect( search ).toHaveValue( `mutable e2e ${ suffix }` );
			await expect( rows ).toHaveCount( 1 );
			await expect( rows.first() ).toContainText( '(updated)' );
		} finally {
			for ( const venue of created ) {
				await apiFetch( page, {
					path: `/fair-events/v1/venues/${ venue.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
	} );
} );
