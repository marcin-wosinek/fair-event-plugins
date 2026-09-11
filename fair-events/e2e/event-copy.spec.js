import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const EXPERIMENTAL_PLUGIN = 'fair-events-experimental/fair-events-experimental';

async function login(
	page,
	username = WP_ADMIN_USER,
	password = WP_ADMIN_PASS
) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', username );
		await page.fill( '#user_pass', password );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function apiFetch( page, options, throwOnError = true ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return {
				ok: false,
				error: {
					message: error?.message,
					code: error?.code,
					data: error?.data,
				},
			};
		}
	}, options );

	if ( throwOnError && ! result.ok ) {
		throw new Error( JSON.stringify( result.error ) );
	}
	return result;
}

async function setPluginStatus( page, status ) {
	return apiFetch( page, {
		path: `/wp/v2/plugins/${ EXPERIMENTAL_PLUGIN }`,
		method: 'PUT',
		data: { status },
	} );
}

async function submitCopy(
	page,
	copyUrl,
	title,
	customDate = null,
	startTime = null,
	endTime = null
) {
	const copyScreen = await page.request.get( copyUrl );
	expect( copyScreen.ok() ).toBe( true );
	const copyScreenHtml = await copyScreen.text();
	expect( copyScreenHtml ).toContain( 'Copy Event' );
	const submissionNonce = copyScreenHtml.match(
		/name="copy_event_nonce" value="([^"]+)"/
	)?.[ 1 ];
	expect( submissionNonce ).toBeTruthy();
	const defaultStartTime = copyScreenHtml.match(
		/name="start_time" value="([^"]*)"/
	)?.[ 1 ];
	const defaultEndTime = copyScreenHtml.match(
		/name="end_time" value="([^"]*)"/
	)?.[ 1 ];

	const response = await page.request.post( copyUrl, {
		maxRedirects: 0,
		form: {
			copy_event_submit: 'Create Copy',
			copy_event_nonce: submissionNonce,
			event_title: title,
			date_option: customDate ? 'custom' : 'week',
			custom_date: customDate || '',
			start_time: startTime ?? defaultStartTime ?? '',
			end_time: endTime ?? defaultEndTime ?? '',
		},
	} );
	expect( response.status() ).toBe( 302 );
	return response.headers().location;
}

async function createCopy(
	page,
	eventId,
	title,
	customDate = null,
	startTime = null,
	endTime = null
) {
	await page.goto( `/wp-admin/edit.php?post_type=fair_event`, {
		waitUntil: 'domcontentloaded',
	} );
	const row = page.locator( `#post-${ eventId }` );
	await expect( row ).toBeVisible();
	await row.hover();
	const copyAction = row.locator( '.row-actions .copy a' );
	await expect( copyAction ).toBeVisible();
	const copyUrl = await copyAction.getAttribute( 'href' );
	const redirect = await submitCopy(
		page,
		copyUrl,
		title,
		customDate,
		startTime,
		endTime
	);
	const redirectUrl = new URL( redirect );
	expect( redirectUrl.pathname ).toBe( '/wp-admin/post.php' );
	expect( redirectUrl.searchParams.get( 'action' ) ).toBe( 'edit' );
	expect( Number( redirectUrl.searchParams.get( 'post' ) ) ).toBeGreaterThan(
		0
	);
	return Number( redirectUrl.searchParams.get( 'post' ) );
}

