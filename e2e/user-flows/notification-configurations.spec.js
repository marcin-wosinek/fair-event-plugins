/**
 * E2E: several notifications of the same kind (#1919), in the list of
 * notifications with each one's editor and history (#1921).
 *
 * An administrator adds two individual emails on Fair Events → Event
 * notifications, sends both to the same address, saves each on its own and
 * pauses one. Each keeps its own name, settings and queued send; both
 * scheduled sends reach the address in the same week, and running each again
 * sends nothing more; pausing one leaves the other scheduled. An unsaved
 * draft survives opening the list and another notification. Each
 * notification's history shows only its own sends, the history of all of
 * them shows both and filters by notification, and the browser's Back and
 * Forward buttons move between the views.
 *
 * The list can be narrowed to one event feed (#2084): the feed is kept in
 * the URL through a search, a reload and the browser's Back and Forward
 * buttons, can be cleared, and a feed that does not exist lists nothing.
 *
 * Each row keeps Edit visible and moves History, Duplicate and Delete into
 * its menu (#2207); the menu works with the keyboard, and stacked rows on a
 * phone do not scroll the page sideways.
 *
 * A notification can be duplicated from the list with the keyboard (#2130):
 * the copy opens paused with the saved settings, sends nothing, and is saved
 * apart from its original.
 *
 * A notification can be deleted from the list with the keyboard (#2204):
 * the confirmation names it and can be cancelled; deleting removes only its
 * row, also after a reload, its queued sends never run, and its past sends
 * stay in All notification history.
 *
 * Individual email needs no other plugin or event feed, so the spec does not
 * depend on Fair Audience or Telegram. No mail leaves the host:
 * fair-e2e-support.php captures wp_mail().
 */

import { test, expect } from '@playwright/test';
import {
	wpCli,
	loginAsAdmin,
	resetCapturedMail,
	runScript,
} from '../support/wp-cli.js';

const SETTINGS_URL = '/wp-admin/admin.php?page=fair-events-event-notifications';
const RECIPIENT = 'shared-1919@example.test';

function fixture( args ) {
	return runScript(
		'notification-configurations-fixture.php',
		'E2E_NOTIFICATION_CONFIGURATIONS',
		args
	);
}

function capturedMail() {
	const out = wpCli( 'option get fair_e2e_captured_mail --format=json', {
		allowFailure: true,
	} ).trim();
	return out ? JSON.parse( out ) : [];
}

function view( page ) {
	return page.locator( '.fair-events-notifications' );
}

function listRow( page, name ) {
	return page
		.getByRole( 'row' )
		.filter( { has: page.getByRole( 'link', { name, exact: true } ) } );
}

function moreActions( page, name ) {
	return listRow( page, name ).getByRole( 'button', {
		name: `More actions for “${ name }”`,
	} );
}

// Opens a row's menu and focuses an item with the keyboard only.
async function focusMenuItem( page, name, item ) {
	await moreActions( page, name ).focus();
	await page.keyboard.press( 'Enter' );
	const menu = page.getByRole( 'menu', {
		name: `More actions for “${ name }”`,
	} );
	await expect( menu ).toBeVisible();
	const target = menu.getByRole( 'menuitem', { name: item, exact: true } );
	for ( let step = 0; step < 4; step++ ) {
		if (
			await target.evaluate( ( el ) => el === document.activeElement )
		) {
			return target;
		}
		await page.keyboard.press( 'ArrowDown' );
	}
	await expect( target ).toBeFocused();
	return target;
}

// Through the list, as an administrator would: the name opens the editor,
// History is in the row's menu.
async function open( page, name, link = name ) {
	const back = page.getByRole( 'link', { name: '← All notifications' } );
	if ( await back.count() ) {
		await back.click();
	}
	if ( 'History' === link ) {
		await moreActions( page, name ).click();
		await page
			.getByRole( 'menu', { name: `More actions for “${ name }”` } )
			.getByRole( 'menuitem', { name: 'History', exact: true } )
			.click();
	} else {
		await listRow( page, name )
			.getByRole( 'link', { name: link, exact: true } )
			.click();
	}
	await expect(
		page.getByRole( 'navigation', { name: 'Notification sections' } )
	).toBeVisible();
	return view( page );
}

