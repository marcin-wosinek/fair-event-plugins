import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * E2E coverage for #1624: the Event Prices block must render the event's
 * public pricing schedule straight from the Prices tab configuration —
 * enabled ticket types, sale periods, and free/priced/unavailable states —
 * and must follow the visitor's selected recurring-event occurrence.
 * Each block instance can also hide ticket types and sale periods from its
 * own display without affecting other blocks or signup.
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

/**
 * Creates a published event date + page rendering the Event Prices block,
 * with the given tickets payload (ticket_types/sale_periods/prices) saved
 * through the Prices tab endpoint. Returns the created resource ids for
 * cleanup, plus a ready-to-use visitor Page loaded on the page.
 */
async function setUpPricesPage(
	adminPage,
	browser,
	label,
	ticketsPayload,
	eventDateOverrides = {}
) {
	const eventPost = await apiFetch( adminPage, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: {
			title: `${ label } ${ Date.now() }`,
			status: 'publish',
		},
	} );

	const eventDate = await apiFetch( adminPage, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: label,
			link_type: 'post',
			start_datetime: '2036-01-01 10:00:00',
			end_datetime: '2036-01-01 12:00:00',
			...eventDateOverrides,
		},
	} );

	await apiFetch( adminPage, {
		path: `/fair-events/v1/event-dates/${ eventDate.id }`,
		method: 'PUT',
		data: { event_id: eventPost.id },
	} );

	await apiFetch( adminPage, {
		path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
		method: 'PUT',
		data: ticketsPayload,
	} );

	const pricesPage = await apiFetch( adminPage, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: {
			title: `${ label } page ${ Date.now() }`,
			status: 'publish',
			content: '<!-- wp:fair-events/event-prices /-->',
		},
	} );

	await apiFetch( adminPage, {
		path: `/fair-events/v1/event-dates/${ eventDate.id }`,
		method: 'PUT',
		data: { event_id: pricesPage.id },
	} );

	const visitorContext = await browser.newContext();
	const visitorPage = await visitorContext.newPage();
	await visitorPage.goto( `/?page_id=${ pricesPage.id }` );

	return {
		eventPostId: eventPost.id,
		eventDateId: eventDate.id,
		pricesPageId: pricesPage.id,
		visitorContext,
		visitorPage,
	};
}

async function cleanUp( adminPage, resources ) {
	await resources.visitorContext.close();
	await apiFetch( adminPage, {
		path: `/wp/v2/pages/${ resources.pricesPageId }`,
		method: 'DELETE',
		data: { force: true },
	} ).catch( () => {} );
	await apiFetch( adminPage, {
		path: `/wp/v2/fair_event/${ resources.eventPostId }`,
		method: 'DELETE',
		data: { force: true },
	} ).catch( () => {} );
	await apiFetch( adminPage, {
		path: `/fair-events/v1/event-dates/${ resources.eventDateId }`,
		method: 'DELETE',
	} ).catch( () => {} );
}

