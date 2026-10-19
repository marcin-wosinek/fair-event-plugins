/**
 * E2E: events with dates and independently optional times (#1851).
 *
 * Covers creating a date-only event from the calendar's Add Event popup,
 * reopening it and adding or clearing either time, validation, the public
 * event page, week view and calendar button for every time combination, a
 * series date that owns its times and gets them back, copying without a
 * time, and calendar placement with the site and browser in different
 * timezones.
 */
import { test, expect } from '@playwright/test';
import { wpCli } from '../../e2e/support/wp-cli.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const UNAVAILABLE =
	'Both start and end times are required to add this event to a calendar.';

// A browser far ahead of the site: a timestamp read in the browser lands on
// the next day, so only date-based placement keeps events on their day.
test.use( { timezoneId: 'Pacific/Kiritimati' } );

let originalTimezone = '';

test.beforeAll( () => {
	originalTimezone = wpCli( 'option get timezone_string', {
		allowFailure: true,
	} ).trim();
	wpCli( 'option update timezone_string Europe/Madrid' );
} );

test.afterAll( () => {
	wpCli( `option update timezone_string "${ originalTimezone }"` );
} );

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
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message || String( error ) };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error( result.error );
	}
	return result.data;
}

async function openAdmin( page ) {
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
}

const BLOCKS = [
	'<!-- wp:fair-events/event-info /-->',
	'<!-- wp:buttons -->',
	'<div class="wp-block-buttons"><!-- wp:button {"isCalendarButton":true} -->',
	'<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Add to calendar</a></div>',
	'<!-- /wp:button --></div>',
	'<!-- /wp:buttons -->',
].join( '\n' );

/**
 * Create an event page with event info and a calendar button.
 *
 * @param {import('@playwright/test').Page} page    Admin page.
 * @param {string}                          title   Event title.
 * @param {Object}                          timing  Canonical timing to create.
 * @param {Object}                          cleanup Collected ids to delete.
 * @return {Promise<{post: Object, eventDate: Object}>} Created records.
 */