async function addIndividualEmail( page, name ) {
	await page.goto( SETTINGS_URL );
	const add = page
		.locator( '.fair-events-notifications__add' )
		.filter( {
			has: page.getByRole( 'heading', { name: 'Add a notification' } ),
		} );
	await add.getByLabel( 'Kind' ).selectOption( 'individual_email' );
	await add.getByLabel( 'Name' ).fill( name );
	await add.getByRole( 'button', { name: 'Add notification' } ).click();
	// Adding opens the new notification's editor.
	await expect(
		page.getByText( `“${ name }” was added.`, { exact: false } ).first()
	).toBeVisible();
	await expect( page ).toHaveURL( /configuration=[a-z0-9-]{36}/ );
	return new URL( page.url() ).searchParams.get( 'configuration' );
}

async function turnOn( own, time ) {
	await own.getByLabel( 'Send to' ).fill( RECIPIENT );
	await own.getByLabel( 'Send at' ).fill( time );
	// The test site may have no events this week.
	await own
		.getByLabel( 'Skip the email when the week has no events' )
		.uncheck();
	await own.getByLabel( 'Email the weekly summary to this address' ).check();
	await own
		.getByRole( 'button', { name: 'Save individual email settings' } )
		.click();
	await expect(
		own.getByText( 'Individual email settings saved.' ).first()
	).toBeVisible();
}

function historyRows( page ) {
	return view( page )
		.getByRole( 'table' )
		.locator( 'tbody' )
		.getByRole( 'row' );
}

