import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the admin calendar's category filter (#1850): selecting and
 * clearing a category, keeping it through month navigation, restoring it from
 * the URL on reload and Back/Forward, the no-matches state, and that event
 * actions keep working on a filtered view.
 */

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
const MONTH = '2036-03';
const NEXT_MONTH = '2036-04';

test.describe( 'Admin calendar — category filter', () => {
	test( 'filters, keeps the selection through navigation, and restores it from the URL', async ( {
		page,
	} ) => {
		test.setTimeout( 90_000 );

		await login( page );
		await page.goto( CALENDAR_PATH );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const suffix = Date.now();
		const created = { categories: [], eventDates: [] };

		try {
			for ( const name of [ 'Music', 'Sports', 'Empty' ] ) {
				created.categories.push(
					await apiFetch( page, {
						path: '/wp/v2/categories',
						method: 'POST',
						data: { name: `${ name } filter ${ suffix }` },
					} )
				);
			}
			const [ music, sports, empty ] = created.categories;

			const eventFixtures = [
				[ `Concert ${ suffix }`, '05', [ music.id ] ],
				[ `Match ${ suffix }`, '10', [ sports.id ] ],
				[ `Festival ${ suffix }`, '15', [ music.id, sports.id ] ],
				[ `Plain ${ suffix }`, '20', [] ],
				[ `April concert ${ suffix }`, '04', [ music.id ], NEXT_MONTH ],
			];
			for ( const [ title, day, categoryIds, month ] of eventFixtures ) {
				created.eventDates.push(
					await apiFetch( page, {
						path: '/fair-events/v1/event-dates',
						method: 'POST',
						data: {
							title,
							start_datetime: `${
								month || MONTH
							}-${ day } 10:00:00`,
							end_datetime: `${
								month || MONTH
							}-${ day } 12:00:00`,
							link_type: 'none',
							categories: categoryIds,
						},
					} )
				);
			}

			const calendar = page.locator( '.fair-events-calendar-days' );
			const select = page.getByLabel( 'Category' );

			// Default view: All categories, every event.
			await page.goto( `${ CALENDAR_PATH }&month=${ MONTH }` );
			await expect( select ).toBeEnabled();
			await expect( select ).toHaveValue( '' );
			await expect( calendar ).toContainText( `Plain ${ suffix }` );
			await expect( calendar ).toContainText( `Match ${ suffix }` );

			// Selecting a category filters immediately and updates the URL.
			await select.selectOption( String( music.id ) );
			await expect( calendar ).toContainText( `Concert ${ suffix }` );
			await expect( calendar ).toContainText( `Festival ${ suffix }` );
			await expect( calendar ).not.toContainText( `Match ${ suffix }` );
			await expect( calendar ).not.toContainText( `Plain ${ suffix }` );
			expect( searchParam( page, 'category' ) ).toBe(
				String( music.id )
			);
			expect( searchParam( page, 'month' ) ).toBe( MONTH );

			// Existing event actions keep working on the filtered view.
			const concertLink = calendar.getByRole( 'link', {
				name: new RegExp( `Concert ${ suffix }` ),
			} );
			await expect( concertLink ).toHaveAttribute(
				'href',
				/page=fair-events-manage-event.*event_date_id=\d+/
			);

			// Next keeps the category.
			await page.getByRole( 'button', { name: 'Next' } ).click();
			await expect( calendar ).toContainText(
				`April concert ${ suffix }`
			);
			expect( searchParam( page, 'month' ) ).toBe( NEXT_MONTH );
			expect( searchParam( page, 'category' ) ).toBe(
				String( music.id )
			);

			// Back restores the previous month with the same category.
			await page.goBack();
			await expect( calendar ).toContainText( `Concert ${ suffix }` );
			expect( searchParam( page, 'month' ) ).toBe( MONTH );
			await expect( select ).toHaveValue( String( music.id ) );

			// Back again restores the unfiltered view in the same month.
			await page.goBack();
			await expect( select ).toHaveValue( '' );
			await expect( calendar ).toContainText( `Plain ${ suffix }` );

			// Forward re-applies the filter.
			await page.goForward();
			await expect( select ).toHaveValue( String( music.id ) );
			await expect( calendar ).not.toContainText( `Plain ${ suffix }` );

			// Reload restores both month and category.
			await page.reload();
			await expect( select ).toBeEnabled();
			await expect( select ).toHaveValue( String( music.id ) );
			await expect( calendar ).toContainText( `Festival ${ suffix }` );
			await expect( calendar ).not.toContainText( `Match ${ suffix }` );

			// A category without matches keeps the grid and says so.
			await select.selectOption( String( empty.id ) );
			await expect(
				page.getByText( 'No events match this category.' )
			).toBeVisible();
			await expect(
				page.locator( '.fair-events-calendar-day' ).first()
			).toBeVisible();
			await expect(
				page.locator( '.fair-events-calendar-day' )
			).not.toHaveCount( 0 );

			// The day-cell add action still opens the quick-add modal.
			await page
				.locator( '.fair-events-calendar-day.current-month' )
				.first()
				.hover();
			await page
				.locator( '.fair-events-calendar-day.current-month' )
				.first()
				.getByRole( 'button', { name: 'Add event' } )
				.click();
			await expect(
				page.getByRole( 'dialog', { name: 'Quick Add Event' } )
			).toBeVisible();
			await page.keyboard.press( 'Escape' );

			// Clearing restores every event and drops the URL parameter.
			await select.selectOption( '' );
			await expect( calendar ).toContainText( `Plain ${ suffix }` );
			await expect( calendar ).toContainText( `Match ${ suffix }` );
			expect( searchParam( page, 'category' ) ).toBeNull();
			await expect(
				page.getByText( 'No events match this category.' )
			).toHaveCount( 0 );

			// A deleted category in the URL falls back to All categories.
			await apiFetch( page, {
				path: `/wp/v2/categories/${ empty.id }?force=true`,
				method: 'DELETE',
			} );
			created.categories = created.categories.filter(
				( category ) => category.id !== empty.id
			);
			await page.goto(
				`${ CALENDAR_PATH }&month=${ MONTH }&category=${ empty.id }`
			);
			await expect( calendar ).toContainText( `Plain ${ suffix }` );
			await expect( select ).toHaveValue( '' );
			await expect
				.poll( () => searchParam( page, 'category' ) )
				.toBeNull();
			expect( searchParam( page, 'month' ) ).toBe( MONTH );
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
