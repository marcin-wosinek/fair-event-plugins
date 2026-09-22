import { test, expect } from '@playwright/test';

/**
 * Verifies (#1621) that an event editor — someone who can edit events but
 * isn't an administrator — can reach venue management, create a venue, edit
 * one, and use the map preview, without being able to delete a venue. A
 * subscriber (no edit_posts) is rejected from the Venues admin URL entirely.
 * An administrator keeps full access, including deletion.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

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

test.describe( 'Venue management — event editor access', () => {
	test( 'an event editor can manage venues but not delete them; a subscriber is rejected', async ( {
		page,
		browser,
	} ) => {
		test.setTimeout( 60_000 );

		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const suffix = Date.now();
		const contributorPassword = `Venue-editor-${ suffix }-pw`;
		const contributor = await apiFetch( page, {
			path: '/wp/v2/users',
			method: 'POST',
			data: {
				username: `venue_editor_${ suffix }`,
				email: `venue-editor-${ suffix }@example.test`,
				password: contributorPassword,
				roles: [ 'contributor' ],
			},
		} );

		const subscriberPassword = `Venue-subscriber-${ suffix }-pw`;
		const subscriber = await apiFetch( page, {
			path: '/wp/v2/users',
			method: 'POST',
			data: {
				username: `venue_subscriber_${ suffix }`,
				email: `venue-subscriber-${ suffix }@example.test`,
				password: subscriberPassword,
				roles: [ 'subscriber' ],
			},
		} );

		let createdVenueId;

		try {
			// Contributor (event editor): the Venues submenu is reachable,
			// venues can be created, edited, and previewed, and no Delete
			// action is exposed.
			const contributorContext = await browser.newContext();
			const contributorPage = await contributorContext.newPage();
			await login(
				contributorPage,
				contributor.username,
				contributorPassword
			);

			await expect(
				contributorPage.locator(
					'#adminmenu a[href="admin.php?page=fair-events-venues"]'
				)
			).toBeVisible();

			await contributorPage.goto(
				'/wp-admin/admin.php?page=fair-events-venues'
			);
			await expect(
				contributorPage.getByRole( 'heading', {
					name: 'Venues',
					exact: true,
				} )
			).toBeVisible();

			await contributorPage
				.getByRole( 'button', { name: 'Add New Venue' } )
				.click();
			const venueName = `E2E Editor Venue ${ suffix }`;
			await contributorPage.getByLabel( 'Name' ).fill( venueName );
			await contributorPage
				.getByLabel( 'Address' )
				.fill( 'Gran Via 1, Valencia' );
			await contributorPage
				.getByRole( 'button', { name: 'Create Venue' } )
				.click();
			await expect(
				contributorPage
					.locator( '#fair-events-venues-root' )
					.getByText( 'Venue created successfully.' )
			).toBeVisible();

			const venueRow = contributorPage.locator( 'tr', {
				hasText: venueName,
			} );
			await expect( venueRow ).toBeVisible();
			await expect(
				venueRow.getByRole( 'button', { name: 'Delete' } )
			).toHaveCount( 0 );

			await venueRow.getByRole( 'button', { name: 'Edit' } ).click();
			const previewLink = contributorPage.getByRole( 'link', {
				name: 'Test Google Maps link',
			} );
			await expect( previewLink ).toHaveAttribute(
				'href',
				/Gran%20Via%201%2C%20Valencia/
			);
			await contributorPage
				.getByLabel( 'Address' )
				.fill( 'Gran Via 1, Valencia (updated)' );
			await contributorPage
				.getByRole( 'button', { name: 'Update Venue' } )
				.click();
			await expect(
				contributorPage
					.locator( '#fair-events-venues-root' )
					.getByText( 'Venue updated successfully.' )
			).toBeVisible();

			createdVenueId = (
				await apiFetch( contributorPage, {
					path: '/fair-events/v1/venues',
				} )
			).find( ( v ) => v.name === venueName )?.id;
			expect( createdVenueId ).toBeTruthy();

			await contributorContext.close();

			// Subscriber: no menu item, and direct access is rejected.
			const subscriberContext = await browser.newContext();
			const subscriberPage = await subscriberContext.newPage();
			await login(
				subscriberPage,
				subscriber.username,
				subscriberPassword
			);
			await expect(
				subscriberPage.locator(
					'#adminmenu a[href="admin.php?page=fair-events-venues"]'
				)
			).toHaveCount( 0 );

			await subscriberPage.goto(
				'/wp-admin/admin.php?page=fair-events-venues'
			);
			await expect(
				subscriberPage.getByText( /Sorry, you are not allowed/i )
			).toBeVisible();
			await subscriberContext.close();

			// Administrator: the page and Delete action remain available.
			await page.goto( '/wp-admin/admin.php?page=fair-events-venues' );
			const adminVenueRow = page.locator( 'tr', {
				hasText: venueName,
			} );
			await expect(
				adminVenueRow.getByRole( 'button', { name: 'Delete' } )
			).toBeVisible();
		} finally {
			await login( page );
			if ( createdVenueId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/venues/${ createdVenueId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			await apiFetch( page, {
				path: `/wp/v2/users/${ contributor.id }?force=true&reassign=1`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/users/${ subscriber.id }?force=true&reassign=1`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );
} );
