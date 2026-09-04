import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

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
	const result = await page.evaluate( async ( request ) => {
		try {
			return { data: await wp.apiFetch( request ) }; // eslint-disable-line no-undef
		} catch ( error ) {
			return { error: { code: error.code, message: error.message } };
		}
	}, options );
	if ( result.error ) {
		throw new Error( JSON.stringify( result.error ) );
	}
	return result.data;
}

test( 'switches between pick-your-extensions and full-pass tickets', async ( {
	page,
} ) => {
	test.setTimeout( 60_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
	await apiFetch( page, {
		path: '/wp/v2/plugins/fair-events-experimental/fair-events-experimental',
		method: 'PUT',
		data: { status: 'active' },
	} );

	const eventDate = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Extension rules e2e ${ Date.now() }`,
			start_datetime: '2039-01-01 10:00:00',
			end_datetime: '2039-01-01 12:00:00',
		},
	} );
	let signupPage;
	try {
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Pick your extensions',
						activities_enabled: true,
						minimum_activities: 1,
						maximum_activities: 1,
						recurrence_scope: 'single_instance',
					},
					{
						name: 'Full pass',
						activities_enabled: false,
						minimum_activities: 0,
						maximum_activities: null,
						recurrence_scope: 'single_instance',
					},
				],
				sale_periods: [
					{
						name: 'Always',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 0 },
				],
				options: [
					{ name: 'Workshop', price: 5 },
					{ name: 'Show', price: 7 },
				],
				settings: {},
			},
		} );
		signupPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Extension rules page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
			},
		} );

		await page.goto( `/?page_id=${ signupPage.id }` );
		const extensions = page.locator( '.fair-events-ticket-options' );
		await expect( extensions ).toBeVisible();
		const choices = extensions.locator( 'input[type="checkbox"]' );
		await choices.first().check();
		await expect( choices.nth( 1 ) ).toBeDisabled();
		await expect( extensions ).toContainText( 'at most 1 extension' );

		await page.getByLabel( 'Full pass' ).check();
		await expect( extensions ).toBeHidden();
		await expect( choices.first() ).not.toBeChecked();

		await page.getByLabel( 'Pick your extensions' ).check();
		await expect( extensions ).toBeVisible();
		await expect( page.locator( 'button[type="submit"]' ) ).toBeDisabled();
	} finally {
		if ( signupPage?.id ) {
			await apiFetch( page, {
				path: `/wp/v2/pages/${ signupPage.id }?force=true`,
				method: 'DELETE',
			} );
		}
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }`,
			method: 'DELETE',
		} );
	}
} );
