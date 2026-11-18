/**
 * E2E: the Manage Event Finance tab works with Fair Payments Connector alone
 * (#2110, #2398). With Fair Finance deactivated the tab still appears, leads
 * with the event result, marked incomplete with its reasons, lists the
 * event's synthetic payments in a collapsed section with failed attempts in
 * a nested collapsed one, shows a payment-specific empty state for an event
 * without payments, and neither requests nor links to anything Fair Finance
 * provides.
 *
 * Transactions are seeded through the fair-e2e transaction-filters fixture;
 * the seeded rows, events and Fair Finance's activation state are restored
 * afterwards.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const FAIR_FINANCE_PLUGIN = 'fair-finance/fair-finance';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: { message: error?.message, code: error?.code },
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

async function setFinanceStatus( page, status ) {
	return apiFetch( page, {
		path: `/wp/v2/plugins/${ FAIR_FINANCE_PLUGIN }`,
		method: 'PUT',
		data: { status },
	} );
}

async function createEventDate( page, title ) {
	const post = await apiFetch( page, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: { title, status: 'publish' },
	} );
	const eventDate = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title,
			link_type: 'post',
			start_date: '2036-03-01',
			start_time: '10:00:00',
			end_date: '2036-03-01',
			end_time: '12:00:00',
		},
	} );
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ eventDate.id }`,
		method: 'PUT',
		data: { event_id: post.id },
	} );
	return { postId: post.id, eventDateId: eventDate.id };
}

const financeUrl = ( eventDateId ) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=finance`;

test.describe( 'Manage Event — Finance tab without Fair Finance', () => {
	test.setTimeout( 60_000 );

	const fixtureKey = `fpo${ Date.now() }`;
	let adminContext;
	let adminPage;
	let originalFinanceStatus;
	const events = [];
	let paidEvent;
	let emptyEvent;

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

		const plugins = await apiFetch( adminPage, { path: '/wp/v2/plugins' } );
		originalFinanceStatus = plugins.find(
			( plugin ) => plugin.plugin === FAIR_FINANCE_PLUGIN
		)?.status;

		paidEvent = await createEventDate(
			adminPage,
			`Finance payments-only e2e ${ fixtureKey }`
		);
		emptyEvent = await createEventDate(
			adminPage,
			`Finance payments-only empty e2e ${ fixtureKey }`
		);
		events.push( paidEvent, emptyEvent );

		const eventDateId = paidEvent.eventDateId;
		await apiFetch( adminPage, {
			path: '/fair-e2e/v1/transaction-filters/seed',
			method: 'POST',
			data: {
				key: fixtureKey,
				participants: [ { name: 'Alex', surname: 'Example' } ],
				transactions: [
					{
						amount: 45,
						status: 'paid',
						testmode: 0,
						description: `Payments-only ticket ${ fixtureKey }`,
						created_at: '2026-07-20 10:00:00',
						participant: 0,
						event_date_id: eventDateId,
					},
					{
						amount: 30,
						status: 'paid',
						testmode: 0,
						description: `Payments-only ticket ${ fixtureKey }`,
						created_at: '2026-07-21 10:00:00',
						participant: 0,
						event_date_id: eventDateId,
					},
					{
						amount: 20,
						status: 'failed',
						testmode: 0,
						description: `Payments-only failed ${ fixtureKey }`,
						created_at: '2026-07-22 10:00:00',
						participant: 0,
						event_date_id: eventDateId,
					},
				],
			},
		} );

		await setFinanceStatus( adminPage, 'inactive' );
		// Confirm the deactivation really happened before relying on it.
		const finance = await apiFetch( adminPage, {
			path: `/wp/v2/plugins/${ FAIR_FINANCE_PLUGIN }`,
		} );
		expect( finance.status ).toBe( 'inactive' );
	} );

	test.afterAll( async () => {
		if ( originalFinanceStatus ) {
			await setFinanceStatus( adminPage, originalFinanceStatus ).catch(
				() => {}
			);
		}
		await apiFetch( adminPage, {
			path: `/fair-e2e/v1/transaction-filters/seed?key=${ fixtureKey }`,
			method: 'DELETE',
		} ).catch( () => {} );
		for ( const { postId, eventDateId } of events ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ postId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	const headline = ( page, label ) =>
		page
			.getByTestId( 'finance-headline' )
			.getByText( label, { exact: true } )
			.locator( 'xpath=following-sibling::div[1]' );

	test( 'shows the event result first and payments on request, without Fair Finance', async () => {
		const financeRequests = [];
		adminPage.on( 'request', ( req ) => {
			const url = decodeURIComponent( req.url() );
			if (
				url.includes( 'fair-finance/' ) ||
				/\/budget(\?|$)/.test( url )
			) {
				financeRequests.push( url );
			}
		} );

		await adminPage.goto( financeUrl( paidEvent.eventDateId ) );

		await expect(
			adminPage.getByRole( 'tab', { name: 'Finance' } )
		).toHaveAttribute( 'aria-selected', 'true' );

		const warning = adminPage.locator( '.components-notice.is-warning' );

		// The failed attempt contributes nothing to sales.
		await expect( headline( adminPage, 'Total sales' ) ).toHaveText(
			'€75.00'
		);
		await expect(
			warning.getByText( 'Incomplete: the net result isn’t final.' )
		).toBeVisible();
		await expect(
			warning.getByText(
				'Expenses and cash sales are left out because Fair Finance is inactive.'
			)
		).toBeVisible();
		await expect(
			warning.getByText(
				'Payment fees aren’t recorded yet for some online payments, so costs leave them out and the net result may be too high.'
			)
		).toBeVisible();

		// Payments stay collapsed until opened.
		const toggle = adminPage.getByRole( 'button', {
			name: 'Online payments',
		} );
		await expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		await expect(
			adminPage.getByText( `Payments-only ticket ${ fixtureKey }` )
		).toHaveCount( 0 );
		await toggle.click();

		const payments = adminPage.getByRole( 'table', {
			name: 'Successful payments',
		} );
		await expect(
			payments.getByRole( 'row', {
				name: new RegExp( `Payments-only ticket ${ fixtureKey }` ),
			} )
		).toHaveCount( 2 );
		await expect(
			adminPage.getByRole( 'link', { name: '€45.00' } )
		).toHaveAttribute(
			'href',
			/page=fair-payments-connector-transaction&transaction_id=\d+/
		);

		// Unsuccessful attempts sit in their own collapsed section.
		const failed = adminPage.getByRole( 'button', {
			name: 'Failed, expired or canceled attempt (1)',
		} );
		await expect( failed ).toHaveAttribute( 'aria-expanded', 'false' );
		await expect(
			adminPage.getByText( `Payments-only failed ${ fixtureKey }` )
		).toHaveCount( 0 );
		await failed.click();
		await expect(
			adminPage.getByText( `Payments-only failed ${ fixtureKey }` )
		).toBeVisible();

		await expect(
			adminPage.getByRole( 'columnheader', { name: 'Budget entry' } )
		).toHaveCount( 0 );
		await expect(
			adminPage.getByRole( 'combobox', { name: 'Budget' } )
		).toHaveCount( 0 );
		await expect(
			adminPage.getByRole( 'link', { name: 'View All Entries' } )
		).toHaveCount( 0 );
		await expect(
			adminPage.locator( 'a[href*="fair-finance"]' )
		).toHaveCount( 0 );
		await expect(
			adminPage.locator( '.components-notice.is-error' )
		).toHaveCount( 0 );
		expect( financeRequests ).toEqual( [] );
	} );

	test( 'shows a payment-specific empty state', async () => {
		await adminPage.goto( financeUrl( emptyEvent.eventDateId ) );

		await expect( headline( adminPage, 'Total sales' ) ).toHaveText(
			'€0.00'
		);
		await adminPage
			.getByRole( 'button', { name: 'Online payments' } )
			.click();
		await expect(
			adminPage.getByText(
				'No successful online payments for this event yet.'
			)
		).toBeVisible();
	} );
} );
