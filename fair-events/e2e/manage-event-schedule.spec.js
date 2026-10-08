/**
 * E2E: an organizer enables the workshop schedule in Prices, plans two
 * parallel workshops and a break in the Schedule tab, and finds them again
 * after a reload (#1767). A workshop marked Not bookable leaves the public
 * signup form, a rejected save keeps what was typed, and unsaved edits are
 * marked on the tab, survive a tab switch and warn before the page is left.
 * The editor stays usable at mobile width.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return {
				ok: false,
				error: { code: error?.code, message: error?.message },
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

test.describe( 'Manage Event — workshop schedule', () => {
	test.describe.configure( { mode: 'serial' } );
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupPageId;
	const stamp = Date.now();

	const manageUrl = ( tab ) =>
		`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=${ tab }`;
	const tab = ( page, name ) => page.getByRole( 'tab', { name } );
	const entry = ( page, name ) =>
		page
			.locator( '.fair-events-schedule-entry' )
			.filter( { has: page.getByRole( 'heading', { name } ) } );
	const entryNames = ( page ) =>
		page.locator( '.fair-events-schedule-entry h3' ).allInnerTexts();
	const addWorkshop = async ( page, name ) => {
		await page
			.getByRole( 'button', { name: 'Add a workshop from Prices' } )
			.click();
		await page.getByRole( 'menuitem', { name } ).click();
		await expect( entry( page, name ) ).toBeVisible();
	};
	const saveSchedule = async ( page ) => {
		await page.getByRole( 'button', { name: 'Save schedule' } ).click();
		await expect(
			page.locator( '.components-notice' ).getByText( 'Schedule saved.' )
		).toBeVisible();
	};
	const signupFormAddons = async ( browser ) => {
		const visitor = await browser.newContext();
		const page = await visitor.newPage();
		await page.goto( `/?page_id=${ signupPageId }` );
		const inputs = page.locator(
			'.fair-events-get-tickets-form input[name="ticket_option_ids[]"]'
		);
		await expect( inputs.first() ).toBeVisible();
		const names = await inputs.evaluateAll( ( all ) =>
			all.map( ( input ) => input.closest( 'label' ).textContent.trim() )
		);
		await visitor.close();
		return names;
	};

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );

		const title = `Schedule e2e ${ stamp }`;
		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title,
				link_type: 'post',
				start_datetime: '2039-05-14 09:00:00',
				end_datetime: '2039-05-15 18:00:00',
			},
		} );
		eventDateId = eventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Standard',
						capacity: null,
						activities_enabled: true,
						minimum_activities: 0,
						maximum_activities: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
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
				],
				options: [ 'Acro', 'Handstands', 'Juggling' ].map(
					( name ) => ( {
						name,
						price: 0,
						capacity: null,
					} )
				),
				settings: {},
			},
		} );

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Schedule page ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;
	} );

	test.afterAll( async () => {
		adminPage.on( 'dialog', ( dialog ) => dialog.accept() );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	test( 'the Schedule tab appears once it is enabled in Prices', async () => {
		const page = adminPage;
		await page.goto( manageUrl( 'prices' ) );
		await expect( tab( page, 'Prices' ) ).toBeVisible();
		await expect( tab( page, 'Schedule' ) ).toHaveCount( 0 );

		await page
			.getByRole( 'button', { name: 'More options', exact: true } )
			.click();
		await page.getByLabel( 'Workshop schedule' ).check();
		// Not until it is saved.
		await expect( tab( page, 'Schedule' ) ).toHaveCount( 0 );

		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();
		await expect( tab( page, 'Schedule' ) ).toBeVisible();

		await tab( page, 'Schedule' ).click();
		await expect( page ).toHaveURL( /tab=schedule/ );
		await expect(
			page.getByText( 'Nothing is scheduled yet.' )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Save schedule' } )
		).toBeDisabled();
		await expect( page.getByText( 'No unsaved changes.' ) ).toBeVisible();
	} );

	test( 'parallel workshops and a break are saved and found again after a reload', async ( {
		browser,
	} ) => {
		const page = adminPage;
		await page.goto( manageUrl( 'schedule' ) );

		await addWorkshop( page, 'Acro' );
		// A new entry starts when the event does.
		await expect(
			entry( page, 'Acro' ).getByLabel( 'Start date' )
		).toHaveValue( '2039-05-14' );
		await expect(
			entry( page, 'Acro' ).getByLabel( 'Start time' )
		).toHaveValue( '09:00' );
		await entry( page, 'Acro' ).getByLabel( 'Start time' ).fill( '10:00' );
		await entry( page, 'Acro' ).getByLabel( 'End time' ).fill( '11:30' );
		await entry( page, 'Acro' )
			.getByLabel( 'Room or location' )
			.fill( 'Main hall' );
		await entry( page, 'Acro' )
			.getByLabel( 'Description' )
			.fill( 'Bring a partner.' );

		await addWorkshop( page, 'Handstands' );
		await entry( page, 'Handstands' )
			.getByLabel( 'Start time' )
			.fill( '10:30' );
		await entry( page, 'Handstands' )
			.getByLabel( 'End time' )
			.fill( '12:00' );
		await entry( page, 'Handstands' )
			.getByLabel( 'Room or location' )
			.fill( 'Studio 2' );
		await entry( page, 'Handstands' )
			.getByLabel( 'Booking' )
			.selectOption( 'Not bookable' );

		await page.getByRole( 'button', { name: 'Add schedule item' } ).click();
		const untitled = entry( page, '(untitled item)' );
		await untitled
			.getByRole( 'textbox', { name: 'Title' } )
			.fill( 'Lunch break' );
		const lunch = entry( page, 'Lunch break' );
		await lunch.getByLabel( 'Start time' ).fill( '13:00' );
		await lunch.getByLabel( 'End time' ).fill( '14:00' );
		// A schedule item is never bookable, and says why.
		await expect( lunch.getByLabel( 'Booking' ) ).toBeDisabled();
		await expect( lunch.getByLabel( 'Booking' ) ).toHaveValue(
			'not-bookable'
		);
		await expect(
			lunch.getByText( 'A schedule item is never a ticket choice.' )
		).toBeVisible();

		// Overlap is information, not an error.
		await expect(
			entry( page, 'Acro' ).getByText(
				'Runs at the same time as Handstands (Studio 2).'
			)
		).toBeVisible();
		await expect( tab( page, 'Schedule •' ) ).toBeVisible();

		await saveSchedule( page );
		await expect( tab( page, 'Schedule', { exact: true } ) ).toBeVisible();
		await expect( tab( page, 'Schedule •' ) ).toHaveCount( 0 );

		await page.reload();
		await expect( entry( page, 'Acro' ) ).toBeVisible();
		expect( await entryNames( page ) ).toEqual( [
			'Acro',
			'Handstands',
			'Lunch break',
		] );
		const acro = entry( page, 'Acro' );
		await expect( acro.getByLabel( 'Start date' ) ).toHaveValue(
			'2039-05-14'
		);
		await expect( acro.getByLabel( 'Start time' ) ).toHaveValue( '10:00' );
		await expect( acro.getByLabel( 'End time' ) ).toHaveValue( '11:30' );
		await expect( acro.getByLabel( 'Room or location' ) ).toHaveValue(
			'Main hall'
		);
		await expect( acro.getByLabel( 'Description' ) ).toHaveValue(
			'Bring a partner.'
		);
		await expect( acro.getByLabel( 'Booking' ) ).toHaveValue( 'bookable' );
		await expect(
			entry( page, 'Handstands' ).getByLabel( 'Booking' )
		).toHaveValue( 'not-bookable' );
		await expect(
			entry( page, 'Lunch break' ).getByLabel( 'Start time' )
		).toHaveValue( '13:00' );

		// The not-bookable workshop and the break are not ticket choices.
		expect( await signupFormAddons( browser ) ).toEqual( [
			'Acro',
			'Juggling',
		] );
	} );

	test( 'a rejected save marks the field and keeps what was typed', async () => {
		const page = adminPage;
		await page.goto( manageUrl( 'schedule' ) );
		const acro = entry( page, 'Acro' );
		await expect( acro ).toBeVisible();

		await acro.getByLabel( 'Room or location' ).fill( 'Garden' );
		await acro.getByLabel( 'End time' ).fill( '09:15' );
		await page.getByRole( 'button', { name: 'Save schedule' } ).click();

		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'The schedule was not saved.' )
		).toBeVisible();
		await expect(
			acro.getByText( 'The end must be after the start.' )
		).toBeVisible();
		await expect( acro.getByLabel( 'Room or location' ) ).toHaveValue(
			'Garden'
		);
		await expect( acro.getByLabel( 'End time' ) ).toHaveValue( '09:15' );
		await expect( tab( page, 'Schedule •' ) ).toBeVisible();

		// The server refuses the same thing, and the entries stay as typed.
		await page.route( '**/schedule*', ( route ) =>
			route.request().method() === 'PUT' ||
			route.request().method() === 'POST'
				? route.fulfill( {
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify( {
							code: 'schedule_save_failed',
							message:
								'The schedule could not be saved. Nothing was changed.',
							data: { status: 500 },
						} ),
				  } )
				: route.fallback()
		);
		await acro.getByLabel( 'End time' ).fill( '11:45' );
		await expect(
			acro.getByText( 'The end must be after the start.' )
		).toHaveCount( 0 );
		await page.getByRole( 'button', { name: 'Save schedule' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'The schedule could not be saved.' )
		).toBeVisible();
		await expect( acro.getByLabel( 'Room or location' ) ).toHaveValue(
			'Garden'
		);
		await page.unroute( '**/schedule*' );

		// Unsaved edits survive a visit to another tab.
		await tab( page, 'Event Details' ).click();
		await expect(
			page.getByRole( 'textbox', { name: 'Title', exact: true } )
		).toBeVisible();
		await tab( page, 'Schedule •' ).click();
		await expect(
			entry( page, 'Acro' ).getByLabel( 'Room or location' )
		).toHaveValue( 'Garden' );
		await expect(
			entry( page, 'Acro' ).getByLabel( 'End time' )
		).toHaveValue( '11:45' );

		// Leaving the page with unsaved edits asks first.
		let warned = false;
		page.once( 'dialog', async ( dialog ) => {
			warned = dialog.type() === 'beforeunload';
			await dialog.dismiss();
		} );
		await page
			.goto( '/wp-admin/admin.php?page=fair-events-all-events' )
			.catch( () => {} );
		expect( warned ).toBe( true );
		await expect( page ).toHaveURL( /tab=schedule/ );

		await saveSchedule( page );
		await page.reload();
		await expect(
			entry( page, 'Acro' ).getByLabel( 'Room or location' )
		).toHaveValue( 'Garden' );
	} );

	test( 'removing an entry asks first and the editor works at mobile width', async () => {
		const page = adminPage;
		await page.setViewportSize( { width: 375, height: 812 } );
		await page.goto( manageUrl( 'schedule' ) );
		const handstands = entry( page, 'Handstands' );
		await expect( handstands ).toBeVisible();

		// Nothing is cut off sideways.
		const overflow = await page.evaluate(
			() =>
				document.querySelector( '.fair-events-schedule' ).scrollWidth -
				document.querySelector( '.fair-events-schedule' ).clientWidth
		);
		expect( overflow ).toBeLessThanOrEqual( 1 );

		await page.getByRole( 'button', { name: 'Remove Handstands' } ).click();
		const dialog = page.getByRole( 'dialog' );
		await expect(
			dialog.getByText( 'Once you save, it can be booked again' )
		).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( handstands ).toBeVisible();

		await page
			.getByRole( 'button', { name: 'Remove Lunch break' } )
			.click();
		await page
			.getByRole( 'dialog' )
			.getByRole( 'button', { name: 'Remove from schedule' } )
			.click();
		await expect( entry( page, 'Lunch break' ) ).toHaveCount( 0 );

		await saveSchedule( page );
		await page.reload();
		await expect( entry( page, 'Handstands' ) ).toBeVisible();
		expect( await entryNames( page ) ).toEqual( [ 'Acro', 'Handstands' ] );
		await page.setViewportSize( { width: 1200, height: 900 } );
	} );
} );
