import { test, expect } from '@playwright/test';
import { timingFields } from '../../e2e/support/event-timing.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the mobile admin calendar's collapsed past days (#2446): earlier
 * days of the current month sit in a collapsed "Past events" disclosure that
 * opens and closes from the keyboard, today's events (including one at 01:00)
 * stay visible, past events keep their manage links, the grouping follows
 * category filtering and month navigation, and widths above 600px keep the
 * month grid.
 *
 * The browser runs in America/Los_Angeles with a fixed clock, so a date
 * parsed as UTC would move the 01:00 event to the previous day.
 */

test.use( { timezoneId: 'America/Los_Angeles' } );

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

function searchParam( page, name ) {
	return new URL( page.url() ).searchParams.get( name );
}

const CALENDAR_PATH = '/wp-admin/admin.php?page=fair-events-calendar';
// A month far from any fixture data other specs create.
const MONTH = '2038-09';
const NEXT_MONTH = '2038-10';
// Noon on 15 September 2038 in Los Angeles (PDT, UTC-7).
const NOW = new Date( '2038-09-15T12:00:00-07:00' );

test.describe( 'Admin calendar — collapsed past days on mobile', () => {
	test( 'collapses past days, toggles from the keyboard, and regroups on filter and navigation', async ( {
		page,
	} ) => {
		test.setTimeout( 90_000 );

		await page.clock.setFixedTime( NOW );
		await page.setViewportSize( { width: 375, height: 812 } );
		await login( page );
		await page.goto( CALENDAR_PATH );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const suffix = Date.now();
		const created = { categories: [], eventDates: [] };

		try {
			for ( const name of [ 'Music', 'Sports' ] ) {
				created.categories.push(
					await apiFetch( page, {
						path: '/wp/v2/categories',
						method: 'POST',
						data: { name: `${ name } past ${ suffix }` },
					} )
				);
			}
			const [ music, sports ] = created.categories;

			const eventFixtures = [
				[ `First ${ suffix }`, `${ MONTH }-01 10:00:00`, [ music.id ] ],
				[
					`Yesterday ${ suffix }`,
					`${ MONTH }-14 18:00:00`,
					[ sports.id ],
				],
				[
					`Early today ${ suffix }`,
					`${ MONTH }-15 01:00:00`,
					[ music.id ],
				],
				[
					`Tomorrow ${ suffix }`,
					`${ MONTH }-16 10:00:00`,
					[ sports.id ],
				],
				[ `October ${ suffix }`, `${ NEXT_MONTH }-02 10:00:00`, [] ],
			];
			for ( const [ title, start, categoryIds ] of eventFixtures ) {
				created.eventDates.push(
					await apiFetch( page, {
						path: '/fair-events/v1/event-dates',
						method: 'POST',
						data: {
							title,
							...timingFields( start ),
							link_type: 'none',
							categories: categoryIds,
						},
					} )
				);
			}

			const calendar = page.locator( '.fair-events-calendar-days' );
			const details = calendar.locator(
				'details.fair-events-calendar-past'
			);
			const summary = details.locator( 'summary' );
			const select = page.getByLabel( 'Category' );
			const eventText = ( title ) => calendar.getByText( title );

			await page.goto( `${ CALENDAR_PATH }&month=${ MONTH }` );
			await expect( select ).toBeEnabled();

			// Collapsed by default; today (including 01:00) and upcoming
			// events are visible outside the disclosure.
			await expect( summary ).toHaveText( 'Past events' );
			await expect( details ).not.toHaveAttribute( 'open' );
			await expect( eventText( `First ${ suffix }` ) ).toBeHidden();
			await expect( eventText( `Yesterday ${ suffix }` ) ).toBeHidden();
			await expect(
				eventText( `Early today ${ suffix }` )
			).toBeVisible();
			await expect( eventText( `Tomorrow ${ suffix }` ) ).toBeVisible();
			await expect(
				details.getByText( `Early today ${ suffix }` )
			).toHaveCount( 0 );
			// The first card on screen is the disclosure, not a past day.
			await expect(
				calendar.locator( ':scope > :visible' ).first()
			).toHaveClass( /fair-events-calendar-past/ );

			// Keyboard: open with Enter, close with Space.
			await summary.focus();
			await page.keyboard.press( 'Enter' );
			await expect( details ).toHaveAttribute( 'open', '' );
			await expect( eventText( `First ${ suffix }` ) ).toBeVisible();
			await expect( eventText( `Yesterday ${ suffix }` ) ).toBeVisible();

			// Past events keep their management links.
			await expect(
				details.getByRole( 'link', {
					name: new RegExp( `First ${ suffix }` ),
				} )
			).toHaveAttribute(
				'href',
				/page=fair-events-manage-event.*event_date_id=\d+/
			);
			await expect(
				details.getByRole( 'button', { name: 'Add event' } ).first()
			).toBeVisible();

			await page.keyboard.press( 'Space' );
			await expect( details ).not.toHaveAttribute( 'open' );

			// Filtering regroups and starts collapsed again.
			await summary.focus();
			await page.keyboard.press( 'Enter' );
			await expect( details ).toHaveAttribute( 'open', '' );
			await select.selectOption( String( music.id ) );
			await expect(
				eventText( `Early today ${ suffix }` )
			).toBeVisible();
			await expect( details ).not.toHaveAttribute( 'open' );
			await expect(
				details.getByText( `First ${ suffix }` )
			).toHaveCount( 1 );
			await expect(
				calendar.getByText( `Yesterday ${ suffix }` )
			).toHaveCount( 0 );

			await select.selectOption( String( sports.id ) );
			await expect( eventText( `Tomorrow ${ suffix }` ) ).toBeVisible();
			await expect(
				details.getByText( `Yesterday ${ suffix }` )
			).toHaveCount( 1 );

			// Other months list every day; Today returns to a collapsed
			// current month.
			await select.selectOption( '' );
			await page.getByRole( 'button', { name: 'Next' } ).click();
			await expect( eventText( `October ${ suffix }` ) ).toBeVisible();
			expect( searchParam( page, 'month' ) ).toBe( NEXT_MONTH );
			await expect( details ).toHaveCount( 0 );

			await page.getByRole( 'button', { name: 'Today' } ).click();
			await expect( summary ).toBeVisible();
			expect( searchParam( page, 'month' ) ).toBe( MONTH );
			await expect( details ).not.toHaveAttribute( 'open' );

			// Both sides of the 600px agenda breakpoint.
			await page.setViewportSize( { width: 601, height: 900 } );
			await expect( details ).toHaveCount( 0 );
			await expect( eventText( `First ${ suffix }` ) ).toBeVisible();

			await page.setViewportSize( { width: 600, height: 900 } );
			await expect( summary ).toBeVisible();
			await expect( eventText( `First ${ suffix }` ) ).toBeHidden();
		} finally {
			for ( const eventDate of created.eventDates ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			for ( const category of created.categories ) {
				await apiFetch( page, {
					path: `/wp/v2/categories/${ category.id }?force=true`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
	} );
} );
