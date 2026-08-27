import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

test( 'a new event post can recover event data without saving or reloading', async ( {
	page,
} ) => {
	test.setTimeout( 60_000 );
	await login( page );

	await page.addInitScript( () => {
		Object.defineProperty( window, 'fairEventsMetaBox', {
			configurable: true,
			set( value ) {
				Object.defineProperty( window, 'fairEventsMetaBox', {
					configurable: true,
					writable: true,
					value: { ...value, eventDateId: 0 },
				} );
			},
		} );
	} );

	let lookupCount = 0;
	await page.route(
		'**/wp-json/fair-events/v1/event-dates?event_id=*',
		( route ) => {
			lookupCount += 1;
			return route.fulfill( {
				status: 200,
				contentType: 'application/json',
				body: '[]',
			} );
		}
	);

	await page.goto( '/wp-admin/post-new.php?post_type=fair_event' );
	const createButton = page.getByRole( 'button', {
		name: 'Create New Event',
	} );
	await expect( createButton ).toBeVisible( { timeout: 10_000 } );
	await expect.poll( () => lookupCount ).toBe( 3 );

	await createButton.click();
	await expect(
		page.getByRole( 'button', { name: 'Save Event' } )
	).toBeVisible();
	await page.unroute( '**/wp-json/fair-events/v1/event-dates?event_id=*' );

	const linkedIds = await page.evaluate( async () => {
		const postId = window.wp.data
			.select( 'core/editor' )
			.getCurrentPostId();
		const eventDates = await window.wp.apiFetch( {
			path: `/fair-events/v1/event-dates?event_id=${ postId }`,
		} );
		return { postId, eventDateId: eventDates[ 0 ].id };
	} );

	await page.reload();
	await expect(
		page.getByRole( 'button', { name: 'Save Event' } )
	).toBeVisible();

	await page.evaluate( async ( ids ) => {
		await window.wp.apiFetch( {
			path: `/fair-events/v1/event-dates/${ ids.eventDateId }`,
			method: 'DELETE',
		} );
		await window.wp.apiFetch( {
			path: `/wp/v2/fair_event/${ ids.postId }?force=true`,
			method: 'DELETE',
		} );
	}, linkedIds );
} );
