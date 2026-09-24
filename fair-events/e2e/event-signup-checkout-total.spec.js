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

test( 'keeps one checkout total above the submit button in sync with selections', async ( {
	page,
	browser,
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
			title: `Checkout total e2e ${ Date.now() }`,
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
						name: 'Standard',
						activities_enabled: true,
						minimum_activities: 0,
						maximum_activities: null,
						recurrence_scope: 'single_instance',
					},
					{
						name: 'Volunteer',
						activities_enabled: true,
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 15 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 0 },
				],
				options: [ { name: 'Workshop', price: 5.5 } ],
				settings: {},
			},
		} );
		signupPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Checkout total page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
			},
		} );

		// An anonymous visitor, so no viewer-context personalization applies.
		const context = await browser.newContext( {
			baseURL: test.info().project.use.baseURL,
		} );
		const visitor = await context.newPage();
		await visitor.goto( `/?page_id=${ signupPage.id }` );

		const form = visitor.locator( '.fair-events-get-tickets-form' );
		const total = form.locator( '.fair-events-signup-checkout-total' );
		const amount = total.locator(
			'.fair-events-signup-checkout-total-amount'
		);
		const expectTotal = async ( value ) => {
			await expect( total ).toBeVisible();
			await expect( total ).toHaveAttribute( 'data-amount', value );
			await expect( total ).toHaveAttribute( 'data-currency', 'EUR' );
			await expect( amount ).toHaveText( `${ value } EUR` );
		};

		// Exactly one total, directly before the submit row; the old
		// contextual totals are gone.
		await expect( total ).toHaveCount( 1 );
		expect(
			await total.evaluate( ( el ) =>
				el.nextElementSibling.classList.contains( 'form-submit' )
			)
		).toBe( true );
		await expect(
			form.locator(
				'.fair-events-ticket-options-total, .fair-events-instance-picker-total'
			)
		).toHaveCount( 0 );

		// Paid default is shown on first paint, before any interaction.
		await expectTotal( '15.00' );

		await visitor.getByLabel( 'Workshop' ).check();
		await expectTotal( '20.50' );

		await visitor.getByLabel( /Volunteer/ ).check();
		await expectTotal( '5.50' );

		await visitor.getByLabel( 'Workshop' ).uncheck();
		await expectTotal( '0.00' );

		// Persists while the visitor fills in the rest of the form.
		await form.locator( 'input[name="name"]' ).fill( 'Checkout Tester' );
		await form
			.locator( 'input[name="email"]' )
			.fill( 'checkout-total@example.test' );
		await visitor.getByLabel( /Standard/ ).check();
		await expectTotal( '15.00' );
		await expect( form.locator( 'button[type="submit"]' ) ).toBeVisible();

		await context.close();
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
