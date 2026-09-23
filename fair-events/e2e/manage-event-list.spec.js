/**
 * E2E: the Manage Event List tab loads existing signups regardless of
 * whether Fair Audience is active (#1672).
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const FAIR_AUDIENCE_PLUGIN = 'fair-audience/fair-audience';

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

async function setPluginStatus( page, status ) {
	return apiFetch( page, {
		path: `/wp/v2/plugins/${ FAIR_AUDIENCE_PLUGIN }`,
		method: 'PUT',
		data: { status },
	} );
}

test.describe( 'Manage Event — List tab', () => {
	test.setTimeout( 60_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let originalAudienceStatus;
	const signup = {
		name: `List Tab Tester ${ Date.now() }`,
		email: `manage-event-list-${ Date.now() }@example.test`,
		ticketType: 'List Tab Admission',
	};

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

		const plugins = await apiFetch( adminPage, {
			path: '/wp/v2/plugins',
		} );
		const fairAudience = plugins.find(
			( plugin ) => plugin.plugin === FAIR_AUDIENCE_PLUGIN
		);
		expect( fairAudience ).toBeDefined();
		originalAudienceStatus = fairAudience.status;

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Manage Event List e2e ${ Date.now() }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Manage Event List e2e',
				link_type: 'post',
				start_datetime: '2036-02-01 10:00:00',
				end_datetime: '2036-02-01 12:00:00',
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
						name: signup.ticketType,
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
				settings: {},
			},
		} );
		const ticketTypeId = tickets.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();

		await apiFetch( adminPage, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDateId,
				name: signup.name,
				email: signup.email,
				ticket_type_id: ticketTypeId,
				quantity: 1,
			},
		} );
	} );

	test.afterAll( async () => {
		if ( originalAudienceStatus ) {
			await setPluginStatus( adminPage, originalAudienceStatus ).catch(
				() => {}
			);
		}
		if ( eventDateId ) {
			const signups = await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			} ).catch( () => [] );
			for ( const row of signups ) {
				await apiFetch( adminPage, {
					path: `/fair-events/v1/get-tickets/${ row.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
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

	for ( const audienceStatus of [ 'active', 'inactive' ] ) {
		test( `loads existing signups with fair-audience ${ audienceStatus }`, async () => {
			await setPluginStatus( adminPage, audienceStatus );
			await adminPage.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=list`
			);

			await expect(
				adminPage.getByRole( 'tab', { name: 'List' } )
			).toHaveAttribute( 'aria-selected', 'true' );

			const row = adminPage.getByRole( 'row', {
				name: new RegExp( signup.email ),
			} );
			await expect( row ).toContainText( signup.name );
			await expect( row ).toContainText( signup.ticketType );

			const audienceTab = adminPage.getByRole( 'tab', {
				name: 'Audience',
			} );
			if ( audienceStatus === 'active' ) {
				await expect( audienceTab ).toBeVisible();
			} else {
				await expect( audienceTab ).toHaveCount( 0 );
			}
		} );
	}
} );
