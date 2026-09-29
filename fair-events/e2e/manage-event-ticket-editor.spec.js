/**
 * E2E: the List and Audience tabs open the same ticket editor (#1709). From
 * the List, an administrator gives one ticket of a two-ticket purchase
 * another type, an activity and a check-in in one save, going over the new
 * type's limit with a reason. The sibling ticket keeps its own state, the
 * List shows each ticket's own type, and the Audience tab's editor shows the
 * same ticket the same way.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
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

// Buy as an anonymous visitor, so the admin's own participant (if any) is
// never taken for the buyer.
async function buy( data ) {
	const visitor = await request.newContext( { baseURL: BASE_URL } );
	const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
		data: { _honeypot: '', ...data },
	} );
	const body = await res.json();
	await visitor.dispose();
	expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
}

test.describe( 'Manage Event — one ticket editor for List and Audience', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	const stamp = Date.now();
	const buyer = `Editor Pair ${ stamp }`;

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
			data: { title: `Ticket editor e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Ticket editor e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2036-05-05 10:00:00',
				end_datetime: '2036-05-05 12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const ticketType = ( name, capacity ) => ( {
			name,
			capacity,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			group_ids: [],
		} );
		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					ticketType( 'Regular', null ),
					ticketType( 'Reduced', 1 ),
				],
				sale_periods: [
					{
						name: 'Always available',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [ 0, 1 ].map( ( index ) => ( {
					ticket_type_index: index,
					sale_period_index: 0,
					price: 0,
				} ) ),
				options: [
					{ name: 'Morning session', price: 0, capacity: null },
				],
				settings: {},
			},
		} );
		const [ regular, reduced ] = tickets.ticket_types;

		await buy( {
			event_date_id: eventDateId,
			name: buyer,
			email: `editor-pair-e2e-${ stamp }@example.test`,
			ticket_type_id: regular.id,
			quantity: 2,
		} );
		// Someone else takes the only Reduced place.
		await buy( {
			event_date_id: eventDateId,
			name: `Reduced Holder ${ stamp }`,
			email: `editor-reduced-e2e-${ stamp }@example.test`,
			ticket_type_id: reduced.id,
			quantity: 1,
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

	const openList = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=list`
		);
		await expect( adminPage.getByText( buyer ).first() ).toBeVisible();
	};

	const ticketRows = async () => {
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		const purchase = signups.find( ( row ) => row.name === buyer );
		return adminPage.locator(
			`tr.fair-events-signups__ticket[data-signup-id="${ purchase.id }"]`
		);
	};

	test( 'edits type, activity and check-in of one ticket from the List', async () => {
		await openList();
		const rows = await ticketRows();
		await expect( rows ).toHaveCount( 2 );
		await expect(
			adminPage.getByRole( 'button', { name: 'Change ticket type' } )
		).toHaveCount( 0 );

		await rows
			.nth( 1 )
			.getByRole( 'button', { name: /^Edit Ticket 2 \(/ } )
			.click();
		const dialog = adminPage.getByRole( 'dialog', {
			name: `Edit ticket — ${ buyer }`,
		} );
		await expect(
			dialog.getByText( /^Ticket 2 \([0-9A-F]{8}\)$/ )
		).toBeVisible();
		await expect( dialog.getByText( 'Status: Confirmed' ) ).toBeVisible();
		await expect(
			dialog.getByText(
				'The amount paid stays the same: no charge or refund is made for a price difference.'
			)
		).toBeVisible();

		await dialog
			.getByRole( 'combobox', { name: 'Ticket type' } )
			.selectOption( { label: 'Reduced — Full' } );
		await dialog
			.getByRole( 'checkbox', { name: 'Morning session' } )
			.check();
		await dialog.getByRole( 'checkbox', { name: 'Checked in' } ).check();
		await dialog.getByRole( 'button', { name: 'Save ticket' } ).click();

		// Reduced is full: the popup stays open with the edits and asks why.
		await expect(
			dialog.getByText( 'Reduced would have 2 of 1 place taken.' )
		).toBeVisible();
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Morning session' } )
		).toBeChecked();
		const override = dialog.getByRole( 'button', {
			name: 'Save over capacity',
		} );
		await expect( override ).toBeDisabled();
		await dialog
			.getByRole( 'textbox', { name: 'Reason for going over capacity' } )
			.fill( 'Speaker guest' );
		await override.click();
		await expect( dialog ).toBeHidden();

		// Each ticket row shows its own type; the registration-wide
		// over-capacity flag shows on both.
		await expect( rows.nth( 1 ) ).toContainText( 'Reduced' );
		await expect( rows.nth( 0 ) ).toContainText( 'Regular' );
		await expect( rows.nth( 0 ) ).toContainText(
			'Confirmed — over capacity'
		);
	} );

	test( 'shows the same ticket the same way in the Audience tab, sibling unchanged', async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);
		const group = adminPage.locator( 'tbody', {
			has: adminPage.getByRole( 'link', { name: buyer } ),
		} );
		await expect( group.locator( 'tr[data-ticket-id]' ) ).toHaveCount( 2 );

		await group
			.getByRole( 'button', { name: /^Edit Ticket 2 — Reduced/ } )
			.click();
		let dialog = adminPage.getByRole( 'dialog', {
			name: `Edit ticket — ${ buyer }`,
		} );
		await expect(
			dialog.getByText( /^Ticket 2 \([0-9A-F]{8}\)$/ )
		).toBeVisible();
		await expect(
			dialog.getByRole( 'combobox', { name: 'Ticket type' } )
		).toHaveValue( /\d+/ );
		await expect(
			dialog.getByRole( 'option', { name: 'Reduced (current)' } )
		).toHaveCount( 1 );
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Morning session' } )
		).toBeChecked();
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Checked in' } )
		).toBeChecked();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();

		await group
			.getByRole( 'button', { name: /^Edit Ticket 1 — Regular/ } )
			.click();
		dialog = adminPage.getByRole( 'dialog', {
			name: `Edit ticket — ${ buyer }`,
		} );
		await expect(
			dialog.getByRole( 'option', { name: 'Regular (current)' } )
		).toHaveCount( 1 );
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Morning session' } )
		).not.toBeChecked();
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Checked in' } )
		).not.toBeChecked();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
	} );
} );
