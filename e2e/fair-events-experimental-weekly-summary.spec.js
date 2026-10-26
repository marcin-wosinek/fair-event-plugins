/**
 * Operator weekly-summary links (#2045): a public page per event feed whose
 * copied text is exactly the "Copy summary" text of an Events Week block on
 * the feed's page that shows only that feed, for the same week.
 *
 * Needs a current `npm run build` in fair-events and fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const ADMIN_PAGE = '/wp-admin/admin.php?page=fair-events-all-events';
// Weeks far from any fixture data other specs create.
const WEEK = '2036-W20';
const EMPTY_WEEK = '2036-W22';
// 2032 has 53 ISO weeks; its last one ends in 2033.
const LAST_WEEK = '2032-W53';
const FIRST_WEEK = '2033-W01';

const suffix = Date.now();
const COMMUNITIES = [ 'valencia', 'madrid', 'barcelona' ];
const created = {
	pages: [],
	posts: [],
	eventDates: [],
	categories: [],
	feeds: [],
};
const fixtures = {};

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = ( page, options ) =>
	page.evaluate( ( opts ) => window.wp.apiFetch( opts ), options );

const operatorPath = ( feed, week ) =>
	`/fair-events-weekly-summary/${ feed }/` +
	( week !== undefined ? `?week=${ encodeURIComponent( week ) }` : '' );

/** The same link in its plain-permalink form. */
const plainOperatorPath = ( feed, week ) =>
	`/?fair_weekly_summary=${ feed }&week=${ encodeURIComponent( week ) }`;

/** The block's own copy-summary text for a page and week. */
async function blockSummary( page, slug, week ) {
	await page.goto(
		`/${ slug }/` +
			( week ? `?week_view=${ encodeURIComponent( week ) }` : '' )
	);
	return page
		.locator( '.fair-events-copy-summary-btn' )
		.getAttribute( 'data-summary' );
}

/** The operator page's summary text. */
async function operatorSummary( page, feed, week ) {
	await page.goto( operatorPath( feed, week ) );
	return page.locator( '.fair-weekly-summary__text' ).inputValue();
}

const weekBlock = ( attrs ) =>
	`<!-- wp:fair-events/events-week ${ JSON.stringify( {
		showCopySummary: true,
		...attrs,
	} ) } /-->`;

