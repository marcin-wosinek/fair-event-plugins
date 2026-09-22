import { test, expect } from '@playwright/test';

/**
 * Events List block: Query Loop layouts (post-backed events only), per-event
 * layouts (every occurrence source, via {{token}} placeholders), and the
 * empty/unavailable-pattern states. See #1651.
 *
 * Coverage here: post-backed events through the bundled Query Loop patterns
 * (list + grid), a standalone event through a custom per-event pattern
 * (including the untitled/unlinked-title fallbacks), category filtering, the
 * empty state, and the unavailable-pattern state. Recurring/multi-day
 * boundary timing in a non-UTC site timezone and external (iCal/API) source
 * filtering are not covered here — see TESTING.md's WP-CLI eval-file manual
 * check for that class of verification.
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
				start_datetime: iso(
					new Date( now.getTime() + 2 * 60 * 60 * 1000 )
				),
				end_datetime: iso(
					new Date( now.getTime() + 3 * 60 * 60 * 1000 )
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
				start_datetime: iso(
					new Date( now.getTime() + 2 * 60 * 60 * 1000 )
				),
				end_datetime: iso(
					new Date( now.getTime() + 3 * 60 * 60 * 1000 )
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
				start_datetime: iso(
					new Date( now.getTime() + 2 * 60 * 60 * 1000 )
				),
				end_datetime: iso(
					new Date( now.getTime() + 3 * 60 * 60 * 1000 )
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
				start_datetime: iso(
					new Date( now.getTime() + 2 * 60 * 60 * 1000 )
				),
				end_datetime: iso(
					new Date( now.getTime() + 3 * 60 * 60 * 1000 )
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
} );
