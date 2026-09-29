/**
 * E2E: a buyer of several tickets chooses the activities of each ticket,
 * with an explicit way to apply the first ticket's choice to all of them;
 * an administrator adding an activity past its limit on the Audience tab
 * must give a reason (#1697); moving an activity to the top in the Tickets
 * editor reorders the signup list without touching earlier selections (#1728).
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

test.describe( 'Event Signup — activities for each ticket', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let ticketTypeId;
	let signupPageId;
	const stamp = Date.now();
	const buyer = `Per ticket ${ stamp }`;
	const buyerEmail = `per-ticket-e2e-${ stamp }@example.test`;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );
		await apiFetch( adminPage, {
			path: '/wp/v2/plugins/fair-events-experimental/fair-events-experimental',
			method: 'PUT',
			data: { status: 'active' },
		} );

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title: `Per ticket e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Per ticket e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2039-02-02 10:00:00',
				end_datetime: '2039-02-02 12:00:00',
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
						name: 'Regular',
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
				options: [
					{ name: 'Workshop', price: 0, capacity: 2 },
					{ name: 'Show', price: 0, capacity: null },
				],
				settings: {},
			},
		} );
		ticketTypeId = tickets.ticket_types[ 0 ].id;

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Per ticket page ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;
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
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	test( 'a buyer of two tickets chooses each ticket’s activities', async ( {
		browser,
	} ) => {
		const visitor = await browser.newContext();
		const page = await visitor.newPage();
		await page.goto( `/?page_id=${ signupPageId }` );

		const form = page.locator( '.fair-events-get-tickets-form' );
		await form.locator( 'input[name="name"]' ).fill( buyer );
		await form.locator( 'input[name="email"]' ).fill( buyerEmail );
		await form.locator( 'input[name="quantity"]' ).fill( '2' );

		const first = form.getByRole( 'group', {
			name: 'Ticket 1: select activities',
		} );
		const second = form.getByRole( 'group', {
			name: 'Ticket 2: select activities',
		} );
		await expect( first ).toBeVisible();
		await expect( second ).toBeVisible();

		await first.getByRole( 'checkbox', { name: 'Workshop' } ).check();
		await expect(
			second.getByRole( 'checkbox', { name: 'Workshop' } )
		).not.toBeChecked();

		await form
			.getByRole( 'button', {
				name: 'Use the first ticket’s activities for all tickets',
			} )
			.click();
		await expect(
			second.getByRole( 'checkbox', { name: 'Workshop' } )
		).toBeChecked();
		await second.getByRole( 'checkbox', { name: 'Show' } ).check();

		await form.locator( 'button[type="submit"]' ).click();
		// The purchase creates the participant and sends its confirmation
		// email, which can take a while on a cold test instance.
		await expect( page.getByRole( 'alert' ) ).toContainText(
			'You have successfully registered!',
			{ timeout: 20_000 }
		);
		await visitor.close();

		const participants = await apiFetch( adminPage, {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants?event_date_id=${ eventDateId }`,
		} );
		const holder = participants.find(
			( p ) => p.participant_email === buyerEmail
		);
		expect(
			holder.tickets.map( ( t ) => t.activity_names.sort() )
		).toEqual( [ [ 'Workshop' ], [ 'Show', 'Workshop' ] ] );
	} );

	test( 'an administrator adding a full activity must give a reason', async () => {
		// Both Workshop places are taken by the buyer's two tickets.
		const otherEmail = `per-ticket-other-${ stamp }@example.test`;
		await apiFetch( adminPage, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDateId,
				name: `Other ${ stamp }`,
				email: otherEmail,
				ticket_type_id: ticketTypeId,
			},
		} );

		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);
		const group = adminPage.locator( 'tbody', {
			has: adminPage.getByRole( 'link', { name: `Other ${ stamp }` } ),
		} );
		await expect( group ).toBeVisible();
		await group
			.getByRole( 'button', { name: /^Edit Ticket 1 — Regular/ } )
			.click();

		const dialog = adminPage.getByRole( 'dialog' );
		// The activity is shown as full before the administrator adds it.
		await dialog
			.getByRole( 'checkbox', { name: 'Workshop — Full' } )
			.check();
		await dialog.getByRole( 'button', { name: 'Save ticket' } ).click();

		await expect( dialog ).toContainText(
			'Workshop would have 3 of 2 places taken.'
		);
		const override = dialog.getByRole( 'button', {
			name: 'Save over capacity',
		} );
		await expect( override ).toBeDisabled();

		await dialog
			.getByLabel( 'Reason for going over capacity' )
			.fill( 'Extra chair' );
		await override.click();
		await expect( dialog ).toBeHidden();

		const participants = await apiFetch( adminPage, {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants?event_date_id=${ eventDateId }`,
		} );
		const other = participants.find(
			( p ) => p.participant_email === otherEmail
		);
		expect( other.tickets[ 0 ].over_capacity_activity_ids ).toHaveLength(
			1
		);
	} );

	test( 'moving an activity to the top reorders the signup list', async ( {
		browser,
	} ) => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`
		);
		await adminPage.getByRole( 'button', { name: 'Add-ons' } ).click();
		const activityNames = () =>
			adminPage
				.getByPlaceholder( 'Add-on name' )
				.evaluateAll( ( inputs ) => inputs.map( ( i ) => i.value ) );
		await expect.poll( activityNames ).toEqual( [ 'Workshop', 'Show' ] );

		const rowOf = ( name ) =>
			adminPage.getByRole( 'row' ).filter( {
				has: adminPage.locator( `input[value="${ name }"]` ),
			} );
		await expect(
			rowOf( 'Workshop' ).getByRole( 'button', { name: 'Move to top' } )
		).toHaveCount( 0 );
		await rowOf( 'Show' )
			.getByRole( 'button', { name: 'Move to top' } )
			.click();
		await expect.poll( activityNames ).toEqual( [ 'Show', 'Workshop' ] );

		await adminPage.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			adminPage
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();

		await adminPage.reload();
		await adminPage.getByRole( 'button', { name: 'Add-ons' } ).click();
		await expect.poll( activityNames ).toEqual( [ 'Show', 'Workshop' ] );

		const visitor = await browser.newContext();
		const page = await visitor.newPage();
		await page.goto( `/?page_id=${ signupPageId }` );
		const form = page.locator( '.fair-events-get-tickets-form' );
		const workshop = form.getByRole( 'checkbox', { name: /^Workshop/ } );
		const show = form.getByRole( 'checkbox', { name: /^Show/ } );
		await expect( show.first() ).toBeVisible();
		const [ showBox, workshopBox ] = await Promise.all( [
			show.first().boundingBox(),
			workshop.first().boundingBox(),
		] );
		expect( showBox.y ).toBeLessThan( workshopBox.y );
		await visitor.close();

		// The earlier buyer's selections are untouched by the reorder.
		const participants = await apiFetch( adminPage, {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants?event_date_id=${ eventDateId }`,
		} );
		const holder = participants.find(
			( p ) => p.participant_email === buyerEmail
		);
		expect(
			holder.tickets.map( ( t ) => t.activity_names.sort() )
		).toEqual( [ [ 'Workshop' ], [ 'Show', 'Workshop' ] ] );
	} );
} );
