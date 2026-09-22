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

function pad2( n ) {
	return String( n ).padStart( 2, '0' );
}

// Minimal ISO week/year calculation (Thursday-of-the-week rule), used only
// to build fixture URLs that land inside the calendar/week canonical
// windows relative to "now" without hardcoding a date that goes stale.
function isoWeekYear( date ) {
	const target = new Date( date.valueOf() );
	const dayNr = ( date.getDay() + 6 ) % 7;
	target.setDate( target.getDate() - dayNr + 3 );
	const firstThursday = target.valueOf();
	target.setMonth( 0, 1 );
	if ( target.getDay() !== 4 ) {
		target.setMonth( 0, 1 + ( ( 4 - target.getDay() + 7 ) % 7 ) );
	}
	const week = 1 + Math.ceil( ( firstThursday - target ) / 604800000 );
	return { year: new Date( firstThursday ).getFullYear(), week };
}

test.describe( 'Combined dated views avoid crawlable permutations', () => {
	test( 'monthly/weekly navigation stays one-dimensional and legacy combined URLs canonicalize to the plain page', async ( {
		page,
	} ) => {
		test.setTimeout( 90_000 );
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		// Both selections land inside their respective canonical windows
		// (±3 months, ±12 weeks) and differ from "now", so each is
		// individually indexable — the interesting case is what happens
		// when both are present on the same request.
		const now = new Date();
		const calendarDate = new Date( now );
		calendarDate.setMonth( calendarDate.getMonth() + 2 );
		const calendarMonth = pad2( calendarDate.getMonth() + 1 );
		const calendarYear = String( calendarDate.getFullYear() );

		const weekDate = new Date( now );
		weekDate.setDate( weekDate.getDate() + 28 );
		const { year: weekYear, week: weekNum } = isoWeekYear( weekDate );
		const weekView = `${ weekYear }-W${ pad2( weekNum ) }`;

		const testPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Combined Dated Views Fixture',
				status: 'publish',
				content:
					FILLER +
					'<!-- wp:fair-events/events-calendar {"anchor":"fair-events-calendar-fixture","categories":[1],"eventSources":["fixture-source"],"showDrafts":true} /-->' +
					'<!-- wp:fair-events/events-week {"anchor":"fair-events-week-fixture","categories":[1],"eventSources":["fixture-source"],"showDrafts":true} /-->',
			},
		} );
		const pageUrl = testPage.link || `/?page_id=${ testPage.id }`;
		const startUrl = `${ pageUrl }?calendar_month=${ calendarMonth }&calendar_year=${ calendarYear }&week_view=${ weekView }&custom_param=keep-me`;

		await page.goto( startUrl );

		// Legacy URL carrying both dated selections: it remains accessible
		// and renders both views, but declares the plain page as canonical
		// instead of independently indexing the combination.
		const canonicalHref = await page
			.locator( 'link[rel="canonical"]' )
			.getAttribute( 'href' );
		expect( canonicalHref ).toBe( pageUrl );

		const monthRegion = page.locator( '#fair-events-calendar-fixture' );
		const weekRegion = page.locator( '#fair-events-week-fixture' );

		const monthNextHref = await monthRegion
			.locator( '.nav-next' )
			.getAttribute( 'href' );
		expect( monthNextHref ).not.toContain( 'week_view' );
		expect( monthNextHref ).toContain( 'custom_param=keep-me' );
		expect( monthNextHref ).toContain( '#fair-events-calendar-fixture' );

		const weekNextHref = await weekRegion
			.locator( '.nav-next' )
			.getAttribute( 'href' );
		expect( weekNextHref ).not.toContain( 'calendar_month' );
		expect( weekNextHref ).not.toContain( 'calendar_year' );
		expect( weekNextHref ).toContain( 'custom_param=keep-me' );
		expect( weekNextHref ).toContain( '#fair-events-week-fixture' );

		// Alternate monthly and weekly navigation and confirm no combined
		// dated URL is ever regenerated.
		await monthRegion.locator( '.nav-next' ).click();
		await expect(
			monthRegion.locator( '.navigation-title' )
		).toBeFocused();
		let params = new URL( page.url() ).searchParams;
		expect( params.has( 'week_view' ) ).toBe( false );
		expect( params.has( 'calendar_month' ) ).toBe( true );
		expect( params.get( 'custom_param' ) ).toBe( 'keep-me' );

		await weekRegion.locator( '.nav-next' ).click();
		await expect( weekRegion.locator( '.navigation-title' ) ).toBeFocused();
		params = new URL( page.url() ).searchParams;
		expect( params.has( 'calendar_month' ) ).toBe( false );
		expect( params.has( 'calendar_year' ) ).toBe( false );
		expect( params.has( 'week_view' ) ).toBe( true );
		expect( params.get( 'custom_param' ) ).toBe( 'keep-me' );

		await monthRegion.locator( '.nav-next' ).click();
		await expect(
			monthRegion.locator( '.navigation-title' )
		).toBeFocused();
		params = new URL( page.url() ).searchParams;
		expect( params.has( 'week_view' ) ).toBe( false );
		expect( params.has( 'calendar_month' ) ).toBe( true );

		await apiFetch( page, {
			path: `/wp/v2/pages/${ testPage.id }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
	} );
} );
