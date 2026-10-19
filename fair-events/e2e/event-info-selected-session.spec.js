import { test, expect } from '@playwright/test';
import { timingFields } from '../../e2e/support/event-timing.js';

/**
 * Event Info: calendar → selected session → recurring overview (#1884).
 *
 * A visitor opens a session of a weekly series from the events calendar,
 * sees that session's own date, then follows "View recurring event" back to
 * the series overview. Also checks that the series' first session (the
 * master row) links to its own date from the calendar, like the others.
 * Initial-HTML coverage of every selection state lives in the root
 * e2e/fair-events-event-info-session.spec.js.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( err ) {
			return { ok: false, error: err?.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${ options.path } failed: ${
				result.error
			}`
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

const pad = ( n ) => String( n ).padStart( 2, '0' );

test( 'a calendar session opens that session, which links back to the recurring overview', async ( {
	page,
	browser,
} ) => {
	test.setTimeout( 120_000 );

	await login( page );
	await page.waitForFunction( () => window.wp?.apiFetch );

	// Three weekly sessions inside next month, so one calendar month shows
	// them all: the 3rd, 10th and 17th.
	const now = new Date();
	const year =
		now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
	const month = ( now.getMonth() + 1 ) % 12; // 0-based next month.
	const day = ( d ) => `${ year }-${ pad( month + 1 ) }-${ pad( d ) }`;
	const title = `Event Info Session Journey ${ Date.now() }`;

	const event = await apiFetch( page, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: {
			title,
			status: 'publish',
			content: '<!-- wp:fair-events/event-info /-->',
		},
	} );
	const ensured = await apiFetch( page, {
		path: '/fair-events/v1/event-dates/ensure-for-post',
		method: 'POST',
		data: { post_id: event.id },
	} );
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ ensured.id }`,
		method: 'PUT',
		data: {
			...timingFields(
				`${ day( 3 ) } 18:00:00`,
				`${ day( 3 ) } 20:00:00`
			),
			all_day: false,
			rrule: 'FREQ=WEEKLY;COUNT=3',
		},
	} );
	const calendarPage = await apiFetch( page, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: {
			title: `${ title } Calendar`,
			status: 'publish',
			content: '<!-- wp:fair-events/events-calendar /-->',
		},
	} );

	// Browse as a visitor.
	const visitor = await browser.newContext();
	const visitorPage = await visitor.newPage();

	try {
		const calendarUrl = new URL( calendarPage.link );
		calendarUrl.searchParams.set( 'calendar_month', pad( month + 1 ) );
		calendarUrl.searchParams.set( 'calendar_year', String( year ) );
		await visitorPage.goto( calendarUrl.toString() );

		const sessionLinks = visitorPage
			.locator( '.calendar-day a.event-title' )
			.filter( { hasText: title } );
		await expect( sessionLinks ).toHaveCount( 3 );

		// The first session is the series master; it links to its own date.
		const hrefs = await sessionLinks.evaluateAll( ( links ) =>
			links.map( ( link ) =>
				new URL( link.href ).searchParams.get( 'event_date' )
			)
		);
		expect( hrefs.sort() ).toEqual( [ day( 3 ), day( 10 ), day( 17 ) ] );

		await visitorPage
			.locator( `a[href*="event_date=${ day( 10 ) }"]` )
			.click();

		const info = visitorPage.locator( '.wp-block-fair-events-event-info' );
		await expect(
			info.locator( '.wp-block-fair-events-event-info__dates' )
		).toHaveText(
			new RegExp(
				`^\\s*18:00—20:00, 10 \\w+ ${ year }\\s*$` // Session date with year.
			)
		);
		await expect(
			info.locator( '.wp-block-fair-events-event-info__status' )
		).toHaveCount( 0 );

		await info
			.getByRole( 'link', { name: 'View recurring event' } )
			.click();

		expect(
			new URL( visitorPage.url() ).searchParams.has( 'event_date' )
		).toBe( false );
		await expect(
			info.locator( '.wp-block-fair-events-event-info__dates' )
		).toHaveText( /^\s*Every \w+, 18:00—20:00\s*$/ );
		await expect(
			info.locator( '.wp-block-fair-events-event-info__overview-link' )
		).toHaveCount( 0 );
	} finally {
		await visitor.close();
		await apiFetch( page, {
			path: `/wp/v2/pages/${ calendarPage.id }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ ensured.id }`,
			method: 'DELETE',
		} ).catch( () => {} );
		await apiFetch( page, {
			path: `/wp/v2/fair_event/${ event.id }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
	}
} );
