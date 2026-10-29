/**
 * Playwright API tests for the weekly event-feed summary on
 * GET /fair-audience/v1/participants/{id} (#2125).
 *
 * Feeds and a participant's stored choice are set up with
 * e2e/mu-plugins/scripts/weekly-feeds-fixture.php: feeds A and B are
 * offered, C exists without a weekly email and D is disabled.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PARTICIPANTS = '/wp-json/fair-audience/v1/participants';
const DELETED_FEED = 999999999;

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

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

test.describe( 'Participant detail — weekly event-feed summary', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	let api;
	let feeds;
	let configurations;

	const participant = async ( label, mode, feedIds ) => {
		const email = `feed-summary-${ label }+${ suffix }@example.test`;
		emails.push( email );
		const res = await api.post( PARTICIPANTS, {
			headers: adminHeaders,
			data: {
				name: 'Feed',
				surname: 'Summary',
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

	test( 'classifies selected, unavailable and deleted feeds without changing them', async () => {
		const chosen = [ feeds.a, feeds.c, feeds.d, DELETED_FEED ];
		const { id, email } = await participant(
			'selected',
			'selected',
			chosen
		);

		const res = await api.get( `${ PARTICIPANTS }/${ id }`, {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body.weekly_feed_mode ).toBe( 'selected' );
		expect( [ ...body.weekly_feed_ids ].sort( ( x, y ) => x - y ) ).toEqual(
			[ ...chosen ].sort( ( x, y ) => x - y )
		);
		expect( body.weekly_feed_summary.available ).toBe( true );
		expect( body.weekly_feed_summary.selected ).toEqual( [
			{ id: feeds.a, name: `Feed A ${ suffix }` },
		] );
		expect(
			[ ...body.weekly_feed_summary.unavailable ].sort(
				( x, y ) => x.id - y.id
			)
		).toEqual( [
			{ id: feeds.c, name: `Feed C ${ suffix }` },
			{ id: feeds.d, name: `Feed D ${ suffix }` },
		] );
		expect( body.weekly_feed_summary.deleted ).toBe( 1 );

		const { participant: stored } = await fixture( 'state', email );
		expect( stored.weekly_feed_mode ).toBe( 'selected' );
		expect( stored.feed_ids ).toEqual(
			[ ...chosen ].sort( ( x, y ) => x - y )
		);
	} );

	test( 'lists no feeds for the all-feeds mode or an empty selection', async () => {
		const empty = {
			available: true,
			selected: [],
			unavailable: [],
			deleted: 0,
		};

		for ( const [ label, mode, feedIds ] of [
			[ 'all', 'all', [ feeds.a ] ],
			[ 'none', 'selected', [] ],
		] ) {
			const { id } = await participant( label, mode, feedIds );
			const body = await (
				await api.get( `${ PARTICIPANTS }/${ id }`, {
					headers: adminHeaders,
				} )
			).json();

			expect( body.weekly_feed_mode ).toBe( mode );
			expect( body.weekly_feed_summary ).toEqual( empty );
		}
	} );

	test( 'requires a logged-in user', async () => {
		const { id } = await participant( 'anonymous', 'selected', [
			feeds.a,
		] );

		const res = await api.get( `${ PARTICIPANTS }/${ id }` );

		expect( res.status() ).toBe( 401 );
		expect( await res.json() ).not.toHaveProperty( 'weekly_feed_summary' );
	} );
} );
