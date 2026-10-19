/**
 * E2E: an empty first sale-period start means the day the event was created
 * (#1841). The admin Prices tab, the public Event Prices block and the
 * event's JSON-LD offers agree on that date, also once the period has ended,
 * while explicit starts keep their own dates.
 *
 * The fixture moves the event's creation back in the database; dates are
 * then derived from the site's own "today" so the spec holds in any site
 * timezone.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../../e2e/support/wp-cli.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const DAYS_SINCE_CREATION = 20;

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

/**
 * Shift a Y-m-d date by whole days, without any timezone conversion.
 *
 * @param {string} date Y-m-d date.
 * @param {number} days Days to add (may be negative).
 * @return {string} Shifted Y-m-d date.
 */
function shiftDate( date, days ) {
	const shifted = new Date( `${ date }T00:00:00Z` );
	shifted.setUTCDate( shifted.getUTCDate() + days );
	return shifted.toISOString().slice( 0, 10 );
}

const ticketType = {
	name: 'Regular',
	capacity: null,
	minimum_activities: 0,
	disable_at: null,
	recurrence_scope: 'single_instance',
	group_ids: [],
};

test.describe( 'Sale periods — empty first start uses the creation day', () => {
	test.setTimeout( 120_000 );

	let adminContext;
	let adminPage;
	let eventPost;
	let eventDateId;
	let creation;
	const stamp = Date.now();

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext( { locale: 'en-US' } );
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Sale start from creation e2e ${ stamp }`,
				status: 'publish',
				content: '<!-- wp:fair-events/event-prices /-->',
			},
		} );

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Sale start from creation e2e ${ stamp }`,
				link_type: 'post',
				start_date: '2036-05-10',
				start_time: '18:00:00',
				end_date: '2036-05-10',
				end_time: '22:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPost.id },
		} );

		creation = runScript(
			'event-date-creation-fixture.php',
			'E2E_CREATION',
			`${ eventDateId } ${ DAYS_SINCE_CREATION }`
		);
	} );

	test.afterAll( async () => {
		if ( eventPost?.id ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPost.id }`,
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

	const saveTickets = ( salePeriods, prices, multiple ) =>
		apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [ ticketType ],
				sale_periods: salePeriods,
				prices: prices.map( ( price, index ) => ( {
					ticket_type_index: 0,
					sale_period_index: index,
					price,
				} ) ),
				options: [],
				settings: { multiple_pricing_periods: multiple },
			},
		} );

	const openSalePeriods = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`
		);
		await adminPage.getByRole( 'button', { name: 'Sale Periods' } ).click();
	};

	// The "Sale start at:" line above the sale-period editor.
	const saleStartSummary = () =>
		adminPage
			.locator( 'div', {
				has: adminPage.getByText( 'Sale start at:', { exact: true } ),
			} )
			.last();

	// The admin summary's own wording of a date (see EventTickets.js).
	const adminDateLabel = ( date ) =>
		adminPage.evaluate(
			( value ) =>
				new Intl.DateTimeFormat( undefined, {
					weekday: 'long',
					day: 'numeric',
					month: 'long',
				} ).format( new Date( `${ value }T00:00:00` ) ),
			date
		);

	const readJsonLd = async ( page ) => {
		await page.goto( eventPost.link );
		const scripts = await page
			.locator( 'script[type="application/ld+json"]' )
			.allTextContents();
		return scripts
			.map( ( raw ) => JSON.parse( raw ) )
			.find( ( data ) => 'Event' === data[ '@type' ] );
	};

	test( 'admin, public prices and JSON-LD agree on the creation-day start', async ( {
		browser,
	} ) => {
		const { createdDate, createdLabel, today } = creation;
		expect( createdDate ).toBe( shiftDate( today, -DAYS_SINCE_CREATION ) );

		const saved = await saveTickets(
			[ { name: '', sale_start: '', sale_end: shiftDate( today, 10 ) } ],
			[ 15 ],
			false
		);
		// The inferred start is never stored, and the response reports the
		// creation day it is derived from.
		expect( saved.sale_periods[ 0 ].sale_start ).toBeFalsy();
		expect( saved.created_date ).toBe( createdDate );

		await openSalePeriods();
		await expect( saleStartSummary() ).toContainText(
			await adminDateLabel( createdDate )
		);
		const fromInput = adminPage.getByLabel( 'From', { exact: true } );
		await expect( fromInput ).toHaveValue( '' );
		await expect( fromInput ).toHaveAttribute( 'placeholder', createdDate );

		const visitor = await browser.newContext();
		const visitorPage = await visitor.newPage();
		try {
			const data = await readJsonLd( visitorPage );
			await expect(
				visitorPage.locator(
					'.wp-block-fair-events-event-prices__period-dates'
				)
			).toContainText( createdLabel );

			expect( data.offers ).toHaveLength( 1 );
			expect( data.offers[ 0 ].validFrom ).toMatch(
				new RegExp( `^${ createdDate }T00:00:00` )
			);
		} finally {
			await visitor.close();
		}
	} );

	test( 'an ended first period keeps its range; the next one keeps its explicit start', async ( {
		browser,
	} ) => {
		const { createdDate, createdLabel, today } = creation;
		const switchDate = shiftDate( today, -5 );

		await saveTickets(
			[
				{ name: 'Early', sale_start: '', sale_end: switchDate },
				{
					name: 'Regular',
					sale_start: switchDate,
					sale_end: shiftDate( today, 10 ),
				},
			],
			[ 10, 15 ],
			true
		);

		await openSalePeriods();
		// The calendar is shown only once every boundary has resolved.
		await expect(
			adminPage.getByText( 'Event day', { exact: true } )
		).toBeVisible();
		await expect( saleStartSummary() ).toContainText(
			await adminDateLabel( createdDate )
		);
		await expect(
			adminPage.locator(
				`input[type="date"][placeholder="${ createdDate }"]`
			)
		).toHaveCount( 1 );

		const visitor = await browser.newContext();
		const visitorPage = await visitor.newPage();
		try {
			const data = await readJsonLd( visitorPage );
			const ranges = visitorPage.locator(
				'.wp-block-fair-events-event-prices__period-dates'
			);
			await expect( ranges ).toHaveCount( 2 );
			await expect( ranges.first() ).toContainText( createdLabel );

			// The ended period is not advertised; the active one is, from
			// its explicit start.
			expect( data.offers ).toHaveLength( 1 );
			expect( data.offers[ 0 ].price ).toBe( '15' );
			expect( data.offers[ 0 ].validFrom ).toMatch(
				new RegExp( `^${ switchDate }T00:00:00` )
			);
		} finally {
			await visitor.close();
		}
	} );

	test( "a series occurrence uses its series' creation day", async () => {
		const series = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Sale start series e2e ${ stamp }`,
				start_date: '2036-06-03',
				start_time: '18:00:00',
				end_date: '2036-06-03',
				end_time: '20:00:00',
			},
		} );

		try {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ series.id }`,
				method: 'PUT',
				data: { rrule: 'FREQ=WEEKLY;COUNT=3' },
			} );
			const seriesCreation = runScript(
				'event-date-creation-fixture.php',
				'E2E_CREATION',
				`${ series.id } ${ DAYS_SINCE_CREATION }`
			);

			const master = await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ series.id }`,
			} );
			const occurrence = master.generated_occurrences.at( -1 );
			expect( occurrence ).toBeTruthy();

			const tickets = await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ occurrence.id }/tickets`,
			} );
			expect( tickets.created_date ).toBe( seriesCreation.createdDate );
		} finally {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ series.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );
} );
