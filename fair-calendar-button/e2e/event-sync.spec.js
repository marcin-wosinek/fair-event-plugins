import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CALENDAR_BUTTON = 'fair-calendar-button/fair-calendar-button';
const BLOCK_NAME = 'fair-calendar-button/calendar-button';
// The server-rendered wrapper that carries the calendar data.
const BUTTON = '.calendar-button-container';

/**
 * Regression for #1961: "Keep in sync with event data" reads the event from
 * Fair Events, in the editor and on every public render.
 *
 * Inserts a synchronized button on an event post, saves it, changes the
 * event (all-day, venue) without touching the post, and checks the public
 * calendar links and ICS download; then reopens the editor, and finally
 * checks that an event without an end time can't be exported.
 *
 * Runs in UTC so the calendar links' timestamps are predictable.
 *
 * Run: `npm run test:e2e:local -- --workspace=fair-calendar-button -- e2e/event-sync.spec.js`.
 */
test.use( { timezoneId: 'UTC' } );

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			const res = await wp.apiFetch( opts );
			return { ok: true, data: res };
		} catch ( err ) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
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
	// The login form focuses and selects the username field once its
	// script runs; fill only after that, and check both values, so typing
	// never lands in the wrong field.
	await page.goto( '/wp-login.php', { waitUntil: 'load' } );
	await page.fill( '#user_login', WP_ADMIN_USER );
	await page.fill( '#user_pass', WP_ADMIN_PASS );
	await expect( page.locator( '#user_login' ) ).toHaveValue( WP_ADMIN_USER );
	await expect( page.locator( '#user_pass' ) ).toHaveValue( WP_ADMIN_PASS );
	await page.click( '#wp-submit' );
	await page.waitForSelector( '#wpadminbar' );
}

async function setPluginStatus( page, plugin, status ) {
	await apiFetch( page, {
		path: `/wp/v2/plugins/${ plugin }`,
		method: 'POST',
		data: { status },
	} );
}

async function openEditor( page, postId ) {
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
	await page.waitForFunction(
		() =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId() &&
			window.wp.blocks.getBlockType(
				'fair-calendar-button/calendar-button'
			)
	);
	// The welcome guide of a fresh admin session covers the editor.
	await page.evaluate( () => {
		wp.data
			.dispatch( 'core/preferences' )
			.set( 'core/edit-post', 'welcomeGuide', false );
	} );
}

async function selectCalendarButton( page ) {
	await page.evaluate( ( name ) => {
		const { select, dispatch } = wp.data;
		const block = select( 'core/block-editor' )
			.getBlocks()
			.find( ( candidate ) => candidate.name === name );
		dispatch( 'core/block-editor' ).selectBlock( block.clientId );
		dispatch( 'core/edit-post' ).openGeneralSidebar( 'edit-post/block' );
	}, BLOCK_NAME );
}

function calendarButtonAttributes( page ) {
	return page.evaluate(
		( name ) =>
			wp.data
				.select( 'core/block-editor' )
				.getBlocks()
				.find( ( block ) => block.name === name )?.attributes,
		BLOCK_NAME
	);
}

async function savePost( page ) {
	await page.evaluate( async () => {
		await wp.data.dispatch( 'core/editor' ).savePost();
	} );
}

/**
 * Open the public page, open the calendar menu, and collect the Google
 * Calendar link and the ICS download content.
 *
 * @param {import('@playwright/test').Page} page Visitor page.
 * @param {string}                          url  Public page URL.
 * @return {Promise<{data: Object, google: string, ics: string}>} Export.
 */
async function publicCalendarExport( page, url ) {
	// Capture the links instead of opening them.
	await page.addInitScript( () => {
		window.__calendarLinks = {};
		window.open = ( href ) => {
			window.__calendarLinks.web = href;
		};
		const { prototype } = window.HTMLAnchorElement;
		const click = prototype.click;
		prototype.click = function () {
			if ( this.download ) {
				window.__calendarLinks.ics = this.href;
				return;
			}
			return click.call( this );
		};
	} );
	await page.goto( url );

	const container = page.locator( BUTTON );
	const data = await container.evaluate( ( element ) => ( {
		...element.dataset,
	} ) );

	await container.locator( '.wp-block-button__link' ).click();
	const dropdown = page.locator( '.calendar-dropdown' );
	await dropdown.locator( '[data-provider="google"]' ).click();
	await container.locator( '.wp-block-button__link' ).click();
	await dropdown.locator( '[data-provider="ics"]' ).click();

	const links = await page.evaluate( () => window.__calendarLinks );
	return {
		data,
		google: decodeURIComponent( links.web ),
		ics: decodeURIComponent( links.ics ),
	};
}

