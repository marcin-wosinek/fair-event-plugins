import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Regression for #1750: the "Turn into a series" popup used to grow a third
 * month (and widen) when a weekly series went from 9 to 10 dates. The calendar
 * now always shows two consecutive months that the organizer pages through.
 *
 * Runs in a browser timezone behind UTC, where a date-only string parsed as
 * UTC would land on the previous day (UI_GUIDELINES.md "Dates and times").
 */
test.use( { timezoneId: 'America/Los_Angeles' } );

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

function monthHeading( dialog, label ) {
	return dialog.getByText( label, { exact: true } );
}

// Layout width, which the modal's opening scale animation does not affect
// (a bounding box read mid-animation would).
async function dialogWidth( dialog ) {
	return dialog.evaluate( ( el ) => el.offsetWidth );
}

test.describe( 'Series popup calendar', () => {
	test( 'stays at two months while the schedule changes, pages, and saves', async ( {
		page,
	} ) => {
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );

		const master = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Series popup two-month calendar regression',
				start_datetime: '2026-09-01 18:00:00',
				end_datetime: '2026-09-01 20:00:00',
				all_day: false,
			},
		} );

		try {
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ master.id }`
			);
			await page
				.getByRole( 'button', { name: 'Turn into a series' } )
				.click();

			const dialog = page.getByRole( 'dialog' );
			const count = dialog.getByRole( 'spinbutton', {
				name: 'Number of occurrences',
			} );
			const previous = dialog.getByRole( 'button', {
				name: 'Previous months',
			} );
			const next = dialog.getByRole( 'button', { name: 'Next months' } );

			// Nine weekly dates end on Oct 27: both months cover the series.
			await count.fill( '9' );
			await expect( dialog.getByText( /^9 dates, until/ ) ).toBeVisible();
			await expect(
				monthHeading( dialog, 'September 2026' )
			).toBeVisible();
			await expect(
				monthHeading( dialog, 'October 2026' )
			).toBeVisible();
			await expect( previous ).toBeDisabled();
			await expect( next ).toBeDisabled();
			const widthWithNine = await dialogWidth( dialog );

			// The tenth date (Nov 3) must not add a month or widen the popup.
			await count.fill( '10' );
			await expect(
				dialog.getByText( /^10 dates, until/ )
			).toBeVisible();
			await expect( monthHeading( dialog, 'November 2026' ) ).toHaveCount(
				0
			);
			expect( await dialogWidth( dialog ) ).toBe( widthWithNine );

			// The master date keeps its day in a timezone behind UTC.
			await expect(
				dialog.getByText( '1', { exact: true } ).first()
			).toHaveCSS( 'background-color', 'rgb(0, 124, 186)' );

			await expect( next ).toBeEnabled();
			await next.click();
			await expect(
				monthHeading( dialog, 'November 2026' )
			).toBeVisible();
			await expect(
				monthHeading( dialog, 'December 2026' )
			).toBeVisible();
			await expect(
				monthHeading( dialog, 'September 2026' )
			).toHaveCount( 0 );
			await expect( next ).toBeDisabled();
			await expect(
				dialog.getByText( /^10 dates, until/ )
			).toBeVisible();

			// The irregular picker has its own view and keeps going forward.
			await dialog
				.getByRole( 'tab', { name: 'Irregular series' } )
				.click();
			await expect(
				monthHeading( dialog, 'September 2026' )
			).toBeVisible();
			await expect(
				monthHeading( dialog, 'October 2026' )
			).toBeVisible();
			await expect( previous ).toBeDisabled();
			await next.click();
			await next.click();
			await expect(
				monthHeading( dialog, 'January 2027' )
			).toBeVisible();
			await expect(
				dialog.getByText( '1 dates selected' )
			).toBeVisible();

			// Back on the regular tab the view is where it was left.
			await dialog
				.getByRole( 'tab', { name: 'Regular schedule' } )
				.click();
			await expect(
				monthHeading( dialog, 'November 2026' )
			).toBeVisible();

			// At phone width the months stack instead of scrolling sideways.
			await page.setViewportSize( { width: 375, height: 812 } );
			await expect(
				monthHeading( dialog, 'December 2026' )
			).toBeVisible();
			const overflow = await dialog.evaluate( ( el ) =>
				[ el, ...el.querySelectorAll( '.components-modal__content' ) ]
					.filter( ( node ) => node.scrollWidth > node.clientWidth )
					.map( ( node ) => node.className )
			);
			expect( overflow ).toEqual( [] );
			await previous.click();
			await expect(
				monthHeading( dialog, 'September 2026' )
			).toBeVisible();

			// Paging changed nothing about what gets saved.
			await dialog
				.getByRole( 'button', { name: 'Create series — 10 dates' } )
				.click();
			await expect( dialog ).toHaveCount( 0 );

			const saved = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ master.id }`,
			} );
			expect( saved.rrule ).toBe( 'FREQ=WEEKLY;COUNT=10' );
			const dates = saved.generated_occurrences
				.map( ( occ ) => occ.start_datetime )
				.sort();
			expect( dates ).toHaveLength( 9 );
			expect( dates[ 0 ] ).toBe( '2026-09-08 18:00:00' );
			expect( dates[ 8 ] ).toBe( '2026-11-03 18:00:00' );
		} finally {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ master.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );
} );