test.describe( 'Several notifications of the same kind', () => {
	const ids = [];

	test.beforeAll( () => {
		resetCapturedMail();
	} );

	test.afterAll( () => {
		if ( ids.length ) {
			fixture( `remove ${ ids.join( ' ' ) }` );
			runScript(
				'notification-history-fixture.php',
				'E2E_NOTIFICATION_HISTORY',
				`clear ${ ids.join( ' ' ) }`
			);
		}
		resetCapturedMail();
	} );

	test( 'two individual emails to one address run and pause independently', async ( {
		page,
	} ) => {
		test.setTimeout( 240000 );
		await loginAsAdmin( page );

		const teamId = await addIndividualEmail( page, 'Team inbox' );
		ids.push( teamId );
		const boardId = await addIndividualEmail( page, 'Board inbox' );
		ids.push( boardId );
		expect( teamId ).not.toBe( boardId );

		// Both start paused, each listed under its own name and kind.
		await page.goto( SETTINGS_URL );
		for ( const name of [ 'Team inbox', 'Board inbox' ] ) {
			await expect(
				listRow( page, name ).getByText( 'Paused', { exact: true } )
			).toBeVisible();
			await expect(
				listRow( page, name ).getByText( 'Individual email', {
					exact: true,
				} )
			).toBeVisible();
		}
		expect( fixture( `state ${ teamId }` ).queued ).toEqual( [] );

		// Saving one leaves the other's unsaved draft alone, also while the
		// list and the other editor are open.
		let own = await open( page, 'Board inbox' );
		await own.getByLabel( 'Send to' ).fill( RECIPIENT );
		own = await open( page, 'Team inbox' );
		await turnOn( own, '06:15' );
		await page.getByRole( 'link', { name: '← All notifications' } ).click();
		await expect(
			listRow( page, 'Board inbox' ).getByText( 'Unsaved changes' )
		).toBeVisible();
		await expect(
			listRow( page, 'Team inbox' ).getByText( 'On', { exact: true } )
		).toBeVisible();
		own = await open( page, 'Board inbox' );
		await expect( own.getByText( 'Unsaved changes' ) ).toBeVisible();
		await expect( own.getByLabel( 'Send to' ) ).toHaveValue( RECIPIENT );
		await turnOn( own, '19:45' );

		const teamQueued = fixture( `state ${ teamId }` ).queued;
		const boardQueued = fixture( `state ${ boardId }` ).queued;
		expect( teamQueued ).toHaveLength( 1 );
		expect( boardQueued ).toHaveLength( 1 );
		expect( teamQueued[ 0 ].timestamp ).not.toBe(
			boardQueued[ 0 ].timestamp
		);

		// Both scheduled sends of this week reach the same address, once each.
		for ( const id of [ teamId, boardId, teamId, boardId ] ) {
			fixture( `run ${ id }` );
		}
		const mail = capturedMail().filter( ( entry ) =>
			[].concat( entry.to ).includes( RECIPIENT )
		);
		expect( mail ).toHaveLength( 2 );
		expect( fixture( `state ${ teamId }` ).runs ).toHaveLength( 1 );
		expect( fixture( `state ${ boardId }` ).runs ).toHaveLength( 1 );

		// The list shows each one's latest send.
		await page.goto( SETTINGS_URL );
		for ( const name of [ 'Team inbox', 'Board inbox' ] ) {
			await expect(
				listRow( page, name ).getByRole( 'link', {
					name: /^Scheduled, /,
				} )
			).toBeVisible();
		}

		// Each history shows only its own send; its details stay in scope.
		own = await open( page, 'Team inbox', 'History' );
		await expect( historyRows( page ) ).toHaveCount( 1 );
		await expect(
			own.getByRole( 'combobox', { name: 'Notification' } )
		).toHaveCount( 0 );
		await historyRows( page ).getByRole( 'link' ).click();
		await expect( page ).toHaveURL(
			new RegExp( `configuration=${ teamId }.*execution=\\d+` )
		);
		await expect(
			own.getByRole( 'table' ).getByText( RECIPIENT )
		).toBeVisible();
		await expect(
			own.getByText( 'Accepted by the provider' )
		).toBeVisible();
		const teamExecution = new URL( page.url() ).searchParams.get(
			'execution'
		);

		// Another notification's entry is not shown in this one's history.
		await page.goto(
			`${ SETTINGS_URL }&configuration=${ boardId }&tab=history&execution=${ teamExecution }`
		);
		await expect(
			view( page )
				.getByText( /It may belong to another notification/ )
				.first()
		).toBeVisible();

		// The history of every notification includes both and filters by one.
		await page.goto( SETTINGS_URL );
		await page
			.getByRole( 'link', { name: 'All notification history' } )
			.click();
		await expect(
			page.getByRole( 'heading', { name: 'All notification history' } )
		).toBeVisible();
		await view( page )
			.getByRole( 'combobox', { name: 'Kind' } )
			.selectOption( 'individual_email' );
		await view( page )
			.getByRole( 'combobox', { name: 'Scheduled or test' } )
			.selectOption( 'scheduled' );
		for ( const name of [ 'Team inbox', 'Board inbox' ] ) {
			await expect(
				historyRows( page ).filter( { hasText: name } )
			).toHaveCount( 1 );
		}
		await view( page )
			.getByRole( 'combobox', { name: 'Notification' } )
			.selectOption( boardId );
		await expect( historyRows( page ) ).toHaveCount( 1 );
		await expect(
			historyRows( page ).filter( { hasText: 'Board inbox' } )
		).toHaveCount( 1 );
		await expect( page ).toHaveURL(
			new RegExp( `filter_configuration=${ boardId }` )
		);

		// Details open from it and return to the same filters.
		await historyRows( page ).getByRole( 'link' ).click();
		await expect(
			view( page ).getByText( 'Accepted by the provider' )
		).toBeVisible();
		await view( page )
			.getByRole( 'link', { name: '← Back to the history' } )
			.click();
		await expect( historyRows( page ) ).toHaveCount( 1 );
		await expect(
			view( page ).getByRole( 'combobox', { name: 'Notification' } )
		).toHaveValue( boardId );

		// Back and Forward move between the views.
		await page.goBack();
		await expect(
			view( page ).getByText( 'Accepted by the provider' )
		).toBeVisible();
		await page.goForward();
		await expect( historyRows( page ) ).toHaveCount( 1 );
		await page.reload();
		await expect(
			view( page ).getByRole( 'combobox', { name: 'Notification' } )
		).toHaveValue( boardId );

		// Pausing one removes only its queued send.
		const boardBefore = fixture( `state ${ boardId }` );
		await page.goto( `${ SETTINGS_URL }&configuration=${ teamId }` );
		own = view( page );
		await own
			.getByLabel( 'Email the weekly summary to this address' )
			.uncheck();
		await own
			.getByRole( 'button', { name: 'Save individual email settings' } )
			.click();
		await expect(
			own.getByText( 'Individual email settings saved.' ).first()
		).toBeVisible();
		expect( fixture( `state ${ teamId }` ).queued ).toEqual( [] );
		expect( fixture( `state ${ boardId }` ).queued ).toEqual(
			boardBefore.queued
		);
		expect( fixture( `state ${ boardId }` ).nextRun ).toEqual(
			boardBefore.nextRun
		);

		// Both are kept as saved.
		await page.goto( SETTINGS_URL );
		await expect(
			listRow( page, 'Team inbox' ).getByText( 'Paused', { exact: true } )
		).toBeVisible();
		await expect(
			listRow( page, 'Board inbox' ).getByText( 'On', { exact: true } )
		).toBeVisible();
		own = await open( page, 'Board inbox' );
		await expect(
			own.getByLabel( 'Email the weekly summary to this address' )
		).toBeChecked();
		await expect( own.getByLabel( 'Send at' ) ).toHaveValue( '19:45' );
	} );
} );