test.describe( 'Calendar Button synchronized with Fair Events', () => {
	test( 'follows the event in the editor and on the site', async ( {
		page,
		browser,
	} ) => {
		test.setTimeout( 180_000 );
		const stamp = Date.now();

		await login( page );
		await page.goto( '/wp-admin/post-new.php' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const plugins = await apiFetch( page, { path: '/wp/v2/plugins' } );
		const wasActive = plugins.some(
			( { plugin, status } ) =>
				plugin === CALENDAR_BUTTON && status === 'active'
		);

		let eventDateId = null;
		let postId = null;
		let venueId = null;

		try {
			if ( ! wasActive ) {
				await setPluginStatus( page, CALENDAR_BUTTON, 'active' );
			}

			const eventDate = await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: `Calendar sync e2e ${ stamp }`,
					start_date: '2030-06-14',
					start_time: '19:00',
					end_date: '2030-06-14',
					end_time: '21:00',
					all_day: false,
				},
			} );
			eventDateId = eventDate.id;
			// The create route ignores the address; only updates set it.
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'PUT',
				data: { address: 'Plaza Mayor 1, Madrid' },
			} );

			const post = await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }/create-post`,
				method: 'POST',
				data: { post_status: 'publish' },
			} );
			postId = post.event_id || post.post_id;

			// A new button on the event post synchronizes on its own.
			await openEditor( page, postId );
			await page.evaluate( ( name ) => {
				const { data, blocks } = window.wp;
				data.dispatch( 'core/block-editor' ).insertBlock(
					blocks.createBlock( name )
				);
			}, BLOCK_NAME );

			await expect
				.poll( () => calendarButtonAttributes( page ) )
				.toMatchObject( {
					syncWithEvent: true,
					start: '2030-06-14T19:00',
					end: '2030-06-14T21:00',
					allDay: false,
					location: 'Plaza Mayor 1, Madrid',
				} );

			await selectCalendarButton( page );
			await expect(
				page.getByLabel( 'Keep in sync with event data' )
			).toBeChecked();
			await expect( page.getByLabel( 'Location' ) ).toBeDisabled();
			await savePost( page );

			const permalink = await page.evaluate( () =>
				window.wp.data.select( 'core/editor' ).getPermalink()
			);

			// Timed event: the saved button exports the event's times.
			const visitor = await browser.newPage();
			const timed = await publicCalendarExport( visitor, permalink );
			expect( timed.data ).toMatchObject( {
				start: '2030-06-14T19:00',
				end: '2030-06-14T21:00',
				allDay: 'false',
				location: 'Plaza Mayor 1, Madrid',
			} );
			expect( timed.data.calendarAvailable ).toBeUndefined();
			expect( timed.google ).toContain(
				'dates=20300614T190000Z/20300614T210000Z'
			);
			expect( timed.google ).toContain( 'Plaza Mayor 1, Madrid' );
			expect( timed.ics ).toContain( 'DTSTART:20300614T190000Z' );
			expect( timed.ics ).toContain( 'DTEND:20300614T210000Z' );
			await visitor.close();

			// Change the event without saving the post again: an all-day
			// event over three days, at a venue.
			const venue = await apiFetch( page, {
				path: '/fair-events/v1/venues',
				method: 'POST',
				data: {
					name: `Town Hall ${ stamp }`,
					address: 'Main St 2',
				},
			} );
			venueId = venue.id;
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'PUT',
				data: {
					all_day: true,
					end_date: '2030-06-16',
					venue_id: venueId,
				},
			} );

			const venueLocation = `Town Hall ${ stamp }, Main St 2`;
			const allDayVisitor = await browser.newPage();
			const allDay = await publicCalendarExport(
				allDayVisitor,
				permalink
			);
			expect( allDay.data ).toMatchObject( {
				start: '2030-06-14',
				end: '2030-06-16',
				allDay: 'true',
				location: venueLocation,
			} );
			// All-day calendar entries end the day after the last day.
			expect( allDay.google ).toContain( 'dates=20300614/20300617' );
			expect( allDay.google ).toContain( venueLocation );
			expect( allDay.ics ).toMatch( /^DTSTART:20300614\r?$/m );
			expect( allDay.ics ).toMatch( /^DTEND:20300617\r?$/m );
			expect( allDay.ics ).toContain(
				'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE'
			);
			expect( allDay.ics ).toContain( `LOCATION:${ venueLocation }` );
			await allDayVisitor.close();

			// Reopening the post refreshes the saved attributes.
			await openEditor( page, postId );
			await expect
				.poll( () => calendarButtonAttributes( page ) )
				.toMatchObject( {
					start: '2030-06-14',
					end: '2030-06-16',
					allDay: true,
					location: venueLocation,
				} );

			// A timed event without an end time can't be exported.
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'PUT',
				data: {
					all_day: false,
					end_date: '2030-06-14',
					start_time: '19:00',
					end_time: null,
				},
			} );

			await openEditor( page, postId );
			await selectCalendarButton( page );
			await expect(
				page.getByText( /both a start and an end time/ ).first()
			).toBeVisible();

			const incompleteVisitor = await browser.newPage();
			await incompleteVisitor.goto( permalink );
			const incomplete = incompleteVisitor.locator( BUTTON );
			await expect( incomplete ).toHaveAttribute(
				'data-calendar-available',
				'false'
			);
			await expect( incomplete ).toHaveAttribute( 'data-start', '' );
			await incomplete.locator( '.wp-block-button__link' ).click();
			await expect(
				incompleteVisitor.locator( '.calendar-dropdown' )
			).toHaveCount( 0 );
			await incompleteVisitor.close();
		} finally {
			if ( postId ) {
				await apiFetch( page, {
					path: `/wp/v2/fair_event/${ postId }`,
					method: 'DELETE',
					data: { force: true },
				} ).catch( () => {} );
			}
			if ( eventDateId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDateId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			if ( venueId ) {
				await apiFetch( page, {
					path: `/fair-events/v1/venues/${ venueId }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			if ( ! wasActive ) {
				await setPluginStatus( page, CALENDAR_BUTTON, 'inactive' );
			}
		}
	} );
} );
