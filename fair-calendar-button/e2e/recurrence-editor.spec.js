import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CALENDAR_BUTTON = 'fair-calendar-button/fair-calendar-button';
// Fair Events and the plugin that requires it, deactivated for the test.
const FAIR_EVENTS_PLUGINS = [
	'fair-events-experimental/fair-events-experimental',
	'fair-events/fair-events',
];

/**
 * Regression for #1456: the Calendar Button recurrence editor builds its rule
 * and occurrence preview with the shared recurrence logic bundled into the
 * plugin, so it works with Fair Events inactive and includes a timed
 * occurrence that falls on the "Until Date".
 *
 * Runs in a browser timezone behind UTC, where a date-only string parsed as
 * UTC would land on the previous day (UI_GUIDELINES.md "Dates and times").
 *
 * Run: `npm run test:e2e:local -- --workspace=fair-calendar-button -- e2e/recurrence-editor.spec.js`.
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

async function setPluginStatus( page, plugin, status ) {
	await apiFetch( page, {
		path: `/wp/v2/plugins/${ plugin }`,
		method: 'POST',
		data: { status },
	} );
}

async function openEditor( page, url ) {
	await page.goto( url );
	await page.waitForFunction(
		() =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId() &&
			window.wp.blocks.getBlockType(
				'fair-calendar-button/calendar-button'
			)
	);
	// The welcome guide of a fresh admin session covers the editor.
	await page.evaluate( () => {
		// eslint-disable-next-line no-undef
		wp.data
			.dispatch( 'core/preferences' )
			.set( 'core/edit-post', 'welcomeGuide', false );
	} );
}

async function selectCalendarButton( page ) {
	await page.evaluate( () => {
		// eslint-disable-next-line no-undef
		const { select, dispatch } = wp.data;
		const block = select( 'core/block-editor' )
			.getBlocks()
			.find(
				( candidate ) =>
					candidate.name === 'fair-calendar-button/calendar-button'
			);
		dispatch( 'core/block-editor' ).selectBlock( block.clientId );
		dispatch( 'core/edit-post' ).openGeneralSidebar( 'edit-post/block' );
	} );
}

function calendarButtonBlocks( page ) {
	return page.evaluate( () =>
		// eslint-disable-next-line no-undef
		wp.data
			.select( 'core/block-editor' )
			.getBlocks()
			.filter(
				( block ) =>
					block.name === 'fair-calendar-button/calendar-button'
			)
			.map( ( block ) => ( {
				isValid: block.isValid,
				attributes: block.attributes,
			} ) )
	);
}

// Local "Y-m-d" for a Date built from local parts.
function toDateString( date ) {
	return `${ date.getFullYear() }-${ String( date.getMonth() + 1 ).padStart(
		2,
		'0'
	) }-${ String( date.getDate() ).padStart( 2, '0' ) }`;
}

/**
 * Show the month of the given date in the occurrence calendar, which opens on
 * the current month, and return the highlighted days.
 */
async function occurrenceDaysInMonth( page, monthsAhead ) {
	const calendar = page.locator( '.recurring-events-calendar' );
	for ( let i = 0; i < monthsAhead; i++ ) {
		await calendar.getByRole( 'button', { name: 'Next month' } ).click();
	}
	return calendar.locator( '.calendar-day.has-event' ).allTextContents();
}

