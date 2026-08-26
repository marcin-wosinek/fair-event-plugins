import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * E2E coverage for #1300: the Event Signup form's cache-safe baseline must
 * render identically for every viewer, with per-viewer personalization
 * (here: name/email pre-fill and signed-up state) hydrated client-side
 * after load — so a page a full-page cache stores for one viewer never
 * leaks another viewer's details, and the same browser gets its own state
 * back once it holds one.
 *
 * fair-events-experimental isn't assumed active, so the group-restricted-
 * tier/discount half of the ticket isn't exercised here — only the
 * prefill/signed-up-state half the ticket explicitly calls out as sharing
 * the same leak. A free ticket type is used so the flow completes without a
 * configured payment connector.
 */

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const res = await wp.apiFetch( opts );
			return { ok: true, data: res };
		} catch ( err ) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
					data: err && err.data,
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

test.describe( 'Event Signup — cache-safe baseline + viewer-context hydration', () => {
	test( 'a viewer who signs up sees their own state on reload; a fresh viewer on the same page never does', async ( {
		browser,
	} ) => {
		const adminContext = await browser.newContext();
		const adminPage = await adminContext.newPage();
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
			data: {
				title: `Viewer-context e2e ${ Date.now() }`,
				status: 'publish',
			},
		} );

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Viewer-context e2e',
				link_type: 'post',
				start_datetime: '2036-01-01 10:00:00',
				end_datetime: '2036-01-01 12:00:00',
			},
		} );

		try {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'PUT',
				data: { event_id: eventPost.id },
			} );

			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
				method: 'PUT',
				data: {
					ticket_types: [
						{
							name: 'Free entry',
							recurrence_scope: 'single_instance',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: 'Always on',
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

			const signupPage = await apiFetch( adminPage, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title: `Viewer-context e2e page ${ Date.now() }`,
					status: 'publish',
					content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDate.id }} /-->`,
				},
			} );

			// Context B: the visitor who will sign up.
			const visitorContext = await browser.newContext();
			const visitorPage = await visitorContext.newPage();
			await visitorPage.goto( `/?page_id=${ signupPage.id }` );

			const form = visitorPage.locator( '.fair-events-get-tickets-form' );
			await expect( form ).toBeVisible();
			// Baseline: no signed-up card, no pre-filled identity.
			await expect(
				visitorPage.locator( '.fair-events-signed-up-card' )
			).toHaveCount( 0 );
			await expect( form.locator( 'input[name="name"]' ) ).toHaveValue(
				''
			);
			await expect( form.locator( 'input[name="email"]' ) ).toHaveValue(
				''
			);

			await form.locator( 'input[name="name"]' ).fill( 'Ada Lovelace' );
			await form
				.locator( 'input[name="email"]' )
				.fill( `ada-e2e-${ Date.now() }@example.test` );
			await form.locator( 'button[type="submit"]' ).click();
			await expect(
				visitorPage.locator(
					'.fair-events-get-tickets-message-success'
				)
			).toBeVisible();

			// Reload as the same browser (same AudienceSession cookie): the
			// server-rendered baseline is identical, but frontend.js's
			// viewer-context hydration must recognise this viewer already
			// holds the signup and swap in the signed-up card.
			await visitorPage.reload();
			await expect(
				visitorPage.locator( '.fair-events-get-tickets-form' )
			).toHaveCount( 0 );
			await expect(
				visitorPage.locator( '.fair-events-signed-up-card' )
			).toBeVisible();
			await expect(
				visitorPage.locator( '.fair-events-signed-up-card' )
			).toContainText( 'You are signed up for this date.' );

			// Context C: a second, unrelated visitor loading the exact same
			// page (same cached markup) must never see the first visitor's
			// signed-up state or identity — the core of #1300's guarantee.
			const strangerContext = await browser.newContext();
			const strangerPage = await strangerContext.newPage();
			await strangerPage.goto( `/?page_id=${ signupPage.id }` );

			await expect(
				strangerPage.locator( '.fair-events-get-tickets-form' )
			).toBeVisible();
			await expect(
				strangerPage.locator( '.fair-events-signed-up-card' )
			).toHaveCount( 0 );
			await expect(
				strangerPage.locator( 'input[name="name"]' )
			).toHaveValue( '' );
			await expect(
				strangerPage.locator( 'input[name="email"]' )
			).toHaveValue( '' );

			await strangerContext.close();
			await visitorContext.close();
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPage.id }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		} finally {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPost.id }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await adminContext.close();
		}
	} );
} );
