/**
 * E2E: an organizer drafts and republishes an event from Manage Event
 * (#1692).
 *
 * A drafted event leaves the public Events List (both the per-event and the
 * Query Loop layouts) and the calendar — even one set to show draft posts,
 * which keeps showing an event whose page is a draft — and its linked page
 * stops being public. Publishing brings all of it back. The saved state is
 * shown again after a reload, and the control works at desktop, tablet and
 * mobile widths.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const VIEWPORTS = {
	desktop: { width: 1280, height: 900 },
	tablet: { width: 768, height: 1024 },
	mobile: { width: 375, height: 812 },
};

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
	await page.waitForSelector( '#wpadminbar' );
}

const manageEventUrl = ( eventDateId ) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }`;

test.describe( 'Manage Event — draft and publish an event', () => {
	test.describe.configure( { mode: 'serial' } );
	test.setTimeout( 120_000 );

	let adminContext;
	let adminPage;
	let visitorContext;
	let visitorPage;

	const stamp = Date.now();
	const titles = {
		linked: `Publication linked event ${ stamp }`,
		calendarOnly: `Publication calendar-only event ${ stamp }`,
		draftPage: `Publication draft-page event ${ stamp }`,
	};
	const created = { eventDates: [], posts: [], pages: [] };
	let category;
	let pattern;
	let linkedEvent;
	let calendarOnlyEvent;
	let linkedPost;
	let perEventPage;
	let queryLoopPage;
	let calendarPage;
	let calendarMonth;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );
		await apiFetch( adminPage, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_register_post_type: true,
				fair_events_enabled_post_types: [ 'fair_event' ],
			},
		} );

		const now = Date.now();
		const iso = ( offsetHours ) =>
			new Date( now + offsetHours * 60 * 60 * 1000 )
				.toISOString()
				.slice( 0, 19 )
				.replace( 'T', ' ' );
		calendarMonth = iso( 2 ).slice( 0, 7 );

		// A unique category keeps these the only events on the pages below,
		// whatever other specs left behind in a reused instance.
		category = await apiFetch( adminPage, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Publication category ${ stamp }` },
		} );

		const createPostEvent = async ( title, status ) => {
			const post = await apiFetch( adminPage, {
				path: '/wp/v2/fair_event',
				method: 'POST',
				data: { title, status, categories: [ category.id ] },
			} );
			created.posts.push( post.id );
			const ensured = await apiFetch( adminPage, {
				path: '/fair-events/v1/event-dates/ensure-for-post',
				method: 'POST',
				data: { post_id: post.id },
			} );
			created.eventDates.push( ensured.id );
			const eventDate = await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ ensured.id }`,
				method: 'PUT',
				data: {
					title,
					start_datetime: iso( 2 ),
					end_datetime: iso( 3 ),
					all_day: false,
					categories: [ category.id ],
				},
			} );
			return { post, eventDate };
		};

		( { post: linkedPost, eventDate: linkedEvent } = await createPostEvent(
			titles.linked,
			'publish'
		) );
		// Published in Fair Events, but its page is still a draft.
		await createPostEvent( titles.draftPage, 'draft' );

		calendarOnlyEvent = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: titles.calendarOnly,
				start_datetime: iso( 2 ),
				end_datetime: iso( 3 ),
				all_day: false,
				categories: [ category.id ],
			},
		} );
		created.eventDates.push( calendarOnlyEvent.id );

		pattern = await apiFetch( adminPage, {
			path: '/wp/v2/blocks',
			method: 'POST',
			data: {
				title: `Publication per-event pattern ${ stamp }`,
				status: 'publish',
				content:
					'<!-- wp:html --><div class="per-event-fixture">{{title}}</div><!-- /wp:html -->',
			},
		} );

		const createPage = async ( title, content ) => {
			const page = await apiFetch( adminPage, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: { title, status: 'publish', content },
			} );
			created.pages.push( page.id );
			return page;
		};
		perEventPage = await createPage(
			`Publication per-event list ${ stamp }`,
			`<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"wp_block:${ pattern.id }","categories":[${ category.id }]} /-->`
		);
		queryLoopPage = await createPage(
			`Publication query loop list ${ stamp }`,
			`<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"fair-events/event-list","categories":[${ category.id }]} /-->`
		);
		calendarPage = await createPage(
			`Publication calendar ${ stamp }`,
			`<!-- wp:fair-events/events-calendar {"categories":[${ category.id }],"showDrafts":true} /-->`
		);

		visitorContext = await browser.newContext();
		visitorPage = await visitorContext.newPage();
	} );

	test.afterAll( async () => {
		if ( adminPage ) {
			await adminPage.setViewportSize( VIEWPORTS.desktop );
			await adminPage.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await adminPage.waitForFunction( () => window.wp?.apiFetch );
			const remove = ( path ) =>
				apiFetch( adminPage, { path, method: 'DELETE' } ).catch(
					() => {}
				);
			for ( const id of created.eventDates ) {
				await remove( `/fair-events/v1/event-dates/${ id }` );
			}
			for ( const id of created.posts ) {
				await remove( `/wp/v2/fair_event/${ id }?force=true` );
			}
			for ( const id of created.pages ) {
				await remove( `/wp/v2/pages/${ id }?force=true` );
			}
			if ( pattern ) {
				await remove( `/wp/v2/blocks/${ pattern.id }?force=true` );
			}
			if ( category ) {
				await remove( `/wp/v2/categories/${ category.id }?force=true` );
			}
		}
		await visitorContext?.close();
		await adminContext?.close();
	} );

	// What an anonymous visitor finds on each public surface.
	const visitorSees = async () => {
		await visitorPage.goto( perEventPage.link );
		const perEvent = await visitorPage
			.locator( '.per-event-fixture' )
			.allTextContents();

		await visitorPage.goto( queryLoopPage.link );
		const queryLoop = await visitorPage
			.locator( '.wp-block-fair-events-events-list' )
			.innerText();

		const calendarUrl = new URL( calendarPage.link );
		calendarUrl.searchParams.set( 'calendar_month', calendarMonth );
		await visitorPage.goto( calendarUrl.toString() );
		const calendar = await visitorPage
			.locator( '.wp-block-fair-events-events-calendar' )
			.innerText();

		const pageResponse = await visitorPage.goto( linkedPost.link );

		return {
			perEvent,
			queryLoop,
			calendar,
			linkedPageStatus: pageResponse.status(),
		};
	};

	const changePublication = async ( eventDateId, buttonName ) => {
		await adminPage.goto( manageEventUrl( eventDateId ) );
		await adminPage.getByRole( 'button', { name: buttonName } ).click();
		const dialog = adminPage.getByRole( 'dialog' );
		await expect( dialog ).toBeVisible();
		return dialog;
	};

	test( 'published events are public before anything is drafted', async () => {
		const seen = await visitorSees();

		expect( seen.perEvent ).toEqual(
			expect.arrayContaining( [ titles.linked, titles.calendarOnly ] )
		);
		// A draft page keeps its event out of a list that shows no drafts.
		expect( seen.perEvent ).not.toContain( titles.draftPage );
		expect( seen.queryLoop ).toContain( titles.linked );
		expect( seen.calendar ).toContain( titles.linked );
		expect( seen.calendar ).toContain( titles.calendarOnly );
		expect( seen.calendar ).toContain( titles.draftPage );
		expect( seen.linkedPageStatus ).toBe( 200 );
	} );

	test( 'drafting a post-linked event hides it and its page, and the state is saved', async () => {
		await adminPage.goto( manageEventUrl( linkedEvent.id ) );
		await expect(
			adminPage.locator( '.fair-events-context-badge.is-event-published' )
		).toHaveText( 'Published' );

		const dialog = await changePublication(
			linkedEvent.id,
			'Move to draft'
		);
		await expect( dialog ).toContainText(
			`Move ${ titles.linked } to draft?`
		);
		await expect( dialog ).toContainText(
			'This linked page will be moved to draft too:'
		);
		await expect( dialog.getByRole( 'listitem' ) ).toHaveText( [
			titles.linked,
		] );
		await dialog.getByRole( 'button', { name: 'Move to draft' } ).click();

		await expect(
			adminPage.locator( '.components-notice__content', {
				hasText: 'Event moved to draft.',
			} )
		).toBeVisible();
		const draftBadge = adminPage.locator(
			'.fair-events-context-badge.is-event-draft'
		);
		await expect( draftBadge ).toContainText( 'Draft' );

		// The saved state is what the screen shows after a reload, and the
		// event is still there to edit.
		await adminPage.reload();
		await expect( draftBadge ).toContainText( 'Draft' );
		await expect(
			adminPage.getByRole( 'button', { name: 'Publish event' } )
		).toBeVisible();
		await expect( adminPage.getByLabel( 'Title' ) ).toHaveValue(
			titles.linked
		);

		const seen = await visitorSees();
		expect( seen.perEvent ).not.toContain( titles.linked );
		expect( seen.perEvent ).toContain( titles.calendarOnly );
		expect( seen.queryLoop ).not.toContain( titles.linked );
		// The calendar shows draft pages, but never an event drafted here.
		expect( seen.calendar ).not.toContain( titles.linked );
		expect( seen.calendar ).toContain( titles.draftPage );
		expect( seen.calendar ).toContain( titles.calendarOnly );
		expect( seen.linkedPageStatus ).toBe( 404 );
	} );

	test( 'drafting a calendar-only event hides it without a page to change', async () => {
		const dialog = await changePublication(
			calendarOnlyEvent.id,
			'Move to draft'
		);
		await expect( dialog ).toContainText(
			`Move ${ titles.calendarOnly } to draft?`
		);
		await expect( dialog.getByRole( 'listitem' ) ).toHaveCount( 0 );
		await dialog.getByRole( 'button', { name: 'Move to draft' } ).click();

		await expect(
			adminPage.locator( '.fair-events-context-badge.is-event-draft' )
		).toBeVisible();

		const seen = await visitorSees();
		expect( seen.perEvent ).not.toContain( titles.calendarOnly );
		expect( seen.calendar ).not.toContain( titles.calendarOnly );
		expect( seen.calendar ).toContain( titles.draftPage );
	} );

	for ( const [ name, viewport ] of Object.entries( VIEWPORTS ) ) {
		test( `the control fits and opens its confirmation at ${ name } width`, async () => {
			await adminPage.setViewportSize( viewport );
			await adminPage.goto( manageEventUrl( linkedEvent.id ) );

			const badge = adminPage.locator(
				'.fair-events-context-badge.is-event-draft'
			);
			const button = adminPage.getByRole( 'button', {
				name: 'Publish event',
			} );
			await expect( badge ).toBeVisible();
			await expect( button ).toBeVisible();

			for ( const element of [ badge, button ] ) {
				const box = await element.boundingBox();
				expect( box.x ).toBeGreaterThanOrEqual( 0 );
				expect( box.x + box.width ).toBeLessThanOrEqual(
					viewport.width
				);
			}
			// Nothing on the screen pushes it wider than the viewport.
			expect(
				await adminPage.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						document.documentElement.clientWidth
				)
			).toBe( true );

			await button.click();
			const dialog = adminPage.getByRole( 'dialog' );
			await expect( dialog ).toBeVisible();
			const confirm = dialog.getByRole( 'button', {
				name: 'Publish event',
			} );
			const confirmBox = await confirm.boundingBox();
			expect( confirmBox.x + confirmBox.width ).toBeLessThanOrEqual(
				viewport.width
			);
			await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
			await expect( dialog ).toBeHidden();
			await expect( badge ).toBeVisible();

			await adminPage.setViewportSize( VIEWPORTS.desktop );
		} );
	}

	test( 'publishing brings the events and the linked page back', async () => {
		const dialog = await changePublication(
			linkedEvent.id,
			'Publish event'
		);
		await expect( dialog ).toContainText( `Publish ${ titles.linked }?` );
		await expect( dialog ).toContainText(
			'This linked page will be published too, even if it is a draft now:'
		);
		await dialog.getByRole( 'button', { name: 'Publish event' } ).click();
		await expect(
			adminPage.locator( '.components-notice__content', {
				hasText: 'Event published.',
			} )
		).toBeVisible();
		await expect(
			adminPage.locator( '.fair-events-context-badge.is-event-published' )
		).toHaveText( 'Published' );

		const calendarOnlyDialog = await changePublication(
			calendarOnlyEvent.id,
			'Publish event'
		);
		await calendarOnlyDialog
			.getByRole( 'button', { name: 'Publish event' } )
			.click();
		await expect(
			adminPage.locator( '.fair-events-context-badge.is-event-published' )
		).toBeVisible();

		const seen = await visitorSees();
		expect( seen.perEvent ).toEqual(
			expect.arrayContaining( [ titles.linked, titles.calendarOnly ] )
		);
		expect( seen.queryLoop ).toContain( titles.linked );
		expect( seen.calendar ).toContain( titles.linked );
		expect( seen.calendar ).toContain( titles.calendarOnly );
		expect( seen.linkedPageStatus ).toBe( 200 );
	} );
} );