test( 'copies an enabled page and a calendar-only event in place', async ( {
	page,
} ) => {
	test.setTimeout( 300_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const suffix = Date.now();
	const settings = (
		await apiFetch( page, { path: '/wp/v2/settings?context=edit' } )
	).data;
	let sourcePage;
	let sourcePageDate;
	let copiedPageId;
	let calendarDate;
	let copiedCalendarDateId;

	try {
		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_events_enabled_post_types: [ 'page' ] },
		} );
		sourcePage = (
			await apiFetch( page, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title: `Page copy source ${ suffix }`,
					content: 'Page copy content',
					excerpt: 'Page copy excerpt',
					status: 'publish',
				},
			} )
		).data;
		sourcePageDate = (
			await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: sourcePage.title.rendered,
					start_datetime: '2040-02-01 10:00:00',
					end_datetime: '2040-02-01 12:00:00',
					link_type: 'post',
				},
			} )
		).data;
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourcePageDate.id }`,
			method: 'PUT',
			data: { event_id: sourcePage.id },
		} );

		await page.goto( '/wp-admin/edit.php?post_type=page' );
		const pageRow = page.locator( `#post-${ sourcePage.id }` );
		await pageRow.hover();
		const pageCopyUrl = await pageRow
			.locator( '.row-actions .copy a' )
			.getAttribute( 'href' );
		expect( pageCopyUrl ).toContain(
			`event_date_id=${ sourcePageDate.id }`
		);
		await page.goto(
			`/wp-admin/post.php?action=edit&post=${ sourcePage.id }`
		);
		await expect(
			page.locator( '#wp-admin-bar-copy-event > a' )
		).toHaveAttribute( 'href', pageCopyUrl );
		const pageRedirect = await submitCopy(
			page,
			pageCopyUrl,
			`Copied page ${ suffix }`,
			null,
			'08:15',
			'13:45'
		);
		copiedPageId = Number(
			new URL( pageRedirect ).searchParams.get( 'post' )
		);
		const copiedPage = (
			await apiFetch( page, {
				path: `/wp/v2/pages/${ copiedPageId }?context=edit`,
			} )
		).data;
		expect( copiedPage.status ).toBe( 'draft' );
		expect( copiedPage.content.raw ).toBe( 'Page copy content' );
		const copiedPageDates = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates?event_id=${ copiedPageId }&include_linked=true`,
			} )
		).data;
		expect( copiedPageDates[ 0 ].start_datetime ).toBe(
			'2040-02-08 08:15:00'
		);
		expect( copiedPageDates[ 0 ].end_datetime ).toBe(
			'2040-02-08 13:45:00'
		);

		calendarDate = (
			await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: `Calendar copy source ${ suffix }`,
					start_datetime: '2040-03-01 09:00:00',
					end_datetime: '2040-03-01 11:30:00',
					link_type: 'none',
					attendance_mode: 'online',
					joining_link: 'https://example.com/join',
				},
			} )
		).data;
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ calendarDate.id }&tab=admin`
		);
		const calendarCopyUrl = await page
			.getByRole( 'link', { name: 'Copy event' } )
			.getAttribute( 'href' );
		const calendarRedirect = await submitCopy(
			page,
			calendarCopyUrl,
			`Copied calendar event ${ suffix }`,
			'2040-04-10'
		);
		copiedCalendarDateId = Number(
			new URL( calendarRedirect ).searchParams.get( 'event_date_id' )
		);
		expect( copiedCalendarDateId ).toBeGreaterThan( 0 );
		const copiedCalendar = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ copiedCalendarDateId }`,
			} )
		).data;
		expect( copiedCalendar.event_id ).toBeNull();
		expect( copiedCalendar.title ).toBe(
			`Copied calendar event ${ suffix }`
		);
		expect( copiedCalendar.start_datetime ).toBe( '2040-04-10 09:00:00' );
		expect( copiedCalendar.end_datetime ).toBe( '2040-04-10 11:30:00' );
		expect( copiedCalendar.attendance_mode ).toBe( 'online' );
		expect( copiedCalendar.joining_link ).toBe(
			'https://example.com/join'
		);
	} finally {
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );
		for ( const id of [
			copiedCalendarDateId,
			calendarDate?.id,
			sourcePageDate?.id,
		] ) {
			if ( id ) {
				await apiFetch(
					page,
					{
						path: `/fair-events/v1/event-dates/${ id }`,
						method: 'DELETE',
					},
					false
				);
			}
		}
		for ( const id of [ copiedPageId, sourcePage?.id ] ) {
			if ( id ) {
				await apiFetch(
					page,
					{
						path: `/wp/v2/pages/${ id }?force=true`,
						method: 'DELETE',
					},
					false
				);
			}
		}
		await apiFetch(
			page,
			{
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					fair_events_enabled_post_types:
						settings.fair_events_enabled_post_types,
				},
			},
			false
		);
	}
} );

test( 'edits copied times and keeps all-day copies date-only', async ( {
	page,
} ) => {
	test.setTimeout( 300_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
	const suffix = Date.now();
	const ids = [];

	try {
		const timed = (
			await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: `Timed copy source ${ suffix }`,
					start_datetime: '2041-05-10 22:30:00',
					end_datetime: '2041-05-12 01:15:00',
					all_day: false,
					link_type: 'none',
				},
			} )
		).data;
		ids.push( timed.id );
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ timed.id }&tab=admin`
		);
		const timedCopyUrl = await page
			.getByRole( 'link', { name: 'Copy event' } )
			.getAttribute( 'href' );
		await page.goto( timedCopyUrl );
		await expect( page.getByLabel( 'Start time' ) ).toHaveValue( '22:30' );
		await expect( page.getByLabel( 'End time' ) ).toHaveValue( '01:15' );
		await page.getByLabel( 'Start time' ).fill( '20:45' );
		await page.getByLabel( 'End time' ).fill( '02:30' );
		await page.getByLabel( 'Custom date' ).check();
		await page.locator( '#custom_date' ).fill( '2041-06-20' );
		await expect( page.locator( '#summary-start-date' ) ).toContainText(
			'June 20, 2041 at 8:45 PM'
		);
		await expect( page.locator( '#summary-end-date' ) ).toContainText(
			'June 22, 2041 at 2:30 AM'
		);
		await page.getByRole( 'button', { name: 'Create Copy' } ).click();
		await expect( page ).toHaveURL( /fair-events-manage-event/ );
		const timedCopyId = Number(
			new URL( page.url() ).searchParams.get( 'event_date_id' )
		);
		ids.push( timedCopyId );
		const timedCopy = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ timedCopyId }`,
			} )
		).data;
		expect( timedCopy.start_datetime ).toBe( '2041-06-20 20:45:00' );
		expect( timedCopy.end_datetime ).toBe( '2041-06-22 02:30:00' );

		const copyScreenHtml = await (
			await page.request.get( timedCopyUrl )
		).text();
		const nonce = copyScreenHtml.match(
			/name="copy_event_nonce" value="([^"]+)"/
		)?.[ 1 ];
		const beforeInvalid = (
			await apiFetch( page, { path: '/fair-events/v1/event-dates' } )
		).data.map( ( { id } ) => id );
		const invalid = await page.request.post( timedCopyUrl, {
			form: {
				copy_event_submit: 'Create Copy',
				copy_event_nonce: nonce,
				event_title: `Invalid time ${ suffix }`,
				date_option: 'week',
				start_time: '25:00',
				end_time: '',
			},
		} );
		expect( invalid.status() ).toBe( 500 );
		expect( await invalid.text() ).toContain(
			'Enter valid start and end times.'
		);
		expect(
			(
				await apiFetch( page, { path: '/fair-events/v1/event-dates' } )
			).data.map( ( { id } ) => id )
		).toEqual( beforeInvalid );

		const allDay = (
			await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: `All-day copy source ${ suffix }`,
					start_datetime: '2041-07-01',
					end_datetime: '2041-07-03',
					all_day: true,
					link_type: 'none',
				},
			} )
		).data;
		ids.push( allDay.id );
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ allDay.id }&tab=admin`
		);
		const allDayCopyUrl = await page
			.getByRole( 'link', { name: 'Copy event' } )
			.getAttribute( 'href' );
		await page.goto( allDayCopyUrl );
		await expect( page.locator( '#start_time' ) ).toHaveCount( 0 );
		await expect( page.locator( '#end_time' ) ).toHaveCount( 0 );
		const redirect = await submitCopy(
			page,
			allDayCopyUrl,
			`All-day copy ${ suffix }`,
			null,
			'12:34',
			'13:45'
		);
		const allDayCopyId = Number(
			new URL( redirect ).searchParams.get( 'event_date_id' )
		);
		ids.push( allDayCopyId );
		const allDayCopy = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ allDayCopyId }`,
			} )
		).data;
		expect( allDayCopy.all_day ).toBe( true );
		expect( allDayCopy.start_datetime ).toBe( '2041-07-08 00:00:00' );
		expect( allDayCopy.end_datetime ).toBe( '2041-07-10 00:00:00' );
	} finally {
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );
		for ( const id of ids ) {
			await apiFetch(
				page,
				{
					path: `/fair-events/v1/event-dates/${ id }`,
					method: 'DELETE',
				},
				false
			);
		}
	}
} );

test( 'starts the copy workflow from the All Events row action', async ( {
	page,
} ) => {
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const suffix = Date.now();
	const source = (
		await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `All Events copy source ${ suffix }`,
				status: 'publish',
			},
		} )
	).data;
	const sourceDate = (
		await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: source.title.rendered,
				start_datetime: '2039-03-26 18:30:00',
				link_type: 'post',
			},
		} )
	).data;

	try {
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
			method: 'PUT',
			data: { event_id: source.id },
		} );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page
			.getByRole( 'searchbox', { name: 'Search' } )
			.fill( source.title.rendered );
		const sourceRow = page.getByRole( 'row', {
			name: new RegExp( source.title.rendered ),
		} );
		await expect( sourceRow ).toBeVisible();
		await sourceRow.getByRole( 'button', { name: 'Actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Copy' } ).click();
		await expect( page ).toHaveURL(
			new RegExp(
				`page=fair-events-copy.*event_date_id=${ sourceDate.id }`
			)
		);
		await expect( page.locator( 'h1' ) ).toContainText(
			source.title.rendered
		);
	} finally {
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/wp/v2/fair_event/${ source.id }?force=true`,
				method: 'DELETE',
			},
			false
		);
	}
} );

