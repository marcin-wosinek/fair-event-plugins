/**
 * E2E: on the Manage Event Audience tab an administrator checks in and edits
 * the activities of one of two tickets held by the same purchaser; the
 * sibling ticket keeps its own state (#1533).
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: {
					message: error?.message,
					code: error?.code,
					data: error?.data,
				},
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

test.describe( 'Manage Event — per-ticket check-in and activities', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	const stamp = Date.now();
	const buyer = `Ticket Pair ${ stamp }`;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title: `Ticket pair e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Ticket pair e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2036-04-04 10:00:00',
				end_datetime: '2036-04-04 12:00:00',
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
						name: 'Pair admission',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
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
				options: [
					{ name: 'Morning session', price: 0, capacity: null },
					{ name: 'Evening session', price: 0, capacity: null },
				],
				settings: {},
			},
		} );
		const ticketTypeId = tickets.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();

		// One purchase of two tickets: both held by the same participant.
		await apiFetch( adminPage, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDateId,
				name: buyer,
				email: `ticket-pair-e2e-${ stamp }@example.test`,
				ticket_type_id: ticketTypeId,
				quantity: 2,
			},
		} );
	} );

	test.afterAll( async () => {
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} ).catch( () => [] );
		for ( const row of signups ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets/${ row.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	const openAudience = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);
		const row = adminPage.getByRole( 'row', { name: new RegExp( buyer ) } );
		await expect( row ).toBeVisible();
		return row;
	};

	test( 'checks in one of two sibling tickets', async () => {
		let row = await openAudience();
		const first = row.getByRole( 'checkbox', {
			name: /^Checked in: Ticket 1 — Pair admission/,
		} );
		const second = row.getByRole( 'checkbox', {
			name: /^Checked in: Ticket 2 — Pair admission/,
		} );
		await expect( first ).not.toBeChecked();
		await expect( second ).not.toBeChecked();

		// apiFetch sends PUT as POST with an X-HTTP-Method-Override header.
		const saved = adminPage.waitForResponse(
			( response ) =>
				/\/fair-audience\/v1\/event-dates\/\d+\/tickets\/\d+/.test(
					decodeURIComponent( response.url() )
				) && response.request().method() !== 'GET'
		);
		await second.check();
		expect( ( await saved ).ok() ).toBeTruthy();

		row = await openAudience();
		await expect(
			row.getByRole( 'checkbox', {
				name: /^Checked in: Ticket 2 — Pair admission/,
			} )
		).toBeChecked();
		await expect(
			row.getByRole( 'checkbox', {
				name: /^Checked in: Ticket 1 — Pair admission/,
			} )
		).not.toBeChecked();
	} );

	test( 'edits one ticket’s activities without changing its sibling', async () => {
		let row = await openAudience();
		await row.getByRole( 'button', { name: 'Edit' } ).click();

		let dialog = adminPage.getByRole( 'dialog' );
		const firstEditor = dialog
			.locator( '.fair-audience-ticket-editor' )
			.nth( 0 );
		await firstEditor
			.getByRole( 'checkbox', { name: 'Morning session' } )
			.check();
		await dialog
			.getByRole( 'button', { name: /^Save Ticket 1 — Pair admission/ } )
			.click();
		await expect( adminPage.getByText( 'Ticket saved.' ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();

		row = await openAudience();
		await row.getByRole( 'button', { name: 'Edit' } ).click();
		dialog = adminPage.getByRole( 'dialog' );
		const editors = dialog.locator( '.fair-audience-ticket-editor' );
		await expect(
			editors
				.nth( 0 )
				.getByRole( 'checkbox', { name: 'Morning session' } )
		).toBeChecked();
		await expect(
			editors
				.nth( 1 )
				.getByRole( 'checkbox', { name: 'Morning session' } )
		).not.toBeChecked();
		// The check-in from the previous test stays on the second ticket only.
		await expect(
			editors.nth( 0 ).getByRole( 'checkbox', { name: 'Checked in' } )
		).not.toBeChecked();
		await expect(
			editors.nth( 1 ).getByRole( 'checkbox', { name: 'Checked in' } )
		).toBeChecked();
	} );
} );
