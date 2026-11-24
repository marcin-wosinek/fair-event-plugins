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
// Fresh per run: with --repeat-each, beforeAll/afterAll run for every
// repetition inside one loaded module, so fixtures can't share one suffix.
let KEEP;
let KEEP_SLUG;
let DOOMED;
let created = [];

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
	test.beforeAll( async ( { browser }, testInfo ) => {
		const suffix = `${ Date.now() }-${ testInfo.repeatEachIndex }`;
		KEEP = `E2E list feed ${ suffix }`;
		KEEP_SLUG = `e2e-list-feed-${ suffix }`;
		DOOMED = `E2E feed to delete ${ suffix }`;
		created = [];
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
		// The deletion test may already have removed its feed; any other
		// failure would leave rows behind for the next repetition.
		const failures = await page.evaluate( async ( ids ) => {
			const errors = [];
			for ( const id of ids ) {
				try {
					await window.wp.apiFetch( {
						path: `/fair-events/v1/sources/${ id }`,
						method: 'DELETE',
					} );
				} catch ( error ) {
					if ( error?.code !== 'rest_source_not_found' ) {
						errors.push(
							`${ id }: ${ error?.code } ${ error?.message }`
						);
					}
				}
			}
			return errors;
		}, created );
		await page.close();
		expect( failures ).toEqual( [] );
	} );

	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'shows identity and status, and copies both URLs from the keyboard menu', async ( {
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

		await expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );

		// Escape straight away, without waiting for focus to enter the menu:
		// the popover moves focus one task after opening, and an Escape that
		// arrived first used to be lost on the trigger (#2440).
		await page.keyboard.press( 'Escape' );
		await expect( menu ).toBeHidden();
		await expect( trigger ).toBeFocused();
		await expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );

		await page.keyboard.press( 'Enter' );
		await expect(
			menu.getByRole( 'menuitem', { name: 'Copy iCal feed URL' } )
		).toBeFocused();
		await page.keyboard.press( 'Enter' );

		await expect(
			page
				.locator( '.components-notice__content' )
				.getByText( `iCal feed URL for “${ KEEP }” copied.` )
		).toBeVisible();
		await expect( menu ).toBeHidden();
		await expect( trigger ).toBeFocused();
		expect(
			await page.evaluate( () => navigator.clipboard.readText() )
		).toMatch(
			new RegExp( `fair-events/v1/sources/${ KEEP_SLUG }/ical$` )
		);

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