test.describe( 'Notification list by event feed', () => {
	const suffix = `e2e2084-${ Date.now() }`;
	let seeded = null;

	test.beforeAll( () => {
		seeded = fixture( `seed-feeds ${ suffix }` );
	} );

	test.afterAll( () => {
		if ( seeded ) {
			fixture( `remove ${ seeded.configurations.join( ' ' ) }` );
			fixture(
				`remove-feeds ${ Object.values( seeded.feeds )
					.map( ( feed ) => feed.id )
					.join( ' ' ) }`
			);
		}
	} );

	test( 'filters by feed, keeps it in the URL and clears it', async ( {
		page,
	} ) => {
		const { north, south } = seeded.feeds;
		const northDigest = `North digest ${ suffix }`;
		const southDigest = `South digest ${ suffix }`;
		await loginAsAdmin( page );
		await page.goto( SETTINGS_URL );

		const feed = view( page ).getByRole( 'combobox', {
			name: 'Event feed',
		} );
		const search = view( page ).getByRole( 'textbox', {
			name: 'Search notifications',
		} );
		await expect( feed ).toHaveValue( '' );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, southDigest ) ).toHaveCount( 1 );

		await feed.selectOption( north.slug );
		await expect( page ).toHaveURL( new RegExp( `feed=${ north.slug }` ) );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, southDigest ) ).toHaveCount( 0 );

		// Combined with the search, and both survive a reload.
		await search.fill( 'digest' );
		await expect( page ).toHaveURL( /s=digest/ );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await page.reload();
		await expect( feed ).toHaveValue( north.slug );
		await expect( search ).toHaveValue( 'digest' );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, southDigest ) ).toHaveCount( 0 );

		// Back and Forward move between the chosen feeds.
		await feed.selectOption( south.slug );
		await expect( listRow( page, southDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, northDigest ) ).toHaveCount( 0 );
		await page.goBack();
		await expect( feed ).toHaveValue( north.slug );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, southDigest ) ).toHaveCount( 0 );
		await page.goForward();
		await expect( feed ).toHaveValue( south.slug );
		await expect( listRow( page, southDigest ) ).toHaveCount( 1 );

		// Clearing it lists every feed again and keeps the search.
		await feed.selectOption( '' );
		await expect( page ).not.toHaveURL( /feed=/ );
		await expect( search ).toHaveValue( 'digest' );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
		await expect( listRow( page, southDigest ) ).toHaveCount( 1 );

		// A feed that does not exist lists nothing and offers every feed.
		await page.goto( `${ SETTINGS_URL }&feed=${ north.slug }-gone` );
		await expect(
			view( page ).getByText(
				`The event feed “${ north.slug }-gone” is not available`,
				{ exact: false }
			)
		).toBeVisible();
		await expect( view( page ).getByRole( 'table' ) ).toHaveCount( 0 );
		await view( page )
			.getByRole( 'button', { name: 'Show all feeds' } )
			.click();
		await expect( page ).not.toHaveURL( /feed=/ );
		await expect( listRow( page, northDigest ) ).toHaveCount( 1 );
	} );
} );

