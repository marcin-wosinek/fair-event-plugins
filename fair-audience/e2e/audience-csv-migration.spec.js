/**
 * E2E: exporting the audience as CSV from the All Participants page and
 * importing it again (#2218). The export popup downloads mailing
 * subscribers only, leaving out a pending member. The downloaded file is edited the way a move
 * to another site would look (a member this site does not have yet), then
 * imported through the popup; a second import of the same file adds nobody.
 *
 * Members are created and removed with
 * e2e/mu-plugins/scripts/audience-migration-fixture.php.
 */

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function migration( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/audience-migration-fixture.php',
			...args,
		],
		{ cwd: new URL( '../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_AUDIENCE_MIGRATION:(\{.*\}|null)/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_AUDIENCE_MIGRATION in output:\n${ stdout }`
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

test.describe( 'Fair Audience — audience CSV export and import', () => {
	test.setTimeout( 120_000 );

	const stamp = Date.now();
	const source = `csv-source-${ stamp }@example.test`;
	const moved = `csv-moved-${ stamp }@example.test`;
	const pending = `csv-pending-${ stamp }@example.test`;
	const surname = `Mígración${ stamp }`;

	test.beforeAll( async () => {
		await migration(
			'member',
			source,
			'Zoë',
			surname,
			'marketing',
			'1',
			'confirmed'
		);
		await migration(
			'member',
			pending,
			'Pia',
			surname,
			'marketing',
			'0',
			'pending'
		);
	} );

	test.afterAll( async () => {
		await migration( 'cleanup', [ source, moved, pending ].join( ',' ) );
	} );

	test( 'exports the audience and imports it, once', async ( {
		page,
	}, testInfo ) => {
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-audience' );

		const menu = page.getByRole( 'button', {
			name: 'Export or import the audience',
		} );

		// Export: the menu opens a popup, which downloads only on request.
		await menu.click();
		await page
			.getByRole( 'menuitem', { name: /Export audience CSV/ } )
			.click();
		const exportDialog = page.getByRole( 'dialog', {
			name: 'Export audience CSV',
		} );
		await expect(
			exportDialog.getByRole( 'radio', { name: 'All participants' } )
		).toBeChecked();
		await exportDialog
			.getByRole( 'radio', { name: 'Mailing subscribers only' } )
			.check();
		const [ download ] = await Promise.all( [
			page.waitForEvent( 'download' ),
			exportDialog
				.getByRole( 'button', { name: 'Download CSV' } )
				.click(),
		] );
		await expect( exportDialog ).toBeHidden();
		expect( download.suggestedFilename() ).toMatch(
			/^fair-audience-subscribers-\d{4}-\d{2}-\d{2}\.csv$/
		);
		const exported = await readFile( await download.path(), 'utf8' );
		const line = exported
			.split( '\r\n' )
			.find( ( row ) => row.includes( source ) );
		expect( line ).toBe( `1,Zoë,${ surname },${ source },,,marketing,1` );
		expect( exported ).not.toContain( pending );
		await expect(
			page
				.getByTestId( 'snackbar' )
				.filter( { hasText: /^Exported \d+ mailing subscribers?\./ } )
		).toBeVisible();

		// A file with one member this site does not have.
		const file = testInfo.outputPath( 'audience.csv' );
		const header = exported.split( '\r\n' )[ 0 ];
		await import( 'node:fs/promises' ).then( ( fs ) =>
			fs.writeFile(
				file,
				`${ header }\r\n${ line }\r\n${ line.replace(
					source,
					moved
				) }\r\n`
			)
		);

		const importFile = async () => {
			await menu.click();
			await page
				.getByRole( 'menuitem', { name: /Import audience CSV/ } )
				.click();
			const dialog = page.getByRole( 'dialog', {
				name: 'Import audience CSV',
			} );
			await expect(
				dialog.getByText( /Feed subscriptions are not transferred/ )
			).toBeVisible();
			const submit = dialog.getByRole( 'button', {
				name: 'Import members',
			} );
			await expect( submit ).toHaveAttribute( 'aria-disabled', 'true' );
			await dialog.getByLabel( 'CSV file' ).setInputFiles( file );
			await submit.click();
			return dialog;
		};

		// First import adds the new member; the existing one is skipped.
		let dialog = await importFile();
		await expect(
			dialog.getByText( 'The file had 2 rows. Added 1 new member.' )
		).toBeVisible();
		await expect(
			dialog.getByText( 'Already present, skipped: 1' )
		).toBeVisible();
		await expect(
			dialog.locator( '.components-notice__content' ).filter( {
				hasText: /Feed subscriptions were not transferred/,
			} )
		).toBeVisible();
		await dialog.getByText( 'Close', { exact: true } ).click();
		await expect( dialog ).toBeHidden();

		// The list reloaded with the new, pending member.
		await page.getByRole( 'searchbox' ).fill( moved );
		await expect( page.getByText( moved ) ).toBeVisible();

		// Importing the same file again adds nobody.
		dialog = await importFile();
		await expect(
			dialog.getByText( 'The file had 2 rows. Added 0 new members.' )
		).toBeVisible();
		await expect(
			dialog.getByText( 'Already present, skipped: 2' )
		).toBeVisible();

		// Keyboard: Escape closes the finished popup.
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
	} );
} );
