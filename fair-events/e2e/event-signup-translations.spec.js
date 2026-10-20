/**
 * E2E: the Event Signup form's public script receives its translations on
 * the event page (#1827), whichever way they reach the site — a
 * WordPress.org language pack in wp-content/languages/plugins/ or the
 * opt-in bundled catalog — and stays in English on an English site.
 *
 * The script's messages only appear after a visitor acts, so the spec reads
 * them through `wp.i18n` on the page an anonymous visitor sees: the locale
 * data WordPress prints for the view script is what the form renders from.
 *
 * The `translation-delivery.php` fixture sets the site locale and copies the
 * plugin's own es_ES catalog to the language-pack location, so the spec
 * needs a current `npm run makemo` and `npm run build`.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../../e2e/support/wp-cli.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const MESSAGES = {
	en: {
		required: 'Please fill in all required fields.',
		registered:
			'You have successfully registered! A confirmation email is on its way.',
	},
	es: {
		required: 'Rellena todos los campos obligatorios.',
		registered:
			'¡Te has registrado correctamente! Un correo de confirmación está en camino.',
	},
};

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
	const result = await page.evaluate( async ( request ) => {
		try {
			return { data: await wp.apiFetch( request ) }; // eslint-disable-line no-undef
		} catch ( error ) {
			return { error: { code: error.code, message: error.message } };
		}
	}, options );
	if ( result.error ) {
		throw new Error( JSON.stringify( result.error ) );
	}
	return result.data;
}

test.describe( 'Event Signup public messages — translations', () => {
	test.setTimeout( 120_000 );

	let adminContext;
	let adminPage;
	let eventDateId;
	let signupPageId;
	const stamp = Date.now();

	test.beforeAll( async ( { browser } ) => {
		runScript( 'translation-delivery.php', 'E2E_TRANSLATIONS', 'reset' );

		adminContext = await browser.newContext( { locale: 'en-US' } );
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Signup translations e2e ${ stamp }`,
				start_date: '2039-02-01',
				start_time: '10:00:00',
				end_date: '2039-02-01',
				end_time: '12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{ name: 'Standard', recurrence_scope: 'single_instance' },
				],
				sale_periods: [
					{
						name: 'Always',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 10 },
				],
				options: [],
				settings: {},
			},
		} );

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Signup translations page ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;
	} );

	test.afterAll( async () => {
		runScript( 'translation-delivery.php', 'E2E_TRANSLATIONS', 'reset' );
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }`,
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

	async function expectPublicMessages( browser, messages ) {
		const context = await browser.newContext( {
			baseURL: test.info().project.use.baseURL,
		} );
		try {
			const visitor = await context.newPage();
			await visitor.goto( `/?page_id=${ signupPageId }` );
			await expect(
				visitor.locator( '.fair-events-get-tickets-form' )
			).toBeVisible();
			await visitor.waitForFunction( () => window.wp?.i18n );

			const translated = await visitor.evaluate(
				( keys ) =>
					Object.fromEntries(
						Object.entries( keys ).map( ( [ key, text ] ) => [
							key,
							// Looks up the page's locale data; nothing to extract.
							// eslint-disable-next-line @wordpress/i18n-no-variables
							window.wp.i18n.__( text, 'fair-events' ),
						] )
					),
				MESSAGES.en
			);
			expect( translated ).toEqual( messages );
		} finally {
			await context.close();
		}
	}

	for ( const mode of [ 'language-pack', 'bundled' ] ) {
		test( `Spanish messages from the ${ mode } catalog`, async ( {
			browser,
		} ) => {
			runScript(
				'translation-delivery.php',
				'E2E_TRANSLATIONS',
				`${ mode } es_ES`
			);

			await expectPublicMessages( browser, MESSAGES.es );
		} );
	}

	test( 'English messages on an English site', async ( { browser } ) => {
		runScript( 'translation-delivery.php', 'E2E_TRANSLATIONS', 'reset' );

		await expectPublicMessages( browser, MESSAGES.en );
	} );
} );