test.describe( 'Duplicating a notification', () => {
	const ids = [];

	test.beforeAll( () => {
		resetCapturedMail();
	} );

	test.afterAll( () => {
		if ( ids.length ) {
			fixture( `remove ${ ids.join( ' ' ) }` );
		}
		resetCapturedMail();
	} );

	test( 'opens a paused copy of the saved settings that is saved on its own', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		const name = `Duplicated digest ${ Date.now() }`;
		const copyName = `Copy of ${ name }`;

		const originalId = await addIndividualEmail( page, name );
		ids.push( originalId );
		await turnOn( view( page ), '06:30' );
		resetCapturedMail();

		await page.getByRole( 'link', { name: '← All notifications' } ).click();
		await focusMenuItem( page, name, 'Duplicate' );
		await page.keyboard.press( 'Enter' );

		await expect(
			page
				.getByText( `“${ copyName }” was added as a copy`, {
					exact: false,
				} )
				.first()
		).toBeVisible();
		await expect( page ).toHaveURL( /configuration=[a-z0-9-]{36}/ );
		const copyId = new URL( page.url() ).searchParams.get(
			'configuration'
		);
		ids.push( copyId );
		expect( copyId ).not.toBe( originalId );

		const copy = view( page );
		await expect( copy.getByLabel( 'Name' ) ).toHaveValue( copyName );
		await expect( copy.getByLabel( 'Send to' ) ).toHaveValue( RECIPIENT );
		await expect( copy.getByLabel( 'Send at' ) ).toHaveValue( '06:30' );
		await expect(
			copy.getByLabel( 'Email the weekly summary to this address' )
		).not.toBeChecked();
		expect( capturedMail() ).toEqual( [] );

		// Saved apart from the original.
		await copy.getByLabel( 'Send at' ).fill( '20:15' );
		await copy
			.getByRole( 'button', { name: 'Save individual email settings' } )
			.click();
		await expect(
			copy.getByText( 'Individual email settings saved.' ).first()
		).toBeVisible();

		await page.getByRole( 'link', { name: '← All notifications' } ).click();
		await expect( listRow( page, name ).getByText( 'On' ) ).toBeVisible();
		await expect(
			listRow( page, copyName ).getByText( 'Paused' )
		).toBeVisible();
		const original = await open( page, name );
		await expect( original.getByLabel( 'Send at' ) ).toHaveValue( '06:30' );
		await expect(
			original.getByLabel( 'Email the weekly summary to this address' )
		).toBeChecked();
		expect( capturedMail() ).toEqual( [] );
	} );
} );

