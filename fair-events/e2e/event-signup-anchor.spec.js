import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const FAIR_AUDIENCE_PLUGIN = 'fair-audience/fair-audience';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
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

async function setPluginStatus( page, status ) {
	return apiFetch( page, {
		path: `/wp/v2/plugins/${ FAIR_AUDIENCE_PLUGIN }`,
		method: 'PUT',
		data: { status },
	} );
}

test.describe( 'Event Signup — HTML anchor', () => {
	test.setTimeout( 60_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupPageId;
	let originalAudienceStatus;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		const plugins = await apiFetch( adminPage, {
			path: '/wp/v2/plugins',
		} );
		const fairAudience = plugins.find(
			( plugin ) => plugin.plugin === FAIR_AUDIENCE_PLUGIN
		);
		expect( fairAudience ).toBeDefined();
		originalAudienceStatus = fairAudience.status;

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Event Signup anchor e2e ${ Date.now() }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Event Signup anchor e2e',
				link_type: 'post',
				start_datetime: '2036-01-01 10:00:00',
				end_datetime: '2036-01-01 12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Event Signup anchor page ${ Date.now() }`,
				status: 'publish',
				content: [
					`<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId },"anchor":"signup-here"} /-->`,
					`<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
				].join( '\n' ),
			},
		} );
		signupPageId = signupPage.id;
	} );

	test.afterAll( async () => {
		if ( originalAudienceStatus ) {
			await setPluginStatus( adminPage, originalAudienceStatus ).catch(
				() => {}
			);
		}
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	for ( const audienceStatus of [ 'inactive', 'active' ] ) {
		test( `renders the anchor with fair-audience ${ audienceStatus }`, async ( {
			page,
		} ) => {
			await setPluginStatus( adminPage, audienceStatus );
			await page.goto( `/?page_id=${ signupPageId }` );

			const wrappers = page.locator( '.fair-events-get-tickets' );
			await expect( wrappers ).toHaveCount( 2 );
			await expect( wrappers.nth( 0 ) ).toHaveAttribute(
				'id',
				'signup-here'
			);
			await expect( wrappers.nth( 1 ) ).not.toHaveAttribute( 'id' );
		} );
	}
} );
