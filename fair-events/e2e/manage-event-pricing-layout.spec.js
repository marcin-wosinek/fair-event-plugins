/**
 * E2E: the Prices table keeps each ticket's extension rules and sales
 * deadline in a collapsed "Ticket settings" panel beneath its row (#2062).
 * Names and prices stay directly editable, settings edits survive
 * collapse/reopen and a reorder, everything is saved, and a wide table
 * scrolls inside its wrapper instead of the page.
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

test.describe( 'Manage Event — pricing editor layout', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventDateId;
	const stamp = Date.now();
	const longName = `General admission with access to every workshop ${ stamp }`;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext( {
			viewport: { width: 1024, height: 900 },
		} );
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Pricing layout e2e ${ stamp }`,
				link_type: 'none',
				start_date: '2039-05-05',
				start_time: '10:00:00',
				end_date: '2039-05-05',
				end_time: '12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		const ticketType = ( name ) => ( {
			name,
			capacity: null,
			activities_enabled: true,
			minimum_activities: 0,
			maximum_activities: null,
			recurrence_scope: 'single_instance',
			group_ids: [],
		} );
		const periods = [
			[ 'Early bird', '2020-01-01', '2039-01-01' ],
			[ 'Advance', '2039-01-01', '2039-03-01' ],
			[ 'Regular', '2039-03-01', '2039-04-20' ],
			[ 'Last minute', '2039-04-20', '2039-05-06' ],
		];
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					ticketType( longName ),
					ticketType( 'Supporter' ),
				],
				sale_periods: periods.map( ( [ name, start, end ] ) => ( {
					name,
					sale_start: `${ start } 00:00:00`,
					sale_end: `${ end } 00:00:00`,
				} ) ),
				prices: [ 0, 1 ].flatMap( ( t ) =>
					periods.map( ( _period, p ) => ( {
						ticket_type_index: t,
						sale_period_index: p,
						price: 10 * ( t + 1 ) + p,
					} ) )
				),
				options: [ { name: 'Lunch', price: 5 } ],
				settings: {
					multiple_pricing_periods: true,
					show_ticket_type_end_date: true,
				},
			},
		} );
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	test( 'settings collapse, follow their ticket, save, and the table scrolls in place', async () => {
		const page = adminPage;
		const openEditor = () =>
			page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`
			);
		const typeNames = () =>
			page
				.getByPlaceholder( 'Type name' )
				.evaluateAll( ( inputs ) => inputs.map( ( i ) => i.value ) );
		const toggle = ( name ) =>
			page.getByRole( 'button', { name: `Ticket settings: ${ name }` } );
		// The settings row directly follows its ticket's main row.
		const settingsOf = ( name ) =>
			page.locator( 'tbody.fair-events-tickets__ticket-group' ).filter( {
				has: toggle( name ),
			} );

		await openEditor();
		await expect.poll( typeNames ).toEqual( [ longName, 'Supporter' ] );

		// Collapsed initially; names and prices are editable in place.
		await expect( toggle( longName ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await expect( page.getByLabel( 'Minimum selections' ) ).toHaveCount(
			0
		);
		const nameInput = page.getByPlaceholder( 'Type name' ).first();
		expect(
			( await nameInput.boundingBox() ).width
		).toBeGreaterThanOrEqual( 200 );
		const supporterGroup = settingsOf( 'Supporter' );
		await supporterGroup
			.getByRole( 'spinbutton', { name: 'Price' } )
			.first()
			.fill( '25' );

		// The wide table scrolls inside its wrapper, not the page.
		const overflow = await page.evaluate( () => {
			const wrapper = document.querySelector(
				'.fair-events-tickets__prices-scroll'
			);
			return {
				wrapper: wrapper.scrollWidth > wrapper.clientWidth,
				page:
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth,
			};
		} );
		expect( overflow ).toEqual( { wrapper: true, page: false } );

		// Edit Supporter's settings, collapse, reopen: values are kept.
		await toggle( 'Supporter' ).click();
		await supporterGroup.getByLabel( 'Maximum selections' ).fill( '1' );
		await supporterGroup
			.getByLabel( 'Stop selling on' )
			.fill( '2039-05-01T18:00' );
		await toggle( 'Supporter' ).click();
		await expect(
			supporterGroup.getByLabel( 'Maximum selections' )
		).toHaveCount( 0 );
		await toggle( 'Supporter' ).click();
		await expect(
			supporterGroup.getByLabel( 'Maximum selections' )
		).toHaveValue( '1' );

		// Reorder: the open panel and its values move with the ticket.
		await supporterGroup
			.getByRole( 'button', { name: 'Move to top' } )
			.click();
		await expect.poll( typeNames ).toEqual( [ 'Supporter', longName ] );
		await expect( toggle( 'Supporter' ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		await expect( toggle( longName ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await expect(
			supporterGroup.getByLabel( 'Stop selling on' )
		).toHaveValue( '2039-05-01T18:00' );

		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();

		await page.reload();
		await expect.poll( typeNames ).toEqual( [ 'Supporter', longName ] );
		await expect( toggle( 'Supporter' ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await toggle( 'Supporter' ).click();
		await expect(
			supporterGroup.getByLabel( 'Maximum selections' )
		).toHaveValue( '1' );
		await expect(
			supporterGroup.getByLabel( 'Stop selling on' )
		).toHaveValue( '2039-05-01T18:00' );
		await expect(
			supporterGroup.getByRole( 'spinbutton', { name: 'Price' } ).first()
		).toHaveValue( '25' );
	} );
} );
