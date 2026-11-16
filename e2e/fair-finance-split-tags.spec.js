/**
 * Fair Finance split allocation tags (#2341): a new split starts each
 * allocation with the entry's tag, a tag can be picked from the existing
 * tags with the keyboard, typed or cleared per allocation, the saved tags
 * reappear when the split is reopened, and cancelling an edit keeps them.
 */
import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const API = '/wp-json/fair-finance/v1';
const STAMP = Date.now().toString( 36 );
const NAME = `E2E split tags ${ STAMP }`;
const PARENT_TAG = `e2e-venue-${ STAMP }`;
const EXISTING_TAG = `e2e-catering-${ STAMP }`;
const CUSTOM_TAG = `e2e-sound-${ STAMP }`;
const ENTRIES_PAGE = '/wp-admin/admin.php?page=fair-finance-entries';

test.describe( 'Fair Finance split allocation tags', () => {
	let api;
	const ids = {};

	const post = async ( path, data ) => {
		const res = await api.post( `${ API }${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const savedTags = async () => {
		const res = await api.get(
			`${ API }/financial-entries?entry_id=${ ids.split }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const [ entry ] = ( await res.json() ).entries;
		return ( entry.children || [] ).map( ( child ) => child.tag );
	};

	test.beforeAll( async ( { baseURL } ) => {
		api = await request.newContext( { baseURL } );
		const entry = ( description, tag ) =>
			post( '/financial-entries', {
				amount: 100,
				description,
				entry_type: 'cost',
				entry_date: '2032-04-01',
				tag,
			} );
		ids.split = ( await entry( NAME, PARENT_TAG ) ).id;
		// Makes EXISTING_TAG one of the suggested tags.
		ids.other = ( await entry( `${ NAME } other`, EXISTING_TAG ) ).id;
	} );

	test.afterAll( async () => {
		await api.delete( `${ API }/financial-entries/${ ids.split }/split`, {
			headers: adminHeaders,
		} );
		for ( const id of [ ids.split, ids.other ] ) {
			if ( id ) {
				await api.delete( `${ API }/financial-entries/${ id }`, {
					headers: adminHeaders,
				} );
			}
		}
		await api.dispose();
	} );

	test( 'tags each allocation, then reopens, cancels and edits them', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( `${ ENTRIES_PAGE }&entry_id=${ ids.split }` );

		// Create: both allocations start with the entry's tag.
		await page
			.getByRole( 'button', { name: `More actions for “${ NAME }”` } )
			.click();
		await page.getByRole( 'menuitem', { name: 'Split' } ).click();
		let dialog = page.getByRole( 'dialog', { name: 'Split Entry' } );
		let tags = dialog.getByRole( 'textbox', { name: 'Tag' } );
		await expect( tags ).toHaveCount( 2 );
		await expect( tags.nth( 0 ) ).toHaveValue( PARENT_TAG );
		await expect( tags.nth( 1 ) ).toHaveValue( PARENT_TAG );

		const amounts = dialog.getByLabel( 'Amount' );
		await amounts.nth( 0 ).fill( '70' );
		await amounts.nth( 1 ).fill( '30' );

		// Clear the first; pick an existing tag for the second by keyboard.
		await tags.nth( 0 ).fill( '' );
		await tags.nth( 1 ).fill( 'e2e-cater' );
		const suggestion = dialog.getByRole( 'button', {
			name: EXISTING_TAG,
		} );
		await expect( suggestion ).toBeVisible();
		await page.keyboard.press( 'Tab' );
		await expect( suggestion ).toBeFocused();
		await page.keyboard.press( 'Enter' );
		await expect( tags.nth( 1 ) ).toHaveValue( EXISTING_TAG );
		await expect( tags.nth( 1 ) ).toBeFocused();
		await expect( dialog ).toBeVisible();

		await dialog.getByRole( 'button', { name: 'Split Entry' } ).click();
		await expect( dialog ).toHaveCount( 0 );
		await expect(
			page
				.locator( '.components-notice__content' )
				.filter( { hasText: 'Entry split successfully.' } )
		).toBeVisible();
		expect( await savedTags() ).toEqual( [ null, EXISTING_TAG ] );

		// Reopen: the saved tags are shown. Cancelling discards the edit.
		const editSplit = page.getByRole( 'button', {
			name: `Edit split “${ NAME }”`,
		} );
		await editSplit.click();
		dialog = page.getByRole( 'dialog', { name: 'Edit Split' } );
		tags = dialog.getByRole( 'textbox', { name: 'Tag' } );
		await expect( tags.nth( 0 ) ).toHaveValue( '' );
		await expect( tags.nth( 1 ) ).toHaveValue( EXISTING_TAG );
		await tags.nth( 0 ).fill( CUSTOM_TAG );
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toHaveCount( 0 );
		expect( await savedTags() ).toEqual( [ null, EXISTING_TAG ] );

		await editSplit.click();
		await expect( tags.nth( 0 ) ).toHaveValue( '' );

		// Edit: type a new tag into the first and clear the second.
		await tags.nth( 0 ).fill( CUSTOM_TAG );
		await tags.nth( 1 ).fill( '' );
		await dialog.getByRole( 'button', { name: 'Update Split' } ).click();
		await expect( dialog ).toHaveCount( 0 );
		await expect(
			page
				.locator( '.components-notice__content' )
				.filter( { hasText: 'Split updated successfully.' } )
		).toBeVisible();
		expect( await savedTags() ).toEqual( [ CUSTOM_TAG, null ] );

		await editSplit.click();
		await expect( tags.nth( 0 ) ).toHaveValue( CUSTOM_TAG );
		await expect( tags.nth( 1 ) ).toHaveValue( '' );
	} );
} );
