import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the multilingual Events Calendar category picker (#1627): the
 * Categories panel offers same-named categories from every configured
 * Polylang language, distinguished by an accessible "Name — Language"
 * label, and selecting/deselecting one drives the public calendar's
 * category filter independently of its same-named counterpart.
 *
 * Uses the test-only Polylang term-language fixture at
 * fair-e2e/v1/term-languages (see e2e/mu-plugins/fair-e2e-support.php) since
 * this environment does not install real Polylang.
 */

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error( result.error );
	}
	return result.data;
}

async function savedCategories( page, pageId ) {
	const saved = await apiFetch( page, {
		path: `/wp/v2/pages/${ pageId }?context=edit`,
	} );
	const match = saved.content.raw.match(
		/<!-- wp:fair-events\/events-calendar (\{.*?\}) \/-->/
	);
	return match ? JSON.parse( match[ 1 ] ).categories : [];
}

test( 'selects same-named categories by language and filters the public calendar independently', async ( {
	page,
} ) => {
	test.setTimeout( 90_000 );
	await login( page );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );

	const suffix = Date.now();
	const categoryName = `Bart ${ suffix }`;

	const catEs = await apiFetch( page, {
		path: '/wp/v2/categories',
		method: 'POST',
		data: { name: categoryName, slug: `bart-${ suffix }-es` },
	} );
	const catEn = await apiFetch( page, {
		path: '/wp/v2/categories',
		method: 'POST',
		data: { name: categoryName, slug: `bart-${ suffix }-en` },
	} );

	await apiFetch( page, {
		path: '/fair-e2e/v1/term-languages',
		method: 'POST',
		data: {
			languages: {
				[ catEs.id ]: { slug: 'es', name: 'Español' },
				[ catEn.id ]: { slug: 'en', name: 'English' },
			},
		},
	} );

	const eventEs = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Bart ES Event ${ suffix }`,
			start_datetime: '2036-03-10 10:00:00',
			end_datetime: '2036-03-10 12:00:00',
			link_type: 'external',
			external_url: 'https://example.com/bart-es',
			categories: [ catEs.id ],
		},
	} );
	const eventEn = await apiFetch( page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: `Bart EN Event ${ suffix }`,
			start_datetime: '2036-03-20 10:00:00',
			end_datetime: '2036-03-20 12:00:00',
			link_type: 'external',
			external_url: 'https://example.com/bart-en',
			categories: [ catEn.id ],
		},
	} );

	const calendarPage = await apiFetch( page, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: {
			title: `Multilingual Categories Calendar ${ suffix }`,
			status: 'publish',
			content: `<!-- wp:fair-events/events-calendar {"currentMonth":"03","currentYear":"2036","categories":[${ catEs.id }]} /-->`,
		},
	} );
	const pageUrl = calendarPage.link || `/?page_id=${ calendarPage.id }`;

	async function openEditorAndSelectBlock() {
		await page.goto(
			`/wp-admin/post.php?post=${ calendarPage.id }&action=edit`
		);
		const editorFrame = page.frameLocator( '[name="editor-canvas"]' );
		await editorFrame.locator( '.block-editor-iframe__body' ).waitFor();

		const welcomeGuide = page.locator( '.components-guide' );
		if ( await welcomeGuide.isVisible().catch( () => false ) ) {
			await page.getByRole( 'button', { name: 'Close' } ).first().click();
		}

		const calendarTitle = editorFrame.locator( '.navigation-title' );
		await calendarTitle.waitFor();
		await calendarTitle.click();

		return {
			spanishCheckbox: page.getByLabel( `Bart ${ suffix } — Español` ),
			englishCheckbox: page.getByLabel( `Bart ${ suffix } — English` ),
		};
	}

	// Only the Spanish-linked event shows before the English category is
	// selected.
	await page.goto( pageUrl );
	await expect( page.locator( '.event-title' ) ).toHaveText( [
		eventEs.title,
	] );

	// Open the editor and select both same-named categories.
	const firstEdit = await openEditorAndSelectBlock();
	await expect( firstEdit.spanishCheckbox ).toBeChecked();
	await expect( firstEdit.englishCheckbox ).not.toBeChecked();

	await firstEdit.englishCheckbox.check();
	await page.getByRole( 'button', { name: 'Save', exact: true } ).click();

	await expect
		.poll( async () => savedCategories( page, calendarPage.id ), {
			timeout: 15000,
		} )
		.toEqual( expect.arrayContaining( [ catEs.id, catEn.id ] ) );

	// Both events show once both translated categories are selected.
	await page.goto( pageUrl );
	await expect( page.locator( '.event-title' ) ).toHaveCount( 2 );
	await expect(
		page.locator( '.event-title', { hasText: `Bart ES Event ${ suffix }` } )
	).toBeVisible();
	await expect(
		page.locator( '.event-title', { hasText: `Bart EN Event ${ suffix }` } )
	).toBeVisible();

	// Deselecting the Spanish category excludes only its own event.
	const secondEdit = await openEditorAndSelectBlock();
	await expect( secondEdit.spanishCheckbox ).toBeChecked();
	await expect( secondEdit.englishCheckbox ).toBeChecked();

	await secondEdit.spanishCheckbox.uncheck();
	await page.getByRole( 'button', { name: 'Save', exact: true } ).click();

	await expect
		.poll( async () => savedCategories( page, calendarPage.id ), {
			timeout: 15000,
		} )
		.toEqual( [ catEn.id ] );

	await page.goto( pageUrl );
	await expect( page.locator( '.event-title' ) ).toHaveText( [
		`Bart EN Event ${ suffix }`,
	] );

	// Cleanup.
	await apiFetch( page, {
		path: `/wp/v2/pages/${ calendarPage.id }?force=true`,
		method: 'DELETE',
	} ).catch( () => {} );
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ eventEs.id }`,
		method: 'DELETE',
	} ).catch( () => {} );
	await apiFetch( page, {
		path: `/fair-events/v1/event-dates/${ eventEn.id }`,
		method: 'DELETE',
	} ).catch( () => {} );
	await apiFetch( page, {
		path: `/wp/v2/categories/${ catEs.id }?force=true`,
		method: 'DELETE',
	} ).catch( () => {} );
	await apiFetch( page, {
		path: `/wp/v2/categories/${ catEn.id }?force=true`,
		method: 'DELETE',
	} ).catch( () => {} );
	await apiFetch( page, {
		path: '/fair-e2e/v1/term-languages',
		method: 'POST',
		data: { languages: {} },
	} ).catch( () => {} );
} );
