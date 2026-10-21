import { test, expect } from '@playwright/test';
import { timingFields } from '../../e2e/support/event-timing.js';

/**
 * Events List block: Query Loop layouts (post-backed events only), per-event
 * layouts (every occurrence source, via {{token}} placeholders), and the
 * empty/unavailable-pattern states. See #1651.
 *
 * Coverage here: post-backed events through the bundled Query Loop patterns
 * (list + grid), a standalone event through a custom per-event pattern
 * (including the untitled/unlinked-title fallbacks), category filtering, the
 * empty state, the unavailable-pattern state, and local recurring series
 * grouped once in the Upcoming view (per-event and bundled Query Loop
 * layouts, editor preview agreement, several lists on one page).
 * Boundary timing in a non-UTC site timezone and external (iCal/API) source
 * filtering are not covered here — see RecurrenceSummaryTest/
 * EventsListSeriesTest and TESTING.md's WP-CLI eval-file manual check.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

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

const cleanupPage = async ( page, created ) => {
	if ( created?.id ) {
		await apiFetch( page, {
			path: `/wp/v2/pages/${ created.id }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
	}
};

test.describe( 'Events List block', () => {
	test.beforeEach( async ( { page } ) => {
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );
		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_register_post_type: true,
				fair_events_enabled_post_types: [ 'fair_event' ],
			},
		} );
	} );

	test( 'renders a post-backed event through the bundled list and grid Query Loop patterns', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const now = new Date();
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );

		// The bundled patterns cap at perPage:10, and this shared --reuse
		// instance accumulates many other specs' near-future fixtures (see
		// TESTING.md's note on stale wp-env data) — a unique category keeps
		// this event the only match regardless of what else is seeded.
		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Query Loop Category ${ Date.now() }` },
		} );

		const event = await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: 'Events List Query Loop Event',
				status: 'publish',
				categories: [ category.id ],
			},
		} );

		// POST /event-dates creates a standalone (unlinked) row — linking to a
		// post is set up by ensure-for-post, then this PUT fills in the actual
		// dates.
		const ensured = await apiFetch( page, {
			path: '/fair-events/v1/event-dates/ensure-for-post',
			method: 'POST',
			data: { post_id: event.id },
		} );

		const eventDate = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ ensured.id }`,
			method: 'PUT',
			data: {
				title: 'Events List Query Loop Event',
				...timingFields(
					iso( new Date( now.getTime() + 2 * 60 * 60 * 1000 ) ),
					iso( new Date( now.getTime() + 3 * 60 * 60 * 1000 ) )
				),
				all_day: false,
			},
		} );

		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Query Loop Page',
				status: 'publish',
				content: `<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"fair-events/event-list","categories":[${ category.id }]} /-->`,
			},
		} );

		const gridPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Query Loop Grid Page',
				status: 'publish',
				content: `<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"fair-events/event-grid","categories":[${ category.id }]} /-->`,
			},
		} );

		try {
			await page.goto( listPage.link );
			await expect(
				page.getByText( 'Events List Query Loop Event' )
			).toBeVisible();

			await page.goto( gridPage.link );
			await expect(
				page.getByText( 'Events List Query Loop Event' )
			).toBeVisible();
		} finally {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/fair_event/${ event.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
			await cleanupPage( page, gridPage );
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );

	test( 'renders a standalone event through a custom per-event pattern, with title/URL fallbacks', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const now = new Date();
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );

		// A unique category keeps this the only match on the page,
		// regardless of other specs' leftover fixtures in this shared
		// --reuse instance (see TESTING.md's note on stale wp-env data).
		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Per-Event Category ${ Date.now() }` },
		} );

		// No external_url/link_type is set, so this standalone event has no
		// URL — exercises the unlinked-title fallback. (The title itself
		// can't be blank: the create endpoint requires a non-empty title,
		// so the untitled-event fallback is covered at the unit level —
		// see OccurrenceFieldsTest — rather than through this API.)
		const standalone = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Events List Standalone Fixture Event',
				...timingFields(
					iso( new Date( now.getTime() + 2 * 60 * 60 * 1000 ) ),
					iso( new Date( now.getTime() + 3 * 60 * 60 * 1000 ) )
				),
				all_day: false,
				categories: [ category.id ],
			},
		} );

		const pattern = await apiFetch( page, {
			path: '/wp/v2/blocks',
			method: 'POST',
			data: {
				title: 'Events List Per-Event Pattern',
				status: 'publish',
				content:
					'<!-- wp:html --><div class="per-event-fixture">{{title_link_open}}{{title}}{{title_link_close}}</div><!-- /wp:html -->',
			},
		} );

		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Per-Event Page',
				status: 'publish',
				content: `<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"wp_block:${ pattern.id }","categories":[${ category.id }]} /-->`,
			},
		} );

		try {
			await page.goto( listPage.link );

			const fixture = page.locator( '.per-event-fixture' );
			await expect( fixture ).toBeVisible();
			await expect( fixture ).toHaveText(
				'Events List Standalone Fixture Event'
			);
			// No URL was set, so the title must render unlinked (no <a>).
			await expect( fixture.locator( 'a' ) ).toHaveCount( 0 );
		} finally {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ standalone.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/blocks/${ pattern.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
		}
	} );

	test( 'shows the unavailable-pattern message for a deleted display pattern', async ( {
		page,
	} ) => {
		test.setTimeout( 60_000 );

		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Unavailable Pattern Page',
				status: 'publish',
				content:
					'<!-- wp:fair-events/events-list {"displayPattern":"wp_block:999999"} /-->',
			},
		} );

		try {
			await page.goto( listPage.link );
			await expect(
				page.getByText(
					'The selected display pattern is no longer available.'
				)
			).toBeVisible();
		} finally {
			await cleanupPage( page, listPage );
		}
	} );

	test( 'shows the empty state when no events match the filter', async ( {
		page,
	} ) => {
		test.setTimeout( 60_000 );

		// A brand-new, never-assigned category guarantees zero matches
		// regardless of other specs' leftover fixtures in this shared
		// --reuse instance (see TESTING.md's note on stale wp-env data) —
		// more robust than relying on a time-boundary filter alone.
		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Empty State Category ${ Date.now() }` },
		} );

		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Empty State Page',
				status: 'publish',
				content: `<!-- wp:fair-events/events-list {"timeFilter":"all","displayPattern":"fair-events/event-list","categories":[${ category.id }]} /-->`,
			},
		} );

		try {
			await page.goto( listPage.link );
			await expect( page.getByText( 'No events found.' ) ).toBeVisible();
		} finally {
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
		}
	} );

	test( 'category filtering applies to a per-event layout', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const now = new Date();
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );

		// Unique per run so retries/re-runs never collide with a leftover
		// category from a previous attempt (term names must be unique).
		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Fixture Category ${ Date.now() }` },
		} );

		const matching = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Events List Matching Category Event',
				...timingFields(
					iso( new Date( now.getTime() + 2 * 60 * 60 * 1000 ) ),
					iso( new Date( now.getTime() + 3 * 60 * 60 * 1000 ) )
				),
				all_day: false,
				categories: [ category.id ],
			},
		} );

		const nonMatching = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Events List Non Matching Category Event',
				...timingFields(
					iso( new Date( now.getTime() + 2 * 60 * 60 * 1000 ) ),
					iso( new Date( now.getTime() + 3 * 60 * 60 * 1000 ) )
				),
				all_day: false,
			},
		} );

		const pattern = await apiFetch( page, {
			path: '/wp/v2/blocks',
			method: 'POST',
			data: {
				title: 'Events List Category Filter Pattern',
				status: 'publish',
				content: '<!-- wp:html -->{{title}}<!-- /wp:html -->',
			},
		} );

		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Events List Category Filter Page',
				status: 'publish',
				content: `<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"wp_block:${ pattern.id }","categories":[${ category.id }]} /-->`,
			},
		} );

		try {
			await page.goto( listPage.link );
			await expect(
				page.getByText( 'Events List Matching Category Event' )
			).toBeVisible();
			await expect(
				page.getByText( 'Events List Non Matching Category Event' )
			).toHaveCount( 0 );
		} finally {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ matching.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ nonMatching.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/blocks/${ pattern.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
		}
	} );

	test( 'shows a local recurring series once in Upcoming, mixed chronologically with single events', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const now = new Date();
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
		const at = ( days, hours = 0 ) =>
			iso(
				new Date(
					now.getTime() +
						days * 24 * 60 * 60 * 1000 +
						hours * 60 * 60 * 1000
				)
			);
		const suffix = Date.now();

		// A unique category keeps these fixtures the only matches, regardless
		// of other specs' leftovers in a shared --reuse instance.
		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Series Category ${ suffix }` },
		} );

		// Weekly standalone series: +2d, +9d, +16d.
		const series = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Weekly Series Fixture ${ suffix }`,
				...timingFields( at( 2 ), at( 2, 1 ) ),
				all_day: false,
				rrule: 'FREQ=WEEKLY;COUNT=3',
				categories: [ category.id ],
			},
		} );

		// Single event between the series' first and second occurrences.
		const single = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Single Fixture ${ suffix }`,
				...timingFields( at( 3 ), at( 3, 1 ) ),
				all_day: false,
				categories: [ category.id ],
			},
		} );

		// Post-backed weekly series for the bundled Query Loop layout.
		const event = await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Weekly Post Series Fixture ${ suffix }`,
				status: 'publish',
				categories: [ category.id ],
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
				...timingFields( at( 4 ), at( 4, 1 ) ),
				all_day: false,
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );

		const pattern = await apiFetch( page, {
			path: '/wp/v2/blocks',
			method: 'POST',
			data: {
				title: `Events List Series Pattern ${ suffix }`,
				status: 'publish',
				content:
					'<!-- wp:html --><p class="series-fixture">{{title}} | {{date_range}}</p><!-- /wp:html -->',
			},
		} );

		const perEventBlock = ( timeFilter ) =>
			`<!-- wp:fair-events/events-list {"timeFilter":"${ timeFilter }","displayPattern":"wp_block:${ pattern.id }","categories":[${ category.id }],"className":"list-${ timeFilter }"} /-->`;

		// Two differently configured lists on one page must not affect
		// each other: Upcoming groups the series, All lists every date.
		const listPage = await apiFetch( page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Events List Series Page ${ suffix }`,
				status: 'publish',
				content:
					perEventBlock( 'upcoming' ) +
					perEventBlock( 'all' ) +
					`<!-- wp:fair-events/events-list {"timeFilter":"upcoming","displayPattern":"fair-events/event-list","categories":[${ category.id }],"className":"list-query-loop"} /-->`,
			},
		} );

		try {
			await page.goto( listPage.link );

			const upcomingRows = page.locator(
				'.list-upcoming .series-fixture'
			);
			await expect( upcomingRows ).toHaveCount( 3 );
			await expect( upcomingRows.nth( 0 ) ).toContainText(
				`Weekly Series Fixture ${ suffix }`
			);
			await expect( upcomingRows.nth( 0 ) ).toContainText(
				/Weekly on \w+ at \d{2}:\d{2}; next occurrence: /
			);
			await expect( upcomingRows.nth( 1 ) ).toContainText(
				`Single Fixture ${ suffix }`
			);
			await expect( upcomingRows.nth( 2 ) ).toContainText(
				`Weekly Post Series Fixture ${ suffix }`
			);

			// All is unchanged: one row per occurrence (3 + 1 + 3).
			await expect(
				page.locator( '.list-all .series-fixture' )
			).toHaveCount( 7 );

			// Bundled Query Loop layout: the post appears once, with the
			// series summary in its dates block.
			const queryLoop = page.locator( '.list-query-loop' );
			await expect(
				queryLoop.getByText( `Weekly Post Series Fixture ${ suffix }` )
			).toHaveCount( 1 );
			await expect( queryLoop.locator( '.event-dates' ) ).toContainText(
				/Weekly on \w+ at \d{2}:\d{2}; next occurrence: /
			);

			// The editor preview (ServerSideRender) uses the same renderer.
			const frontendRows = await upcomingRows.allTextContents();
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp && window.wp.apiFetch );
			const preview = await apiFetch( page, {
				path: `/wp/v2/block-renderer/fair-events/events-list?context=edit&attributes[timeFilter]=upcoming&attributes[displayPattern]=wp_block:${ pattern.id }&attributes[categories][0]=${ category.id }`,
			} );
			const previewRows = preview.rendered.match(
				/class="series-fixture">[^<]*/g
			);
			expect(
				previewRows.map( ( row ) =>
					row.replace( 'class="series-fixture">', '' )
				)
			).toEqual( frontendRows );
		} finally {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ series.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ single.id }`,
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
			await apiFetch( page, {
				path: `/wp/v2/blocks/${ pattern.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
		}
	} );

	test( 'gives each post in an Upcoming Query Loop the next date the per-event layout shows', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const now = new Date();
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
		const at = ( days ) =>
			iso( new Date( now.getTime() + days * 24 * 60 * 60 * 1000 ) );
		const suffix = Date.now();

		const category = await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Events List Next Date Category ${ suffix }` },
		} );

		// The Query Loop looks up every rendered post's next date together
		// (#1669): a single event, a series whose next date is a generated
		// occurrence (its master has passed), a series starting later, and
		// a past event that must not be listed.
		const fixtures = [
			{ name: 'Single', start: 3 },
			{ name: 'Started Series', start: -6, rrule: 'FREQ=WEEKLY;COUNT=3' },
			{ name: 'Later Series', start: 5, rrule: 'FREQ=WEEKLY;COUNT=3' },
			{ name: 'Past', start: -2 },
		];
		const created = [];

		const pattern = await apiFetch( page, {
			path: '/wp/v2/blocks',
			method: 'POST',
			data: {
				title: `Events List Next Date Pattern ${ suffix }`,
				status: 'publish',
				content:
					'<!-- wp:html --><p class="next-date-fixture">{{title}} | {{date_range}}</p><!-- /wp:html -->',
			},
		} );
		let listPage;

		try {
			for ( const fixture of fixtures ) {
				const title = `Next Date ${ fixture.name } ${ suffix }`;
				const event = await apiFetch( page, {
					path: '/wp/v2/fair_event',
					method: 'POST',
					data: {
						title,
						status: 'publish',
						categories: [ category.id ],
					},
				} );
				const ensured = await apiFetch( page, {
					path: '/fair-events/v1/event-dates/ensure-for-post',
					method: 'POST',
					data: { post_id: event.id },
				} );
				created.push( { event, ensured, title } );
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ ensured.id }`,
					method: 'PUT',
					data: {
						...timingFields(
							at( fixture.start ),
							at( fixture.start + 1 / 24 )
						),
						all_day: false,
						...( fixture.rrule ? { rrule: fixture.rrule } : {} ),
					},
				} );
			}

			listPage = await apiFetch( page, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title: `Events List Next Date Page ${ suffix }`,
					status: 'publish',
					content:
						`<!-- wp:fair-events/events-list {"displayPattern":"wp_block:${ pattern.id }","categories":[${ category.id }],"className":"list-per-event"} /-->` +
						`<!-- wp:fair-events/events-list {"displayPattern":"fair-events/event-list","categories":[${ category.id }],"className":"list-query-loop"} /-->`,
				},
			} );

			await page.goto( listPage.link );

			// Both layouts list the three upcoming events in date order. The
			// per-event row's date is the list's own occurrence selection,
			// which the Query Loop's dates block must match.
			const perEventDates = (
				await page
					.locator( '.list-per-event .next-date-fixture' )
					.allTextContents()
			).map( ( row ) => row.split( ' | ' )[ 1 ].trim() );
			expect( perEventDates ).toHaveLength( 3 );

			const queryLoopPosts = page.locator(
				'.list-query-loop li.wp-block-post'
			);
			await expect( queryLoopPosts ).toHaveCount( 3 );
			const titles = [ 1, 0, 2 ].map(
				( index ) => created[ index ].title
			);
			for ( const [ index, title ] of titles.entries() ) {
				const post = queryLoopPosts.nth( index );
				await expect( post ).toContainText( title );
				await expect( post.locator( '.event-dates' ) ).toHaveText(
					perEventDates[ index ]
				);
			}
			await expect(
				page.locator( '.list-query-loop .event-dates' ).first()
			).toContainText( /next occurrence: / );
		} finally {
			for ( const { event, ensured } of created ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ ensured.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
				await apiFetch( page, {
					path: `/wp/v2/fair_event/${ event.id }?force=true`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			await apiFetch( page, {
				path: `/wp/v2/blocks/${ pattern.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/categories/${ category.id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await cleanupPage( page, listPage );
		}
	} );
} );
