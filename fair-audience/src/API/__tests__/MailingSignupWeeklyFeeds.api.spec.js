/**
 * Playwright API tests for weekly email feed subscriptions through
 * POST /fair-audience/v1/mailing-signup (#2041).
 *
 * Feeds and their weekly emails are seeded with
 * e2e/mu-plugins/scripts/weekly-feeds-fixture.php, which also reads the
 * stored preferences and pending confirmation, and runs a weekly email's
 * send to see who receives it.
 *
 * The Mailing Signup block (#2042) signs its feed policy into the form; the
 * block-form tests read it from a published page, as a visitor's browser
 * does.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const SIGNUP = '/wp-json/fair-audience/v1/mailing-signup';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

// Awaited rather than blocking, so pooled sockets are not left to go stale
// while WP-CLI runs.
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
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_WEEKLY_FEEDS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Expected E2E_WEEKLY_FEEDS in output:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

test.describe( 'Mailing signup — weekly email feeds', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	let api;
	let feeds;
	let configurations;
	let wpUserId;

	const email = ( label ) => {
		const address = `feeds-${ label }+${ suffix }@example.test`;
		emails.push( address );
		return address;
	};

	const signup = ( data, headers = {} ) =>
		api.post( SIGNUP, {
			headers,
			data: { name: 'Feed', surname: 'Tester', ...data },
		} );

	const confirm = async ( address ) => {
		const { token } = await fixture( 'state', address );
		const res = await api.post( `${ SIGNUP }/confirm`, {
			data: { token },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await fixture( 'state', address ) ).participant;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		( { feeds, configurations } = await fixture( 'seed', suffix ) );
	} );

	test.afterAll( async () => {
		if ( wpUserId ) {
			await api.delete( `/wp-json/wp/v2/users/${ wpUserId }`, {
				headers: adminHeaders,
				params: { force: 'true', reassign: '1' },
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

	test( 'rejects feeds that cannot be chosen, before anything is stored', async () => {
		for ( const feedId of [ feeds.c, feeds.d, 999999999 ] ) {
			const address = email( `invalid-${ feedId }` );
			const res = await signup( {
				email: address,
				weekly_feed_ids: [ feeds.a, feedId ],
			} );

			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'invalid_weekly_feeds' );
			expect( ( await fixture( 'state', address ) ).participant ).toBe(
				null
			);
		}
	} );

	test( 'without weekly fields, a new subscriber keeps every weekly email', async () => {
		const address = email( 'omitted' );
		const res = await signup( { email: address } );
		expect( ( await res.json() ).status ).toBe( 'pending' );
		expect( ( await fixture( 'state', address ) ).pending ).toBe( null );

		const participant = await confirm( address );

		expect( participant.weekly_feed_mode ).toBe( 'all' );
		expect( participant.feed_ids ).toEqual( [] );
		expect( participant.weekly_summary_opt_out ).toBe( false );
	} );

	test( 'chosen feeds wait on the confirmation token and apply when it confirms', async () => {
		const address = email( 'chosen' );
		await signup( { email: address, weekly_feed_ids: [ feeds.a ] } );

		const pending = await fixture( 'state', address );
		expect( pending.participant.weekly_feed_mode ).toBe( 'all' );
		expect( pending.participant.feed_ids ).toEqual( [] );
		expect( pending.pending ).toEqual( { feed_ids: [ feeds.a ] } );

		const participant = await confirm( address );

		expect( participant.status ).toBe( 'confirmed' );
		expect( participant.weekly_feed_mode ).toBe( 'selected' );
		expect( participant.feed_ids ).toEqual( [ feeds.a ] );
	} );

	test( 'an empty selection means no feeds, and the weekly switch is kept', async () => {
		const address = email( 'empty' );
		await signup( {
			email: address,
			weekly_summary: false,
			weekly_feed_ids: [],
		} );

		const participant = await confirm( address );

		expect( participant.weekly_feed_mode ).toBe( 'selected' );
		expect( participant.feed_ids ).toEqual( [] );
		expect( participant.weekly_summary_opt_out ).toBe( true );
	} );

	test( 'a signup with a subscribed address only emails it the management link', async () => {
		const address = email( 'existing' );
		const created = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Existing',
					email: address,
					email_profile: 'marketing',
				},
			}
		);
		expect( created.ok() ).toBeTruthy();

		const res = await signup( {
			email: address,
			weekly_summary: false,
			weekly_feed_ids: [ feeds.b ],
		} );
		const body = await res.json();

		expect( res.ok() ).toBeTruthy();
		expect( body.status ).toBe( 'manage_link_sent' );

		const state = await fixture( 'state', address );
		expect( state.participant.weekly_feed_mode ).toBe( 'all' );
		expect( state.participant.feed_ids ).toEqual( [] );
		expect( state.participant.weekly_summary_opt_out ).toBe( false );
		expect( state.token ).toBe( null );
	} );

	test( 'a signed-in user changes only their own linked participant', async () => {
		const password = `pw-${ suffix }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: `feeds-user-${ suffix }`,
				email: `feeds-user-${ suffix }@example.test`,
				password,
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		const user = await userRes.json();
		wpUserId = user.id;

		const own = email( 'own' );
		const linked = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Linked',
					email: own,
					email_profile: 'marketing',
					wp_user_id: wpUserId,
				},
			}
		);
		expect( linked.ok() ).toBeTruthy();

		const other = email( 'other' );
		await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'Other', email: other, email_profile: 'marketing' },
		} );

		const res = await signup(
			{ email: other, weekly_feed_ids: [ feeds.b ] },
			basicAuth( user.slug, password )
		);
		expect( ( await res.json() ).status ).toBe( 'preferences_updated' );

		const ownState = ( await fixture( 'state', own ) ).participant;
		expect( ownState.weekly_feed_mode ).toBe( 'selected' );
		expect( ownState.feed_ids ).toEqual( [ feeds.b ] );

		const otherState = ( await fixture( 'state', other ) ).participant;
		expect( otherState.weekly_feed_mode ).toBe( 'all' );
		expect( otherState.feed_ids ).toEqual( [] );
	} );

	test( "each feed's weekly email reaches only its subscribers", async () => {
		const onlyA = email( 'only-a' );
		const both = email( 'both' );
		const none = email( 'none' );
		const everything = email( 'everything' );
		const optedOut = email( 'opted-out' );

		await signup( { email: onlyA, weekly_feed_ids: [ feeds.a ] } );
		await signup( { email: both, weekly_feed_ids: [ feeds.a, feeds.b ] } );
		await signup( { email: none, weekly_feed_ids: [] } );
		await signup( { email: everything } );
		await signup( {
			email: optedOut,
			weekly_summary: false,
			weekly_feed_ids: [ feeds.a ],
		} );
		for ( const address of [ onlyA, both, none, everything, optedOut ] ) {
			await confirm( address );
		}
		const pending = email( 'unconfirmed' );
		await signup( { email: pending, weekly_feed_ids: [ feeds.a ] } );

		const a = await fixture( 'deliver', configurations.a );
		// Other participants on the shared site may lack a valid address.
		expect( [ 'sent', 'partial' ] ).toContain( a.run.status );
		expect( a.recipients ).toEqual(
			expect.arrayContaining( [ onlyA, both, everything ] )
		);
		for ( const address of [ none, optedOut, pending ] ) {
			expect( a.recipients ).not.toContain( address );
		}

		const b = await fixture( 'deliver', configurations.b );
		expect( b.recipients ).toEqual(
			expect.arrayContaining( [ both, everything ] )
		);
		for ( const address of [ onlyA, none, optedOut, pending ] ) {
			expect( b.recipients ).not.toContain( address );
		}
	} );
} );

test.describe( 'Mailing signup — Mailing Signup block feed policy', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	const pageIds = [];
	let api;
	let feeds;
	let configurations;

	const email = ( label ) => {
		const address = `block-feeds-${ label }+${ suffix }@example.test`;
		emails.push( address );
		return address;
	};

	const signup = ( data ) =>
		api.post( SIGNUP, {
			data: { name: 'Block', surname: 'Tester', ...data },
		} );

	// Publishes a page holding the block and returns its weekly fieldset.
	const blockForm = async ( attributes ) => {
		const created = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: {
				title: `Mailing signup ${ suffix }`,
				status: 'publish',
				content: `<!-- wp:fair-audience/mailing-signup ${ JSON.stringify(
					attributes
				) } /-->`,
			},
		} );
		expect( created.ok() ).toBeTruthy();
		const page = await created.json();
		pageIds.push( page.id );

		const html = await ( await api.get( page.link ) ).text();
		const fieldset = html.match(
			/<fieldset\s+class="fair-audience-mailing-weekly"[\s\S]*?<\/legend>[\s\S]*?(?:<\/fieldset>\s*){1,2}/
		);
		return {
			html: fieldset ? fieldset[ 0 ] : null,
			config: fieldset
				? fieldset[ 0 ].match( /data-weekly-config="([^"]+)"/ )[ 1 ]
				: null,
		};
	};

	const pending = async ( address ) =>
		( await fixture( 'state', address ) ).pending;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		( { feeds, configurations } = await fixture( 'seed', suffix ) );
	} );

	test.afterAll( async () => {
		for ( const id of pageIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }`, {
				headers: adminHeaders,
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

	test( 'the editor lists only feeds a subscriber can choose, to editors only', async () => {
		const anonymous = await api.get( `${ SIGNUP }/weekly-feeds` );
		expect( anonymous.status() ).toBe( 401 );

		const res = await api.get( `${ SIGNUP }/weekly-feeds`, {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		const ids = body.feeds.map( ( feed ) => feed.id );

		expect( body.available ).toBe( true );
		expect( ids ).toEqual( expect.arrayContaining( [ feeds.a, feeds.b ] ) );
		expect( ids ).not.toContain( feeds.c );
		expect( ids ).not.toContain( feeds.d );
	} );

	test( 'a block without the weekly checkbox renders and submits no weekly fields', async () => {
		const form = await blockForm( { showCategories: false } );
		expect( form.html ).toBe( null );
	} );

	test( 'a tampered form configuration is rejected before anything is stored', async () => {
		const { config } = await blockForm( {
			weeklyUpdate: 'checked',
			feedSelection: 'hidden',
			feedId: feeds.a,
		} );
		const forged = Buffer.from(
			`hidden:${ feeds.b }:` +
				Buffer.from( config, 'base64url' ).toString().split( ':' )[ 2 ]
		).toString( 'base64url' );

		for ( const weeklyConfig of [ forged, 'not-a-config' ] ) {
			const address = email( `tampered-${ weeklyConfig.length }` );
			const res = await signup( {
				email: address,
				weekly_config: weeklyConfig,
				weekly_summary: true,
			} );

			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'invalid_weekly_config' );
			expect( ( await fixture( 'state', address ) ).participant ).toBe(
				null
			);
		}
	} );

	test( 'a hidden-feed form subscribes to its own feed, whatever IDs are submitted', async () => {
		const form = await blockForm( {
			weeklyUpdate: 'checked',
			feedSelection: 'hidden',
			feedId: feeds.a,
		} );
		expect( form.html ).toContain( 'name="mailing_weekly"' );
		expect( form.html ).toContain( 'checked' );
		expect( form.html ).not.toContain( 'mailing_weekly_feeds' );

		const address = email( 'hidden-checked' );
		const res = await signup( {
			email: address,
			weekly_config: form.config,
			weekly_summary: true,
			weekly_feed_ids: [ feeds.b ],
		} );
		expect( ( await res.json() ).status ).toBe( 'pending' );
		expect( await pending( address ) ).toEqual( {
			weekly_summary: true,
			feed_ids: [ feeds.a ],
		} );

		const { token } = await fixture( 'state', address );
		await api.post( `${ SIGNUP }/confirm`, { data: { token } } );
		const participant = ( await fixture( 'state', address ) ).participant;
		expect( participant.weekly_feed_mode ).toBe( 'selected' );
		expect( participant.feed_ids ).toEqual( [ feeds.a ] );
		expect( participant.weekly_summary_opt_out ).toBe( false );
	} );

	test( 'declining the weekly update on a hidden-feed form stores only the opt-out', async () => {
		const { config } = await blockForm( {
			weeklyUpdate: 'unchecked',
			feedSelection: 'hidden',
			feedId: feeds.a,
		} );
		const address = email( 'hidden-unchecked' );
		await signup( {
			email: address,
			weekly_config: config,
			weekly_summary: false,
		} );

		expect( await pending( address ) ).toEqual( {
			weekly_summary: false,
		} );
	} );

	test( 'a hidden feed that cannot be chosen is not offered or substituted', async () => {
		for ( const feedId of [ feeds.d, 999999999 ] ) {
			const form = await blockForm( {
				weeklyUpdate: 'checked',
				feedSelection: 'hidden',
				feedId,
			} );
			expect( form.html ).toContain(
				'Weekly updates are not available right now.'
			);
			expect( form.html ).not.toContain( 'name="mailing_weekly"' );

			const address = email( `hidden-unavailable-${ feedId }` );
			const res = await signup( {
				email: address,
				weekly_config: form.config,
				weekly_summary: true,
			} );
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe(
				'weekly_feed_unavailable'
			);
			expect( ( await fixture( 'state', address ) ).participant ).toBe(
				null
			);
		}
	} );

	test( 'a multiselect form offers every eligible feed, unselected, and needs one when checked', async () => {
		const form = await blockForm( {
			weeklyUpdate: 'unchecked',
			feedSelection: 'multiselect',
		} );
		for ( const id of [ feeds.a, feeds.b ] ) {
			expect( form.html ).toContain( `value="${ id }"` );
		}
		for ( const id of [ feeds.c, feeds.d ] ) {
			expect( form.html ).not.toContain( `value="${ id }"` );
		}
		expect( form.html ).not.toMatch(
			/name="mailing_weekly_feeds\[\]"[^>]*checked/
		);

		const missing = email( 'multi-missing' );
		const rejected = await signup( {
			email: missing,
			weekly_config: form.config,
			weekly_summary: true,
		} );
		expect( rejected.status() ).toBe( 400 );
		expect( ( await rejected.json() ).code ).toBe( 'weekly_feed_required' );
		expect( ( await fixture( 'state', missing ) ).participant ).toBe(
			null
		);

		const unavailable = email( 'multi-unavailable' );
		const invalid = await signup( {
			email: unavailable,
			weekly_config: form.config,
			weekly_summary: true,
			weekly_feed_ids: [ feeds.a, feeds.d ],
		} );
		expect( ( await invalid.json() ).code ).toBe( 'invalid_weekly_feeds' );

		const address = email( 'multi-chosen' );
		await signup( {
			email: address,
			weekly_config: form.config,
			weekly_summary: true,
			weekly_feed_ids: [ feeds.a, feeds.b ],
		} );
		const { token } = await fixture( 'state', address );
		await api.post( `${ SIGNUP }/confirm`, { data: { token } } );
		const participant = ( await fixture( 'state', address ) ).participant;
		expect( participant.weekly_feed_mode ).toBe( 'selected' );
		expect( participant.feed_ids ).toEqual(
			[ feeds.a, feeds.b ].sort( ( x, y ) => x - y )
		);

		const declined = email( 'multi-declined' );
		await signup( {
			email: declined,
			weekly_config: form.config,
			weekly_summary: false,
		} );
		expect( await pending( declined ) ).toEqual( {
			weekly_summary: false,
		} );

		const omitted = email( 'multi-omitted' );
		const unanswered = await signup( {
			email: omitted,
			weekly_config: form.config,
		} );
		expect( ( await unanswered.json() ).code ).toBe(
			'weekly_summary_required'
		);
	} );

	test( 'a block form with a subscribed address only emails it the management link', async () => {
		const { config } = await blockForm( {
			weeklyUpdate: 'checked',
			feedSelection: 'hidden',
			feedId: feeds.b,
		} );
		const address = email( 'block-existing' );
		const created = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Existing',
					email: address,
					email_profile: 'marketing',
				},
			}
		);
		expect( created.ok() ).toBeTruthy();

		const res = await signup( {
			email: address,
			weekly_config: config,
			weekly_summary: true,
		} );
		expect( ( await res.json() ).status ).toBe( 'manage_link_sent' );

		const state = await fixture( 'state', address );
		expect( state.participant.weekly_feed_mode ).toBe( 'all' );
		expect( state.participant.feed_ids ).toEqual( [] );
		expect( state.token ).toBe( null );
	} );
} );