async function createEventPage( page, title, timing, cleanup ) {
	const post = await apiFetch( page, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: { title, status: 'publish', content: BLOCKS },
	} );
	cleanup.posts.push( post.id );
	const eventDate = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: { title, link_type: 'post', ...timing },
	} );
	cleanup.dates.push( eventDate.id );
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ eventDate.id }`,
		method: 'PUT',
		data: { event_id: post.id },
	} );
	return { post, eventDate };
}

async function removeAll( page, cleanup ) {
	// Public pages don't load wp.apiFetch: clean up from an admin screen.
	await openAdmin( page ).catch( () => {} );
	const paths = [
		...cleanup.dates.map( ( id ) => `/fair-events/v1/event-dates/${ id }` ),
		...cleanup.posts.map(
			( id ) => `/wp/v2/fair_event/${ id }?force=true`
		),
		...( cleanup.pages || [] ).map(
			( id ) => `/wp/v2/pages/${ id }?force=true`
		),
	];
	for ( const path of paths ) {
		await page
			.evaluate(
				( target ) =>
					// eslint-disable-next-line no-undef
					wp
						.apiFetch( { path: target, method: 'DELETE' } )
						.catch( () => {} ),
				path
			)
			.catch( () => {} );
	}
}

const readDate = ( page, id ) =>
	apiFetch( page, { path: `/fair-events/v1/event-dates/${ id }` } );

const calendarDay = ( page, day ) =>
	page.locator( '.fair-events-calendar-day.current-month' ).filter( {
		has: page.locator( '.fair-events-calendar-day-number', {
			hasText: new RegExp( `^${ day }$` ),
		} ),
	} );

test( 'creates a date-only event in the popup, then adds and clears each time', async ( {
	page,
} ) => {
	test.setTimeout( 180_000 );
	const cleanup = { dates: [], posts: [] };
	const title = `Dates known ${ Date.now() }`;
	await openAdmin( page );

	try {
		await page.goto(
			'/wp-admin/admin.php?page=fair-events-calendar&month=2041-03'
		);
		const day = calendarDay( page, 12 );
		await day.hover();
		await day
			.getByRole( 'button', { name: 'Add event' } )
			.click( { force: true } );

		const dialog = page.getByRole( 'dialog', { name: 'Quick Add Event' } );
		await dialog.getByLabel( 'Title' ).fill( title );
		await expect( dialog.getByLabel( 'Start date' ) ).toHaveValue(
			'2041-03-12'
		);
		await dialog.getByLabel( 'Start time (optional)' ).fill( '' );
		await dialog.getByLabel( 'End time (optional)' ).fill( '' );
		await expect( dialog.getByLabel( 'All day' ) ).not.toBeChecked();

		const created = page.waitForResponse(
			( response ) =>
				response.url().includes( 'event-dates' ) &&
				response.request().method() === 'POST'
		);
		await dialog.getByRole( 'button', { name: 'Create Event' } ).click();
		const eventDate = await ( await created ).json();
		cleanup.dates.push( eventDate.id );
		expect( eventDate ).toMatchObject( {
			start_date: '2041-03-12',
			end_date: '2041-03-12',
			start_time: null,
			end_time: null,
			all_day: false,
		} );

		// Placed on its date although it has no start timestamp.
		await expect( calendarDay( page, 12 ) ).toContainText( title );

		// Reopen: both times stay empty.
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDate.id }&tab=event-details`
		);
		const startTime = page.getByLabel( 'Start time (optional)' );
		const endTime = page.getByLabel( 'End time (optional)' );
		await expect( startTime ).toHaveValue( '' );
		await expect( endTime ).toHaveValue( '' );
		await expect(
			page.locator( '.fair-events-context-header, .wrap' ).first()
		).not.toContainText( '12:00 am' );

		// Start time only.
		await startTime.fill( '19:30' );
		await page
			.getByRole( 'button', { name: 'Save event details' } )
			.click();
		await expect(
			page.getByText( 'Event updated successfully.' ).first()
		).toBeVisible();
		expect( await readDate( page, eventDate.id ) ).toMatchObject( {
			start_time: '19:30:00',
			end_time: null,
			all_day: false,
		} );

		// Swap to an end time only, after a reload.
		await page.reload();
		await expect( startTime ).toHaveValue( '19:30' );
		await expect( endTime ).toHaveValue( '' );
		await startTime.fill( '' );
		await endTime.fill( '21:00' );
		await page
			.getByRole( 'button', { name: 'Save event details' } )
			.click();
		await expect(
			page.getByText( 'Event updated successfully.' ).first()
		).toBeVisible();
		expect( await readDate( page, eventDate.id ) ).toMatchObject( {
			start_time: null,
			end_time: '21:00:00',
		} );
		await page.reload();
		await expect( startTime ).toHaveValue( '' );
		await expect( endTime ).toHaveValue( '21:00' );
		await expect( page.getByText( /ends 9:00 pm/i ).first() ).toBeVisible();
		await expect(
			page.locator( '.fair-events-timing-status' )
		).toContainText( 'both start and end times are required' );

		// Both times: the export note goes away.
		await startTime.fill( '19:00' );
		await page
			.getByRole( 'button', { name: 'Save event details' } )
			.click();
		await expect(
			page.getByText( 'Event updated successfully.' ).first()
		).toBeVisible();
		await page.reload();
		await expect(
			page.locator( '.fair-events-timing-status' )
		).toHaveCount( 0 );
	} finally {
		await removeAll( page, cleanup );
	}
} );

test( 'explains invalid ranges and never compares a missing time', async ( {
	page,
} ) => {
	const cleanup = { dates: [], posts: [] };
	await openAdmin( page );

	try {
		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Range check ${ Date.now() }`,
				start_date: '2041-03-12',
				start_time: '18:00',
				end_time: '20:00',
				link_type: 'none',
			},
		} );
		cleanup.dates.push( eventDate.id );
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDate.id }&tab=event-details`
		);
		const save = page.getByRole( 'button', { name: 'Save event details' } );

		await page.getByLabel( 'End date' ).fill( '2041-03-11' );
		await expect(
			page.getByText( 'The end date is before the start date.' ).first()
		).toBeVisible();
		await expect( save ).toBeDisabled();

		await page.getByLabel( 'End date' ).fill( '2041-03-12' );
		await page.getByLabel( 'End time (optional)' ).fill( '17:00' );
		await expect(
			page
				.getByText(
					'The end time is before the start time on the same day.'
				)
				.first()
		).toBeVisible();
		await expect( save ).toBeDisabled();

		await page.getByLabel( 'Start time (optional)' ).fill( '' );
		await expect( save ).toBeEnabled();
	} finally {
		await removeAll( page, cleanup );
	}
} );

