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

test( 'shows one checkout total above the submit button only while it is enabled', async ( {
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
			start_date: '2039-01-01',
			start_time: '10:00:00',
			end_date: '2039-01-01',
			end_time: '12:00:00',
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
					{
						name: 'Supporter',
						activities_enabled: true,
						minimum_activities: 1,
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
					{ ticket_type_index: 2, sale_period_index: 0, price: 25 },
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

		// Hold viewer-context hydration back so the loading state is
		// observable: the server markup alone must keep the total hidden.
		let releaseViewerContext;
		const viewerContextHeld = new Promise( ( resolve ) => {
			releaseViewerContext = resolve;
		} );
		await visitor.route(
			/get-tickets(\/|%2F)viewer-context/,
			async ( route ) => {
				await viewerContextHeld;
				await route.continue();
			}
		);
		await visitor.goto( `/?page_id=${ signupPage.id }` );

		const form = visitor.locator( '.fair-events-get-tickets-form' );
		const submit = form.locator( 'button[type="submit"]' );
		const total = form.locator( '.fair-events-signup-checkout-total' );
		const amount = total.locator(
			'.fair-events-signup-checkout-total-amount'
		);
		const expectAmount = async ( value ) => {
			await expect( total ).toHaveAttribute( 'data-amount', value );
			await expect( total ).toHaveAttribute( 'data-currency', 'EUR' );
		};
		const expectTotal = async ( value ) => {
			await expect( submit ).toBeEnabled();
			await expect( total ).toBeVisible();
			await expectAmount( value );
			await expect( amount ).toHaveText( `${ value } EUR` );
		};
		const expectHiddenTotal = async ( value ) => {
			await expect( submit ).toBeDisabled();
			await expect( total ).toBeHidden();
			await expectAmount( value );
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

		// While the viewer's pricing is still loading the button is disabled
		// and no total is shown, but tracking can already read the baseline.
		await expectHiddenTotal( '15.00' );
		expect(
			await total.evaluate( ( el ) => el.getBoundingClientRect().height )
		).toBe( 0 );

		// Once loaded, the paid default appears with the enabled button.
		releaseViewerContext();
		await expectTotal( '15.00' );

		await visitor.getByLabel( 'Workshop' ).check();
		await expectTotal( '20.50' );

		await visitor.getByLabel( /Volunteer/ ).check();
		await expectTotal( '5.50' );

		await visitor.getByLabel( 'Workshop' ).uncheck();
		await expectTotal( '0.00' );

		// A ticket type whose required activity is not chosen disables the
		// button and hides the total, while the amount stays current.
		await visitor.getByLabel( /Supporter/ ).check();
		await expectHiddenTotal( '25.00' );

		await visitor.getByLabel( 'Workshop' ).check();
		await expectTotal( '30.50' );

		await visitor.getByLabel( 'Workshop' ).uncheck();
		await expectHiddenTotal( '25.00' );

		// Persists while the visitor fills in the rest of the form.
		await form.locator( 'input[name="name"]' ).fill( 'Checkout Tester' );
		await form
			.locator( 'input[name="email"]' )
			.fill( 'checkout-total@example.test' );
		await visitor.getByLabel( /Standard/ ).check();
		await expectTotal( '15.00' );

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

test( 'explains each series ticket’s dates and total, and buys the choice made last (#1768)', async ( {
	page,
	browser,
} ) => {
	test.setTimeout( 90_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const series = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Series coverage e2e ${ Date.now() }`,
			start_date: '2039-03-01',
			start_time: '18:00:00',
			end_date: '2039-03-01',
			end_time: '19:30:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
		},
	} );
	const [ first, second, third ] = [
		series.id,
		...series.generated_occurrences.map( ( occurrence ) => occurrence.id ),
	];
	let signupPage;
	try {
		const tickets = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ series.id }/tickets`,
			method: 'PUT',
			data: {
				capacity: 1,
				ticket_types: [
					{
						name: 'Drop-in',
						minimum_activities: 0,
						recurrence_scope: 'single_instance',
					},
					{
						name: 'Class pack',
						minimum_activities: 0,
						recurrence_scope: 'multiple_instances',
						minimum_instances: 2,
					},
					{
						name: 'Season pass',
						minimum_activities: 0,
						recurrence_scope: 'whole_series',
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 12 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 10 },
					{ ticket_type_index: 2, sale_period_index: 0, price: 40 },
				],
				settings: {},
			},
		} );
		// The second date's only place is held by a purchase awaiting payment.
		await apiFetch( page, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: second,
				ticket_type_id: tickets.ticket_types[ 0 ].id,
				name: 'Place Holder',
				email: `series-holder-${ Date.now() }@example.test`,
				quantity: 1,
				_honeypot: '',
			},
		} );
		signupPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Series coverage page ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ series.id }} /-->`,
			},
		} );

		const context = await browser.newContext( {
			baseURL: test.info().project.use.baseURL,
		} );
		const visitor = await context.newPage();
		await visitor.goto( `/?page_id=${ signupPage.id }` );

		const form = visitor.locator( '.fair-events-get-tickets-form' );
		const submit = form.locator( 'button[type="submit"]' );
		const total = form.locator( '.fair-events-signup-checkout-total' );
		const summary = form.locator( '.fair-events-signup-coverage-summary' );
		const heading = summary.locator(
			'.fair-events-signup-coverage-summary-heading'
		);
		const reason = summary.locator(
			'.fair-events-signup-coverage-summary-reason'
		);
		const dateBox = ( id ) =>
			form.locator( `input[name="event_date_ids[]"][value="${ id }"]` );

		// Each ticket says what it covers before it is chosen.
		const fieldset = form.locator( '.fair-events-ticket-fieldset' );
		await expect( fieldset ).toContainText( 'One date' );
		await expect( fieldset ).toContainText( 'Selected dates' );
		await expect( fieldset ).toContainText( 'Whole series' );
		await expect( fieldset ).toContainText( 'for the whole series' );

		// One date: the dropdown follows the ticket choices, the full date
		// is listed but can't be chosen.
		await expect( submit ).toBeEnabled();
		await expect( heading ).toHaveText( 'Drop-in covers 1 date:' );
		await expect( total ).toHaveAttribute( 'data-amount', '12.00' );
		const select = form.locator( 'select[name="event_date_id_single"]' );
		await expect( select ).toBeVisible();
		await expect(
			select.locator( `option[value="${ second }"]` )
		).toBeDisabled();
		await expect(
			select.locator( `option[value="${ second }"]` )
		).toContainText( 'full' );

		// Selected dates: the minimum is explained until it is met.
		await visitor.getByLabel( /Class pack/ ).check();
		await expect( reason ).toHaveText(
			'No dates selected yet. Choose at least 2 dates.'
		);
		await expect( total ).toBeHidden();
		await expect( submit ).toBeDisabled();
		await expect( dateBox( second ) ).toBeDisabled();
		await dateBox( first ).check();
		await expect( reason ).toHaveText(
			'Choose at least 2 dates to continue.'
		);
		await dateBox( third ).check();
		await expect( heading ).toHaveText( 'Class pack covers 2 dates:' );
		await expect( reason ).toBeHidden();
		await expect( total ).toHaveAttribute( 'data-amount', '20.00' );
		await expect( submit ).toBeEnabled();

		// Whole series: every covered date is listed, and the full one
		// blocks the purchase with its reason.
		await visitor.getByLabel( /Season pass/ ).check();
		await expect(
			form.locator( '.fair-events-series-coverage li' )
		).toHaveCount( 3 );
		await expect( heading ).toHaveText( 'Season pass covers 3 dates:' );
		await expect( reason ).toContainText( 'is full' );
		await expect( total ).toBeHidden();
		await expect( submit ).toBeDisabled();

		// Back to selected dates: the purchase is the one shown last.
		await visitor.getByLabel( /Class pack/ ).check();
		await dateBox( first ).check();
		await dateBox( third ).check();
		await expect( total ).toHaveAttribute( 'data-amount', '20.00' );
		await form.locator( 'input[name="name"]' ).fill( 'Series Buyer' );
		await form
			.locator( 'input[name="email"]' )
			.fill( `series-buyer-${ Date.now() }@example.test` );

		const purchase = visitor.waitForRequest(
			( req ) =>
				req.method() === 'POST' &&
				/get-tickets(\?|$|&)|get-tickets%2F?$|get-tickets$/.test(
					req.url().split( '?rest_route=' ).pop()
				) &&
				! /viewer-context/.test( req.url() )
		);
		await submit.click();
		const sent = JSON.parse( ( await purchase ).postData() );
		expect( sent ).toMatchObject( {
			ticket_type_id: tickets.ticket_types[ 1 ].id,
			event_date_ids: [ first, third ],
			quantity: 1,
		} );

		await context.close();
	} finally {
		if ( signupPage?.id ) {
			await apiFetch( page, {
				path: `/wp/v2/pages/${ signupPage.id }?force=true`,
				method: 'DELETE',
			} );
		}
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ series.id }`,
			method: 'DELETE',
		} );
	}
} );
