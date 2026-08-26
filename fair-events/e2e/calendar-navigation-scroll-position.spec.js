import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies (#1425) that clicking next/previous on the calendar month view and
 * the week view lands the browser back on the block instead of resetting
 * scroll to the top of the page, and that the URL still carries the
 * month/year (or week) selection so it stays bookmarkable.
 */

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const res = await wp.apiFetch( opts );
			return { ok: true, data: res };
		} catch ( err ) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
					data: err && err.data,
					raw: JSON.stringify( err ),
				},
			};
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${
				options.path
			} failed: ${ JSON.stringify( result.error ) }`
		);
	}
	return result.data;
}

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function createPage( page, title, content ) {
	const priorPages = await apiFetch( page, {
		path: `/wp/v2/pages?search=${ encodeURIComponent(
			title
		) }&per_page=20`,
	} );
	for ( const p of priorPages ) {
		await apiFetch( page, {
			path: `/wp/v2/pages/${ p.id }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
	}

	return apiFetch( page, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: { title, status: 'publish', content },
	} );
}

// Enough leading filler that the block isn't already at the top of the page,
// so a scroll-to-top regression is actually observable.
const FILLER =
	'<!-- wp:paragraph -->\n<p>Filler paragraph to push the block below the fold.</p>\n<!-- /wp:paragraph -->\n'.repeat(
		40
	);

const viewports = [
	{ name: 'desktop', size: { width: 1200, height: 900 } },
	{ name: 'mobile', size: { width: 375, height: 667 } },
];

test.describe( 'Calendar navigation keeps scroll position (#1425)', () => {
	for ( const { name, size } of viewports ) {
		test( `month view: next keeps the calendar in view (${ name })`, async ( {
			page,
		} ) => {
			test.setTimeout( 60_000 );
			await page.setViewportSize( size );
			await login( page );
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp && window.wp.apiFetch );

			const testPage = await createPage(
				page,
				`Scroll Position Calendar ${ name }`,
				FILLER + '<!-- wp:fair-events/events-calendar /-->'
			);

			await page.goto( testPage.link || `/?page_id=${ testPage.id }` );

			const block = page.locator( '#fair-events-calendar' );
			await expect( block ).toBeVisible();
			await block.scrollIntoViewIfNeeded();
			// Nudge off the exact top edge so a scroll-to-top regression is
			// distinguishable from "already there".
			await page.evaluate( () => window.scrollBy( 0, -100 ) );

			await page.locator( '.nav-next' ).click();
			await page.waitForLoadState( 'load' );

			// Bookmarkable URL: the month/year selection is still encoded.
			const afterUrl = new URL( page.url() );
			expect( afterUrl.hash ).toBe( '#fair-events-calendar' );
			expect(
				afterUrl.searchParams.get( 'calendar_month' )
			).toBeTruthy();
			expect( afterUrl.searchParams.get( 'calendar_year' ) ).toBeTruthy();

			// The reload lands on the block instead of resetting to the top.
			const scrollY = await page.evaluate( () => window.scrollY );
			expect( scrollY ).toBeGreaterThan( 100 );
			const box = await block.boundingBox();
			expect( box ).not.toBeNull();
			expect( box.y ).toBeGreaterThan( -50 );
			expect( box.y ).toBeLessThan( size.height / 2 );

			// Cleanup.
			await apiFetch( page, {
				path: `/wp/v2/pages/${ testPage.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		} );

		test( `week view: next keeps the week grid in view (${ name })`, async ( {
			page,
		} ) => {
			test.setTimeout( 60_000 );
			await page.setViewportSize( size );
			await login( page );
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp && window.wp.apiFetch );

			const testPage = await createPage(
				page,
				`Scroll Position Week ${ name }`,
				FILLER + '<!-- wp:fair-events/events-week /-->'
			);

			await page.goto( testPage.link || `/?page_id=${ testPage.id }` );

			const block = page.locator( '#fair-events-week' );
			await expect( block ).toBeVisible();
			await block.scrollIntoViewIfNeeded();
			await page.evaluate( () => window.scrollBy( 0, -100 ) );

			const beforeWeek = new URL( page.url() ).searchParams.get(
				'week_view'
			);

			await page.locator( '.nav-next' ).click();
			await page.waitForLoadState( 'load' );

			// Bookmarkable URL: the week selection is still encoded, and changed.
			const afterUrl = new URL( page.url() );
			expect( afterUrl.hash ).toBe( '#fair-events-week' );
			const afterWeek = afterUrl.searchParams.get( 'week_view' );
			expect( afterWeek ).toBeTruthy();
			expect( afterWeek ).not.toBe( beforeWeek );

			// The reload lands on the block instead of resetting to the top.
			const scrollY = await page.evaluate( () => window.scrollY );
			expect( scrollY ).toBeGreaterThan( 100 );
			const box = await block.boundingBox();
			expect( box ).not.toBeNull();
			expect( box.y ).toBeGreaterThan( -50 );
			expect( box.y ).toBeLessThan( size.height / 2 );

			// Cleanup.
			await apiFetch( page, {
				path: `/wp/v2/pages/${ testPage.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		} );
	}
} );