test( 'copies events without Experimental and keeps advanced tools isolated', async ( {
	browser,
	page,
} ) => {
	test.setTimeout( 300_000 );
	page.setDefaultNavigationTimeout( 30_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const plugins = ( await apiFetch( page, { path: '/wp/v2/plugins' } ) ).data;
	const experimental = plugins.find(
		( plugin ) => plugin.plugin === EXPERIMENTAL_PLUGIN
	);
	const originalExperimentalStatus = experimental.status;
	await setPluginStatus( page, 'inactive' );

	const suffix = Date.now();
	const category = (
		await apiFetch( page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Copy category ${ suffix }` },
		} )
	).data;
	const tag = (
		await apiFetch( page, {
			path: '/wp/v2/tags',
			method: 'POST',
			data: { name: `Copy tag ${ suffix }` },
		} )
	).data;
	const venue = (
		await apiFetch( page, {
			path: '/fair-events/v1/venues',
			method: 'POST',
			data: { name: `Copy venue ${ suffix }`, address: 'Test address' },
		} )
	).data;
	const media = await page.evaluate( async () => {
		const bytes = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
			),
			( char ) => char.charCodeAt( 0 )
		);
		const form = new FormData();
		form.append(
			'file',
			new Blob( [ bytes ], { type: 'image/png' } ),
			'copy-event.png'
		);
		// eslint-disable-next-line no-undef
		return wp.apiFetch( {
			path: '/wp/v2/media',
			method: 'POST',
			body: form,
		} );
	} );
	const source = (
		await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Copy source ${ suffix }`,
				content: 'Copy source content',
				excerpt: 'Copy source excerpt',
				status: 'publish',
				featured_media: media.id,
				categories: [ category.id ],
				tags: [ tag.id ],
				meta: { event_location: 'Legacy copy location' },
			},
		} )
	).data;
	const sourceDate = (
		await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: source.title.rendered,
				start_datetime: '2036-03-26 18:30:00',
				end_datetime: '2036-03-26 21:00:00',
				all_day: false,
				venue_id: venue.id,
				link_type: 'post',
			},
		} )
	).data;
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
		method: 'PUT',
		data: { event_id: source.id },
	} );
	const originalSettings = (
		await apiFetch( page, { path: '/wp/v2/settings?context=edit' } )
	).data;
	await apiFetch( page, {
		path: '/wp/v2/settings',
		method: 'POST',
		data: { timezone: 'Europe/Madrid' },
	} );
	let sourceTickets = (
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }/tickets`,
			method: 'PUT',
			data: {
				capacity: 120,
				settings: {
					show_ticket_type_capacity: true,
					multiple_pricing_periods: true,
					minimum_activities: 1,
				},
				ticket_types: [
					{
						name: 'General',
						capacity: 80,
						activities_enabled: false,
						minimum_activities: 0,
						maximum_activities: 2,
						disable_at: '2036-03-25 18:30:00',
						recurrence_scope: 'single_instance',
						disabled: true,
					},
					{
						name: 'Supporter',
						capacity: null,
						recurrence_scope: 'single_instance',
					},
				],
				sale_periods: [
					{
						name: 'Early',
						sale_start: '2036-03-20 09:00:00',
						sale_end: '2036-03-25 23:00:00',
					},
					{
						name: 'Open start',
						sale_start: null,
						sale_end: '2036-03-26 18:30:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 15.5,
						capacity: 40,
					},
					{
						ticket_type_index: 1,
						sale_period_index: 1,
						price: 25,
						capacity: null,
					},
				],
				options: [],
			},
		} )
	).data;
	sourceTickets = (
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }/tickets`,
			method: 'PUT',
			data: {
				...sourceTickets,
				ticket_types: sourceTickets.ticket_types.map(
					( type, index ) => ( {
						...type,
						disabled: 0 === index,
					} )
				),
				prices: sourceTickets.prices.map( ( price ) => ( {
					...price,
					ticket_type_index: sourceTickets.ticket_types.findIndex(
						( type ) => type.id === price.ticket_type_id
					),
					sale_period_index: sourceTickets.sale_periods.findIndex(
						( period ) => period.id === price.sale_period_id
					),
				} ) ),
			},
		} )
	).data;
	const unavailableTicketTypeId =
		Math.max( ...sourceTickets.ticket_types.map( ( type ) => type.id ) ) +
		1000000;
	const sourceConditionalAttributes = {
		conditionSource: 'ticketType',
		conditionOperator: 'not_selected',
		conditionTicketTypeIds: [
			sourceTickets.ticket_types[ 1 ].id,
			unavailableTicketTypeId,
			sourceTickets.ticket_types[ 0 ].id,
		],
	};
	await apiFetch( page, {
		path: `/wp/v2/fair_event/${ source.id }`,
		method: 'POST',
		data: {
			content: `<!-- wp:fair-events/event-signup -->
<!-- wp:fair-audience/fair-form-conditional ${ JSON.stringify(
				sourceConditionalAttributes
			) } -->
<!-- wp:paragraph --><p>Nested conditional content</p><!-- /wp:paragraph -->
<!-- /wp:fair-audience/fair-form-conditional -->
<!-- /wp:fair-events/event-signup -->`,
		},
	} );

	const copiedIds = [];
	let restrictedUser;
	try {
		copiedIds.push(
			await createCopy( page, source.id, `Week copy ${ suffix }` )
		);
		copiedIds.push(
			await createCopy(
				page,
				source.id,
				`Custom copy ${ suffix }`,
				'2036-05-20'
			)
		);

		for ( const [ index, copiedId ] of copiedIds.entries() ) {
			const copied = (
				await apiFetch( page, {
					path: `/wp/v2/fair_event/${ copiedId }?context=edit`,
				} )
			).data;
			const copiedDates = (
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates?event_id=${ copiedId }&include_linked=true`,
				} )
			).data;
			const copiedTickets = (
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ copiedDates[ 0 ].id }/tickets`,
				} )
			).data;
			expect( copied.status ).toBe( 'draft' );
			expect( copied.content.raw ).toContain(
				'Nested conditional content'
			);
			expect( copied.excerpt.raw ).toBe( 'Copy source excerpt' );
			expect( copied.featured_media ).toBe( media.id );
			expect( copied.categories ).toContain( category.id );
			expect( copied.tags ).toContain( tag.id );
			expect( copied.meta.event_location ).toBe( 'Legacy copy location' );
			expect( copiedDates ).toHaveLength( 1 );
			expect( copiedDates[ 0 ].venue_id ).toBe( venue.id );
			expect( copiedDates[ 0 ].all_day ).toBe( false );
			expect( copiedDates[ 0 ].end_datetime ).toBe(
				0 === index ? '2036-04-02 21:00:00' : '2036-05-20 21:00:00'
			);
			expect( copiedDates[ 0 ].start_datetime ).toBe(
				0 === index ? '2036-04-02 18:30:00' : '2036-05-20 18:30:00'
			);
			expect( copiedTickets.capacity ).toBe( 120 );
			expect( copiedTickets.settings ).toMatchObject(
				sourceTickets.settings
			);
			expect( copiedTickets.ticket_types ).toHaveLength( 2 );
			expect( copiedTickets.sale_periods ).toHaveLength( 2 );
			expect( copiedTickets.prices ).toHaveLength( 2 );
			expect( copiedTickets.ticket_types[ 0 ] ).toMatchObject( {
				name: 'General',
				capacity: 80,
				activities_enabled: false,
				maximum_activities: 2,
				disabled: true,
			} );
			expect( copiedTickets.ticket_types[ 0 ].id ).not.toBe(
				sourceTickets.ticket_types[ 0 ].id
			);
			expect( copiedTickets.sale_periods[ 0 ].id ).not.toBe(
				sourceTickets.sale_periods[ 0 ].id
			);
			expect( copiedTickets.prices[ 0 ].id ).not.toBe(
				sourceTickets.prices[ 0 ].id
			);
			expect( copiedTickets.sale_periods[ 1 ].sale_start ).toBeNull();
			expect( copiedTickets.ticket_types[ 0 ].disable_at ).toBe(
				0 === index ? '2036-04-01 18:30:00' : '2036-05-19 18:30:00'
			);
			expect( copiedTickets.sale_periods[ 0 ].sale_start ).toBe(
				0 === index ? '2036-03-27 09:00:00' : '2036-05-14 09:00:00'
			);

			await page.goto(
				`/wp-admin/post.php?action=edit&post=${ copiedId }`
			);
			await page.waitForFunction( () => window.wp?.blocks );
			const copiedBlocks = await page.evaluate( ( content ) => {
				// eslint-disable-next-line no-undef
				return wp.blocks.parse( content );
			}, copied.content.raw );
			const copiedConditional = copiedBlocks[ 0 ].innerBlocks[ 0 ];
			expect( copiedConditional.name ).toBe(
				'fair-audience/fair-form-conditional'
			);
			expect( copiedConditional.attributes ).toMatchObject( {
				conditionSource: sourceConditionalAttributes.conditionSource,
				conditionOperator:
					sourceConditionalAttributes.conditionOperator,
				conditionTicketTypeIds: [
					copiedTickets.ticket_types[ 1 ].id,
					copiedTickets.ticket_types[ 0 ].id,
				],
			} );
			expect(
				copiedConditional.innerBlocks[ 0 ].attributes.content
			).toBe( 'Nested conditional content' );

			await expect(
				page
					.frameLocator( '[name="editor-canvas"]' )
					.getByText( 'Supporter, General is not selected' )
			).toBeVisible();
		}

		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }/tickets`,
			method: 'PUT',
			data: {
				...sourceTickets,
				ticket_types: sourceTickets.ticket_types.map(
					( type, index ) => ( {
						...type,
						name: 0 === index ? 'Changed source' : type.name,
					} )
				),
				prices: sourceTickets.prices.map( ( price ) => ( {
					...price,
					ticket_type_index: sourceTickets.ticket_types.findIndex(
						( type ) => type.id === price.ticket_type_id
					),
					sale_period_index: sourceTickets.sale_periods.findIndex(
						( period ) => period.id === price.sale_period_id
					),
				} ) ),
			},
		} );
		const firstCopyDates = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates?event_id=${ copiedIds[ 0 ] }&include_linked=true`,
			} )
		).data;
		const unchangedCopy = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ firstCopyDates[ 0 ].id }/tickets`,
			} )
		).data;
		expect( unchangedCopy.ticket_types[ 0 ].name ).toBe( 'General' );

		await page.goto( '/wp-admin/edit.php?post_type=fair_event' );
		const copyUrl = await page
			.locator( `#post-${ source.id } .row-actions .copy a` )
			.getAttribute( 'href' );
		const invalidOpen = await page.request.get(
			copyUrl.replace( /_wpnonce=[^&]+/, '_wpnonce=invalid' )
		);
		expect( await invalidOpen.text() ).toContain( 'Security check failed' );
		const invalidSubmission = await page.request.post( copyUrl, {
			form: {
				copy_event_submit: 'Create Copy',
				copy_event_nonce: 'invalid',
				event_title: `Invalid copy ${ suffix }`,
				date_option: 'week',
			},
		} );
		expect( await invalidSubmission.text() ).toContain(
			'Security check failed'
		);
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp?.apiFetch );

		restrictedUser = (
			await apiFetch( page, {
				path: '/wp/v2/users',
				method: 'POST',
				data: {
					username: `copy_author_${ suffix }`,
					email: `copy-author-${ suffix }@example.com`,
					password: `Copy-${ suffix }-password`,
					roles: [ 'subscriber' ],
				},
			} )
		).data;
		const restrictedContext = await browser.newContext();
		const restrictedPage = await restrictedContext.newPage();
		await login(
			restrictedPage,
			restrictedUser.username,
			`Copy-${ suffix }-password`
		);
		const restrictedResponse = await restrictedPage.request.get( copyUrl );
		expect( await restrictedResponse.text() ).not.toContain(
			'id="event_title"'
		);
		await restrictedContext.close();

		await setPluginStatus( page, 'active' );
		await page.goto( '/wp-admin/edit.php?post_type=fair_event' );
		await expect(
			page.locator( `#post-${ source.id } .row-actions .copy` )
		).toHaveCount( 1 );
		await page.goto( `/wp-admin/post.php?action=edit&post=${ source.id }` );
		await expect( page.locator( '#wp-admin-bar-copy-event' ) ).toHaveCount(
			1
		);
		const experimentalCopyScreen = await page.request.get( copyUrl );
		expect( experimentalCopyScreen.ok() ).toBe( true );
		expect( await experimentalCopyScreen.text() ).toContain(
			'id="event_title"'
		);
		for ( const slug of [
			'fair-events-duplicate-event',
			'fair-events-merge-event',
		] ) {
			const advancedPage = await page.request.get(
				`/wp-admin/admin.php?page=${ slug }&event_date_id=${ sourceDate.id }`
			);
			expect( advancedPage.ok() ).toBe( true );
			expect( await advancedPage.text() ).toContain(
				`id="${ slug }-root"`
			);
		}
	} finally {
		await login( page );
		if ( restrictedUser ) {
			await apiFetch(
				page,
				{
					path: `/wp/v2/users/${ restrictedUser.id }?force=true&reassign=1`,
					method: 'DELETE',
				},
				false
			);
		}
		for ( const copiedId of copiedIds ) {
			await apiFetch(
				page,
				{
					path: `/wp/v2/fair_event/${ copiedId }?force=true`,
					method: 'DELETE',
				},
				false
			);
		}
		await apiFetch(
			page,
			{
				path: `/wp/v2/fair_event/${ source.id }?force=true`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/venues/${ venue.id }`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/wp/v2/media/${ media.id }?force=true`,
				method: 'DELETE',
			},
			false
		);
		await setPluginStatus( page, originalExperimentalStatus ).catch(
			() => {}
		);
		await apiFetch(
			page,
			{
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					timezone: originalSettings.timezone,
					gmt_offset: originalSettings.gmt_offset,
				},
			},
			false
		);
	}
} );

