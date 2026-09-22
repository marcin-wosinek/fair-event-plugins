import { test, expect } from '@playwright/test';

/**
 * Verifies (#1622) that an organizer can create a venue inline from the
 * calendar's Quick Add Event form — without leaving the event workflow —
 * and that the newly created venue is selected and persisted with the
 * saved event.
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

test.describe( 'Calendar Quick Add — inline venue creation', () => {
	test( 'creates a venue inline while adding an event and saves the event with it selected', async ( {
		page,
	} ) => {
		test.setTimeout( 60_000 );

		const suffix = Date.now();
		const eventTitle = `E2E Inline Venue Event ${ suffix }`;
		const venueName = `E2E Inline Venue ${ suffix }`;

		let createdEventDateId;
		let createdVenueId;

		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-calendar' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		try {
			await page.getByRole( 'button', { name: 'Add event' } ).click();

			const modal = page.getByRole( 'dialog', {
				name: 'Quick Add Event',
			} );
			await expect( modal ).toBeVisible();

			await modal.getByLabel( 'Title' ).fill( eventTitle );

			await modal
				.getByLabel( 'Venue' )
				.selectOption( { label: 'Add new venue' } );

			await modal.getByLabel( 'Venue name' ).fill( venueName );
			await modal.getByLabel( 'Address' ).fill( 'Gran Via 1, Valencia' );
			await modal.getByRole( 'button', { name: 'Create venue' } ).click();

			// The inline form closes and the new venue is auto-selected.
			await expect( modal.getByLabel( 'Venue name' ) ).toHaveCount( 0 );
			const venueSelect = modal.getByLabel( 'Venue' );
			const newVenueValue = await venueSelect
				.locator( 'option', { hasText: venueName } )
				.getAttribute( 'value' );
			await expect( venueSelect ).toHaveValue( newVenueValue );

			await modal.getByRole( 'button', { name: 'Create Event' } ).click();

			await expect(
				page
					.locator( '#fair-events-calendar-root' )
					.getByText( `Event "${ eventTitle }" created.` )
			).toBeVisible();

			const venues = await apiFetch( page, {
				path: '/fair-events/v1/venues',
			} );
			const createdVenue = venues.find( ( v ) => v.name === venueName );
			expect( createdVenue ).toBeTruthy();
			createdVenueId = createdVenue.id;

			const manageLink = page.getByRole( 'link', {
				name: 'Manage Event',
			} );
			const manageHref = await manageLink.getAttribute( 'href' );
			createdEventDateId = new URL(
				manageHref,
				'http://example.test'
			).searchParams.get( 'event_date_id' );
			expect( createdEventDateId ).toBeTruthy();

			const eventDate = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ createdEventDateId }`,
			} );
			expect( eventDate.venue_id ).toBe( createdVenueId );
		} finally {
			if ( createdEventDateId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ createdEventDateId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			if ( createdVenueId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/venues/${ createdVenueId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
	} );
} );
