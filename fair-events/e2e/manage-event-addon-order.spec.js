/**
 * E2E: an organizer arranges add-ons in the "Reorder add-ons" popup of the
 * Prices tab (#1765). Dragging and the arrow buttons both move an add-on, the
 * editor follows at once, and nothing is saved until Save tickets. After a
 * reload the editor and the signup form show the saved order, and an earlier
 * signup keeps the add-on it picked. The popup also works by touch at mobile
 * width.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
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

test.describe( 'Manage Event — reorder add-ons in a popup', () => {
	test.describe.configure( { mode: 'serial' } );
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupPageId;
	let signupId;
	let hikeId;
	const stamp = Date.now();
	const buyerEmail = `addon-order-e2e-${ stamp }@example.test`;

	const editorUrl = () =>
		`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`;

	// The Add-ons panel starts collapsed.
	const openAddons = async ( page ) => {
		await page.goto( editorUrl() );
		await page
			.getByRole( 'button', { name: 'Add-ons', exact: true } )
			.click();
		await expect(
			page.getByPlaceholder( 'Add-on name' ).first()
		).toBeVisible();
	};
	const editorNames = ( page ) =>
		page
			.getByPlaceholder( 'Add-on name' )
			.evaluateAll( ( inputs ) => inputs.map( ( i ) => i.value ) );
	const openPopup = async ( page ) => {
		await page.getByRole( 'button', { name: 'Reorder add-ons' } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Reorder add-ons' } );
		await expect( dialog ).toBeVisible();
		// The popup slides in; row positions are only final once it rests.
		await ( await dialog.elementHandle() ).waitForElementState( 'stable' );
		return dialog;
	};
	const popupNames = ( dialog ) =>
		dialog.getByRole( 'listitem' ).allInnerTexts();
	const handleCentre = async ( dialog, name ) => {
		const box = await dialog
			.getByRole( 'listitem' )
			.filter( { hasText: name } )
			.locator( '.fair-events-reorder-addons__handle' )
			.boundingBox();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const rowBox = ( dialog, name ) =>
		dialog
			.getByRole( 'listitem' )
			.filter( { hasText: name } )
			.boundingBox();
	const saveTickets = async ( page ) => {
		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();
	};
	const signupFormAddons = async ( browser ) => {
		const visitor = await browser.newContext();
		const page = await visitor.newPage();
		await page.goto( `/?page_id=${ signupPageId }` );
		await expect(
			page
				.locator(
					'.fair-events-get-tickets-form input[name="ticket_option_ids[]"]'
				)
				.first()
		).toBeVisible();
		const names = await page
			.locator(
				'.fair-events-get-tickets-form input[name="ticket_option_ids[]"]'
			)
			.evaluateAll( ( inputs ) =>
				inputs.map( ( input ) =>
					input.closest( 'label' ).textContent.trim()
				)
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

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title: `Add-on order e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Add-on order e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2039-04-04 10:00:00',
				end_datetime: '2039-04-04 12:00:00',
			},
		} );
		eventDateId = eventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const tickets = await apiFetch( adminPage, {
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
				options: [ 'Yoga', 'Dinner', 'Hike', 'Sauna' ].map(
					( name ) => ( { name, price: 0, capacity: null } )
				),
				settings: {},
			},
		} );
		hikeId = Number( tickets.options[ 2 ].id );

		// An earlier signup that picked the add-on about to move, bought as
		// an anonymous visitor.
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const buyRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					_honeypot: '',
					event_date_id: eventDateId,
					name: `Addon order ${ stamp }`,
					email: buyerEmail,
					ticket_type_id: tickets.ticket_types[ 0 ].id,
					ticket_option_ids: [ hikeId ],
				},
			}
		);
		const buyBody = await buyRes.json();
		await visitor.dispose();
		expect( buyRes.status(), JSON.stringify( buyBody ) ).toBe( 200 );
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		signupId = signups.find( ( row ) => row.email === buyerEmail ).id;

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Add-on order page ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;
	} );

	test.afterAll( async () => {
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} ).catch( () => [] );
		for ( const row of signups ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets/${ row.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }?force=true`,
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

	test( 'drag and keyboard moves are saved by Save tickets and used by the signup form', async ( {
		browser,
	} ) => {
		const saveRequests = [];
		adminPage.on( 'request', ( req ) => {
			if (
				req.method() !== 'GET' &&
				/\/tickets(\?|$)/.test( req.url() )
			) {
				saveRequests.push( req.url() );
			}
		} );

		await openAddons( adminPage );
		expect( await editorNames( adminPage ) ).toEqual( [
			'Yoga',
			'Dinner',
			'Hike',
			'Sauna',
		] );

		const dialog = await openPopup( adminPage );
		expect( await popupNames( dialog ) ).toEqual( [
			'Yoga',
			'Dinner',
			'Hike',
			'Sauna',
		] );
		await expect(
			dialog.getByText( 'Save tickets to save this order.', {
				exact: false,
			} )
		).toBeVisible();

		// Drag Sauna from the bottom to the very top.
		const start = await handleCentre( dialog, 'Sauna' );
		const top = await rowBox( dialog, 'Yoga' );
		await adminPage.mouse.move( start.x, start.y );
		await adminPage.mouse.down();
		await adminPage.mouse.move( start.x, top.y + 2, { steps: 12 } );
		await adminPage.mouse.up();
		await expect
			.poll( () => popupNames( dialog ) )
			.toEqual( [ 'Sauna', 'Yoga', 'Dinner', 'Hike' ] );

		// Drag Yoga into the middle: below Dinner, above Hike.
		const yoga = await handleCentre( dialog, 'Yoga' );
		const dinner = await rowBox( dialog, 'Dinner' );
		await adminPage.mouse.move( yoga.x, yoga.y );
		await adminPage.mouse.down();
		await adminPage.mouse.move( yoga.x, dinner.y + dinner.height / 2 + 4, {
			steps: 8,
		} );
		await adminPage.mouse.up();
		await expect
			.poll( () => popupNames( dialog ) )
			.toEqual( [ 'Sauna', 'Dinner', 'Yoga', 'Hike' ] );

		// Keyboard: Hike up twice with the arrow button, without re-focusing.
		const hikeUp = dialog.getByRole( 'button', { name: 'Move Hike up' } );
		await hikeUp.focus();
		await adminPage.keyboard.press( 'Enter' );
		await expect( hikeUp ).toBeFocused();
		await adminPage.keyboard.press( 'Enter' );
		await expect( hikeUp ).toBeFocused();
		await expect
			.poll( () => popupNames( dialog ) )
			.toEqual( [ 'Sauna', 'Hike', 'Dinner', 'Yoga' ] );
		await expect( dialog.getByRole( 'status' ) ).toHaveText(
			'Hike moved to position 2 of 4.'
		);

		// Escape closes the popup, keeps the draft order, and saves nothing.
		await adminPage.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		expect( await editorNames( adminPage ) ).toEqual( [
			'Sauna',
			'Hike',
			'Dinner',
			'Yoga',
		] );
		expect( saveRequests ).toEqual( [] );
		expect( await signupFormAddons( browser ) ).toEqual( [
			'Yoga',
			'Dinner',
			'Hike',
			'Sauna',
		] );

		await saveTickets( adminPage );
		expect( saveRequests ).toHaveLength( 1 );

		// The editor and the popup reopen in the saved order.
		await openAddons( adminPage );
		expect( await editorNames( adminPage ) ).toEqual( [
			'Sauna',
			'Hike',
			'Dinner',
			'Yoga',
		] );
		expect( await popupNames( await openPopup( adminPage ) ) ).toEqual( [
			'Sauna',
			'Hike',
			'Dinner',
			'Yoga',
		] );

		// The signup form offers the add-ons in the saved order.
		expect( await signupFormAddons( browser ) ).toEqual( [
			'Sauna',
			'Hike',
			'Dinner',
			'Yoga',
		] );

		// The earlier signup still has the add-on it picked.
		const state = await apiFetch( adminPage, {
			path: `/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ signupId }`,
		} );
		expect(
			state.tickets.map( ( ticket ) =>
				ticket.activities.map( ( a ) => Number( a.ticket_option_id ) )
			)
		).toEqual( [ [ hikeId ] ] );
	} );

	test( 'the popup reorders by touch and stays usable at tablet and mobile widths', async ( {
		browser,
	} ) => {
		const context = await browser.newContext( {
			viewport: { width: 375, height: 812 },
			hasTouch: true,
			isMobile: true,
		} );
		const page = await context.newPage();
		await login( page );
		await openAddons( page );
		const before = await editorNames( page );
		const dialog = await openPopup( page );
		expect( await popupNames( dialog ) ).toEqual( before );

		// Every control is inside the viewport: no sideways scrolling.
		const fitsViewport = async () => {
			const width = page.viewportSize().width;
			const boxes = await dialog
				.locator(
					'.fair-events-reorder-addons__handle, li button, button:has-text("Done")'
				)
				.evaluateAll( ( nodes ) =>
					nodes.map( ( node ) => {
						const box = node.getBoundingClientRect();
						return [ box.left, box.right, box.width, box.height ];
					} )
				);
			expect( boxes ).toHaveLength( before.length * 3 + 1 );
			for ( const [ left, right, w, h ] of boxes ) {
				expect( left ).toBeGreaterThanOrEqual( 0 );
				expect( right ).toBeLessThanOrEqual( width );
				expect( w ).toBeGreaterThanOrEqual( 24 );
				expect( h ).toBeGreaterThanOrEqual( 24 );
			}
		};
		await fitsViewport();

		// Touch-drag the first add-on to the bottom.
		const from = await handleCentre( dialog, before[ 0 ] );
		const last = await rowBox( dialog, before[ before.length - 1 ] );
		const to = { x: from.x, y: last.y + last.height - 2 };
		const cdp = await context.newCDPSession( page );
		const touch = ( type, point ) =>
			cdp.send( 'Input.dispatchTouchEvent', {
				type,
				touchPoints: point ? [ { x: point.x, y: point.y } ] : [],
			} );
		await touch( 'touchStart', from );
		const steps = 12;
		for ( let step = 1; step <= steps; step++ ) {
			await touch( 'touchMove', {
				x: from.x,
				y: from.y + ( ( to.y - from.y ) * step ) / steps,
			} );
		}
		await touch( 'touchEnd' );

		const moved = [ ...before.slice( 1 ), before[ 0 ] ];
		await expect.poll( () => popupNames( dialog ) ).toEqual( moved );

		// The arrow buttons respond to a tap.
		await dialog
			.getByRole( 'button', { name: `Move ${ before[ 0 ] } up` } )
			.tap();
		const tapped = [
			...before.slice( 1, -1 ),
			before[ 0 ],
			before[ before.length - 1 ],
		];
		await expect.poll( () => popupNames( dialog ) ).toEqual( tapped );

		// Tablet width keeps the same controls reachable.
		await page.setViewportSize( { width: 768, height: 1024 } );
		await fitsViewport();
		await page.setViewportSize( { width: 375, height: 812 } );

		await dialog.getByRole( 'button', { name: 'Done' } ).tap();
		await expect( dialog ).toBeHidden();
		expect( await editorNames( page ) ).toEqual( tapped );

		await saveTickets( page );
		await openAddons( page );
		expect( await editorNames( page ) ).toEqual( tapped );
		await context.close();
	} );
} );
