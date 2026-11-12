/**
 * E2E: a registrant gives a name and an optional surname, which survive a
 * rejected checkout, and the organizer sees and edits them on the List
 * (#2215).
 *
 * Storage, compatibility and idempotency are covered by
 * GetTicketsSurname.api.spec.js.
 */

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

const isPurchase = ( response ) =>
	response.request().method() === 'POST' &&
	/get-tickets(\?|$)/.test( decodeURIComponent( response.url() ) );

test( 'a registrant’s name and surname survive a rejected checkout and the organizer edits them', async ( {
	page,
	browser,
} ) => {
	test.setTimeout( 120_000 );
	const baseURL = test.info().project.use.baseURL;
	const email = `surname-e2e-${ Date.now() }@example.test`;

	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const eventDate = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Surname e2e ${ Date.now() }`,
			start_date: '2039-03-01',
			start_time: '10:00:00',
			end_date: '2039-03-01',
			end_time: '12:00:00',
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
				title: `Surname page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
			},
		} );

		const context = await browser.newContext( { baseURL } );
		contexts.push( context );
		const visitor = await context.newPage();
		await visitor.goto( `/?page_id=${ signupPage.id }` );

		const form = visitor.locator( '.fair-events-get-tickets-form' );
		const submit = form.locator( 'button[type="submit"]' );
		const nameField = form.getByLabel( 'Your Name' );
		const surnameField = form.getByLabel( /Surname/ );
		await expect( surnameField ).toHaveAttribute(
			'autocomplete',
			'family-name'
		);
		await expect( surnameField ).not.toHaveAttribute( 'required', '' );
		await nameField.fill( 'María José' );
		await surnameField.fill( 'García de la Vega' );
		await form.getByLabel( 'Your Email' ).fill( email );
		await visitor.getByLabel( /Front row/ ).check();

		// Someone else takes the front row first.
		const other = await browser.newContext( { baseURL } );
		contexts.push( other );
		const taken = await other.request.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDate.id,
					ticket_type_id: frontRowId,
					name: 'Faster Buyer',
					email: `surname-e2e-other-${ Date.now() }@example.test`,
					quantity: 1,
					_honeypot: '',
				},
			}
		);
		expect( taken.ok(), await taken.text() ).toBeTruthy();

		const [ rejected ] = await Promise.all( [
			visitor.waitForResponse( isPurchase ),
			submit.click(),
		] );
		expect( rejected.status() ).toBe( 409 );
		await expect(
			visitor.locator( '.fair-events-get-tickets-message-error' )
		).toBeVisible();
		await expect( nameField ).toHaveValue( 'María José' );
		await expect( surnameField ).toHaveValue( 'García de la Vega' );

		await visitor.getByLabel( /Standing/ ).check();
		const [ accepted ] = await Promise.all( [
			visitor.waitForResponse( isPurchase ),
			submit.click(),
		] );
		expect( accepted.status(), await accepted.text() ).toBe( 200 );
		const sent = accepted.request().postDataJSON();
		expect( sent ).toMatchObject( {
			name: 'María José',
			surname: 'García de la Vega',
		} );

		// The organizer sees the complete name and edits its parts.
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDate.id }&tab=list`
		);
		const row = page
			.locator( 'tr.fair-events-signups__ticket' )
			.filter( { hasText: 'María José García de la Vega' } );
		await expect( row ).toBeVisible();

		await row.getByRole( 'button', { name: 'Edit name' } ).click();
		const dialog = page.getByRole( 'dialog' );
		await expect(
			dialog.getByLabel( 'Name', { exact: true } )
		).toHaveValue( 'María José' );
		await dialog.getByLabel( 'Surname (optional)' ).fill( 'García' );
		await dialog.getByRole( 'button', { name: 'Save name' } ).click();
		await expect( dialog ).toBeHidden();

		await expect(
			page
				.locator( 'tr.fair-events-signups__ticket' )
				.filter( { hasText: 'María José García' } )
		).toBeVisible();
		await expect(
			page.locator( 'tr.fair-events-signups__ticket', {
				hasText: 'García de la Vega',
			} )
		).toHaveCount( 0 );

		const signup = (
			await apiFetch( page, {
				path: `/fair-events/v1/get-tickets?event_date=${ eventDate.id }`,
			} )
		).find( ( row2 ) => row2.email === email );
		expect( signup ).toMatchObject( {
			name: 'María José',
			surname: 'García',
			full_name: 'María José García',
		} );
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
