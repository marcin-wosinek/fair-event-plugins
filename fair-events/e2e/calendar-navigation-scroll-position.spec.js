import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error( result.error );
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

const FILLER =
	'<!-- wp:paragraph --><p>Navigation fixture filler.</p><!-- /wp:paragraph -->'.repeat(
		40
	);

const cases = [
	{
		name: 'month',
		block: 'events-calendar',
		id: 'fair-events-calendar',
		param: 'calendar_month',
		gridCell: '.calendar-day[data-date]',
	},
	{
		name: 'week',
		block: 'events-week',
		id: 'fair-events-week',
		param: 'week_view',
		gridCell: '.week-day[data-date]',
	},
];

test.describe( 'Calendar client-side navigation', () => {
	for ( const fixture of cases ) {
		test( `${ fixture.name } view navigates, restores history, and remains accessible`, async ( {
			page,
			browser,
		} ) => {
			test.setTimeout( 90_000 );
			await login( page );
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp?.apiFetch );
			const testPage = await apiFetch( page, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title: `Client Navigation ${ fixture.name }`,
					status: 'publish',
					content:
						FILLER +
						`<!-- wp:fair-events/${ fixture.block } {"anchor":"${ fixture.id }-fixture","categories":[1],"eventSources":["fixture-source"],"showDrafts":true,"showCopySummary":true} /-->`,
				},
			} );
			const pageUrl = testPage.link || `/?page_id=${ testPage.id }`;
			await page.goto( pageUrl );

			const region = page.locator( `#${ fixture.id }-fixture` );
			await expect( region ).toHaveAttribute(
				'data-wp-router-region',
				`${ fixture.id }-fixture`
			);
			await region.scrollIntoViewIfNeeded();
			await page.evaluate( () => window.scrollBy( 0, -100 ) );
			const initialScroll = await page.evaluate( () => window.scrollY );
			const initialHeading = (
				await region.locator( '.navigation-title' ).textContent()
			).trim();
			const initialDate = await region
				.locator( fixture.gridCell )
				.first()
				.getAttribute( 'data-date' );
			await page.evaluate( () => {
				window.__fairNavigationDocument = document;
			} );

			await page.route( '**/*', async ( route ) => {
				if (
					route.request().resourceType() === 'document' &&
					route.request().url().includes( fixture.param )
				) {
					await new Promise( ( resolve ) =>
						setTimeout( resolve, 500 )
					);
				}
				await route.continue();
			} );

			await region.locator( '.nav-next' ).click();
			await expect( region ).toHaveAttribute( 'aria-busy', 'true' );
			await expect(
				region.locator( '.fair-events-navigation-loading' )
			).toBeVisible();
			await expect(
				region.locator( '.navigation-title' )
			).not.toHaveText( initialHeading );
			expect(
				await page.evaluate(
					() => window.__fairNavigationDocument === document
				)
			).toBe( true );
			const secondHeading = (
				await region.locator( '.navigation-title' ).textContent()
			).trim();
			const secondDate = await region
				.locator( fixture.gridCell )
				.first()
				.getAttribute( 'data-date' );
			expect( secondDate ).not.toBe( initialDate );
			expect(
				new URL( page.url() ).searchParams.get( fixture.param )
			).toBeTruthy();
			expect( await page.evaluate( () => window.scrollY ) ).toBeCloseTo(
				initialScroll,
				-1
			);
			await expect( region.locator( '.navigation-title' ) ).toBeFocused();
			await expect( region.locator( '.nav-prev' ) ).toHaveAttribute(
				'href',
				new RegExp( fixture.param )
			);

			await region.locator( '.nav-next' ).click();
			await expect(
				region.locator( '.navigation-title' )
			).not.toHaveText( secondHeading );
			const thirdHeading = (
				await region.locator( '.navigation-title' ).textContent()
			).trim();
			await page.goBack();
			await expect( region.locator( '.navigation-title' ) ).toHaveText(
				secondHeading
			);
			await page.goForward();
			await expect( region.locator( '.navigation-title' ) ).toHaveText(
				thirdHeading
			);

			const noJsContext = await browser.newContext( {
				javaScriptEnabled: false,
			} );
			const noJsPage = await noJsContext.newPage();
			await noJsPage.goto( pageUrl );
			await noJsPage
				.locator( `#${ fixture.id }-fixture .nav-next` )
				.click();
			await expect( noJsPage ).toHaveURL(
				new RegExp( `${ fixture.param }=.*#${ fixture.id }-fixture` )
			);
			await noJsContext.close();

			await apiFetch( page, {
				path: `/wp/v2/pages/${ testPage.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		} );
	}
} );
