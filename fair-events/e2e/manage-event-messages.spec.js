/**
 * E2E: the Manage Event Messages tab (#2126). An organizer writes a booking
 * confirmation message with a link in the classic editor, sees the tab
 * marked as unsaved, saves it, and finds it again after reloading the page.
 * Saving from the Code view captures quicktag edits that fire no input event,
 * and the editor keeps working after switching to another tab and back
 * (#2232).
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

	test( 'saves Code-view edits and keeps editing after a tab switch', async ( {
		page,
	} ) => {
		const id = `fair-events-booking-message-${ eventDateId }`;
		const code = page.locator( `#${ id }` );
		const visual = page.frameLocator( `#${ id }_ifr` ).locator( 'body' );
		const saveButton = page.getByRole( 'button', { name: 'Save message' } );
		const savedNotice = page.locator( '.components-notice__content', {
			hasText:
				'Message saved. It will be added to confirmation emails for new bookings.',
		} );
		const readSaved = async () =>
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDateId }/booking-message`,
				} )
			).message;

		await page.goto( messagesUrl( eventDateId ) );
		await expect( visual ).toBeVisible();

		// Write in the Code view, then bold a word with the quicktag, which
		// changes the textarea without an input event, and save from there.
		await page.locator( `#${ id }-html` ).click();
		await code.fill( '<p>Bring water.</p>' );
		await code.evaluate( ( el ) => el.setSelectionRange( 9, 14 ) );
		await page.locator( `#qt_${ id }_strong` ).click();
		await expect( code ).toHaveValue(
			'<p>Bring <strong>water</strong>.</p>'
		);
		await saveButton.click();
		await expect( savedNotice ).toBeVisible();
		expect( await readSaved() ).toContain( '<strong>water</strong>' );

		// The saved message comes back after reloading.
		await page.reload();
		await page.locator( `#${ id }-tmce` ).click();
		await expect( visual.locator( 'strong' ) ).toHaveText( 'water' );

		// Another tab unmounts the editor; returning mounts a working one.
		await page.getByRole( 'tab', { name: /^Statistics/ } ).click();
		await expect( page.locator( `#${ id }` ) ).toHaveCount( 0 );
		await page.getByRole( 'tab', { name: /^Messages/ } ).click();
		await expect( visual.locator( 'strong' ) ).toHaveText( 'water' );
		await visual.click();
		await page.keyboard.press( 'Control+End' );
		await page.keyboard.press( 'Enter' );
		await page.keyboard.type( 'And a hat.' );
		await expect(
			page.getByRole( 'tab', { name: /^Messages/ } )
		).toHaveText( 'Messages •' );
		await saveButton.click();
		await expect( savedNotice ).toBeVisible();

		const saved = await readSaved();
		expect( saved ).toContain( '<strong>water</strong>' );
		expect( saved ).toContain( '<p>And a hat.</p>' );
	} );
} );
