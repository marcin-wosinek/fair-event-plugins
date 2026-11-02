/**
 * E2E: the Manage Event Messages tab (#2126). An organizer writes a booking
 * confirmation message with a link in the classic editor, sees the tab
 * marked as unsaved, saves it, and finds it again after reloading the page.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: { message: error?.message, code: error?.code },
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

const messagesUrl = ( eventDateId ) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=messages`;

test.describe( 'Manage Event Messages tab', () => {
	let eventDateId;

	test.beforeEach( async ( { page } ) => {
		await login( page );
		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Messages tab ${ Date.now() }`,
				start_date: '2036-04-01',
				start_time: '10:00:00',
				end_date: '2036-04-01',
				end_time: '12:00:00',
			},
		} );
		eventDateId = eventDate.id;
	} );

	test.afterEach( async ( { page } ) => {
		if ( eventDateId ) {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} );
		}
	} );

	test( 'writes, saves and reloads a message with a link', async ( {
		page,
	} ) => {
		await page.goto( messagesUrl( eventDateId ) );

		const messagesTab = page.getByRole( 'tab', { name: /^Messages/ } );
		await expect( messagesTab ).toHaveAttribute( 'aria-selected', 'true' );

		// The classic editor mounts with its visual and code views.
		const visual = page
			.frameLocator(
				'#fair-events-booking-message-' + eventDateId + '_ifr'
			)
			.locator( 'body' );
		await expect( visual ).toBeVisible();

		// Write HTML in the code view, then return to the visual view.
		await page
			.locator( `#fair-events-booking-message-${ eventDateId }-html` )
			.click();
		await page
			.locator( `#fair-events-booking-message-${ eventDateId }` )
			.fill(
				'<p>Doors open at 9. <a href="https://example.com/venue">Venue details</a></p>'
			);
		await page
			.locator( `#fair-events-booking-message-${ eventDateId }-tmce` )
			.click();
		await expect(
			visual.getByRole( 'link', { name: 'Venue details' } )
		).toBeVisible();

		// Typing in the visual view marks the tab as unsaved.
		await visual.click();
		await page.keyboard.press( 'Control+End' );
		await page.keyboard.press( 'Enter' );
		await page.keyboard.type( 'See you there.' );
		await expect( messagesTab ).toHaveText( 'Messages •' );

		await page.getByRole( 'button', { name: 'Save message' } ).click();
		await expect(
			page.locator( '.components-notice__content', {
				hasText:
					'Message saved. It will be added to confirmation emails for new bookings.',
			} )
		).toBeVisible();
		await expect( messagesTab ).toHaveText( 'Messages' );

		await page.reload();
		await expect(
			visual.getByRole( 'link', { name: 'Venue details' } )
		).toHaveAttribute( 'href', 'https://example.com/venue' );
		await expect( visual ).toContainText( 'See you there.' );

		const saved = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/booking-message`,
		} );
		expect( saved.message ).toContain(
			'<a href="https://example.com/venue">Venue details</a>'
		);
		expect( saved.message ).toContain( '<p>See you there.</p>' );
	} );
} );
