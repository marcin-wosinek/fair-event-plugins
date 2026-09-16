import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the events-calendar "Manage events" shortcut (#1596): a
 * capability-gated link next to the month navigation that takes an event
 * manager straight to the corresponding month on the admin calendar, and is
 * fully absent — no leftover markup or spacing — for anyone who cannot edit
 * events.
 */

async function login(
	page,
	username = WP_ADMIN_USER,
	password = WP_ADMIN_PASS
) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', username );
		await page.fill( '#user_pass', password );
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

function monthParam( href ) {
	return new URL( href, 'http://example.test' ).searchParams.get( 'month' );
}

test.describe( 'Events Calendar — Manage events link', () => {
	test( 'is shown only to users who can edit events, and targets the displayed month', async ( {
		page,
		browser,
	} ) => {
		test.setTimeout( 60_000 );

		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const suffix = Date.now();
		const subscriberPassword = `Manage-link-${ suffix }-pw`;
		const subscriber = await apiFetch( page, {
			path: '/wp/v2/users',
			method: 'POST',
			data: {
				username: `manage_link_${ suffix }`,
				email: `manage-link-${ suffix }@example.test`,
				password: subscriberPassword,
				roles: [ 'subscriber' ],
			},
		} );

		const calendarPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Manage Link Calendar ${ suffix }`,
				status: 'publish',
				content: '<!-- wp:fair-events/events-calendar /-->',
			},
		} );
		const pageUrl = calendarPage.link || `/?page_id=${ calendarPage.id }`;

		try {
			// Administrator: the link is visible, accessible, and points at
			// the admin calendar for the month currently displayed.
			await page.goto( pageUrl );
			const manageLink = page.locator( '.fair-events-manage-link' );
			await expect( manageLink ).toBeVisible();
			await expect( manageLink ).toHaveText( 'Manage events' );
			await expect( manageLink ).toHaveAccessibleName( 'Manage events' );

			const initialHref = await manageLink.getAttribute( 'href' );
			expect( initialHref ).toContain(
				'/wp-admin/admin.php?page=fair-events-calendar'
			);
			const initialMonth = monthParam( initialHref );
			expect( initialMonth ).toMatch( /^\d{4}-\d{2}$/ );

			await manageLink.focus();
			const focusIndicator = await manageLink.evaluate( ( element ) => {
				const styles = window.getComputedStyle( element );
				return {
					style: styles.outlineStyle,
					width: Number.parseFloat( styles.outlineWidth ),
				};
			} );
			expect( focusIndicator.style ).not.toBe( 'none' );
			expect( focusIndicator.width ).toBeGreaterThan( 0 );

			// Existing previous/next navigation keeps working, and the
			// management destination follows the displayed month.
			const initialHeading = (
				await page.locator( '.navigation-title' ).textContent()
			).trim();
			await page.locator( '.nav-next' ).click();
			await expect( page.locator( '.navigation-title' ) ).not.toHaveText(
				initialHeading
			);
			const nextHref = await manageLink.getAttribute( 'href' );
			const nextMonth = monthParam( nextHref );
			expect( nextMonth ).not.toBe( initialMonth );

			await manageLink.click();
			await page.waitForURL( /admin\.php\?page=fair-events-calendar/ );
			expect( new URL( page.url() ).searchParams.get( 'month' ) ).toBe(
				nextMonth
			);

			// A logged-in subscriber (no edit_posts capability) gets no link
			// and no leftover empty wrapper.
			const subscriberContext = await browser.newContext();
			const subscriberPage = await subscriberContext.newPage();
			await login(
				subscriberPage,
				subscriber.username,
				subscriberPassword
			);
			await subscriberPage.goto( pageUrl );
			await expect(
				subscriberPage.locator( '.fair-events-manage-link' )
			).toHaveCount( 0 );
			await expect(
				subscriberPage.locator( '.navigation-title' )
			).toBeVisible();
			await subscriberContext.close();

			// A logged-out visitor gets no link either.
			const visitorContext = await browser.newContext();
			const visitorPage = await visitorContext.newPage();
			await visitorPage.goto( pageUrl );
			await expect(
				visitorPage.locator( '.fair-events-manage-link' )
			).toHaveCount( 0 );
			await expect( visitorPage.locator( '.nav-next' ) ).toBeVisible();
			await visitorContext.close();
		} finally {
			await login( page );
			await apiFetch( page, {
				path: `/wp/v2/pages/${ calendarPage.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/users/${ subscriber.id }?force=true&reassign=1`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );
} );
