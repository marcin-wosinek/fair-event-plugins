import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const EVENTS_EXPERIMENTAL = 'fair-events-experimental/fair-events-experimental';

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function apiFetch( page, options ) {
	return page.evaluate( async ( requestOptions ) => {
		// eslint-disable-next-line no-undef
		return wp.apiFetch( requestOptions );
	}, options );
}

test( 'organizer restrictions survive reload and control public availability', async ( {
	browser,
} ) => {
	test.setTimeout( 90_000 );
	const adminContext = await browser.newContext();
	const adminPage = await adminContext.newPage();
	await login( adminPage );
	await adminPage.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await adminPage.waitForFunction( () => window.wp?.apiFetch );

	let eventDateId;
	let eventPostId;
	let identityEventDateId;
	let groupId;
	let participantId;
	let signupPageId;
	let originalExperimentalStatus;
	try {
		const plugins = await apiFetch( adminPage, { path: '/wp/v2/plugins' } );
		const audienceExperimental = plugins.find(
			( plugin ) =>
				plugin.plugin ===
				'fair-audience-experimental/fair-audience-experimental'
		);
		test.skip(
			audienceExperimental?.status !== 'active',
			'Fair Audience Experimental groups bundle is required'
		);
		const eventsExperimental = plugins.find(
			( plugin ) => plugin.plugin === EVENTS_EXPERIMENTAL
		);
		originalExperimentalStatus = eventsExperimental?.status;
		if ( originalExperimentalStatus === 'active' ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/plugins/${ EVENTS_EXPERIMENTAL }`,
				method: 'PUT',
				data: { status: 'inactive' },
			} );
		}

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Group restriction e2e ${ Date.now() }`,
				start_datetime: '2037-02-01 10:00:00',
				end_datetime: '2037-02-01 12:00:00',
			},
		} );
		eventDateId = eventDate.id;
		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Group restriction event ${ Date.now() }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );
		const groupName = `Members ${ Date.now() }`;
		const group = await apiFetch( adminPage, {
			path: '/fair-audience/v1/groups',
			method: 'POST',
			data: { name: groupName },
		} );
		groupId = group.id;

		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Members Only',
						recurrence_scope: 'single_instance',
					},
					{ name: 'Open', recurrence_scope: 'single_instance' },
				],
				sale_periods: [
					{
						name: 'Always open',
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
					{
						ticket_type_index: 1,
						sale_period_index: 0,
						price: 0,
					},
				],
				settings: {},
			},
		} );
		expect(
			tickets.ticket_types.some( ( type ) => type.name === 'Open' )
		).toBe( true );
		const identityEventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Group restriction identity event',
				start_datetime: '2037-01-01 10:00:00',
				end_datetime: '2037-01-01 12:00:00',
			},
		} );
		identityEventDateId = identityEventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ identityEventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );
		const identityTickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ identityEventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Identity ticket',
						recurrence_scope: 'single_instance',
					},
				],
				sale_periods: [
					{
						name: 'Always open',
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
		const identityTypeId = identityTickets.ticket_types[ 0 ].id;

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Group restriction signup ${ Date.now() }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;

		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=tickets`
		);
		const memberRow = adminPage.getByRole( 'row' ).filter( {
			has: adminPage.locator( 'input[value="Members Only"]' ),
		} );
		const groupInput = memberRow.getByPlaceholder( 'All participants' );
		await groupInput.fill( groupName );
		await groupInput.press( 'Enter' );
		await adminPage.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			adminPage
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();

		await adminPage.reload();
		await expect(
			adminPage
				.getByRole( 'row' )
				.filter( {
					has: adminPage.locator( 'input[value="Members Only"]' ),
				} )
				.getByText( groupName, { exact: true } )
		).toBeVisible();

		const anonymousContext = await browser.newContext();
		const anonymousPage = await anonymousContext.newPage();
		await anonymousPage.goto( `/?page_id=${ signupPageId }` );
		await expect(
			anonymousPage.getByRole( 'radio', { name: /^Open/ } )
		).toBeVisible();
		await expect(
			anonymousPage.getByRole( 'radio', { name: /^Members Only/ } )
		).toHaveCount( 0 );
		await anonymousContext.close();

		const memberContext = await browser.newContext();
		const memberEmail = `eligible-${ Date.now() }@example.test`;
		const memberName = `Eligible Member ${ Date.now() }`;
		const participant = await apiFetch( adminPage, {
			path: '/fair-audience/v1/participants',
			method: 'POST',
			data: {
				name: memberName,
				email: memberEmail,
				status: 'confirmed',
			},
		} );
		participantId = participant.id;
		await apiFetch( adminPage, {
			path: `/fair-audience/v1/groups/${ groupId }/participants`,
			method: 'POST',
			data: { participant_id: participantId },
		} );
		const memberPage = await memberContext.newPage();
		await memberPage.goto( `/?page_id=${ signupPageId }` );
		const signupResult = await memberPage.evaluate(
			async ( data ) => {
				const response = await fetch(
					'/wp-json/fair-events/v1/get-tickets',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify( data ),
					}
				);
				return { ok: response.ok, body: await response.json() };
			},
			{
				event_date_id: identityEventDateId,
				ticket_type_id: identityTypeId,
				name: memberName,
				email: memberEmail,
			}
		);
		expect(
			signupResult.ok,
			JSON.stringify( signupResult.body )
		).toBeTruthy();
		expect(
			( await memberContext.cookies() ).some(
				( cookie ) => cookie.name === 'fair_audience_session'
			)
		).toBe( true );
		await memberPage.reload();
		await expect(
			memberPage.getByRole( 'radio', { name: /^Members Only/ } )
		).toBeVisible( { timeout: 15_000 } );
		await memberContext.close();
	} finally {
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( groupId ) {
			await apiFetch( adminPage, {
				path: `/fair-audience/v1/groups/${ groupId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( participantId ) {
			await apiFetch( adminPage, {
				path: `/fair-audience/v1/participants/${ participantId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( identityEventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ identityEventDateId }`,
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
		if ( originalExperimentalStatus === 'active' ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/plugins/${ EVENTS_EXPERIMENTAL }`,
				method: 'PUT',
				data: { status: 'active' },
			} ).catch( () => {} );
		}
		await adminContext.close();
	}
} );
