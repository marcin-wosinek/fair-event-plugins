import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	return page.evaluate( async ( opts ) => {
		// eslint-disable-next-line no-undef
		return wp.apiFetch( opts );
	}, options );
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

async function submitSignup( browser, signupPageId, name, email, optedIn ) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto( `/?page_id=${ signupPageId }` );
	const form = page.locator( '.fair-events-get-tickets-form' );
	await expect( form ).toBeVisible();
	await form.locator( 'input[name="ticket_type_id"]' ).first().check();
	await form.locator( 'input[name="name"]' ).fill( name );
	await form.locator( 'input[name="email"]' ).fill( email );
	if ( optedIn ) {
		await form.locator( 'input[name="mailing_opt_in"]' ).check();
	}
	await form.locator( 'button[type="submit"]' ).click();
	await expect( page.getByRole( 'alert' ) ).toContainText(
		'You have successfully registered!'
	);
	await context.close();
}

test( 'mailing consent survives signup, display, and filtering', async ( {
	page,
	browser,
} ) => {
	test.setTimeout( 60_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp && window.wp.apiFetch );

	const unique = Date.now();
	const uncheckedEmail = `mailing-unchecked-${ unique }@example.test`;
	const checkedEmail = `mailing-checked-${ unique }@example.test`;
	let eventPost;
	let eventDate;
	let signupPage;
	let audienceDeactivated = false;

	try {
		await apiFetch( page, {
			path: '/wp/v2/plugins/fair-audience/fair-audience',
			method: 'PUT',
			data: { status: 'inactive' },
		} );
		audienceDeactivated = true;

		eventPost = await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Mailing consent e2e ${ unique }`,
				status: 'publish',
			},
		} );
		eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Mailing consent e2e ${ unique }`,
				link_type: 'post',
				start_datetime: '2036-01-01 10:00:00',
				end_datetime: '2036-01-01 12:00:00',
			},
		} );
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }`,
			method: 'PUT',
			data: { event_id: eventPost.id },
		} );
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Free admission',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Always available',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 0,
					},
				],
				settings: {},
			},
		} );
		signupPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Mailing consent signup ${ unique }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
			},
		} );

		await submitSignup(
			browser,
			signupPage.id,
			'Unchecked Mailing Signup',
			uncheckedEmail,
			false
		);
		await submitSignup(
			browser,
			signupPage.id,
			'Checked Mailing Signup',
			checkedEmail,
			true
		);

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDate.id }`
		);
		await page.getByRole( 'tab', { name: 'Signups' } ).click();
		const uncheckedRow = page.locator( 'tr', { hasText: uncheckedEmail } );
		const checkedRow = page.locator( 'tr', { hasText: checkedEmail } );
		await expect( uncheckedRow ).toContainText( 'No' );
		await expect( checkedRow ).toContainText( 'Yes' );

		await page
			.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
			.check();
		await expect( uncheckedRow ).toHaveCount( 0 );
		await expect( checkedRow ).toBeVisible();
	} finally {
		if ( eventDate ) {
			const signups = await apiFetch( page, {
				path: `/fair-events/v1/get-tickets?event_date=${ eventDate.id }`,
			} ).catch( () => [] );
			for ( const signup of signups ) {
				await apiFetch( page, {
					path: `/fair-events/v1/get-tickets/${ signup.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
		if ( signupPage ) {
			await apiFetch( page, {
				path: `/wp/v2/pages/${ signupPage.id }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( eventDate ) {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPost ) {
			await apiFetch( page, {
				path: `/wp/v2/fair_event/${ eventPost.id }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( audienceDeactivated ) {
			await apiFetch( page, {
				path: '/wp/v2/plugins/fair-audience/fair-audience',
				method: 'PUT',
				data: { status: 'active' },
			} ).catch( () => {} );
		}
	}
} );
