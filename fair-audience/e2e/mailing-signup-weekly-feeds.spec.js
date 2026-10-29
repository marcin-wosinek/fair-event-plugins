/**
 * E2E test for the weekly-update controls of the Mailing Signup block
 * (#2042).
 *
 * An editor turns on the weekly checkbox and picks one hidden event feed in
 * the block settings; a visitor signs up on the published page and the feed
 * applies when they follow the link in the confirmation email. A multiselect form asks for a
 * feed before sending, works from the keyboard, and only emails a
 * management link to an address that is already subscribed.
 *
 * Feeds are seeded with e2e/mu-plugins/scripts/weekly-feeds-fixture.php,
 * which also reads the stored preferences and pending confirmation.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

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

test.describe( 'Mailing Signup block — weekly update and event feeds', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	const pageIds = [];
	let api;
	let feeds;
	let configurations;

	const email = ( label ) => {
		const address = `signup-block-${ label }+${ suffix }@example.test`;
		emails.push( address );
		return address;
	};

	const createPage = async ( attributes ) => {
		const res = await api.post( '/wp-json/wp/v2/pages', {
			headers: authHeaders,
			data: {
				title: `Weekly signup ${ suffix }`,
				status: 'publish',
				content: `<!-- wp:fair-audience/mailing-signup ${ JSON.stringify(
					attributes
				) } /-->`,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const page = await res.json();
		pageIds.push( page.id );
		return page;
	};

	const fillIdentity = async ( form, address ) => {
		await form.getByLabel( 'First Name' ).fill( 'Feed' );
		await form.getByLabel( 'Last Name' ).fill( 'Visitor' );
		await form.getByLabel( 'Email' ).fill( address );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		( { feeds, configurations } = await fixture( 'seed', suffix ) );
	} );

	test.afterAll( async () => {
		for ( const id of pageIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }`, {
				headers: authHeaders,
				params: { force: 'true' },
			} );
		}
		if ( feeds ) {
			await fixture(
				'cleanup',
				Object.values( feeds ).join( ',' ),
				Object.values( configurations ).join( ',' ),
				emails.join( ',' )
			);
		}
		await api.dispose();
	} );

	test( 'an editor offers one hidden feed, and it applies on confirmation', async ( {
		page,
		browser,
	} ) => {
		const created = await createPage( {} );

		await page.goto( '/wp-login.php' );
		await page.fill( '#user_login', ADMIN_USER );
		await page.fill( '#user_pass', ADMIN_PASSWORD );
		await page.click( '#wp-submit' );
		await page.waitForURL( /\/wp-admin\/?/ );

		await page.goto(
			`/wp-admin/post.php?post=${ created.id }&action=edit`
		);
		await page.waitForFunction(
			() =>
				window.wp?.data?.select( 'core/block-editor' )?.getBlocks()
					.length > 0
		);
		await page.evaluate( () => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/preferences' ).set(
				'core/edit-post',
				'welcomeGuide',
				false
			);
			const [ block ] = select( 'core/block-editor' ).getBlocks();
			dispatch( 'core/block-editor' ).selectBlock( block.clientId );
			dispatch( 'core/edit-post' ).openGeneralSidebar(
				'edit-post/block'
			);
		} );

		await page
			.getByLabel( 'Weekly update checkbox' )
			.selectOption( 'checked' );
		await page.getByLabel( 'Event feeds' ).selectOption( 'hidden' );
		const feed = page.getByLabel( 'Event feed', { exact: true } );
		await expect(
			feed.locator( `option[value="${ feeds.c }"]` )
		).toHaveCount( 0 );
		await expect(
			feed.locator( `option[value="${ feeds.d }"]` )
		).toHaveCount( 0 );
		await feed.selectOption( String( feeds.a ) );

		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await page.waitForFunction( () => {
			const editor = window.wp.data.select( 'core/editor' );
			return ! editor.isSavingPost() && ! editor.isEditedPostDirty();
		} );

		// The visitor is anonymous, so nothing is applied without the link.
		const visitor = await browser.newPage();
		await visitor.goto( created.link );
		const form = visitor.locator( '.fair-audience-mailing-form' );
		const weekly = form.getByRole( 'checkbox', {
			name: 'Receive a weekly update of upcoming events',
		} );
		await expect( weekly ).toBeChecked();
		await expect(
			form.locator( 'input[name="mailing_weekly_feeds[]"]' )
		).toHaveCount( 0 );

		const address = email( 'hidden' );
		await fillIdentity( form, address );
		await form.getByRole( 'button', { name: 'Subscribe' } ).click();
		await expect( form.getByRole( 'status' ) ).toHaveText(
			'Please check your email to confirm your subscription.'
		);

		const state = await fixture( 'state', address );
		expect( state.pending ).toEqual( {
			weekly_summary: true,
			feed_ids: [ feeds.a ],
		} );

		// The visitor follows the link the confirmation email carries.
		const { link } = await fixture( 'confirmation-link', address );
		await visitor.goto( link );
		await expect(
			visitor.getByRole( 'heading', { name: 'Email Confirmed!' } )
		).toBeVisible();
		const confirmed = await fixture( 'state', address );
		expect( confirmed.token ).toBe( null );
		expect( confirmed.participant ).toMatchObject( {
			status: 'confirmed',
			weekly_feed_mode: 'selected',
			feed_ids: [ feeds.a ],
			weekly_summary_opt_out: false,
		} );
		await visitor.close();
	} );

	test( 'a multiselect form asks for a feed and is usable from the keyboard', async ( {
		page,
	} ) => {
		const created = await createPage( {
			weeklyUpdate: 'unchecked',
			feedSelection: 'multiselect',
		} );
		await page.goto( created.link );
		const form = page.locator( '.fair-audience-mailing-form' );
		const weekly = form.getByRole( 'checkbox', {
			name: 'Receive a weekly update of upcoming events',
		} );
		const feedA = form.getByRole( 'checkbox', {
			name: `Feed A ${ suffix }`,
		} );
		await expect( weekly ).not.toBeChecked();
		await expect( feedA ).not.toBeChecked();
		await expect(
			form.getByRole( 'checkbox', { name: `Feed C ${ suffix }` } )
		).toHaveCount( 0 );

		const address = email( 'multi' );
		await fillIdentity( form, address );
		await weekly.focus();
		await page.keyboard.press( 'Space' );
		await expect( weekly ).toBeChecked();

		await form.getByRole( 'button', { name: 'Subscribe' } ).click();
		await expect( form.getByRole( 'status' ) ).toHaveText(
			'Please choose at least one event feed to receive the weekly update.'
		);
		expect( ( await fixture( 'state', address ) ).participant ).toBe(
			null
		);

		await feedA.focus();
		await page.keyboard.press( 'Space' );
		await form.getByRole( 'button', { name: 'Subscribe' } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( form.getByRole( 'status' ) ).toHaveText(
			'Please check your email to confirm your subscription.'
		);
		expect( ( await fixture( 'state', address ) ).pending ).toEqual( {
			weekly_summary: true,
			feed_ids: [ feeds.a ],
		} );
	} );

	test( 'a subscribed address only gets a management link and keeps its preferences', async ( {
		page,
	} ) => {
		const address = email( 'existing' );
		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Existing',
					email: address,
					email_profile: 'marketing',
				},
			}
		);
		expect( participantRes.ok() ).toBeTruthy();

		const created = await createPage( {
			weeklyUpdate: 'checked',
			feedSelection: 'multiselect',
		} );
		await page.goto( created.link );
		const form = page.locator( '.fair-audience-mailing-form' );
		await fillIdentity( form, address );
		const feedB = form.getByRole( 'checkbox', {
			name: `Feed B ${ suffix }`,
		} );
		await feedB.check();
		await form.getByRole( 'button', { name: 'Subscribe' } ).click();

		await expect( form.getByRole( 'status' ) ).toHaveText(
			'This email address is already subscribed. We sent it a link to review and change its email preferences.'
		);
		await expect( feedB ).toBeChecked();
		await expect( form.getByLabel( 'Email' ) ).toHaveValue( address );

		const state = await fixture( 'state', address );
		expect( state.participant.weekly_feed_mode ).toBe( 'all' );
		expect( state.participant.feed_ids ).toEqual( [] );
	} );
} );
