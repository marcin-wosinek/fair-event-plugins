import { test, expect } from '@playwright/test';

/**
 * Verifies (#2143) the calendar's Quick Add "From URL" flow end to end:
 * lookup → review → save. The lookup response is routed to a fixed payload
 * so the test doesn't depend on a live Oona page; the server-side extraction
 * is covered by the PHPUnit and API specs.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

const OONA_URL =
	'https://oona.es/evento/emuna-yoga-expande-martes-y-jueves-4d79e226';

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

async function routeLookup( page, payload ) {
	await page.route( /lookup-url/, ( route ) =>
		route.fulfill( {
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify( payload ),
		} )
	);
}

async function lookUp( page, url ) {
	await page.getByRole( 'button', { name: 'Add event' } ).click();
	const modal = page.getByRole( 'dialog', { name: 'Quick Add Event' } );
	await expect( modal ).toBeVisible();

	await modal.getByRole( 'radio', { name: 'From URL' } ).click();
	await modal.getByLabel( 'Event page URL' ).fill( url );
	await modal.getByRole( 'button', { name: 'Look up' } ).click();
	await expect( modal.getByLabel( 'Title' ) ).toBeVisible();
	return modal;
}

async function createdEventDateId( page ) {
	const href = await page
		.getByRole( 'link', { name: 'Manage Event' } )
		.getAttribute( 'href' );
	return new URL( href, 'http://example.test' ).searchParams.get(
		'event_date_id'
	);
}

test.describe( 'Calendar Quick Add — From URL lookup', () => {
	test.beforeEach( async ( { page } ) => {
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-calendar' );
		await page.waitForFunction( () => window.wp?.apiFetch );
	} );

	test( 'prefills an Oona event for review and saves the edited values', async ( {
		page,
	} ) => {
		const title = `E2E Oona Lookup ${ Date.now() }`;
		await routeLookup( page, {
			title,
			start_date: '2026-11-02',
			start_time: '08:45:00',
			end_date: '2026-11-02',
			end_time: '10:00:00',
			all_day: false,
			location: 'Valencia, España',
			source: 'schema',
			timing_ambiguous: false,
			found: [ 'title', 'start', 'end', 'location' ],
		} );

		let eventDateId;
		try {
			const modal = await lookUp( page, OONA_URL );

			await expect( modal.getByLabel( 'Title' ) ).toHaveValue( title );
			await expect( modal.getByLabel( 'Start date' ) ).toHaveValue(
				'2026-11-02'
			);
			await expect(
				modal.getByLabel( 'Start time (optional)' )
			).toHaveValue( '08:45' );
			await expect(
				modal.getByLabel( 'End time (optional)' )
			).toHaveValue( '10:00' );
			await expect(
				modal.getByText( 'From the page: Valencia, España' )
			).toBeVisible();

			// Correct a value before saving.
			await modal.getByLabel( 'End time (optional)' ).fill( '10:15' );
			await modal.getByRole( 'button', { name: 'Create Event' } ).click();

			await expect(
				page
					.locator( '#fair-events-calendar-root' )
					.getByText( `Event "${ title }" created.` )
			).toBeVisible();
			eventDateId = await createdEventDateId( page );

			const eventDate = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
			} );
			expect( eventDate ).toMatchObject( {
				start_date: '2026-11-02',
				start_time: '08:45:00',
				end_time: '10:15:00',
				link_type: 'external',
				external_url: OONA_URL,
			} );
		} finally {
			if ( eventDateId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDateId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
	} );

	test( 'requires a manually entered date when the page lists several sessions', async ( {
		page,
	} ) => {
		const title = `E2E Several Sessions ${ Date.now() }`;
		await routeLookup( page, {
			title,
			start_date: null,
			start_time: null,
			end_date: null,
			end_time: null,
			all_day: false,
			location: null,
			source: 'schema',
			timing_ambiguous: true,
			found: [ 'title' ],
		} );

		let eventDateId;
		try {
			const modal = await lookUp( page, 'https://example.com/course' );

			await expect(
				modal.getByText( /This page lists several sessions/ )
			).toBeVisible();
			await expect( modal.getByLabel( 'Start date' ) ).toHaveValue( '' );
			await expect(
				modal.getByRole( 'button', { name: 'Create Event' } )
			).toBeDisabled();

			await modal.getByLabel( 'Start date' ).fill( '2026-11-05' );
			await modal.getByLabel( 'Start time (optional)' ).fill( '09:00' );
			await modal.getByRole( 'button', { name: 'Create Event' } ).click();

			await expect(
				page
					.locator( '#fair-events-calendar-root' )
					.getByText( `Event "${ title }" created.` )
			).toBeVisible();
			eventDateId = await createdEventDateId( page );

			const eventDate = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
			} );
			expect( eventDate ).toMatchObject( {
				start_date: '2026-11-05',
				start_time: '09:00:00',
				end_time: null,
			} );
		} finally {
			if ( eventDateId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDateId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
	} );
} );
