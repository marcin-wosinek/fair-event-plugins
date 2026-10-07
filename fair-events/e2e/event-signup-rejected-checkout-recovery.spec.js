/**
 * E2E: a buyer whose checkout keeps being rejected can still complete one
 * with the same email (#1769). Rejections that create no signup use up none
 * of the email's allowance, however many there are.
 *
 * The thresholds, windows and counting points are covered by
 * GetTicketsRateLimit.api.spec.js.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

// More than the ten checkouts an email may start within its window.
const REJECTIONS = 11;

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

const isPurchase = ( response ) =>
	response.request().method() === 'POST' &&
	/get-tickets(\?|$)/.test( decodeURIComponent( response.url() ) );

test( 'a buyer completes a checkout with the same email after repeated rejections', async ( {
	page,
	browser,
} ) => {
	test.setTimeout( 120_000 );
	const baseURL = test.info().project.use.baseURL;
	const email = `rejected-recovery-${ Date.now() }@example.test`;

	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const eventDate = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Rejected checkout e2e ${ Date.now() }`,
			start_datetime: '2039-02-01 10:00:00',
			end_datetime: '2039-02-01 12:00:00',
		},
	} );
	let signupPage;
	const contexts = [];
	try {
		const tickets = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Front row',
						capacity: 1,
						minimum_activities: 0,
						recurrence_scope: 'single_instance',
					},
					{
						name: 'Standing',
						capacity: null,
						minimum_activities: 0,
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
				options: [],
				settings: {},
			},
		} );
		const frontRowId = tickets.ticket_types.find(
			( type ) => type.name === 'Front row'
		).id;
		signupPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Rejected checkout page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
			},
		} );

		// The buyer opens the form while the front row still has its place.
		const context = await browser.newContext( { baseURL } );
		contexts.push( context );
		const visitor = await context.newPage();
		await visitor.goto( `/?page_id=${ signupPage.id }` );

		const form = visitor.locator( '.fair-events-get-tickets-form' );
		const submit = form.locator( 'button[type="submit"]' );
		await form.locator( 'input[name="name"]' ).fill( 'Rejected Buyer' );
		await form.locator( 'input[name="email"]' ).fill( email );
		await visitor.getByLabel( /Front row/ ).check();
		await expect( submit ).toBeEnabled();

		// Someone else takes it first.
		const other = await browser.newContext( { baseURL } );
		contexts.push( other );
		const taken = await other.request.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDate.id,
					ticket_type_id: frontRowId,
					name: 'Faster Buyer',
					email: `rejected-recovery-other-${ Date.now() }@example.test`,
					quantity: 1,
					_honeypot: '',
				},
			}
		);
		expect( taken.ok(), await taken.text() ).toBeTruthy();

		// Every attempt at the taken place is refused and saves nothing.
		for ( let attempt = 1; attempt <= REJECTIONS; attempt++ ) {
			const [ response ] = await Promise.all( [
				visitor.waitForResponse( isPurchase ),
				submit.click(),
			] );
			expect( response.status(), `attempt ${ attempt }` ).toBe( 409 );
			await expect(
				visitor.locator( '.fair-events-get-tickets-message-error' )
			).toBeVisible();
			await expect( submit ).toBeEnabled();
		}

		// With another ticket type the same email checks out.
		await visitor.getByLabel( /Standing/ ).check();
		await expect( submit ).toBeEnabled();
		const [ accepted ] = await Promise.all( [
			visitor.waitForResponse( isPurchase ),
			submit.click(),
		] );
		expect( accepted.status(), await accepted.text() ).toBe( 200 );
		await expect(
			visitor.locator( '.fair-events-get-tickets-message-success' )
		).toContainText( 'successfully registered' );

		const signups = (
			await apiFetch( page, {
				path: `/fair-e2e/v1/checkout-keys?event_date_ids[]=${ eventDate.id }`,
			} )
		).signups.filter( ( signup ) => signup.email === email );
		expect( signups ).toHaveLength( 1 );
		expect( signups[ 0 ].status ).toBe( 'confirmed' );

		// One checkout was created, so one was counted.
		const counters = await apiFetch( page, {
			path: `/fair-e2e/v1/rate-limit?email=${ encodeURIComponent(
				email
			) }`,
		} );
		expect( counters.email.count ).toBe( 1 );
	} finally {
		for ( const context of contexts ) {
			await context.close();
		}
		const signups = await apiFetch( page, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDate.id }`,
		} ).catch( () => [] );
		for ( const signup of signups ) {
			await apiFetch( page, {
				path: `/fair-events/v1/get-tickets/${ signup.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
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
