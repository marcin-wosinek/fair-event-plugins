/**
 * Playwright API tests for weekly summary and event feed preferences on
 * PUT /fair-audience/v1/participants/{id} (#2135).
 *
 * Feeds and a participant's stored choice are set up with
 * e2e/mu-plugins/scripts/weekly-feeds-fixture.php: feeds A and B are
 * offered, C exists without a weekly email and D is disabled. A request
 * that Fair Events cannot check because its catalog is missing is covered
 * by WeeklyFeedsTest (resolve_choice).
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PARTICIPANTS = '/wp-json/fair-audience/v1/participants';
const DELETED_FEED = 999999999;

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

const sorted = ( ids ) => [ ...ids ].sort( ( x, y ) => x - y );

test.describe( 'Participant popup — weekly preferences', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	let api;
	let feeds;
	let configurations;

	// A marketing participant with a stored feed choice.
	const participant = async ( label, mode, feedIds ) => {
		const email = `feed-prefs-${ label }+${ suffix }@example.test`;
		emails.push( email );
		const res = await api.post( PARTICIPANTS, {
			headers: adminHeaders,
			data: {
				name: 'Feed',
				surname: 'Prefs',
				email,
				email_profile: 'marketing',
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const { participant_id: id } = await fixture(
			'choose',
			email,
			mode,
			feedIds.join( ',' )
		);
		return { id, email };
	};

	const contact = ( email ) => ( {
		name: 'Feed',
		surname: 'Prefs',
		email,
		email_profile: 'marketing',
	} );

	const update = ( id, data, headers = adminHeaders ) =>
		api.put( `${ PARTICIPANTS }/${ id }`, { headers, data } );

	const stored = async ( email ) =>
		( await fixture( 'state', email ) ).participant;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		( { feeds, configurations } = await fixture( 'seed', suffix ) );
	} );

	test.afterAll( async () => {
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

	test( 'saves the weekly opt-out and all, selected and no feeds', async () => {
		const { id, email } = await participant( 'modes', 'all', [] );

		let res = await update( id, {
			...contact( email ),
			weekly_summary_opt_out: true,
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ feeds.b, feeds.a ],
		} );
		expect( res.status() ).toBe( 200 );
		let state = await stored( email );
		expect( state.weekly_summary_opt_out ).toBe( true );
		expect( state.weekly_feed_mode ).toBe( 'selected' );
		expect( state.feed_ids ).toEqual( sorted( [ feeds.a, feeds.b ] ) );

		// All feeds keeps the stored choice for switching back.
		res = await update( id, {
			...contact( email ),
			weekly_summary_opt_out: false,
			weekly_feed_mode: 'all',
		} );
		expect( res.status() ).toBe( 200 );
		state = await stored( email );
		expect( state.weekly_summary_opt_out ).toBe( false );
		expect( state.weekly_feed_mode ).toBe( 'all' );
		expect( state.feed_ids ).toEqual( sorted( [ feeds.a, feeds.b ] ) );

		res = await update( id, {
			...contact( email ),
			weekly_feed_mode: 'none',
		} );
		expect( res.status() ).toBe( 200 );
		state = await stored( email );
		expect( state.weekly_feed_mode ).toBe( 'selected' );
		expect( state.feed_ids ).toEqual( [] );

		// The detail endpoint the popup reads shows the same values.
		const detail = await (
			await api.get( `${ PARTICIPANTS }/${ id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( detail.weekly_feed_mode ).toBe( 'selected' );
		expect( detail.weekly_feed_ids ).toEqual( [] );
		expect( detail.weekly_summary_opt_out ).toBe( false );
	} );

	test( 'a contact edit keeps confirmation status and weekly preferences', async () => {
		const { id, email } = await participant( 'contact', 'selected', [
			feeds.a,
			feeds.c,
		] );
		await fixture( 'status', email, 'pending' );
		await update( id, {
			...contact( email ),
			weekly_summary_opt_out: true,
		} );

		const res = await update( id, {
			...contact( email ),
			phone: '+34 600 000 000',
			email_profile: 'declined',
		} );

		expect( res.status() ).toBe( 200 );
		const state = await stored( email );
		expect( state.status ).toBe( 'pending' );
		expect( state.email_profile ).toBe( 'declined' );
		expect( state.weekly_summary_opt_out ).toBe( true );
		expect( state.weekly_feed_mode ).toBe( 'selected' );
		expect( state.feed_ids ).toEqual( sorted( [ feeds.a, feeds.c ] ) );
	} );

	test( 'keeps unavailable and deleted feeds when chosen feeds change; no feeds clears them', async () => {
		const { id, email } = await participant( 'kept', 'selected', [
			feeds.a,
			feeds.c,
			feeds.d,
			DELETED_FEED,
		] );

		let res = await update( id, {
			...contact( email ),
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ feeds.b ],
		} );
		expect( res.status() ).toBe( 200 );
		expect( ( await stored( email ) ).feed_ids ).toEqual(
			sorted( [ feeds.b, feeds.c, feeds.d, DELETED_FEED ] )
		);

		res = await update( id, {
			...contact( email ),
			weekly_feed_mode: 'none',
		} );
		expect( res.status() ).toBe( 200 );
		expect( ( await stored( email ) ).feed_ids ).toEqual( [] );
	} );

	test( 'refuses feeds that cannot be chosen and changes nothing', async () => {
		const { id, email } = await participant( 'invalid', 'all', [
			feeds.a,
		] );

		for ( const data of [
			{ weekly_feed_mode: 'selected', weekly_feed_ids: [ feeds.c ] },
			{ weekly_feed_mode: 'selected', weekly_feed_ids: [ feeds.d ] },
			{
				weekly_feed_mode: 'selected',
				weekly_feed_ids: [ feeds.a, DELETED_FEED ],
			},
			{ weekly_feed_mode: 'selected' },
			{ weekly_feed_mode: 'all', weekly_feed_ids: [ feeds.b ] },
			{ weekly_feed_ids: [ feeds.b ] },
			{ weekly_feed_mode: 'everything' },
			{ weekly_feed_mode: 'selected', weekly_feed_ids: [ 'x' ] },
		] ) {
			const res = await update( id, {
				...contact( email ),
				phone: 'changed',
				weekly_summary_opt_out: true,
				...data,
			} );
			expect( res.status(), JSON.stringify( data ) ).toBe( 400 );
		}

		const state = await stored( email );
		expect( state.weekly_feed_mode ).toBe( 'all' );
		expect( state.weekly_summary_opt_out ).toBe( false );
		expect( state.feed_ids ).toEqual( [ feeds.a ] );
		const detail = await (
			await api.get( `${ PARTICIPANTS }/${ id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( detail.phone ).toBe( '' );
	} );

	test( 'rolls the feeds back when the profile cannot be saved', async () => {
		const { id, email } = await participant( 'rollback', 'selected', [
			feeds.a,
		] );

		// A profile without a name is not saved, after the feeds were.
		const res = await update( id, {
			...contact( email ),
			name: '',
			weekly_feed_mode: 'none',
		} );

		expect( res.status() ).toBe( 500 );
		const state = await stored( email );
		expect( state.weekly_feed_mode ).toBe( 'selected' );
		expect( state.feed_ids ).toEqual( [ feeds.a ] );
	} );

	test( 'only administrators can change preferences', async () => {
		const { id, email } = await participant( 'auth', 'all', [] );
		const change = { ...contact( email ), weekly_feed_mode: 'none' };

		expect( ( await update( id, change, {} ) ).status() ).toBe( 401 );

		const username = `feed-prefs-subscriber-${ suffix }`;
		const password = 'Feed-prefs-test-2135!';
		const user = await (
			await api.post( '/wp-json/wp/v2/users', {
				headers: adminHeaders,
				data: {
					username,
					password,
					email: `${ username }@example.test`,
					roles: [ 'subscriber' ],
				},
			} )
		).json();
		const forbidden = await update(
			id,
			change,
			basicAuth( username, password )
		);
		await api.delete(
			`/wp-json/wp/v2/users/${ user.id }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);

		expect( forbidden.status() ).toBe( 403 );
		expect( ( await stored( email ) ).weekly_feed_mode ).toBe( 'all' );
	} );
} );