test.describe( 'Fair Events Experimental — operator weekly summary', () => {
	test.setTimeout( 120_000 );

	test.beforeAll( async ( { browser } ) => {
		const page = await browser.newPage();
		await loginAsAdmin( page );
		await page.goto( ADMIN_PAGE );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const createPage = async ( slug, title, content, extra = {} ) => {
			const created_page = await adminApiFetch( page, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title,
					slug,
					status: 'publish',
					content,
					...extra,
				},
			} );
			created.pages.push( created_page.id );
			return {
				id: created_page.id,
				slug: new URL( created_page.link ).pathname.replace(
					/^\/|\/$/g,
					''
				),
			};
		};
		const createFeed = async ( slug, categoryId, data = {} ) => {
			const feed = await adminApiFetch( page, {
				path: '/fair-events/v1/sources',
				method: 'POST',
				data: {
					name: `Weekly feed ${ slug }`,
					slug,
					enabled: true,
					data_sources: [
						{
							source_type: 'categories',
							config: { category_ids: [ categoryId ] },
						},
					],
					...data,
				},
			} );
			created.feeds.push( feed.id );
			return feed.slug;
		};
		const createEventDate = async ( data ) => {
			const eventDate = await adminApiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: { all_day: false, ...data },
			} );
			created.eventDates.push( eventDate.id );
			return eventDate;
		};
		const linkedEvent = async ( title, status, category, dates ) => {
			const post = await adminApiFetch( page, {
				path: '/wp/v2/fair_event',
				method: 'POST',
				data: { title, status },
			} );
			created.posts.push( post.id );
			const eventDate = await createEventDate( {
				title,
				link_type: 'post',
				categories: [ category ],
				...dates,
			} );
			await adminApiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'PUT',
				data: { event_id: post.id },
			} );
		};

		for ( const community of COMMUNITIES ) {
			const category = await adminApiFetch( page, {
				path: '/wp/v2/categories',
				method: 'POST',
				data: { name: `Weekly ${ community } ${ suffix }` },
			} );
			created.categories.push( category.id );

			const titles = {
				timed: `Jam in the park — ${ community } ${ suffix }`,
				apostrophe: `Teachers' "open" class ${ community } ${ suffix }`,
				multiday: `Weekend retreat ${ community } ${ suffix }`,
				series: `Daily handstands ${ community } ${ suffix }`,
				boundary: `New Year jam ${ community } ${ suffix }`,
				draft: `Draft plan ${ community } ${ suffix }`,
				private: `Private rehearsal ${ community } ${ suffix }`,
			};

			await createEventDate( {
				title: titles.timed,
				start_date: '2036-05-13',
				start_time: '18:00:00',
				end_date: '2036-05-13',
				end_time: '20:00:00',
				categories: [ category.id ],
			} );
			await linkedEvent( titles.apostrophe, 'publish', category.id, {
				start_date: '2036-05-14',
				start_time: '19:30:00',
				end_date: '2036-05-14',
				end_time: '21:00:00',
			} );
			await createEventDate( {
				title: titles.multiday,
				start_date: '2036-05-16',
				end_date: '2036-05-18',
				all_day: true,
				categories: [ category.id ],
			} );
			const series = await createEventDate( {
				title: titles.series,
				start_date: '2036-05-12',
				start_time: '08:00:00',
				end_date: '2036-05-12',
				end_time: '09:00:00',
				categories: [ category.id ],
			} );
			await adminApiFetch( page, {
				path: `/fair-events/v1/event-dates/${ series.id }`,
				method: 'PUT',
				data: { rrule: 'FREQ=DAILY;COUNT=3' },
			} );
			await createEventDate( {
				title: titles.boundary,
				start_date: '2032-12-31',
				start_time: '22:00:00',
				end_date: '2033-01-01',
				end_time: '02:00:00',
				categories: [ category.id ],
			} );
			await linkedEvent( titles.draft, 'draft', category.id, {
				start_date: '2036-05-15',
				start_time: '10:00:00',
				end_date: '2036-05-15',
				end_time: '11:00:00',
			} );
			await linkedEvent( titles.private, 'private', category.id, {
				start_date: '2036-05-15',
				start_time: '12:00:00',
				end_date: '2036-05-15',
				end_time: '13:00:00',
			} );

			// The feed's page shows an Events Week block with only that
			// feed: the calendar whose summary the operator page matches.
			const feedSlug = `weekly-${ community }-${ suffix }`;
			const feedPage = await createPage(
				`weekly-${ community }-${ suffix }`,
				`Acro agenda ${ community }'s week`,
				weekBlock( { eventSources: [ feedSlug ] } )
			);
			const feed = await createFeed( feedSlug, category.id, {
				page_id: feedPage.id,
			} );
			fixtures[ community ] = { slug: feedPage.slug, feed, titles };
		}

		const firstCategory = created.categories[ 0 ];
		const privatePage = await createPage(
			`weekly-private-${ suffix }`,
			'Private calendar',
			'',
			{ status: 'private' }
		);
		const protectedPage = await createPage(
			`weekly-protected-${ suffix }`,
			'Protected calendar',
			'',
			{ password: 'secret' }
		);
		const publicPage = await createPage(
			`weekly-disabled-${ suffix }`,
			'Calendar of a disabled feed',
			''
		);
		fixtures.disabled = await createFeed(
			`weekly-disabled-${ suffix }`,
			firstCategory,
			{ enabled: false, page_id: publicPage.id }
		);
		fixtures.pageless = await createFeed(
			`weekly-pageless-${ suffix }`,
			firstCategory
		);
		fixtures.privateFeed = await createFeed(
			`weekly-private-${ suffix }`,
			firstCategory,
			{ page_id: privatePage.id }
		);
		fixtures.protectedFeed = await createFeed(
			`weekly-protected-${ suffix }`,
			firstCategory,
			{ page_id: protectedPage.id }
		);
		await page.close();
	} );

	test.afterAll( async ( { browser } ) => {
		const page = await browser.newPage();
		await loginAsAdmin( page );
		await page.goto( ADMIN_PAGE );
		await page.waitForFunction( () => window.wp?.apiFetch );
		const remove = ( path ) =>
			adminApiFetch( page, { path, method: 'DELETE' } ).catch( () => {} );
		for ( const id of created.feeds ) {
			await remove( `/fair-events/v1/sources/${ id }` );
		}
		for ( const id of created.eventDates ) {
			await remove( `/fair-events/v1/event-dates/${ id }` );
		}
		for ( const id of created.posts ) {
			await remove( `/wp/v2/fair_event/${ id }?force=true` );
		}
		for ( const id of created.pages ) {
			await remove( `/wp/v2/pages/${ id }?force=true` );
		}
		for ( const id of created.categories ) {
			await remove( `/wp/v2/categories/${ id }?force=true` );
		}
		await page.close();
	} );

	test( 'copied text matches each feed’s Events Week block exactly', async ( {
		page,
	} ) => {
		for ( const community of COMMUNITIES ) {
			const { slug, feed, titles } = fixtures[ community ];
			const expected = await blockSummary( page, slug, WEEK );
			const actual = await operatorSummary( page, feed, WEEK );

			expect( actual ).toBe( expected );
			const lines = actual.split( '\n' );
			expect( lines[ 0 ] ).toContain(
				`Acro agenda ${ community }’s week`
			);
			expect( lines[ 0 ] ).toContain( `/${ slug }/` );
			// Timed, multi-day, recurring and post-linked events, in order.
			expect( actual ).toContain( titles.timed );
			expect( actual ).toContain( titles.apostrophe );
			expect( actual ).toContain( titles.multiday );
			expect(
				lines.filter( ( line ) => line.includes( titles.series ) )
			).toHaveLength( 3 );
			expect( lines ).toHaveLength( 1 + 3 + 3 );

			// Other communities' events stay out.
			for ( const other of COMMUNITIES.filter(
				( c ) => c !== community
			) ) {
				expect( actual ).not.toContain(
					fixtures[ other ].titles.timed
				);
			}
		}
	} );

	test( 'lists only public events, for visitors and logged-in organizers alike', async ( {
		page,
	} ) => {
		const { feed, titles } = fixtures.valencia;
		for ( const loggedIn of [ false, true ] ) {
			if ( loggedIn ) {
				await loginAsAdmin( page );
			}
			await page.goto( operatorPath( feed, WEEK ) );
			const main = page.locator( 'main.fair-weekly-summary' );
			await expect(
				main.getByText( titles.timed ).first()
			).toBeVisible();
			await expect( main ).not.toContainText( titles.draft );
			await expect( main ).not.toContainText( titles.private );
			expect(
				await page.locator( '.fair-weekly-summary__text' ).inputValue()
			).not.toContain( titles.draft );
		}
	} );

	test( 'identifies the feed, page and week, and navigates across a year boundary', async ( {
		page,
	} ) => {
		const { slug, feed, titles } = fixtures.madrid;
		const range = await page
			.goto( `/${ slug }/?week_view=${ LAST_WEEK }` )
			.then( () => page.locator( '.navigation-title' ).textContent() );

		await page.goto( operatorPath( feed, LAST_WEEK ) );
		await expect( page.locator( '.fair-weekly-summary__feed' ) ).toHaveText(
			`Event feed: Weekly feed ${ feed }`
		);
		await expect(
			page.getByRole( 'heading', { level: 1, name: /madrid/i } )
		).toBeVisible();
		await expect(
			page.locator( '.fair-weekly-summary__source' )
		).toContainText( `/${ slug }/` );
		await expect(
			page.locator( '.fair-weekly-summary__range strong' )
		).toHaveText( range.trim() );
		await expect( page.getByText( 'Week 53, 2032' ) ).toBeVisible();
		await expect(
			page
				.locator( '.fair-weekly-summary__events' )
				.getByText( titles.boundary )
		).toBeVisible();
		expect(
			await page.locator( '.fair-weekly-summary__text' ).inputValue()
		).toBe( await blockSummary( page, slug, LAST_WEEK ) );

		await page.goto( operatorPath( feed, LAST_WEEK ) );
		await page.getByRole( 'link', { name: 'Next week' } ).click();
		await expect( page.getByText( 'Week 1, 2033' ) ).toBeVisible();
		const next = new URL( page.url() );
		expect( next.pathname ).toBe(
			`/fair-events-weekly-summary/${ feed }/`
		);
		expect( next.searchParams.get( 'week' ) ).toBe( FIRST_WEEK );
		expect(
			await page.locator( '.fair-weekly-summary__text' ).inputValue()
		).toBe( await blockSummary( page, slug, FIRST_WEEK ) );

		await page.goto( operatorPath( feed, FIRST_WEEK ) );
		await page.getByRole( 'link', { name: 'Previous week' } ).click();
		await expect( page.getByText( 'Week 53, 2032' ) ).toBeVisible();
	} );

	test( 'falls back to the current week for a missing or invalid week', async ( {
		page,
	} ) => {
		const { slug, feed } = fixtures.barcelona;
		const current = await blockSummary( page, slug );

		expect( await operatorSummary( page, feed ) ).toBe( current );
		await expect( page.getByText( 'is not a valid week' ) ).toHaveCount(
			0
		);

		for ( const invalid of [ '2027-W53', 'next-week' ] ) {
			expect( await operatorSummary( page, feed, invalid ) ).toBe(
				current
			);
			await expect(
				page.getByText( `“${ invalid }” is not a valid week` )
			).toBeVisible();
		}
	} );

	test( 'explains an empty week and keeps the heading-only summary', async ( {
		page,
	} ) => {
		const { slug, feed } = fixtures.valencia;
		const expected = await blockSummary( page, slug, EMPTY_WEEK );

		await page.goto( operatorPath( feed, EMPTY_WEEK ) );
		await expect(
			page.getByText( 'There are no public events this week.' )
		).toBeVisible();
		const text = await page
			.locator( '.fair-weekly-summary__text' )
			.inputValue();
		expect( text ).toBe( expected );
		expect( text.split( '\n' ) ).toHaveLength( 1 );
		await expect(
			page.getByRole( 'button', { name: 'Copy WhatsApp message' } )
		).toBeEnabled();
	} );

	test( 'refuses unknown, disabled, page-less and non-public feeds', async ( {
		page,
	} ) => {
		const notPublic = 'must be published and publicly visible';
		const cases = [
			[
				`weekly-unknown-${ suffix }`,
				'doesn’t match an enabled event feed',
			],
			[ 'Not-A-Slug', 'doesn’t match an enabled event feed' ],
			[ fixtures.disabled, 'doesn’t match an enabled event feed' ],
			[ fixtures.pageless, 'This event feed has no page' ],
			[ fixtures.privateFeed, notPublic ],
			[ fixtures.protectedFeed, notPublic ],
		];
		const expectUnavailable = async ( feed, message ) => {
			const response = await page.goto( operatorPath( feed, WEEK ) );
			expect( response.status() ).toBe( 404 );
			await expect( page.getByRole( 'alert' ) ).toContainText( message );
			await expect(
				page.locator( '.fair-weekly-summary__text' )
			).toHaveCount( 0 );
		};
		for ( const [ feed, message ] of cases ) {
			await expectUnavailable( feed, message );
		}

		// A logged-in organizer can open the private page, but not as a
		// public summary.
		await loginAsAdmin( page );
		await expectUnavailable( fixtures.privateFeed, notPublic );
	} );

	test( 'serves the plain-permalink form of the link', async ( { page } ) => {
		const { slug, feed } = fixtures.valencia;
		const expected = await blockSummary( page, slug, WEEK );

		await page.goto( plainOperatorPath( feed, WEEK ) );
		expect(
			await page.locator( '.fair-weekly-summary__text' ).inputValue()
		).toBe( expected );
		await expect( page.getByText( 'Week 20, 2036' ) ).toBeVisible();
	} );

	test( 'opens each feed’s WhatsApp summary from the Event Feeds list', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-sources' );
		const row = ( feed ) =>
			page.getByRole( 'row' ).filter( {
				has: page.getByRole( 'link', {
					name: `Weekly feed ${ feed }`,
					exact: true,
				} ),
			} );
		const summaryLink = { name: 'Open WhatsApp summary' };

		await expect(
			page.getByRole( 'columnheader', { name: 'WhatsApp' } )
		).toBeVisible();
		await expect(
			row( fixtures.pageless ).getByText(
				'Choose a page to enable the WhatsApp summary.'
			)
		).toBeVisible();
		await expect(
			row( fixtures.disabled ).getByText(
				'Enable this feed to use its WhatsApp summary.'
			)
		).toBeVisible();
		await expect(
			row( fixtures.disabled ).getByRole( 'link', summaryLink )
		).toHaveCount( 0 );

		const hrefs = {};
		for ( const community of COMMUNITIES ) {
			const { feed } = fixtures[ community ];
			hrefs[ community ] = await row( feed )
				.getByRole( 'link', summaryLink )
				.getAttribute( 'href' );
			expect( new URL( hrefs[ community ] ).pathname ).toBe(
				`/fair-events-weekly-summary/${ feed }/`
			);
		}

		// Clicking an in-page link stalls headless rendering on the next
		// page, so follow the link's href.
		const { slug, feed } = fixtures.barcelona;
		await page.goto( hrefs.barcelona );
		await expect( page.locator( '.fair-weekly-summary__feed' ) ).toHaveText(
			`Event feed: Weekly feed ${ feed }`
		);
		expect(
			await page.locator( '.fair-weekly-summary__text' ).inputValue()
		).toBe( await blockSummary( page, slug ) );
	} );

	test( 'copies the summary to the clipboard', async ( {
		page,
		context,
	} ) => {
		await context.grantPermissions( [
			'clipboard-read',
			'clipboard-write',
		] );
		const { slug, feed } = fixtures.valencia;
		const expected = await blockSummary( page, slug, WEEK );
		const requests = [];
		await page.goto( operatorPath( feed, WEEK ) );
		await expect(
			page.getByText( 'Weekly summary for WhatsApp' )
		).toBeVisible();
		await expect(
			page.getByRole( 'heading', { level: 2, name: 'WhatsApp message' } )
		).toBeVisible();
		await expect(
			page.getByText(
				'Copy this message, then paste it into your WhatsApp group or community. Nothing is sent automatically.'
			)
		).toBeVisible();
		page.on( 'request', ( request ) => {
			if ( request.method() !== 'GET' ) {
				requests.push( `${ request.method() } ${ request.url() }` );
			}
		} );

		await page
			.getByRole( 'button', { name: 'Copy WhatsApp message' } )
			.click();

		await expect( page.getByRole( 'status' ) ).toHaveText(
			'Message copied. Paste it into WhatsApp.'
		);
		expect(
			await page.evaluate( () => navigator.clipboard.readText() )
		).toBe( expected );
		// Copying is local: nothing is posted anywhere.
		expect( requests ).toEqual( [] );
	} );

	test( 'offers manual copying when the clipboard is unavailable', async ( {
		page,
	} ) => {
		await page.addInitScript( () => {
			Object.defineProperty( navigator, 'clipboard', {
				value: {
					writeText: () =>
						Promise.reject(
							new DOMException( 'Denied', 'NotAllowedError' )
						),
				},
			} );
		} );
		const { feed } = fixtures.valencia;
		await page.goto( operatorPath( feed, WEEK ) );

		await page
			.getByRole( 'button', { name: 'Copy WhatsApp message' } )
			.click();

		await expect( page.getByRole( 'status' ) ).toContainText(
			'Couldn’t copy automatically.'
		);
		const textarea = page.locator( '.fair-weekly-summary__text' );
		await expect( textarea ).toBeFocused();
		const selected = await textarea.evaluate( ( el ) =>
			el.value.slice( el.selectionStart, el.selectionEnd )
		);
		expect( selected ).toBe( await textarea.inputValue() );
	} );

	test( 'fits a phone screen without horizontal scrolling', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 375, height: 812 } );
		const { feed, titles } = fixtures.valencia;
		await page.goto( operatorPath( feed, WEEK ) );

		await expect(
			page.getByText( titles.apostrophe ).first()
		).toBeVisible();
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth >
				document.documentElement.clientWidth
		);
		expect( overflow ).toBe( false );
		const button = await page
			.getByRole( 'button', { name: 'Copy WhatsApp message' } )
			.boundingBox();
		expect( button.width ).toBeGreaterThan( 300 );
	} );
} );