test.describe( 'Calendar Button recurrence editor', () => {
	test( 'builds and previews a rule with Fair Events inactive', async ( {
		page,
	} ) => {
		// A weekly event tonight that repeats until the day two weeks from
		// now: three occurrences, the last one on the until date itself.
		const today = new Date();
		const occurrences = [ 0, 7, 14 ].map(
			( offset ) =>
				new Date(
					today.getFullYear(),
					today.getMonth(),
					today.getDate() + offset
				)
		);
		const startDay = toDateString( occurrences[ 0 ] );
		const untilDay = toDateString( occurrences[ 2 ] );
		const expectedRRule = `FREQ=WEEKLY;UNTIL=${ untilDay.replace(
			/-/g,
			''
		) }`;
		// Occurrence days per displayed month, starting with the current one.
		const expectedByMonth = [ [], [] ];
		occurrences.forEach( ( date ) => {
			const monthsAhead =
				( date.getFullYear() - today.getFullYear() ) * 12 +
				date.getMonth() -
				today.getMonth();
			expectedByMonth[ monthsAhead ].push( String( date.getDate() ) );
		} );
		const untilMonthsAhead = expectedByMonth[ 1 ].length ? 1 : 0;

		await login( page );
		await page.goto( '/wp-admin/post-new.php' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		const plugins = await apiFetch( page, { path: '/wp/v2/plugins' } );
		const statusBefore = Object.fromEntries(
			plugins.map( ( { plugin, status } ) => [ plugin, status ] )
		);
		const toDeactivate = FAIR_EVENTS_PLUGINS.filter(
			( plugin ) => statusBefore[ plugin ] === 'active'
		);
		let postId = null;

		try {
			for ( const plugin of toDeactivate ) {
				await setPluginStatus( page, plugin, 'inactive' );
			}
			if ( statusBefore[ CALENDAR_BUTTON ] !== 'active' ) {
				await setPluginStatus( page, CALENDAR_BUTTON, 'active' );
			}

			await openEditor( page, '/wp-admin/post-new.php' );
			expect(
				await page.evaluate(
					() =>
						// eslint-disable-next-line no-undef
						!! wp.blocks.getBlockType( 'fair-events/event-dates' )
				)
			).toBe( false );

			await page.evaluate(
				( { start, end } ) => {
					// eslint-disable-next-line no-undef
					const { dispatch } = wp.data;
					dispatch( 'core/editor' ).editPost( {
						title: 'Calendar Button recurrence E2E',
						status: 'publish',
					} );
					dispatch( 'core/block-editor' ).insertBlock(
						// eslint-disable-next-line no-undef
						wp.blocks.createBlock(
							'fair-calendar-button/calendar-button',
							{ start, end }
						)
					);
				},
				{ start: `${ startDay }T22:30`, end: `${ startDay }T23:30` }
			);
			await selectCalendarButton( page );

			// Edit the recurrence through the block's own controls.
			await page.getByLabel( 'Recurring Event' ).check();
			await page.getByLabel( 'Frequency' ).selectOption( 'WEEKLY' );
			await page.getByLabel( 'Until Date' ).fill( untilDay );

			const calendar = page.locator( '.recurring-events-calendar' );
			await expect( calendar ).toBeVisible();
			expect( await occurrenceDaysInMonth( page, 0 ) ).toEqual(
				expectedByMonth[ 0 ]
			);
			if ( untilMonthsAhead ) {
				expect( await occurrenceDaysInMonth( page, 1 ) ).toEqual(
					expectedByMonth[ 1 ]
				);
			}
			// The until day is both an occurrence and the end date.
			await expect(
				calendar.locator( '.calendar-day.has-event.is-end-date' )
			).toHaveText( String( occurrences[ 2 ].getDate() ) );

			postId = await page.evaluate( async () => {
				// eslint-disable-next-line no-undef
				await wp.data.dispatch( 'core/editor' ).savePost();
				// eslint-disable-next-line no-undef
				return wp.data.select( 'core/editor' ).getCurrentPostId();
			} );

			// Reopen: the saved attributes carry the shared rule.
			await openEditor(
				page,
				`/wp-admin/post.php?post=${ postId }&action=edit`
			);
			const blocks = await calendarButtonBlocks( page );
			expect( blocks ).toHaveLength( 1 );
			expect( blocks[ 0 ].isValid ).toBe( true );
			expect( blocks[ 0 ].attributes ).toMatchObject( {
				recurring: true,
				recurrence: {
					frequency: 'WEEKLY',
					count: null,
					until: untilDay,
				},
				rRule: expectedRRule,
			} );

			await selectCalendarButton( page );
			await expect( page.getByLabel( 'Until Date' ) ).toHaveValue(
				untilDay
			);
			expect(
				await occurrenceDaysInMonth( page, untilMonthsAhead )
			).toEqual( expectedByMonth[ untilMonthsAhead ] );
			await expect(
				calendar.locator( '.calendar-day.has-event.is-end-date' )
			).toHaveText( String( occurrences[ 2 ].getDate() ) );

			// The published block hands the saved rule to the calendar links.
			await page.goto( `/?p=${ postId }` );
			const button = page.locator( '.calendar-button-container' );
			await expect( button ).toHaveAttribute( 'data-recurring', 'true' );
			await expect( button ).toHaveAttribute(
				'data-rrule',
				expectedRRule
			);
		} finally {
			await page.goto( '/wp-admin/post-new.php' );
			await page.waitForFunction( () => window.wp?.apiFetch );
			if ( postId ) {
				await apiFetch( page, {
					path: `/wp/v2/posts/${ postId }?force=true`,
					method: 'DELETE',
				} );
			}
			if ( statusBefore[ CALENDAR_BUTTON ] !== 'active' ) {
				await setPluginStatus(
					page,
					CALENDAR_BUTTON,
					statusBefore[ CALENDAR_BUTTON ]
				);
			}
			// Fair Events first: the experimental plugin requires it.
			for ( const plugin of [ ...toDeactivate ].reverse() ) {
				await setPluginStatus( page, plugin, 'active' );
			}
		}
	} );
} );
