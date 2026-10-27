/**
 * Playwright API tests for weekly email feed subscriptions through
 * POST /fair-audience/v1/mailing-signup (#2041).
 *
 * Feeds and their weekly emails are seeded with
 * e2e/mu-plugins/scripts/weekly-feeds-fixture.php, which also reads the
 * stored preferences and pending confirmation, and runs a weekly email's
 * send to see who receives it.
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
