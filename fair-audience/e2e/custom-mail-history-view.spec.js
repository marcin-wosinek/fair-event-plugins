/**
 * E2E: a Mail History subject opens a read-only view of that recorded email
 * (#2164). Following the link with the keyboard shows the saved subject and
 * body; returning keeps the composer's draft and focus; Back and Forward,
 * direct links and missing records work; and nothing is sent on the way.
 */

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const PAGE = '/wp-admin/admin.php?page=fair-audience-custom-mail';

/**
 * Run PHP on the tests site and return its output.
 *
 * @param {string} php Code for `wp eval`.
 * @return {Promise<string>} Standard output.
 */
async function wpEval( php ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', 'eval', php ],
		{ cwd: new URL( '../../', import.meta.url ), encoding: 'utf8' }
	);
	return stdout;
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

/** Number of emails the test mail capture holds. */
async function capturedMailCount( page ) {
	return page.evaluate( async () => {
		// eslint-disable-next-line no-undef
		const mail = await wp.apiFetch( {
			path: '/fair-e2e/v1/fee-reminders/mail',
		} );
		return mail.length;
	} );
}

test.describe( 'Fair Audience — view a sent custom mail', () => {
	test.setTimeout( 90_000 );

	const stamp = Date.now();
	const subject = `Recorded mail ${ stamp }`;
	let messageId;

	test.beforeAll( async () => {
		const out = await wpEval(
			`$m = new FairAudience\\Models\\CustomMailMessage();
			$m->subject = ${ JSON.stringify( subject ) };
			$m->content = '<p>Hi {name}, the <strong>studio</strong> opens at ten.</p>';
			$m->is_marketing = false;
			$m->sent_count = 4; $m->failed_count = 1; $m->skipped_count = 2;
			$m->save();
			echo 'E2E_MAIL_ID:' . $m->id;`
		);
		messageId = Number( out.match( /E2E_MAIL_ID:(\d+)/ )[ 1 ] );
	} );

	test.afterAll( async () => {
		if ( messageId ) {
			await wpEval(
				`( new FairAudience\\Database\\CustomMailMessageRepository() )->delete( ${ messageId } );`
			);
		}
	} );

	test( 'opens a recorded email and returns to an unchanged draft', async ( {
		page,
	} ) => {
		await login( page );
		await page.goto( PAGE );
		const draftSubject = page.getByRole( 'textbox', { name: 'Subject' } );
		await expect( draftSubject ).toBeVisible();
		await draftSubject.fill( `Draft ${ stamp }` );
		const sentBefore = await capturedMailCount( page );

		// Keyboard: focus the subject link and follow it.
		const link = page.getByRole( 'link', { name: subject } );
		await expect( link ).toHaveAttribute(
			'href',
			new RegExp( `message_id=${ messageId }$` )
		);
		await link.focus();
		await page.keyboard.press( 'Enter' );

		await expect( page ).toHaveURL(
			new RegExp( `message_id=${ messageId }$` )
		);
		const heading = page.getByRole( 'heading', {
			level: 1,
			name: subject,
		} );
		await expect( heading ).toBeFocused();
		await expect(
			page.locator( '.fair-audience-custom-mail__content strong' )
		).toHaveText( 'studio' );
		await expect(
			page.locator( '.fair-audience-custom-mail__content' )
		).toContainText( 'Hi {name},' );
		await expect( draftSubject ).toBeHidden();

		await page
			.getByRole( 'link', { name: /Back to Mail History/ } )
			.click();
		await expect( page ).toHaveURL( /page=fair-audience-custom-mail$/ );
		await expect( draftSubject ).toHaveValue( `Draft ${ stamp }` );
		await expect( link ).toBeFocused();

		// Forward and Back follow the address.
		await page.goForward();
		await expect( heading ).toBeVisible();
		await page.goBack();
		await expect( draftSubject ).toHaveValue( `Draft ${ stamp }` );

		expect( await capturedMailCount( page ) ).toBe( sentBefore );
	} );

	test( 'a direct link loads only the email; a missing one offers a way back', async ( {
		page,
	} ) => {
		await login( page );

		const previews = [];
		page.on( 'request', ( request ) => {
			if (
				decodeURIComponent( request.url() ).includes(
					'/fair-audience/v1/custom-mail/preview'
				)
			) {
				previews.push( request.url() );
			}
		} );

		await page.goto( `${ PAGE }&message_id=${ messageId }` );
		await expect(
			page.getByRole( 'heading', { level: 1, name: subject } )
		).toBeVisible();
		await expect(
			page.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveCount( 0 );
		expect( previews ).toEqual( [] );

		await page.goto( `${ PAGE }&message_id=999999999` );
		await expect(
			page.getByRole( 'heading', { level: 1, name: 'Email not found' } )
		).toBeVisible();
		await page
			.getByRole( 'link', { name: /Back to Mail History/ } )
			.click();
		await expect(
			page.getByRole( 'textbox', { name: 'Subject' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'link', { name: subject } )
		).toBeVisible();
	} );
} );