test( 'public pages show only supplied times and explain calendar export', async ( {
	page,
} ) => {
	test.setTimeout( 180_000 );
	const cleanup = { dates: [], posts: [] };
	const suffix = Date.now();
	await openAdmin( page );

	try {
		const cases = [
			{
				name: 'none',
				timing: { start_date: '2041-03-12' },
				info: '12 March 2041',
				week: null,
				exportable: false,
			},
			{
				name: 'start',
				timing: { start_date: '2041-03-12', start_time: '10:00' },
				info: '10:00, 12 March 2041',
				week: '10:00',
				exportable: false,
			},
			{
				name: 'end',
				timing: { start_date: '2041-03-12', end_time: '12:00' },
				info: 'Ends 12:00, 12 March 2041',
				week: 'Ends 12:00',
				exportable: false,
			},
			{
				name: 'both',
				timing: {
					start_date: '2041-03-12',
					start_time: '00:00',
					end_time: '02:00',
				},
				info: '00:00—02:00, 12 March 2041',
				week: '00:00',
				exportable: true,
			},
			{
				name: 'multi',
				timing: {
					start_date: '2041-03-13',
					end_date: '2041-03-15',
					end_time: '17:00',
				},
				info: '13 March 2041—ends 17:00 15 March 2041',
				week: null,
				exportable: false,
			},
			{
				name: 'allday',
				timing: {
					start_date: '2041-03-12',
					all_day: true,
				},
				info: '12 March 2041',
				week: null,
				exportable: true,
			},
		];

		const links = {};
		for ( const item of cases ) {
			const { post } = await createEventPage(
				page,
				`Public ${ item.name } ${ suffix }`,
				item.timing,
				cleanup
			);
			links[ item.name ] = post.link;
		}
		const weekPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Week ${ suffix }`,
				status: 'publish',
				content: '<!-- wp:fair-events/events-week /-->',
			},
		} );
		cleanup.pages = [ weekPage.id ];

		for ( const item of cases ) {
			await page.goto( links[ item.name ] );
			await expect(
				page.locator( '.wp-block-fair-events-event-info__dates' )
			).toHaveText( item.info );
			const button = page.locator( '.wp-block-button__link' ).first();
			if ( item.exportable ) {
				await expect( button ).not.toHaveAttribute(
					'data-calendar-available',
					'false'
				);
				await expect( page.getByText( UNAVAILABLE ) ).toHaveCount( 0 );
			} else {
				await expect( button ).toHaveAttribute(
					'data-calendar-available',
					'false'
				);
				await expect( button ).toHaveAttribute(
					'aria-disabled',
					'true'
				);
				const note = page.getByText( UNAVAILABLE );
				await expect( note ).toBeVisible();
				await expect( button ).toHaveAttribute(
					'aria-describedby',
					( await note.getAttribute( 'id' ) ) || 'missing'
				);
			}
		}

		// Week view: supplied times only, an end-only time labelled.
		await page.goto( `${ weekPage.link }?week_view=2041-W11` );
		for ( const item of cases ) {
			const entry = page
				.locator( '.week-event' )
				.filter( { hasText: `Public ${ item.name } ${ suffix }` } )
				.first();
			await expect( entry ).toBeVisible();
			const time = entry.locator( '.week-event-time' );
			if ( item.week ) {
				await expect( time ).toHaveText( item.week );
			} else {
				await expect( time ).toHaveCount( 0 );
			}
		}
		// The multi-day end-only date covers three days and shows its end
		// on the last one only.
		await expect(
			page
				.locator( '.week-day' )
				.filter( { hasText: `Public multi ${ suffix }` } )
		).toHaveCount( 3 );
		await expect(
			page
				.locator( '.week-day[data-date="2041-03-15"] .week-event' )
				.filter( { hasText: `Public multi ${ suffix }` } )
				.locator( '.week-event-time' )
		).toHaveText( 'Ends 17:00' );
	} finally {
		await removeAll( page, cleanup );
	}
} );

test( 'a series date clears a time on its own and gets the series times back', async ( {
	page,
} ) => {
	test.setTimeout( 180_000 );
	const cleanup = { dates: [], posts: [] };
	await openAdmin( page );

	try {
		const series = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Weekly class ${ Date.now() }`,
				start_date: '2041-03-14',
				start_time: '18:00',
				end_time: '20:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
				link_type: 'none',
			},
		} );
		cleanup.dates.push( series.id );
		const occurrence = series.generated_occurrences.find(
			( occ ) => occ.start_date === '2041-03-21'
		);
		expect( occurrence ).toBeTruthy();

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ occurrence.id }&tab=event-details`
		);
		await expect(
			page.getByText( /The times follow the series/ )
		).toBeVisible();
		await page.getByLabel( 'End time (optional)' ).fill( '' );
		await page
			.getByRole( 'button', { name: 'Save event details' } )
			.click();
		await expect(
			page.getByText( 'Event updated successfully.' ).first()
		).toBeVisible();

		const own = await readDate( page, occurrence.id );
		expect( own ).toMatchObject( {
			start_time: '18:00:00',
			end_time: null,
			timing_overrides: { times: true },
		} );

		// A later series edit leaves this date's own times alone.
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ series.id }`,
			method: 'PUT',
			data: { end_time: '21:00' },
		} );
		expect( ( await readDate( page, occurrence.id ) ).end_time ).toBeNull();

		await page.reload();
		await expect(
			page.getByText( /This date has its own times/ )
		).toBeVisible();
		await page
			.getByRole( 'button', { name: 'Use the series times' } )
			.click();
		await expect(
			page.getByText( /The times follow the series/ )
		).toBeVisible();
		await expect( page.getByLabel( 'End time (optional)' ) ).toHaveValue(
			'21:00'
		);
		expect( await readDate( page, occurrence.id ) ).toMatchObject( {
			start_time: '18:00:00',
			end_time: '21:00:00',
			timing_overrides: { times: false },
		} );

		// Edit instances lists each date with its own timing.
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ series.id }&tab=event-details`
		);
		await page.getByRole( 'button', { name: 'Edit instances' } ).click();
		await expect(
			page.getByRole( 'dialog', { name: 'Edit instances' } )
		).toContainText( '9:00 pm' );
	} finally {
		await removeAll( page, cleanup );
	}
} );

test( 'a copy can drop a time the source has', async ( { page } ) => {
	test.setTimeout( 180_000 );
	const cleanup = { dates: [], posts: [] };
	await openAdmin( page );

	try {
		const source = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Copy source ${ Date.now() }`,
				start_date: '2041-03-12',
				end_date: '2041-03-13',
				start_time: '18:00',
				end_time: '11:00',
				link_type: 'none',
			},
		} );
		cleanup.dates.push( source.id );
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ source.id }&tab=admin`
		);
		const copyUrl = await page
			.getByRole( 'link', { name: 'Copy event' } )
			.getAttribute( 'href' );
		await page.goto( copyUrl );
		await expect( page.getByLabel( 'Start time (optional)' ) ).toHaveValue(
			'18:00'
		);
		await page.getByLabel( 'Start time (optional)' ).fill( '' );
		await page.getByRole( 'button', { name: 'Create Copy' } ).click();
		await expect( page ).toHaveURL( /fair-events-manage-event/ );
		const copyId = Number(
			new URL( page.url() ).searchParams.get( 'event_date_id' )
		);
		cleanup.dates.push( copyId );
		expect( await readDate( page, copyId ) ).toMatchObject( {
			start_date: '2041-03-19',
			end_date: '2041-03-20',
			start_time: null,
			end_time: '11:00:00',
			all_day: false,
		} );
	} finally {
		await removeAll( page, cleanup );
	}
} );

test( 'the admin calendar places dates by the site calendar day', async ( {
	page,
} ) => {
	const cleanup = { dates: [], posts: [] };
	const suffix = Date.now();
	await openAdmin( page );

	try {
		for ( const [ title, timing ] of [
			[
				`Late ${ suffix }`,
				{
					start_date: '2041-03-13',
					start_time: '23:30',
					end_time: '23:45',
				},
			],
			[ `DST day ${ suffix }`, { start_date: '2041-03-31' } ],
			[
				`Span ${ suffix }`,
				{ start_date: '2041-03-14', end_date: '2041-03-15' },
			],
		] ) {
			const created = await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: { title, link_type: 'none', ...timing },
			} );
			cleanup.dates.push( created.id );
		}

		await page.goto(
			'/wp-admin/admin.php?page=fair-events-calendar&month=2041-03'
		);
		await expect( calendarDay( page, 13 ) ).toContainText(
			`Late ${ suffix }`
		);
		await expect( calendarDay( page, 14 ) ).not.toContainText(
			`Late ${ suffix }`
		);
		await expect( calendarDay( page, 31 ) ).toContainText(
			`DST day ${ suffix }`
		);
		await expect( calendarDay( page, 14 ) ).toContainText(
			`Span ${ suffix }`
		);
		await expect( calendarDay( page, 15 ) ).toContainText(
			`Span ${ suffix }`
		);
	} finally {
		await removeAll( page, cleanup );
	}
} );
