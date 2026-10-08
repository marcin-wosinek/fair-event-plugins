/**
 * E2E: a registered attendee adding activities sees each activity on its own
 * row, with the checkbox beside the first line of a wrapping name, at mobile,
 * tablet, and desktop widths — and can still add a free activity (#1763).
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const VIEWPORTS = [
	{ name: 'mobile', width: 375, height: 812 },
	{ name: 'tablet', width: 768, height: 1024 },
	{ name: 'desktop', width: 1280, height: 900 },
];

const LONG_ACTIVITY =
	'Guided walk through the old town with a stop at the market hall and the riverside gardens';

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
	await page.waitForURL( /\/wp-admin\/?/ );
}

async function signUp( page, signupPageId, { name, email, activity } ) {
	await page.goto( `/?page_id=${ signupPageId }` );
	const form = page.locator( '.fair-events-get-tickets-form' );
	await form.locator( 'input[name="name"]' ).fill( name );
	await form.locator( 'input[name="email"]' ).fill( email );
	if ( activity ) {
		await form.getByRole( 'checkbox', { name: activity } ).check();
	}
	await form.locator( 'button[type="submit"]' ).click();
	// The purchase creates the participant and sends its confirmation
	// email, which can take a while on a cold test instance.
	await expect(
		page.locator( '.fair-events-get-tickets-message-success' )
	).toBeVisible( { timeout: 20_000 } );
}

/**
 * Measure every add-activities row: the label box, its checkbox, and the
 * line boxes of its text.
 */
function measureRows( section ) {
	return section
		.locator( '.fair-events-ticket-option-item' )
		.evaluateAll( ( labels ) =>
			labels.map( ( label ) => {
				const box = label.getBoundingClientRect();
				const checkbox = label
					.querySelector( 'input[type="checkbox"]' )
					.getBoundingClientRect();
				const range = document.createRange();
				range.selectNodeContents( label );
				const lines = Array.from( range.getClientRects() )
					.filter(
						( rect ) =>
							rect.width > 1 &&
							Math.abs( rect.left - checkbox.left ) > 1
					)
					.map( ( rect ) => ( {
						left: rect.left,
						top: rect.top,
						bottom: rect.bottom,
					} ) );
				return {
					top: box.top,
					bottom: box.bottom,
					left: box.left,
					right: box.right,
					checkbox: {
						left: checkbox.left,
						right: checkbox.right,
						middle: ( checkbox.top + checkbox.bottom ) / 2,
					},
					lines,
				};
			} )
		);
}

test.describe( 'Event Signup — add-activities rows', () => {
	test.setTimeout( 120_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupPageId;
	const stamp = Date.now();

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title: `Add rows e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Add rows e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2039-03-03 10:00:00',
				end_datetime: '2039-03-03 12:00:00',
			},
		} );
		eventDateId = eventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		await apiFetch( adminPage, {
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
					{ name: 'Morning workshop', price: 0, capacity: null },
					{ name: LONG_ACTIVITY, price: 12.5, capacity: null },
					{ name: 'Evening gala dinner', price: 30, capacity: null },
					{ name: 'Backstage tour', price: 0, capacity: 1 },
				],
				settings: {},
			},
		} );

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Add rows page ${ stamp }`,
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

	test( 'each addable activity has its own row and can still be added', async ( {
		browser,
	} ) => {
		// Someone else takes the only Backstage tour place.
		const stranger = await browser.newContext();
		await signUp( await stranger.newPage(), signupPageId, {
			name: `Stranger ${ stamp }`,
			email: `add-rows-stranger-${ stamp }@example.test`,
			activity: /^Backstage tour/,
		} );
		await stranger.close();

		// The attendee holds a ticket with no activities yet.
		const attendee = await browser.newContext();
		const page = await attendee.newPage();
		await signUp( page, signupPageId, {
			name: `Attendee ${ stamp }`,
			email: `add-rows-attendee-${ stamp }@example.test`,
		} );
		await page.reload();

		const section = page.locator( '.fair-events-add-activities' );
		await expect( section ).toBeVisible();
		const rows = section.locator( '.fair-events-ticket-option-item' );
		await expect( rows ).toHaveCount( 4 );
		await expect( rows.nth( 1 ) ).toContainText( LONG_ACTIVITY );
		await expect( rows.nth( 1 ) ).toContainText( '12.50' );

		for ( const viewport of VIEWPORTS ) {
			await test.step( `rows at ${ viewport.name }`, async () => {
				await page.setViewportSize( {
					width: viewport.width,
					height: viewport.height,
				} );
				const fieldset = await section
					.locator( 'fieldset' )
					.boundingBox();
				const measured = await measureRows( section );

				measured.forEach( ( row, index ) => {
					// Every row starts at the same left edge, below the
					// previous one, and stays inside the fieldset.
					expect( row.left ).toBeCloseTo( measured[ 0 ].left, 0 );
					if ( index > 0 ) {
						expect( row.top ).toBeGreaterThanOrEqual(
							measured[ index - 1 ].bottom - 0.5
						);
					}
					expect( row.right ).toBeLessThanOrEqual(
						fieldset.x + fieldset.width + 0.5
					);

					// The checkbox leads the row, level with the first
					// line; no line of the name runs under it.
					expect( row.checkbox.left ).toBeCloseTo( row.left, 0 );
					expect( row.lines.length ).toBeGreaterThan( 0 );
					expect(
						Math.abs(
							row.checkbox.middle -
								( row.lines[ 0 ].top + row.lines[ 0 ].bottom ) /
									2
						)
					).toBeLessThanOrEqual( 3 );
					for ( const line of row.lines ) {
						expect( line.left ).toBeGreaterThan(
							row.checkbox.right
						);
					}
				} );

				if ( viewport.name === 'mobile' ) {
					// The long name really wraps here.
					expect( measured[ 1 ].lines.length ).toBeGreaterThan( 1 );
				}

				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth
				);
				expect( overflow ).toBeLessThanOrEqual( 0 );
			} );
		}

		const button = section.getByRole( 'button', {
			name: 'Add activities',
		} );
		await expect( button ).toBeDisabled();
		await expect(
			section.getByRole( 'checkbox', { name: /^Backstage tour/ } )
		).toBeDisabled();

		// Clicking the row, away from the checkbox, selects its activity.
		const workshop = section.getByRole( 'checkbox', {
			name: /^Morning workshop/,
		} );
		await rows.nth( 0 ).click();
		await expect( workshop ).toBeChecked();
		await expect( button ).toBeEnabled();

		// A free activity is added without checkout and survives a reload.
		// Plain permalinks carry the route URL-encoded in ?rest_route=.
		await Promise.all( [
			page.waitForResponse(
				( response ) =>
					decodeURIComponent( response.url() ).includes(
						'event-signup/add-activities'
					) && response.ok()
			),
			// The block reloads the page itself once the activity is saved.
			page.waitForEvent( 'load' ),
			button.click(),
		] );
		await page.goto( `/?page_id=${ signupPageId }` );
		await expect(
			page.locator( '.fair-events-signed-up-card' )
		).toContainText( 'Morning workshop' );
		await expect(
			page
				.locator( '.fair-events-add-activities' )
				.getByRole( 'checkbox', { name: /^Morning workshop/ } )
		).toHaveCount( 0 );
		await attendee.close();
	} );
} );
