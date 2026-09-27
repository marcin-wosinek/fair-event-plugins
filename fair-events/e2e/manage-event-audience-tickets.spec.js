/**
 * E2E: on the Manage Event Audience tab each of a purchaser's two tickets
 * gets its own row; an administrator checks in and edits the activities of
 * one of them while the sibling keeps its own state (#1533, #1530). Totals
 * and the printed list count tickets, and participant-level history stays
 * apart from them.
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

	// The buyer's group: their participant row, one row per ticket, and any
	// history not tied to a ticket.
	const openAudience = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);
		const group = adminPage.locator( 'tbody', {
			has: adminPage.getByRole( 'link', { name: buyer } ),
		} );
		await expect( group ).toBeVisible();
		return group;
	};

	const totals = async ( label ) => {
		const row = adminPage.locator( 'tfoot tr', { hasText: label } );
		return row.locator( 'th[data-colname]' ).allTextContents();
	};

	test( 'shows each ticket as its own row under the purchaser', async () => {
		const group = await openAudience();
		await expect( group.locator( 'tr[data-ticket-id]' ) ).toHaveCount( 2 );
		await expect( group ).toContainText( '2 tickets' );
		await expect(
			group.getByRole( 'button', { name: 'Edit participant' } )
		).toHaveCount( 1 );
		await expect(
			group.getByRole( 'button', { name: /^Edit Ticket \d — / } )
		).toHaveCount( 2 );
	} );

	test( 'checks in one of two sibling tickets', async () => {
		let group = await openAudience();
		const first = group.getByRole( 'checkbox', {
			name: /^Checked in: Ticket 1 — Pair admission/,
		} );
		const second = group.getByRole( 'checkbox', {
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

		group = await openAudience();
		await expect(
			group.getByRole( 'checkbox', {
				name: /^Checked in: Ticket 2 — Pair admission/,
			} )
		).toBeChecked();
		await expect(
			group.getByRole( 'checkbox', {
				name: /^Checked in: Ticket 1 — Pair admission/,
			} )
		).not.toBeChecked();
	} );

	test( 'edits one ticket’s activities without changing its sibling', async () => {
		let group = await openAudience();
		await group
			.getByRole( 'button', { name: /^Edit Ticket 1 — Pair admission/ } )
			.click();

		let dialog = adminPage.getByRole( 'dialog' );
		await expect(
			dialog.locator( '.fair-audience-ticket-editor' )
		).toHaveCount( 1 );
		await dialog
			.getByRole( 'checkbox', { name: 'Morning session' } )
			.check();
		await dialog
			.getByRole( 'button', { name: /^Save Ticket 1 — Pair admission/ } )
			.click();
		await expect( adminPage.getByText( 'Ticket saved.' ) ).toBeVisible();
		await expect( dialog ).toBeHidden();

		group = await openAudience();
		await group
			.getByRole( 'button', { name: /^Edit Ticket 2 — Pair admission/ } )
			.click();
		dialog = adminPage.getByRole( 'dialog' );
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Morning session' } )
		).not.toBeChecked();
		// The check-in from the previous test stays on the second ticket only.
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Checked in' } )
		).toBeChecked();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();

		group = await openAudience();
		await group
			.getByRole( 'button', { name: /^Edit Ticket 1 — Pair admission/ } )
			.click();
		dialog = adminPage.getByRole( 'dialog' );
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Morning session' } )
		).toBeChecked();
		await expect(
			dialog.getByRole( 'checkbox', { name: 'Checked in' } )
		).not.toBeChecked();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();

		// One ticket holds the morning session: the ticket total says one.
		expect( await totals( 'Total — tickets' ) ).toEqual( [ '1', '0' ] );
	} );

	test( 'prints one row per ticket under the purchaser', async () => {
		await openAudience();
		const [ popup ] = await Promise.all( [
			adminContext.waitForEvent( 'page' ),
			adminPage.getByRole( 'button', { name: 'Print list' } ).click(),
		] );
		const group = popup.locator( 'tbody', { hasText: buyer } );
		await expect( group.locator( 'tr' ) ).toHaveCount( 2 );
		await expect( group.locator( 'td.ticket' ) ).toHaveText( [
			/^Ticket 1 \(/,
			/^Ticket 2 \(/,
		] );
		await expect( group.locator( 'td.activities' ) ).toHaveText( [
			'Morning session',
			'',
		] );
		await popup.close();
	} );

	test( 'shows participant-level history apart from the tickets', async () => {
		const participants = await apiFetch( adminPage, {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants`,
		} );
		const holder = participants.find(
			( p ) => p.participant_name.trim() === buyer
		);
		const { options } = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		} );
		const evening = options.find( ( o ) => o.name === 'Evening session' );
		// An activity recorded for the participant, not on either ticket.
		await apiFetch( adminPage, {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants/${ holder.participant_id }`,
			method: 'PUT',
			data: { ticket_option_ids: [ evening.id ] },
		} );

		const group = await openAudience();
		const history = group.locator( 'tr', {
			hasText: 'Not tied to a ticket',
		} );
		await expect( history ).toBeVisible();
		await expect( history.locator( 'td.is-activity' ).nth( 1 ) ).toHaveText(
			'✓'
		);
		// Neither ticket gains the evening session.
		for ( const ticketRow of await group
			.locator( 'tr[data-ticket-id]' )
			.all() ) {
			await expect(
				ticketRow.locator( 'td.is-activity' ).nth( 1 )
			).toHaveText( '' );
		}
		expect( await totals( 'Total — tickets' ) ).toEqual( [ '1', '0' ] );
		expect( await totals( 'Total — not tied to a ticket' ) ).toEqual( [
			'0',
			'1',
		] );
	} );
} );