/**
 * #1749: generated dates in the Regular schedule calendar can be skipped and
 * restored before saving, and a saved skip comes back when the series is
 * reopened.
 *
 * Runs with the site and the browser both on Europe/Madrid, ahead of UTC,
 * where a date-only value converted through UTC lands on the wrong day
 * (UI_GUIDELINES.md "Dates and times").
 */
test.describe( 'Series popup calendar — skipping dates', () => {
	test.use( { timezoneId: 'Europe/Madrid' } );

	test( 'skips a date, saves it, shows it on reopening, and restores it', async ( {
		page,
	} ) => {
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );

		const settings = await apiFetch( page, { path: '/wp/v2/settings' } );
		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { timezone: 'Europe/Madrid' },
		} );

		const master = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Series popup skipped dates',
				// Late evening: the next day already in UTC+1/+2 terms.
				start_datetime: '2026-09-01 23:30:00',
				end_datetime: '2026-09-02 00:30:00',
				all_day: false,
			},
		} );
		const managePage = `/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ master.id }`;

		try {
			await page.goto( managePage );
			await page
				.getByRole( 'button', { name: 'Turn into a series' } )
				.click();

			const dialog = page.getByRole( 'dialog' );
			const day = ( label ) =>
				dialog.getByRole( 'button', { name: new RegExp( label ) } );

			await dialog
				.getByRole( 'spinbutton', { name: 'Number of occurrences' } )
				.fill( '4' );
			await expect( dialog.getByText( /^4 dates, until/ ) ).toBeVisible();

			// The original date is shown but cannot be skipped; a day outside
			// the schedule is not a control at all.
			await expect( day( 'September 1, 2026' ) ).toBeDisabled();
			await expect( day( 'September 2, 2026' ) ).toHaveCount( 0 );

			// Keyboard only: skip with Enter, restore with Space.
			const second = day( 'September 8, 2026' );
			await second.focus();
			await page.keyboard.press( 'Enter' );
			await expect( second ).toHaveAttribute( 'aria-pressed', 'false' );
			await expect( dialog.getByText( /^3 dates, until/ ) ).toBeVisible();
			await expect( dialog.getByText( '1 date skipped' ) ).toBeVisible();
			await page.keyboard.press( 'Space' );
			await expect( second ).toHaveAttribute( 'aria-pressed', 'true' );
			await expect( dialog.getByText( /^4 dates, until/ ) ).toBeVisible();

			// Skip the third date and save.
			const third = day( 'September 15, 2026' );
			await third.click();
			await expect( third ).toHaveAttribute( 'aria-pressed', 'false' );
			await expect( third ).toHaveCSS(
				'text-decoration-line',
				'line-through'
			);
			// The schedule still ends on its fourth weekly date.
			await expect( day( 'September 22, 2026' ) ).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await expect( day( 'September 29, 2026' ) ).toHaveCount( 0 );

			await dialog
				.getByRole( 'button', { name: 'Create series — 3 dates' } )
				.click();
			await expect( dialog ).toHaveCount( 0 );

			const saved = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ master.id }`,
			} );
			expect( saved.rrule ).toBe( 'FREQ=WEEKLY;COUNT=4' );
			expect( saved.cancelled_dates ).toEqual( [ '2026-09-15' ] );
			const savedRows = Object.fromEntries(
				saved.generated_occurrences.map( ( occ ) => [
					occ.start_datetime,
					occ,
				] )
			);
			expect( Object.keys( savedRows ).sort() ).toEqual( [
				'2026-09-08 23:30:00',
				'2026-09-15 23:30:00',
				'2026-09-22 23:30:00',
			] );
			expect( savedRows[ '2026-09-15 23:30:00' ].status ).toBe(
				'cancelled'
			);

			// Reopened after a fresh page load, the skip is still there.
			await page.goto( managePage );
			await page.getByRole( 'button', { name: 'Edit series' } ).click();
			await expect( third ).toHaveAttribute( 'aria-pressed', 'false' );
			await expect( dialog.getByText( /^3 dates, until/ ) ).toBeVisible();
			await expect( dialog.getByText( '1 date skipped' ) ).toBeVisible();

			// Closing without saving discards a toggle.
			await second.click();
			await expect( dialog.getByText( '2 dates skipped' ) ).toBeVisible();
			await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
			await expect( dialog ).toHaveCount( 0 );
			await page.getByRole( 'button', { name: 'Edit series' } ).click();
			await expect( second ).toHaveAttribute( 'aria-pressed', 'true' );

			// Restoring brings the same occurrence back.
			await third.click();
			await dialog
				.getByRole( 'button', { name: 'Update series — 4 dates' } )
				.click();
			await expect( dialog ).toHaveCount( 0 );

			const restored = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ master.id }`,
			} );
			expect( restored.cancelled_dates ).toEqual( [] );
			const restoredRow = restored.generated_occurrences.find(
				( occ ) => occ.start_datetime === '2026-09-15 23:30:00'
			);
			expect( restoredRow.id ).toBe(
				savedRows[ '2026-09-15 23:30:00' ].id
			);
			expect( restoredRow.status ).toBe( 'active' );
		} finally {
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp && window.wp.apiFetch );
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ master.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: { timezone: settings.timezone },
			} ).catch( () => {} );
		}
	} );
} );
