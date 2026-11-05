/**
 * E2E: editing a participant's weekly summary and event feeds from the
 * participant page (#2135). The popup shows what is saved, Cancel changes
 * nothing, and a saved choice shows in the page summary, after reopening
 * the popup and after reloading the page.
 *
 * Feeds are seeded with e2e/mu-plugins/scripts/weekly-feeds-fixture.php:
 * A and B are offered, C exists without a weekly email.
 */

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function fixture( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/weekly-feeds-fixture.php',
			...args,
		],
		{ cwd: new URL( '../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_WEEKLY_FEEDS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Expected E2E_WEEKLY_FEEDS in output:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
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

test.describe( 'Fair Audience — edit weekly preferences in the participant popup', () => {
	test.setTimeout( 120_000 );

	const suffix = `${ Date.now() }`;
	const email = `weekly-popup+${ suffix }@example.test`;
	let feeds;
	let configurations;
	let participantId;

	test.beforeAll( async ( { browser } ) => {
		( { feeds, configurations } = await fixture( 'seed', suffix ) );
		const page = await browser.newPage();
		await login( page );
		participantId = await page.evaluate(
			async ( address ) =>
				// eslint-disable-next-line no-undef
				(
					await wp.apiFetch( {
						path: '/fair-audience/v1/participants',
						method: 'POST',
						data: {
							name: 'Weekly',
							surname: `Popup${ address.length }`,
							email: address,
							email_profile: 'marketing',
						},
					} )
				).id,
			email
		);
		await page.close();
		await fixture(
			'choose',
			email,
			'selected',
			`${ feeds.a },${ feeds.c }`
		);
	} );

	test.afterAll( async () => {
		if ( feeds ) {
			await fixture(
				'cleanup',
				Object.values( feeds ).join( ',' ),
				Object.values( configurations ).join( ',' ),
				email
			);
		}
	} );

	test( 'edits, cancels, saves and shows the saved weekly preferences', async ( {
		page,
	} ) => {
		await login( page );
		const detailUrl = `/wp-admin/admin.php?page=fair-audience-participant-detail&participant_id=${ participantId }`;
		await page.goto( detailUrl );

		const feedsRow = page.locator( 'tr', {
			has: page.locator( 'th', { hasText: 'Event feeds' } ),
		} );
		const weeklyRow = page.locator( 'tr', {
			has: page.locator( 'th', { hasText: 'Weekly summary' } ),
		} );
		const nameA = `Feed A ${ suffix }`;
		const nameB = `Feed B ${ suffix }`;
		const nameC = `Feed C ${ suffix }`;
		await expect( feedsRow ).toContainText( nameA );

		const open = async () => {
			await page
				.getByRole( 'button', { name: 'Edit participant' } )
				.click();
			const dialog = page.getByRole( 'dialog' );
			await expect( dialog.getByLabel( nameA ) ).toBeVisible();
			return dialog;
		};

		// The popup shows what is saved, including the unavailable feed.
		let dialog = await open();
		await expect(
			dialog.getByLabel( 'Send the weekly events summary' )
		).toBeChecked();
		await expect(
			dialog.getByLabel( 'Selected event feeds' )
		).toBeChecked();
		await expect( dialog.getByLabel( nameA ) ).toBeChecked();
		await expect( dialog.getByLabel( nameB ) ).not.toBeChecked();
		await expect(
			dialog.getByText( `${ nameC } (not available right now)` )
		).toBeVisible();

		// Cancel changes nothing.
		await dialog.getByLabel( 'No event feeds' ).check();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		expect( ( await fixture( 'state', email ) ).participant ).toMatchObject(
			{
				weekly_feed_mode: 'selected',
				feed_ids: [ feeds.a, feeds.c ].sort( ( x, y ) => x - y ),
			}
		);

		// Keyboard: choose feed B with the keyboard, then opt out and save.
		dialog = await open();
		await dialog.getByLabel( nameB ).focus();
		await page.keyboard.press( 'Space' );
		await expect( dialog.getByLabel( nameB ) ).toBeChecked();
		await dialog.getByLabel( 'Send the weekly events summary' ).uncheck();
		await dialog.getByRole( 'button', { name: 'Update' } ).click();
		await expect( dialog ).toBeHidden();

		// The page summary refreshes.
		await expect( weeklyRow ).toContainText( 'Opted out' );
		await expect( feedsRow ).toContainText( nameB );
		await expect( feedsRow ).toContainText( nameA );
		await expect( feedsRow ).toContainText(
			`${ nameC } (not available right now)`
		);

		// Reopening shows the saved values.
		dialog = await open();
		await expect(
			dialog.getByLabel( 'Send the weekly events summary' )
		).not.toBeChecked();
		await expect( dialog.getByLabel( nameB ) ).toBeChecked();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();

		// So does a reload.
		await page.reload();
		await expect( weeklyRow ).toContainText( 'Opted out' );
		await expect( feedsRow ).toContainText( nameB );
		dialog = await open();
		await expect( dialog.getByLabel( nameB ) ).toBeChecked();
		await expect(
			dialog.getByLabel( 'Send the weekly events summary' )
		).not.toBeChecked();

		const state = ( await fixture( 'state', email ) ).participant;
		expect( state ).toMatchObject( {
			status: 'confirmed',
			email_profile: 'marketing',
			weekly_summary_opt_out: true,
			weekly_feed_mode: 'selected',
			feed_ids: [ feeds.a, feeds.b, feeds.c ].sort( ( x, y ) => x - y ),
		} );
	} );
} );