test.describe( 'Deleting a notification', () => {
	const ids = [];

	test.beforeAll( () => {
		resetCapturedMail();
	} );

	test.afterAll( () => {
		if ( ids.length ) {
			fixture( `remove ${ ids.join( ' ' ) }` );
		}
		resetCapturedMail();
	} );

	test( 'confirms, removes only its row and keeps its history', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		const suffix = Date.now();
		const keptName = `Kept digest ${ suffix }`;
		const name = `Deleted digest ${ suffix }`;

		const keptId = await addIndividualEmail( page, keptName );
		ids.push( keptId );
		await turnOn( view( page ), '06:10' );
		const id = await addIndividualEmail( page, name );
		ids.push( id );
		await turnOn( view( page ), '06:20' );
		// One scheduled send, so it has a history to keep.
		fixture( `run ${ id }` );
		await expect.poll( () => capturedMail().length ).toBe( 1 );
		resetCapturedMail();
		expect( fixture( `state ${ id }` ).queued ).toHaveLength( 1 );

		await page.goto( SETTINGS_URL );
		await focusMenuItem( page, name, 'Delete' );
		await page.keyboard.press( 'Enter' );
		let dialog = page.getByRole( 'dialog', {
			name: `Delete notification — ${ name }`,
		} );
		await expect( dialog ).toBeVisible();
		await expect(
			dialog.getByText(
				`Delete the notification “${ name }” (Individual email), which sends to: ${ RECIPIENT }?`
			)
		).toBeVisible();
		await expect(
			dialog.getByText(
				'Its past sends and tests stay in All notification history.'
			)
		).toBeVisible();

		// Escape cancels, and focus returns to the row's menu.
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toHaveCount( 0 );
		await expect( moreActions( page, name ) ).toBeFocused();
		await expect( listRow( page, name ) ).toHaveCount( 1 );

		await focusMenuItem( page, name, 'Delete' );
		await page.keyboard.press( 'Enter' );
		dialog = page.getByRole( 'dialog', {
			name: `Delete notification — ${ name }`,
		} );
		await dialog
			.getByRole( 'button', { name: 'Delete notification' } )
			.click();

		await expect(
			page
				.getByText( `“${ name }” was deleted.`, { exact: false } )
				.first()
		).toBeVisible();
		await expect( dialog ).toHaveCount( 0 );
		await expect( listRow( page, name ) ).toHaveCount( 0 );
		await expect( listRow( page, keptName ) ).toHaveCount( 1 );
		await expect(
			page.getByRole( 'textbox', { name: 'Search notifications' } )
		).toBeFocused();

		await page.reload();
		await expect( listRow( page, keptName ) ).toHaveCount( 1 );
		await expect( listRow( page, name ) ).toHaveCount( 0 );

		// Its queued send never runs; the other one stays scheduled.
		expect( fixture( `state ${ id } individual_email` ) ).toMatchObject( {
			exists: false,
			queued: [],
			nextRun: null,
		} );
		fixture( `run ${ id }` );
		expect( capturedMail() ).toEqual( [] );
		expect( fixture( `state ${ keptId }` ).queued ).toHaveLength( 1 );

		// Its past send stays in the history of every notification.
		await page.goto(
			`${ SETTINGS_URL }&view=history&filter_configuration=${ id }`
		);
		await expect(
			view( page ).getByRole( 'combobox', { name: 'Notification' } )
		).toHaveValue( id );
		await expect( historyRows( page ) ).toHaveCount( 1 );
		await expect(
			historyRows( page ).filter( { hasText: name } )
		).toHaveCount( 1 );
		await historyRows( page ).getByRole( 'link' ).click();
		await expect(
			view( page ).getByText( 'This notification no longer exists.' )
		).toBeVisible();
	} );
} );

test.describe( 'Notification list layout', () => {
	test( 'stacks rows on a phone without scrolling sideways', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.setViewportSize( { width: 375, height: 812 } );
		await page.goto( SETTINGS_URL );
		const table = view( page ).locator( '.fair-admin-table' );
		await expect( table ).toBeVisible();
		const row = table.locator( 'tbody tr' ).first();
		await expect(
			row.getByRole( 'link', { name: /^Edit “/ } )
		).toBeVisible();
		await expect(
			row.getByRole( 'button', { name: /^More actions for “/ } )
		).toBeVisible();
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect( overflow ).toBeLessThanOrEqual( 0 );
	} );
} );