test( 'copies Experimental ticket options and period prices', async ( {
	page,
} ) => {
	test.setTimeout( 300_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
	const plugins = ( await apiFetch( page, { path: '/wp/v2/plugins' } ) ).data;
	const experimental = plugins.find(
		( plugin ) => plugin.plugin === EXPERIMENTAL_PLUGIN
	);
	const originalExperimentalStatus = experimental.status;
	await setPluginStatus( page, 'active' );

	const suffix = Date.now();
	const source = (
		await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Option copy source ${ suffix }`,
				status: 'publish',
			},
		} )
	).data;
	const sourceDate = (
		await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: source.title.rendered,
				start_datetime: '2038-06-01 18:00:00',
				end_datetime: '2038-06-01 20:00:00',
			},
		} )
	).data;
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
		method: 'PUT',
		data: { event_id: source.id },
	} );
	const sourceTickets = (
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [],
				sale_periods: [
					{
						name: 'Summer',
						sale_start: '2038-05-01 10:00:00',
						sale_end: null,
					},
				],
				prices: [],
				settings: { activity_period_pricing: true },
				options: [
					{
						name: 'Workshop',
						short_name: 'WS',
						price: 12,
						capacity: 18,
						derive_price_from_sale_period: true,
						collaborator_ids: [],
						period_prices: [ { sale_period_index: 0, price: 9.5 } ],
					},
				],
			},
		} )
	).data;
	let copiedId;
	try {
		copiedId = await createCopy(
			page,
			source.id,
			`Option week copy ${ suffix }`
		);
		const copiedDates = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates?event_id=${ copiedId }&include_linked=true`,
			} )
		).data;
		const copiedTickets = (
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ copiedDates[ 0 ].id }/tickets`,
			} )
		).data;
		expect( copiedTickets.options ).toHaveLength( 1 );
		expect( copiedTickets.options[ 0 ] ).toMatchObject( {
			name: 'Workshop',
			short_name: 'WS',
			price: 12,
			capacity: 18,
			derive_price_from_sale_period: true,
			collaborator_ids: [],
		} );
		expect( copiedTickets.options[ 0 ].id ).not.toBe(
			sourceTickets.options[ 0 ].id
		);
		expect( copiedTickets.options[ 0 ].period_prices ).toEqual( [
			{
				sale_period_id: copiedTickets.sale_periods[ 0 ].id,
				price: 9.5,
			},
		] );
		expect( copiedTickets.sale_periods[ 0 ].sale_start ).toBe(
			'2038-05-08 10:00:00'
		);
		expect( copiedTickets.sale_periods[ 0 ].sale_end ).toBeNull();
	} finally {
		if ( copiedId ) {
			await apiFetch(
				page,
				{
					path: `/wp/v2/fair_event/${ copiedId }?force=true`,
					method: 'DELETE',
				},
				false
			);
		}
		await apiFetch(
			page,
			{
				path: `/wp/v2/fair_event/${ source.id }?force=true`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
				method: 'DELETE',
			},
			false
		);
		await setPluginStatus( page, originalExperimentalStatus ).catch(
			() => {}
		);
	}
} );

test( 'opens copy options from managed events and recurring occurrences', async ( {
	page,
} ) => {
	test.setTimeout( 300_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const suffix = Date.now();
	const source = (
		await apiFetch( page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Managed copy source ${ suffix }`,
				status: 'publish',
			},
		} )
	).data;
	const sourceDate = (
		await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: source.title.rendered,
				start_datetime: '2036-04-10 18:30:00',
				end_datetime: '2036-04-10 21:00:00',
				all_day: false,
				link_type: 'post',
				rrule: 'FREQ=WEEKLY;COUNT=2',
			},
		} )
	).data;
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
		method: 'PUT',
		data: { event_id: source.id },
	} );
	const linkedSeries = (
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
		} )
	).data;
	const generatedOccurrence = linkedSeries.generated_occurrences[ 0 ];
	const calendarOnlyDate = (
		await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Calendar only ${ suffix }`,
				start_datetime: '2036-06-10 18:30:00',
				end_datetime: '2036-06-10 21:00:00',
				all_day: false,
				link_type: 'none',
			},
		} )
	).data;

	try {
		for ( const eventDateId of [ sourceDate.id, generatedOccurrence.id ] ) {
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=admin`,
				{ waitUntil: 'domcontentloaded' }
			);
			const copyAction = page.getByRole( 'link', {
				name: 'Copy event',
			} );
			await expect( copyAction ).toBeVisible();
			if ( eventDateId === generatedOccurrence.id ) {
				await expect(
					page.getByText(
						'Open copy options for the underlying recurring event, not only this date.'
					)
				).toBeVisible();
			}
			const copyUrl = await copyAction.getAttribute( 'href' );
			await page.goto( copyUrl, { waitUntil: 'domcontentloaded' } );
			await expect( page ).toHaveURL( /page=fair-events-copy/ );
			await expect( page.locator( 'h1' ) ).toContainText(
				source.title.rendered
			);
		}

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ calendarOnlyDate.id }&tab=admin`,
			{ waitUntil: 'domcontentloaded' }
		);
		const calendarCopyAction = page.getByRole( 'link', {
			name: 'Copy event',
		} );
		await expect( calendarCopyAction ).toBeVisible();
		await expect( calendarCopyAction ).toHaveAttribute(
			'href',
			new RegExp( `event_date_id=${ calendarOnlyDate.id }` )
		);
	} finally {
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events', {
			waitUntil: 'domcontentloaded',
		} );
		await page.waitForFunction( () => window.wp?.apiFetch );
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/event-dates/${ calendarOnlyDate.id }`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/fair-events/v1/event-dates/${ sourceDate.id }`,
				method: 'DELETE',
			},
			false
		);
		await apiFetch(
			page,
			{
				path: `/wp/v2/fair_event/${ source.id }?force=true`,
				method: 'DELETE',
			},
			false
		);
	}
} );
