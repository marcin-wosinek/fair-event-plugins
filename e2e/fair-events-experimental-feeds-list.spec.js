/**
 * Event Feeds list on the shared admin table (#2206): identity, status,
 * keyboard-operable row menus, copy feedback, deletion focus and the
 * stacked layout on narrow screens.
 *
 * Needs a current `npm run build` in fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const SOURCES_PAGE = '/wp-admin/admin.php?page=fair-events-sources';
const suffix = Date.now();
const KEEP = `E2E list feed ${ suffix }`;
const KEEP_SLUG = `e2e-list-feed-${ suffix }`;
const DOOMED = `E2E feed to delete ${ suffix }`;
const created = [];

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = ( page, options ) =>
	page.evaluate( ( opts ) => window.wp.apiFetch( opts ), options );

async function openList( page ) {
	await page.goto( SOURCES_PAGE );
	await expect( page.getByRole( 'link', { name: KEEP } ) ).toBeVisible();
}

const row = ( page, name ) =>
	page.getByRole( 'row' ).filter( {
		has: page.getByRole( 'link', { name, exact: true } ),
	} );

const moreButton = ( page, name ) =>
	page.getByRole( 'button', { name: `More actions for “${ name }”` } );

test.describe( 'Fair Events Experimental — Event Feeds list', () => {
	test.beforeAll( async ( { browser } ) => {
		const page = await browser.newPage();
		await loginAsAdmin( page );
		await page.goto( SOURCES_PAGE );
		await page.waitForFunction(
			() => typeof window.wp?.apiFetch === 'function'
		);
		const input = [
			{ source_type: 'categories', config: { category_ids: [] } },
		];
		for ( const [ name, slug, enabled ] of [
			[ KEEP, KEEP_SLUG, true ],
			[ DOOMED, `e2e-feed-to-delete-${ suffix }`, false ],
		] ) {
			const feed = await adminApiFetch( page, {
				path: '/fair-events/v1/sources',
				method: 'POST',
				data: { name, slug, enabled, data_sources: input },
			} );
			created.push( feed.id );
		}
		await page.close();
	} );

	test.afterAll( async ( { browser } ) => {
		const page = await browser.newPage();
		await loginAsAdmin( page );
		await page.goto( SOURCES_PAGE );
		await page.waitForFunction(
			() => typeof window.wp?.apiFetch === 'function'
		);
		for ( const id of created ) {
			await adminApiFetch( page, {
				path: `/fair-events/v1/sources/${ id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await page.close();
	} );

	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'shows identity and status, and copies a URL from the keyboard menu', async ( {
		page,
		context,
	} ) => {
		await context.grantPermissions( [
			'clipboard-read',
			'clipboard-write',
		] );
		await openList( page );

		const keep = row( page, KEEP );
		await expect( keep.getByText( KEEP_SLUG ) ).toBeVisible();
		await expect( keep.getByText( 'Enabled' ) ).toBeVisible();
		await expect(
			row( page, DOOMED ).getByText( 'Disabled' )
		).toBeVisible();
		await expect(
			page.getByRole( 'columnheader', { name: 'iCal Feed' } )
		).toHaveCount( 0 );

		const trigger = moreButton( page, KEEP );
		await trigger.focus();
		await page.keyboard.press( 'Enter' );
		const menu = page.getByRole( 'menu', {
			name: `More actions for “${ KEEP }”`,
		} );
		await expect( menu ).toBeVisible();
		await expect( menu.getByRole( 'menuitem' ) ).toHaveText( [
			'Copy iCal feed URL',
			'Copy JSON API URL',
			'Delete',
		] );

		await page.keyboard.press( 'Escape' );
		await expect( menu ).toBeHidden();
		await expect( trigger ).toBeFocused();

		await page.keyboard.press( 'Enter' );
		await expect(
			menu.getByRole( 'menuitem', { name: 'Copy iCal feed URL' } )
		).toBeFocused();
		await page.keyboard.press( 'ArrowDown' );
		await expect(
			menu.getByRole( 'menuitem', { name: 'Copy JSON API URL' } )
		).toBeFocused();
		await page.keyboard.press( 'Enter' );

		await expect(
			page
				.locator( '.components-notice__content' )
				.getByText( `JSON API URL for “${ KEEP }” copied.` )
		).toBeVisible();
		await expect( trigger ).toBeFocused();
		expect(
			await page.evaluate( () => navigator.clipboard.readText() )
		).toMatch(
			new RegExp( `fair-events/v1/sources/${ KEEP_SLUG }/json$` )
		);
	} );

	test( 'returns focus to Edit after closing the editor', async ( {
		page,
	} ) => {
		await openList( page );

		const edit = page.getByRole( 'button', { name: `Edit “${ KEEP }”` } );
		await edit.focus();
		await page.keyboard.press( 'Enter' );
		const dialog = page.getByRole( 'dialog', { name: 'Edit Event Feed' } );
		await expect( dialog ).toBeVisible();
		await page.keyboard.press( 'Escape' );

		await expect( dialog ).toBeHidden();
		await expect( edit ).toBeFocused();
	} );

	test( 'cancelling a deletion returns focus; deleting focuses the heading', async ( {
		page,
	} ) => {
		await openList( page );

		const trigger = moreButton( page, DOOMED );
		await trigger.click();
		await page.getByRole( 'menuitem', { name: 'Delete' } ).click();
		const dialog = page.getByRole( 'dialog', {
			name: `Delete event feed — ${ DOOMED }`,
		} );
		await expect( dialog ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();

		await trigger.click();
		await page.getByRole( 'menuitem', { name: 'Delete' } ).click();
		await dialog
			.getByRole( 'button', { name: 'Delete event feed' } )
			.click();

		await expect( dialog ).toBeHidden();
		await expect(
			page
				.locator( '.components-notice__content' )
				.getByText( `Event feed “${ DOOMED }” deleted.` )
		).toBeVisible();
		await expect( page.getByRole( 'link', { name: DOOMED } ) ).toHaveCount(
			0
		);
		await expect(
			page.getByRole( 'heading', { name: 'Event Feeds' } )
		).toBeFocused();
		await expect( page.getByRole( 'link', { name: KEEP } ) ).toBeVisible();
	} );

	for ( const [ label, width, height ] of [
		[ 'tablet', 768, 1024 ],
		[ 'mobile', 375, 812 ],
	] ) {
		test( `stacks rows without horizontal scrolling on ${ label }`, async ( {
			page,
		} ) => {
			await page.setViewportSize( { width, height } );
			await openList( page );

			await expect(
				page.getByRole( 'columnheader', { name: 'Status' } )
			).toBeHidden();
			const keep = row( page, KEEP );
			await expect( keep.getByText( 'Enabled' ) ).toBeVisible();
			await expect(
				keep.getByRole( 'button', { name: `Edit “${ KEEP }”` } )
			).toBeVisible();
			await expect( moreButton( page, KEEP ) ).toBeVisible();
			const overflow = await page.evaluate(
				() =>
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth
			);
			expect( overflow ).toBe( false );
		} );
	}
} );
