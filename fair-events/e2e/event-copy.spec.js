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

async function createCopy( page, eventId, title, customDate = null ) {
	await page.goto( `/wp-admin/edit.php?post_type=fair_event`, {
		waitUntil: 'domcontentloaded',
	} );
	const row = page.locator( `#post-${ eventId }` );
	await expect( row ).toBeVisible();
	await row.hover();
	const copyAction = row.locator( '.row-actions .copy a' );
	await expect( copyAction ).toBeVisible();
	const copyUrl = await copyAction.getAttribute( 'href' );
	const copyScreen = await page.request.get( copyUrl );
	expect( copyScreen.ok() ).toBe( true );
	const copyScreenHtml = await copyScreen.text();
	expect( copyScreenHtml ).toContain( 'Copy Event' );
	const submissionNonce = copyScreenHtml.match(
		/name="copy_event_nonce" value="([^"]+)"/
	)?.[ 1 ];
	expect( submissionNonce ).toBeTruthy();

	const response = await page.request.post( copyUrl, {
		maxRedirects: 0,
		form: {
			copy_event_submit: 'Create Copy',
			copy_event_nonce: submissionNonce,
			event_title: title,
			date_option: customDate ? 'custom' : 'week',
			custom_date: customDate || '',
		},
	} );
	expect( response.status() ).toBe( 302 );
	const redirect = response.headers().location;
	expect( redirect ).toMatch( /\/wp-admin\/post\.php\?action=edit&post=\d+/ );
	return Number( new URL( redirect ).searchParams.get( 'post' ) );
}

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
				start_datetime: '2036-04-10 18:30:00',
				end_datetime: '2036-04-10 21:00:00',
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
			expect( copied.status ).toBe( 'draft' );
			expect( copied.content.raw ).toBe( 'Copy source content' );
			expect( copied.excerpt.raw ).toBe( 'Copy source excerpt' );
			expect( copied.featured_media ).toBe( media.id );
			expect( copied.categories ).toContain( category.id );
			expect( copied.tags ).toContain( tag.id );
			expect( copied.meta.event_location ).toBe( 'Legacy copy location' );
			expect( copiedDates ).toHaveLength( 1 );
			expect( copiedDates[ 0 ].venue_id ).toBe( venue.id );
			expect( copiedDates[ 0 ].all_day ).toBe( false );
			expect( copiedDates[ 0 ].end_datetime ).toBe(
				0 === index ? '2036-04-17 21:00:00' : '2036-05-20 21:00:00'
			);
			expect( copiedDates[ 0 ].start_datetime ).toBe(
				0 === index ? '2036-04-17 18:30:00' : '2036-05-20 18:30:00'
			);
		}

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
	}
} );
