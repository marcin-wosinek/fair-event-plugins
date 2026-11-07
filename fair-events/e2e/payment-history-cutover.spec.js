import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * E2E: switching payment records to Fair Events on the Payment history
 * page (#2140, stage 4 of #2111; PAYMENT_HISTORY_MIGRATION.md §8.13). On a
 * phone-sized screen, an administrator opens the confirmation, which names
 * the tables to back up and withholds the switch until the backup is
 * confirmed, switches, and sees who switched and when; the switch control
 * is gone.
 *
 * The payment-cutover.php fixture, shared with
 * PaymentHistoryCutover.api.spec.js, records a verified migration with
 * nothing outstanding and restores the site's state afterwards.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';
const PAGE = '/wp-admin/admin.php?page=fair-events-payment-history';

async function cutover( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-cutover.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_PAYMENT_CUTOVER:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_CUTOVER output, got:\n${ stdout }`
		);
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

// The visible notice only: its text is mirrored in a screen-reader region.
const notice = ( scope, text ) =>
	scope.locator( '.components-notice' ).filter( { hasText: text } );

test.describe.serial( 'Payment history cutover', () => {
	test.setTimeout( 180_000 );

	test.beforeAll( async () => {
		expect( ( await cutover( 'prepare' ) ).blockers ).toEqual( [] );
	} );

	test.afterAll( async () => {
		await cutover( 'restore' );
	} );

	test( 'an administrator switches payment records after confirming a backup', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 375, height: 812 } );
		await login( page );
		await page.goto( PAGE );

		const card = page.locator( '.components-card' ).filter( {
			has: page.getByRole( 'heading', {
				name: 'Payment records',
				exact: true,
			} ),
		} );
		await expect( card ).toBeVisible();
		await expect(
			card.getByText( /Fair Audience’s records still decide/ )
		).toBeVisible();

		const open = card.getByRole( 'button', {
			name: 'Switch payment records to Fair Events',
		} );
		await open.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Switch payment records to Fair Events',
		} );
		await expect( dialog ).toBeVisible();
		await expect(
			dialog.getByText( 'fair_audience_event_participant_transactions' )
		).toBeVisible();
		await expect( dialog.getByText( /It can’t be undone/ ) ).toBeVisible();
		const confirm = dialog.getByRole( 'button', {
			name: 'Switch payment records',
			exact: true,
		} );
		await expect( confirm ).toBeDisabled();

		await dialog
			.getByLabel(
				'I took a fresh database backup that includes these tables.'
			)
			.check();
		await confirm.click();

		await expect( dialog ).toBeHidden();
		await expect(
			notice( card, /Payment records use Fair Events since/ )
		).toBeVisible();
		await expect(
			notice( card, new RegExp( `Switched by ${ WP_ADMIN_USER }` ) )
		).toBeVisible();
		await expect( open ).toHaveCount( 0 );
		await expect( card.getByText( /can’t be undone/ ) ).toBeVisible();

		// No horizontal scroll at phone width.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect( overflow ).toBeLessThanOrEqual( 0 );

		const facts = await cutover( 'facts' );
		expect( facts.cutover ).toBe( true );
		expect( ( await cutover( 'audit' ) ).records ).toHaveLength( 1 );
	} );
} );
