/**
 * E2E: the Event length options are translated on Manage Event and in the
 * post editor's event details box (#1831), whichever way the translations
 * reach the site — a WordPress.org language pack in
 * wp-content/languages/plugins/ or the opt-in bundled catalog — and stay in
 * English on an English site.
 *
 * The `translation-delivery.php` fixture sets the site locale and copies the
 * plugin's own es_ES catalog to the language-pack location, so the spec
 * needs a current `npm run makemo` and `npm run build`.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../../e2e/support/wp-cli.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

// The seeded event runs 18:00–22:00, so "4 hours" is selected.
const TIMED_OPTIONS = {
	en: {
		label: /^Event length$/i,
		options: [
			'Other',
			'30 minutes',
			'1 hour',
			'1 hour 30 minutes',
			'2 hours',
			'2 hours 30 minutes',
			'3 hours',
			'4 hours',
			'6 hours',
			'8 hours',
		],
	},
	es: {
		label: 'Duración del evento',
		options: [
			'Otra',
			'30 minutos',
			'1 hora',
			'1 hora 30 minutos',
			'2 horas',
			'2 horas 30 minutos',
			'3 horas',
			'4 horas',
			'6 horas',
			'8 horas',
		],
	},
};

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: { message: error?.message, code: error?.code },
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

async function expectDurationOptions( page, { label, options } ) {
	const select = page.getByRole( 'combobox', { name: label } );
	await expect( select ).toBeVisible( { timeout: 20_000 } );
	await expect( select.locator( 'option' ) ).toHaveText( options );
	await expect( select ).toHaveValue( '240' );
}

test.describe( 'Event length options — translations', () => {
	test.setTimeout( 120_000 );

	let adminContext;
	let adminPage;
	let eventDateId;
	let postId;
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
				title: `Duration translations e2e ${ stamp }`,
				start_datetime: '2036-05-10 18:00:00',
				end_datetime: '2036-05-10 22:00:00',
				all_day: false,
			},
		} );
		eventDateId = eventDate.id;

		const post = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/create-post`,
			method: 'POST',
			data: { post_status: 'draft' },
		} );
		postId = post.event_id || post.post_id;
	} );

	test.afterAll( async () => {
		runScript( 'translation-delivery.php', 'E2E_TRANSLATIONS', 'reset' );
		if ( postId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ postId }`,
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

	const manageEvent = ( page ) =>
		page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }`
		);

	const postEditor = ( page ) =>
		page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );

	for ( const mode of [ 'language-pack', 'bundled' ] ) {
		test( `Spanish options from the ${ mode } catalog`, async () => {
			runScript(
				'translation-delivery.php',
				'E2E_TRANSLATIONS',
				`${ mode } es_ES`
			);

			await manageEvent( adminPage );
			await expectDurationOptions( adminPage, TIMED_OPTIONS.es );

			await postEditor( adminPage );
			await expectDurationOptions( adminPage, TIMED_OPTIONS.es );
		} );
	}

	test( 'English options on an English site', async () => {
		runScript( 'translation-delivery.php', 'E2E_TRANSLATIONS', 'reset' );

		await manageEvent( adminPage );
		await expectDurationOptions( adminPage, TIMED_OPTIONS.en );

		await postEditor( adminPage );
		await expectDurationOptions( adminPage, TIMED_OPTIONS.en );
	} );
} );