test.describe( 'Event Prices block', () => {
	let adminContext;
	let adminPage;

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
	} );

	test.afterAll( async () => {
		await adminContext.close();
	} );

	test( 'flat pricing shows the ticket name and formatted price', async ( {
		browser,
	} ) => {
		const resources = await setUpPricesPage(
			adminPage,
			browser,
			'Flat pricing e2e',
			{
				ticket_types: [
					{
						name: 'General admission',
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 15 },
				],
				settings: {},
			}
		);

		try {
			const block = resources.visitorPage.locator(
				'.wp-block-fair-events-event-prices'
			);
			await expect( block ).toBeVisible();
			await expect( block ).toContainText( 'General admission' );
			await expect( block ).toContainText( '15' );
		} finally {
			await cleanUp( adminPage, resources );
		}
	} );

	test( 'multiple sale periods show each period, with free, priced, and not-available states', async ( {
		browser,
	} ) => {
		const resources = await setUpPricesPage(
			adminPage,
			browser,
			'Multi period e2e',
			{
				ticket_types: [
					{
						name: 'Early bird',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
					{
						name: 'RSVP',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Early bird window',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2020-02-01 00:00:00',
					},
					{
						name: 'Regular window',
						sale_start: '2020-02-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					// Early bird only priced for the first period.
					{ ticket_type_index: 0, sale_period_index: 0, price: 10 },
					// RSVP is explicitly free in both periods.
					{ ticket_type_index: 1, sale_period_index: 0, price: 0 },
					{ ticket_type_index: 1, sale_period_index: 1, price: 0 },
				],
				settings: {},
			}
		);

		try {
			const periods = resources.visitorPage.locator(
				'.wp-block-fair-events-event-prices__period'
			);
			await expect( periods ).toHaveCount( 2 );

			const earlyBirdPeriod = periods.filter( {
				hasText: 'Early bird window',
			} );
			await expect( earlyBirdPeriod ).toContainText( 'Early bird' );
			await expect( earlyBirdPeriod ).toContainText( '10' );
			await expect( earlyBirdPeriod ).toContainText( 'RSVP' );
			await expect( earlyBirdPeriod ).toContainText( 'Free' );

			const regularPeriod = periods.filter( {
				hasText: 'Regular window',
			} );
			// Early bird has no price row for the regular period — shown as
			// not available, never guessed as free or omitted silently.
			await expect( regularPeriod ).toContainText( 'Early bird' );
			await expect( regularPeriod ).toContainText( 'Not available' );
			await expect( regularPeriod ).toContainText( 'RSVP' );
			await expect( regularPeriod ).toContainText( 'Free' );
		} finally {
			await cleanUp( adminPage, resources );
		}
	} );

	test( 'a disabled ticket type is not displayed', async ( { browser } ) => {
		const resources = await setUpPricesPage(
			adminPage,
			browser,
			'Disabled type e2e',
			{
				ticket_types: [
					{
						name: 'Active tier',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
					{
						name: 'Retired tier',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						disabled: true,
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 5 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 5 },
				],
				settings: {},
			}
		);

		try {
			const block = resources.visitorPage.locator(
				'.wp-block-fair-events-event-prices'
			);
			await expect( block ).toContainText( 'Active tier' );
			await expect( block ).not.toContainText( 'Retired tier' );
		} finally {
			await cleanUp( adminPage, resources );
		}
	} );

	test( 'no public prices configured renders no block markup', async ( {
		browser,
	} ) => {
		const resources = await setUpPricesPage(
			adminPage,
			browser,
			'Empty state e2e',
			{
				ticket_types: [
					{
						name: 'Unpriced tier',
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
				prices: [],
				settings: {},
			}
		);

		try {
			await expect(
				resources.visitorPage.locator(
					'.wp-block-fair-events-event-prices'
				)
			).toHaveCount( 0 );
		} finally {
			await cleanUp( adminPage, resources );
		}
	} );

	test( 'a recurring occurrence URL shows the same series pricing as the master', async ( {
		browser,
	} ) => {
		const resources = await setUpPricesPage(
			adminPage,
			browser,
			'Recurring pricing e2e',
			{
				ticket_types: [
					{
						name: 'Series pass',
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 20 },
				],
				settings: {},
			},
			{ rrule: 'FREQ=WEEKLY;COUNT=3' }
		);

		try {
			const masterBlock = resources.visitorPage.locator(
				'.wp-block-fair-events-event-prices'
			);
			await expect( masterBlock ).toContainText( 'Series pass' );
			await expect( masterBlock ).toContainText( '20' );

			// The second occurrence (one week after the series start) must show
			// the same series-master pricing, not an empty/unpriced schedule.
			const occurrenceContext = await browser.newContext();
			const occurrencePage = await occurrenceContext.newPage();
			await occurrencePage.goto(
				`/?page_id=${ resources.pricesPageId }&event_date=2036-01-08`
			);
			const occurrenceBlock = occurrencePage.locator(
				'.wp-block-fair-events-event-prices'
			);
			await expect( occurrenceBlock ).toContainText( 'Series pass' );
			await expect( occurrenceBlock ).toContainText( '20' );
			await occurrenceContext.close();
		} finally {
			await cleanUp( adminPage, resources );
		}
	} );

	test.describe( 'per-block visibility', () => {
		const festivalTickets = () => {
			const type = ( name ) => ( {
				name,
				recurrence_scope: 'single_instance',
				capacity: null,
				minimum_activities: 0,
				disable_at: null,
				group_ids: [],
			} );
			return {
				ticket_types: [
					type( 'Full Pass' ),
					type( 'Day Pass' ),
					type( 'Workshop only' ),
				],
				sale_periods: [
					{
						name: 'Early Bird',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2030-01-01 00:00:00',
					},
					{
						name: 'Regular',
						sale_start: '2030-01-01 00:00:00',
						sale_end: '2035-01-01 00:00:00',
					},
					{
						name: 'Last minute',
						sale_start: '2035-01-01 00:00:00',
						sale_end: '2036-01-01 00:00:00',
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 90 },
					{ ticket_type_index: 0, sale_period_index: 1, price: 120 },
					{ ticket_type_index: 0, sale_period_index: 2, price: 150 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 50 },
					{ ticket_type_index: 1, sale_period_index: 1, price: 65 },
					{ ticket_type_index: 1, sale_period_index: 2, price: 80 },
					{ ticket_type_index: 2, sale_period_index: 1, price: 30 },
					{ ticket_type_index: 2, sale_period_index: 2, price: 35 },
				],
				settings: {},
			};
		};

		/**
		 * Look up the saved ticket type / sale period IDs by name.
		 *
		 * @param {number} eventDateId Event date ID.
		 * @return {Promise<{types: Object, periods: Object}>} Name → ID maps.
		 */
		async function savedIds( eventDateId ) {
			const data = await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			} );
			const byName = ( items ) =>
				Object.fromEntries( items.map( ( i ) => [ i.name, i.id ] ) );
			return {
				types: byName( data.ticket_types ),
				periods: byName( data.sale_periods ),
			};
		}

		async function setPageContent( pageId, content ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ pageId }`,
				method: 'POST',
				data: { content },
			} );
		}

		async function rawContent( pageId ) {
			const page = await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ pageId }?context=edit`,
			} );
			return page.content.raw;
		}

		/**
		 * Summarize a rendered block as period name → ticket names.
		 *
		 * @param {import('@playwright/test').Locator} block Block locator.
		 * @return {Promise<Object>} Shape of the rendered schedule.
		 */
		async function shapeOf( block ) {
			return block.evaluate( ( el ) =>
				Object.fromEntries(
					[
						...el.querySelectorAll(
							'.wp-block-fair-events-event-prices__period'
						),
					].map( ( period ) => [
						period
							.querySelector(
								'.wp-block-fair-events-event-prices__period-name'
							)
							.textContent.trim(),
						[
							...period.querySelectorAll(
								'.wp-block-fair-events-event-prices__name'
							),
						].map( ( n ) => n.textContent.trim() ),
					] )
				)
			);
		}

		async function openEditor( pageId ) {
			await adminPage.goto(
				`/wp-admin/post.php?post=${ pageId }&action=edit`
			);
			const editorFrame = adminPage.frameLocator(
				'[name="editor-canvas"]'
			);
			await editorFrame.locator( '.block-editor-iframe__body' ).waitFor();

			const welcomeGuide = adminPage.locator( '.components-guide' );
			if ( await welcomeGuide.isVisible().catch( () => false ) ) {
				await adminPage
					.getByRole( 'button', { name: 'Close' } )
					.first()
					.click();
			}
			return editorFrame;
		}

		async function selectBlock( editorFrame, index ) {
			const block = editorFrame
				.locator( '[data-type="fair-events/event-prices"]' )
				.nth( index );
			await block
				.locator( '.wp-block-fair-events-event-prices__period' )
				.first()
				.waitFor();
			await block.click();
			await expect(
				adminPage.getByLabel( 'Full Pass', { exact: true } )
			).toBeVisible();
		}

		test( 'editors limit one block to Full Pass in Early Bird and Regular, and restore entries', async ( {
			browser,
		} ) => {
			const resources = await setUpPricesPage(
				adminPage,
				browser,
				'Visibility editor e2e',
				festivalTickets()
			);

			try {
				// Two blocks on one page: only the first is configured.
				await setPageContent(
					resources.pricesPageId,
					'<!-- wp:fair-events/event-prices /-->\n\n<!-- wp:fair-events/event-prices /-->'
				);

				const editorFrame = await openEditor( resources.pricesPageId );
				await selectBlock( editorFrame, 0 );

				await adminPage
					.getByLabel( 'Day Pass', { exact: true } )
					.uncheck();
				await adminPage
					.getByLabel( 'Workshop only', { exact: true } )
					.uncheck();
				await adminPage
					.getByLabel( 'Last minute', { exact: true } )
					.uncheck();

				// The editor preview follows the settings immediately.
				const firstEditorBlock = editorFrame
					.locator( '[data-type="fair-events/event-prices"]' )
					.first();
				await expect(
					firstEditorBlock.locator(
						'.wp-block-fair-events-event-prices__period'
					)
				).toHaveCount( 2 );

				await adminPage
					.getByRole( 'button', { name: 'Save', exact: true } )
					.click();
				await expect
					.poll( () => rawContent( resources.pricesPageId ), {
						timeout: 15000,
					} )
					.toContain( 'hiddenSalePeriodIds' );

				await resources.visitorPage.reload();
				const blocks = resources.visitorPage.locator(
					'.wp-block-fair-events-event-prices'
				);
				await expect( blocks ).toHaveCount( 2 );
				expect( await shapeOf( blocks.nth( 0 ) ) ).toEqual( {
					'Early Bird': [ 'Full Pass' ],
					Regular: [ 'Full Pass' ],
				} );
				await expect( blocks.nth( 0 ) ).toContainText( '90' );
				await expect( blocks.nth( 0 ) ).toContainText( '120' );
				// The second block keeps showing everything.
				expect( await shapeOf( blocks.nth( 1 ) ) ).toEqual( {
					'Early Bird': [ 'Full Pass', 'Day Pass', 'Workshop only' ],
					Regular: [ 'Full Pass', 'Day Pass', 'Workshop only' ],
					'Last minute': [ 'Full Pass', 'Day Pass', 'Workshop only' ],
				} );

				// Reloading the editor keeps the selections, and hidden
				// entries stay listed so they can be restored.
				const reloadedFrame = await openEditor(
					resources.pricesPageId
				);
				await selectBlock( reloadedFrame, 0 );
				await expect(
					adminPage.getByLabel( 'Day Pass', { exact: true } )
				).not.toBeChecked();
				await adminPage
					.getByLabel( 'Day Pass', { exact: true } )
					.check();
				await adminPage
					.getByRole( 'button', { name: 'Save', exact: true } )
					.click();
				await expect
					.poll( () => rawContent( resources.pricesPageId ), {
						timeout: 15000,
					} )
					.not.toMatch( /"hiddenTicketTypeIds":\[\d+,\d+\]/ );

				await resources.visitorPage.reload();
				expect(
					await shapeOf(
						resources.visitorPage
							.locator( '.wp-block-fair-events-event-prices' )
							.first()
					)
				).toEqual( {
					'Early Bird': [ 'Full Pass', 'Day Pass' ],
					Regular: [ 'Full Pass', 'Day Pass' ],
				} );
			} finally {
				await cleanUp( adminPage, resources );
			}
		} );

		test( 'hiding everything renders no public markup', async ( {
			browser,
		} ) => {
			const resources = await setUpPricesPage(
				adminPage,
				browser,
				'Visibility all hidden e2e',
				festivalTickets()
			);

			try {
				const { types } = await savedIds( resources.eventDateId );
				await setPageContent(
					resources.pricesPageId,
					`<!-- wp:fair-events/event-prices ${ JSON.stringify( {
						hiddenTicketTypeIds: Object.values( types ),
					} ) } /-->`
				);

				await resources.visitorPage.reload();
				await expect(
					resources.visitorPage.locator(
						'.wp-block-fair-events-event-prices'
					)
				).toHaveCount( 0 );
			} finally {
				await cleanUp( adminPage, resources );
			}
		} );

		test( 'a recurring occurrence applies the same hidden entries to series pricing', async ( {
			browser,
		} ) => {
			const resources = await setUpPricesPage(
				adminPage,
				browser,
				'Visibility recurring e2e',
				festivalTickets(),
				{ rrule: 'FREQ=WEEKLY;COUNT=3' }
			);

			try {
				const { types, periods } = await savedIds(
					resources.eventDateId
				);
				await setPageContent(
					resources.pricesPageId,
					`<!-- wp:fair-events/event-prices ${ JSON.stringify( {
						hiddenTicketTypeIds: [
							types[ 'Day Pass' ],
							types[ 'Workshop only' ],
						],
						hiddenSalePeriodIds: [ periods[ 'Last minute' ] ],
					} ) } /-->`
				);

				const occurrenceContext = await browser.newContext();
				const occurrencePage = await occurrenceContext.newPage();
				await occurrencePage.goto(
					`/?page_id=${ resources.pricesPageId }&event_date=2036-01-08`
				);
				expect(
					await shapeOf(
						occurrencePage.locator(
							'.wp-block-fair-events-event-prices'
						)
					)
				).toEqual( {
					'Early Bird': [ 'Full Pass' ],
					Regular: [ 'Full Pass' ],
				} );
				await occurrenceContext.close();
			} finally {
				await cleanUp( adminPage, resources );
			}
		} );
	} );
} );
