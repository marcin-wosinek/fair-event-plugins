/**
 * E2E: scheduled Instagram event-list posts (#2076).
 *
 * An administrator adds an Instagram notification on Fair Events → Event
 * notifications, chooses an event feed and a heading page, previews the
 * image and caption (nothing is published), turns it on after reading that
 * this authorizes automatic public posts, and saves. The week's scheduled
 * run publishes once, and the notification's history shows the accepted
 * post with its link. Running the send again publishes nothing more.
 *
 * Nothing reaches Meta: the Unified Login connection uses the
 * `e2e-ig-unified-ok` token, which fair-e2e-protected-credentials.php
 * answers. The spec restores the Instagram feature it found, and skips when
 * the site has an Instagram connection of its own.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin, runScript } from '../support/wp-cli.js';

const SETTINGS_URL = '/wp-admin/admin.php?page=fair-events-event-notifications';
const NAME = 'Weekly Instagram post';

function fixture( args ) {
	return runScript(
		'instagram-notification-fixture.php',
		'E2E_INSTAGRAM',
		args
	);
}

function graphRequests() {
	const out = wpCli(
		'option get fair_e2e_credential_requests --format=json',
		{ allowFailure: true }
	).trim();
	return out
		? JSON.parse( out ).filter(
				( entry ) => 'instagram_graph' === entry.service
			).length
		: 0;
}

test.describe( 'Scheduled Instagram posts', () => {
	let initial;
	let source;
	let eventId;
	let pageId;
	let pageTitle;
	let configurationId;

	test.beforeAll( () => {
		initial = fixture( 'state' );
		if ( initial.connected ) {
			return;
		}
		fixture( 'feature on' );
		fixture( 'connect' );
		source = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			'source'
		);
		eventId = runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			`event ${ source.termId }`
		).eventId;
		pageTitle = `Agenda ${ Date.now() }`;
		pageId = wpCli(
			`post create --post_type=page --post_status=publish --post_title="${ pageTitle }" --post_content="Agenda" --porcelain`
		).match( /(\d+)\s*$/ )[ 1 ];
	} );

	test.afterAll( () => {
		if ( initial.connected ) {
			return;
		}
		if ( configurationId ) {
			fixture( `cleanup ${ configurationId }` );
			wpCli(
				`eval 'wp_set_current_user( 1 ); rest_do_request( new WP_REST_Request( "DELETE", "/fair-events/v1/event-notifications/configurations/${ configurationId }" ) );'`,
				{ allowFailure: true }
			);
		}
		fixture( 'disconnect' );
		fixture( `feature ${ initial.feature ? 'on' : 'off' }` );
		if ( source ) {
			runScript(
				'weekly-summary-fixture.php',
				'E2E_WEEKLY',
				`cleanup ${ source.termId } ${ source.sourceId } ${ eventId }`
			);
		}
		if ( pageId ) {
			wpCli( `post delete ${ pageId } --force`, { allowFailure: true } );
		}
	} );

	test( 'an administrator previews, turns on and inspects a published post', async ( {
		page,
	} ) => {
		test.skip(
			initial.connected,
			'The site has an Instagram connection of its own.'
		);
		test.setTimeout( 180000 );
		await loginAsAdmin( page );

		// Add it from the list; it starts paused.
		await page.goto( SETTINGS_URL );
		const add = page.locator( '.fair-events-notifications__add' );
		await add.getByLabel( 'Kind' ).selectOption( 'instagram' );
		await add.getByLabel( 'Name' ).fill( NAME );
		await add.getByRole( 'button', { name: 'Add notification' } ).click();
		await expect( page ).toHaveURL( /configuration=[a-z0-9-]{36}/ );
		configurationId = new URL( page.url() ).searchParams.get(
			'configuration'
		);

		const editor = page.locator( '.fair-events-notifications__channel' );
		await expect(
			editor.getByText( 'Posts are published to @e2e_unified_club.' )
		).toBeVisible();
		await expect(
			editor.getByRole( 'button', { name: /test/i } )
		).toHaveCount( 0 );

		await editor
			.getByLabel( 'Events to include' )
			.selectOption( source.sourceSlug );
		await editor
			.getByLabel( 'Page linked in the caption' )
			.selectOption( pageId );
		await editor.getByLabel( 'Send at' ).fill( '09:30' );
		await editor
			.getByRole( 'button', { name: 'Save Instagram settings' } )
			.click();
		await expect(
			editor.getByText( 'Instagram settings saved.' ).first()
		).toBeVisible();

		// The preview draws the image and caption and publishes nothing.
		const before = graphRequests();
		await editor
			.getByRole( 'button', { name: 'Preview next Instagram post' } )
			.click();
		await expect(
			editor.getByRole( 'img', {
				name: /Instagram image listing the events of/,
			} )
		).toBeVisible();
		await expect(
			editor.getByRole( 'group', { name: 'Instagram caption' } )
		).toContainText( pageTitle );
		await expect( editor.getByText( /was not published/ ) ).toBeVisible();
		expect( graphRequests() ).toBe( before );

		// Turning it on says what it authorizes.
		const toggle = editor.getByRole( 'checkbox', {
			name: 'Publish the weekly post to Instagram automatically',
		} );
		await expect(
			editor.getByText(
				/lets this site publish a public post to @e2e_unified_club every week/
			)
		).toBeVisible();
		await toggle.check();
		await editor
			.getByRole( 'button', { name: 'Save Instagram settings' } )
			.click();
		await expect(
			editor.getByText( 'Instagram settings saved.' ).first()
		).toBeVisible();
		await expect( page.getByText( /^Next send: / ) ).toBeVisible();

		// The week's scheduled send publishes once.
		const published = fixture( `publish ${ configurationId }` );
		expect( published.run.status ).toBe( 'sent' );
		expect( published.images ).toBe( initial.images );
		const again = fixture( `publish ${ configurationId }` );
		expect( again.run ).toBeNull();

		// The editor links the post; the history shows it accepted.
		await page.reload();
		await expect(
			editor.getByRole( 'link', { name: /View the post/ } )
		).toHaveAttribute( 'href', 'https://www.instagram.com/p/e2e1319/' );

		await page
			.getByRole( 'navigation', { name: 'Notification sections' } )
			.getByRole( 'link', { name: 'History' } )
			.click();
		const rows = page
			.locator( '.fair-events-notifications' )
			.getByRole( 'table' )
			.locator( 'tbody' )
			.getByRole( 'row' );
		await expect( rows ).toHaveCount( 1 );
		await expect( rows.first() ).toContainText( 'Accepted' );
	} );
} );
