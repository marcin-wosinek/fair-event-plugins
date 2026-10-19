/**
 * E2E: on the Manage Event Audience tab an organizer removes a participant
 * from the event date after a confirmation naming them, the event and the
 * date; keeping them changes nothing, and a failure leaves them listed for a
 * retry. A participant whose registration still stands is not removed: the
 * popup says what to do first and leads to the List tab (#1820). The Event
 * Participants page removes several at once through the same popup, keeping
 * whoever is blocked (#1775).
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

// apiFetch sends DELETE as POST with an X-HTTP-Method-Override header.
const isRemoval = ( request ) =>
	/\/fair-audience\/v1\/event-dates\/\d+\/participants\/\d+(?:[?&]|$)/.test(
		decodeURIComponent( request.url() )
	) &&
	( request.method() === 'DELETE' ||
		request.headers()[ 'x-http-method-override' ] === 'DELETE' );

test.describe( 'Manage Event — remove a participant from the audience', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	const participantIds = [];
	const stamp = Date.now();
	const title = `Remove participant e2e ${ stamp }`;
	const buyer = `Registered Buyer ${ stamp }`;
	const guests = [ 'Kept', 'Removed', 'Retried' ].map( ( name ) => ( {
		name,
		surname: `Guest ${ stamp }`,
		fullName: `${ name } Guest ${ stamp }`,
	} ) );
	const [ kept, removed, retried ] = guests;

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
			data: { title, status: 'publish' },
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title,
				link_type: 'post',
				start_date: '2036-04-04',
				start_time: '10:00:00',
				end_date: '2036-04-04',
				end_time: '12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		// No activities: the event offers nothing to edit on a participant.
		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Admission',
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
				options: [],
				settings: {},
			},
		} );

		// Blocked fixture: a registration with its ticket.
		await apiFetch( adminPage, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDateId,
				name: buyer,
				email: `remove-participant-buyer-${ stamp }@example.test`,
				ticket_type_id: tickets.ticket_types[ 0 ].id,
				quantity: 1,
			},
		} );

		// Eligible fixtures: people added by hand, with no purchase.
		for ( const guest of guests ) {
			const participant = await apiFetch( adminPage, {
				path: '/fair-audience/v1/participants',
				method: 'POST',
				data: {
					name: guest.name,
					surname: guest.surname,
					email: `remove-participant-${ guest.name.toLowerCase() }-${ stamp }@example.test`,
				},
			} );
			participantIds.push( participant.id );
			await apiFetch( adminPage, {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/participants`,
				method: 'POST',
				data: { participant_id: participant.id, label: 'interested' },
			} );
		}
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
		for ( const participantId of participantIds ) {
			await apiFetch( adminPage, {
				path: `/fair-audience/v1/participants/${ participantId }`,
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

	const groupOf = ( name ) =>
		// By text: a popup hides the rows behind it from role queries.
		adminPage.locator( 'tbody', {
			has: adminPage.locator( 'a', { hasText: name } ),
		} );

	const openAudience = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);
		await expect( groupOf( buyer ) ).toBeVisible();
	};

	const openRemoval = async ( name ) => {
		await groupOf( name )
			.getByRole( 'button', { name: 'Remove participant' } )
			.click();
		const dialog = adminPage.getByRole( 'dialog', {
			name: `Remove participant — ${ name }`,
		} );
		await expect( dialog ).toBeVisible();
		return dialog;
	};

	const interestedTotal = () => adminPage.getByText( /^Interested: \d+$/ );

	test( 'asks first, and keeping the participant changes nothing', async () => {
		await openAudience();
		await expect( interestedTotal() ).toHaveText( 'Interested: 3' );

		const dialog = await openRemoval( kept.fullName );
		await expect( dialog ).toContainText(
			`Remove ${ kept.fullName } from the audience of ${ title } on`
		);
		await expect( dialog ).toContainText( 'Their participant profile' );

		let requested = false;
		const watch = ( request ) => {
			requested = requested || isRemoval( request );
		};
		adminPage.on( 'request', watch );
		await dialog
			.getByRole( 'button', { name: 'Keep participant' } )
			.click();
		await expect( dialog ).toBeHidden();
		adminPage.off( 'request', watch );

		expect( requested ).toBe( false );
		await openAudience();
		await expect( groupOf( kept.fullName ) ).toBeVisible();
		await expect( interestedTotal() ).toHaveText( 'Interested: 3' );
	} );

	test( 'removes the participant and refreshes the audience and totals', async () => {
		await openAudience();
		const dialog = await openRemoval( removed.fullName );

		const sent = adminPage.waitForResponse( ( response ) =>
			isRemoval( response.request() )
		);
		await dialog
			.getByRole( 'button', { name: 'Remove participant' } )
			.click();
		expect( ( await sent ).ok() ).toBeTruthy();

		await expect(
			adminPage.getByText(
				`${ removed.fullName } was removed from this date.`
			)
		).toBeVisible();
		await expect( dialog ).toBeHidden();
		await expect( groupOf( removed.fullName ) ).toHaveCount( 0 );
		await expect( interestedTotal() ).toHaveText( 'Interested: 2' );

		// Their profile is kept: only this date's audience lost them.
		const profile = await apiFetch( adminPage, {
			path: `/fair-audience/v1/participants/${ participantIds[ 1 ] }`,
		} );
		expect( profile.name ).toBe( removed.name );

		await openAudience();
		await expect( groupOf( removed.fullName ) ).toHaveCount( 0 );
		await expect( groupOf( kept.fullName ) ).toBeVisible();
	} );

	test( 'keeps the participant after a failure and removes on retry', async () => {
		await openAudience();
		const dialog = await openRemoval( retried.fullName );

		const fail = async ( route ) => {
			if ( ! isRemoval( route.request() ) ) {
				return route.fallback();
			}
			return route.fulfill( {
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify( {
					code: 'removal_failed',
					message:
						'The participant could not be removed. Nothing was changed; try again.',
					data: { status: 500 },
				} ),
			} );
		};
		await adminPage.route( '**/*', fail );
		await dialog
			.getByRole( 'button', { name: 'Remove participant' } )
			.click();
		await expect( dialog ).toContainText(
			'The participant could not be removed. Nothing was changed; try again.'
		);
		await adminPage.unroute( '**/*', fail );

		// Still open, still listed, and the removal can be sent again.
		await expect( groupOf( retried.fullName ) ).toHaveCount( 1 );
		await dialog
			.getByRole( 'button', { name: 'Remove participant' } )
			.click();
		await expect(
			adminPage.getByText(
				`${ retried.fullName } was removed from this date.`
			)
		).toBeVisible();
		await expect( groupOf( retried.fullName ) ).toHaveCount( 0 );
	} );

	test( 'explains what stands in the way of a registered participant', async () => {
		await openAudience();
		const dialog = await openRemoval( buyer );

		await expect( dialog ).toContainText(
			`${ buyer } cannot be removed from ${ title } on`
		);
		await expect( dialog ).toContainText(
			'This participant has 1 registration for this date. Delete it on the List tab first; its tickets are deleted with it.'
		);
		await expect(
			dialog.getByRole( 'button', { name: 'Remove participant' } )
		).toHaveCount( 0 );

		// Followed by URL: a clicked link stalls rendering in headless runs.
		const listUrl = await dialog
			.getByRole( 'link', { name: 'Open the List tab' } )
			.getAttribute( 'href' );
		expect( listUrl ).toContain( `event_date_id=${ eventDateId }` );
		expect( listUrl ).toContain( 'tab=list' );
		await adminPage.goto( listUrl );
		await expect(
			adminPage.getByRole( 'heading', { name: 'List', exact: true } )
		).toBeVisible();
		await expect( adminPage.getByText( buyer ).first() ).toBeVisible();
	} );

	test( 'offers the action and its popup on a phone', async () => {
		await adminPage.setViewportSize( { width: 375, height: 812 } );
		try {
			await openAudience();
			const action = groupOf( kept.fullName ).getByRole( 'button', {
				name: 'Remove participant',
			} );
			await action.scrollIntoViewIfNeeded();
			await expect( action ).toBeVisible();

			const dialog = await openRemoval( kept.fullName );
			const confirm = dialog.getByRole( 'button', {
				name: 'Remove participant',
			} );
			const keep = dialog.getByRole( 'button', {
				name: 'Keep participant',
			} );
			await expect( confirm ).toBeInViewport();
			await expect( keep ).toBeInViewport();
			await keep.click();
			await expect( dialog ).toBeHidden();
		} finally {
			await adminPage.setViewportSize( { width: 1280, height: 720 } );
		}
	} );

	// Last: it removes the remaining hand-added participant (#1775).
	test( 'removes several from the Event Participants page, keeping who is blocked', async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-audience-event-participants&event_date_id=${ eventDateId }`
		);
		const rows = adminPage.locator( '.dataviews-view-table tbody tr' );
		await expect( rows ).toHaveCount( 2 );

		// No browser confirmation: the popup below asks instead.
		let nativeDialogs = 0;
		const countDialog = ( nativeDialog ) => {
			nativeDialogs++;
			nativeDialog.dismiss();
		};
		adminPage.on( 'dialog', countDialog );

		const boxes = rows.locator( '.dataviews-selection-checkbox input' );
		await boxes.nth( 0 ).check( { force: true } );
		await boxes.nth( 1 ).check( { force: true } );
		await adminPage
			.locator( '.dataviews-bulk-actions-footer__container' )
			.getByRole( 'button', { name: 'Remove' } )
			.click();

		const dialog = adminPage.getByRole( 'dialog', {
			name: 'Remove participants from this event',
		} );
		await expect( dialog ).toBeVisible();
		expect( nativeDialogs ).toBe( 0 );
		// The stored wall-clock time, whatever the browser's timezone.
		await expect( dialog ).toContainText(
			`Remove 1 participant from the audience of ${ title } on April 4, 2036 10:00 am?`
		);
		await expect(
			dialog.getByRole( 'list', { name: 'Participants to remove' } )
		).toContainText( kept.fullName );
		const blocked = dialog.getByRole( 'list', {
			name: 'Participants who cannot be removed yet',
		} );
		await expect( blocked ).toContainText( buyer );
		await expect( blocked ).toContainText(
			'This participant has 1 registration for this date.'
		);

		const sent = adminPage.waitForResponse(
			( response ) =>
				decodeURIComponent( response.url() ).includes(
					`/event-dates/${ eventDateId }/participants/batch`
				) &&
				response.request().headers()[ 'x-http-method-override' ] ===
					'DELETE'
		);
		await dialog
			.getByRole( 'button', { name: 'Remove 1 participant' } )
			.click();
		const result = await ( await sent ).json();
		expect( result.removed ).toBe( 1 );
		expect( result.failed ).toBe( 0 );

		// The blocked participant stays, in the popup and in the list.
		await expect( dialog ).toContainText(
			'1 participant was removed from this date.'
		);
		await expect(
			dialog.getByRole( 'button', { name: /^Remove/ } )
		).toHaveCount( 0 );
		await dialog
			.getByRole( 'button', { name: 'Back to the audience' } )
			.click();
		await expect( dialog ).toBeHidden();
		await expect( rows ).toHaveCount( 1 );
		await expect( rows ).toContainText( buyer );
		adminPage.off( 'dialog', countDialog );

		// Only the audience entry went: the profile is still there.
		const profile = await apiFetch( adminPage, {
			path: `/fair-audience/v1/participants/${ participantIds[ 0 ] }`,
		} );
		expect( profile.name ).toBe( kept.name );
	} );
} );
