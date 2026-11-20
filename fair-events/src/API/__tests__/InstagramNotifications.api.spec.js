/**
 * Playwright API tests for Instagram notifications (#2076): an Instagram
 * configuration on the event-notifications routes, with Fair Events
 * Experimental providing the connection and the image.
 *
 * - Administrators only; subscribers and visitors are refused.
 * - A configuration starts paused and is turned on only with a public page,
 *   an event feed and a usable connection.
 * - The preview returns the image and caption without publishing or storing
 *   anything; there is no test post.
 * - With the Instagram feature off, settings are kept, read-only, and
 *   neither preview nor save works; deleting still does.
 * - Responses never hold the access token.
 *
 * Nothing reaches Meta: the `e2e-ig-unified-ok` token is answered by
 * e2e/mu-plugins/fair-e2e-protected-credentials.php, which records every
 * Graph API request so the spec can check that a preview makes none.
 *
 * The suite restores the Instagram feature it found and leaves an existing
 * connection alone: the cases that need one are skipped when the site has
 * a connection of its own.
 */

import { test, expect, request } from '@playwright/test';
import { runScript, wpCli } from '../../../../e2e/support/wp-cli.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/event-notifications';
const CONFIGURATIONS = `${ PATH }/configurations`;
const TOKEN = 'e2e-ig-unified-ok';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

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

test.describe( 'Instagram notifications', () => {
	let api;
	let initial;
	let source;
	let eventId;
	let pageId;
	let subscriberId;
	let subscriberHeaders;
	const configurationIds = [];

	const create = async ( data = {} ) => {
		const res = await api.post( CONFIGURATIONS, {
			headers: adminHeaders,
			data: { type: 'instagram', ...data },
		} );
		expect( res.status() ).toBe( 201 );
		const configuration = await res.json();
		configurationIds.push( configuration.id );
		return configuration;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		initial = fixture( 'state' );
		fixture( 'feature on' );
		if ( ! initial.connected ) {
			fixture( 'connect' );
		}

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
		pageId = wpCli(
			`post create --post_type=page --post_status=publish --post_title="Agenda ${ Date.now() }" --post_content="Agenda" --porcelain`
		).match( /(\d+)\s*$/ )[ 1 ];

		const login = `instagram-2076-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: 'Test-password-2076!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ login }:Test-password-2076!` ).toString(
					'base64'
				),
		};
	} );

	test.afterAll( async () => {
		fixture( 'feature on' );
		for ( const id of configurationIds ) {
			fixture( `cleanup ${ id }` );
			await api.delete( `${ CONFIGURATIONS }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( ! initial.connected ) {
			fixture( 'disconnect' );
		}
		fixture( `feature ${ initial.feature ? 'on' : 'off' }` );
		runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			`cleanup ${ source.termId } ${ source.sourceId } ${ eventId }`
		);
		wpCli( `post delete ${ pageId } --force`, { allowFailure: true } );
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'only administrators manage Instagram notifications', async () => {
		const configuration = await create();
		const anon = await request.newContext( { baseURL: BASE_URL } );

		expect(
			(
				await anon.post( CONFIGURATIONS, {
					data: { type: 'instagram' },
				} )
			).status()
		).toBe( 401 );
		expect(
			(
				await api.post( CONFIGURATIONS, {
					headers: subscriberHeaders,
					data: { type: 'instagram' },
				} )
			).status()
		).toBe( 403 );
		expect(
			(
				await api.get(
					`${ CONFIGURATIONS }/${ configuration.id }/preview`,
					{ headers: subscriberHeaders }
				)
			).status()
		).toBe( 403 );
		await anon.dispose();
	} );

	test( 'starts paused and turns on only with a feed, a page and a connection', async () => {
		test.skip(
			initial.connected,
			'The site has an Instagram connection of its own.'
		);
		const configuration = await create( { name: 'Weekly post' } );
		expect( configuration.enabled ).toBe( false );
		expect( configuration.next_run ).toBeNull();
		expect( configuration.account ).toMatchObject( {
			usable: true,
			username: 'e2e_unified_club',
		} );
		expect( JSON.stringify( configuration ) ).not.toContain( TOKEN );

		const route = `${ CONFIGURATIONS }/${ configuration.id }`;
		const missing = await api.post( route, {
			headers: adminHeaders,
			data: { enabled: true },
		} );
		expect( missing.status() ).toBe( 400 );
		expect( ( await missing.json() ).code ).toBe( 'missing_source' );

		fixture( 'disconnect' );
		const disconnected = await api.post( route, {
			headers: adminHeaders,
			data: {
				enabled: true,
				source_slug: source.sourceSlug,
				page_id: Number( pageId ),
			},
		} );
		expect( disconnected.status() ).toBe( 400 );
		expect( ( await disconnected.json() ).code ).toBe(
			'instagram_not_connected'
		);
		fixture( 'connect' );

		const saved = await api.post( route, {
			headers: adminHeaders,
			data: {
				enabled: true,
				source_slug: source.sourceSlug,
				page_id: Number( pageId ),
				day_of_week: 3,
				time_of_day: '07:15',
				week_scope: 'next',
			},
		} );
		expect( saved.status() ).toBe( 200 );
		const body = await saved.json();
		expect( body ).toMatchObject( {
			enabled: true,
			day_of_week: 3,
			time_of_day: '07:15',
			week_scope: 'next',
		} );
		expect( body.next_run ).not.toBeNull();
	} );

	test( 'previews the image and caption without publishing or storing', async () => {
		test.skip(
			initial.connected,
			'The site has an Instagram connection of its own.'
		);
		const configuration = await create();
		const route = `${ CONFIGURATIONS }/${ configuration.id }`;
		await api.post( route, {
			headers: adminHeaders,
			data: {
				source_slug: source.sourceSlug,
				page_id: Number( pageId ),
			},
		} );
		const before = graphRequests();

		const res = await api.get( `${ route }/preview`, {
			headers: adminHeaders,
		} );

		expect( res.status() ).toBe( 200 );
		const preview = await res.json();
		expect( preview.occurrence_count ).toBe( 1 );
		expect( preview.image ).toMatch( /^data:image\/jpeg;base64,/ );
		expect( [ preview.width, preview.height ] ).toEqual( [ 1080, 1350 ] );
		expect( preview.caption ).toContain( 'E2E *Weekly*' );
		expect( graphRequests() ).toBe( before );
		expect( fixture( 'state' ).images ).toBe( initial.images );

		const testRes = await api.post( `${ route }/test`, {
			headers: adminHeaders,
		} );
		expect( testRes.status() ).toBe( 400 );
		expect( ( await testRes.json() ).code ).toBe( 'instagram_no_test' );
	} );

	test( 'keeps settings read-only while the Instagram feature is off', async () => {
		const configuration = await create( { name: 'Paused post' } );
		const route = `${ CONFIGURATIONS }/${ configuration.id }`;
		fixture( 'feature off' );

		const read = await api.get( route, { headers: adminHeaders } );
		expect( read.status() ).toBe( 200 );
		const payload = await read.json();
		expect( payload.state ).toBe( 'instagram_unavailable' );
		expect( payload.state_message ).toMatch( /Instagram feature is off/ );
		expect( payload.name ).toBe( 'Paused post' );

		const save = await api.post( route, {
			headers: adminHeaders,
			data: { time_of_day: '11:00' },
		} );
		expect( save.status() ).toBe( 409 );
		expect(
			(
				await api.get( `${ route }/preview`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 409 );
		expect(
			(
				await api.post( CONFIGURATIONS, {
					headers: adminHeaders,
					data: { type: 'instagram' },
				} )
			).status()
		).toBe( 409 );

		const types = (
			await ( await api.get( PATH, { headers: adminHeaders } ) ).json()
		).types;
		expect( types.instagram.state ).toBe( 'instagram_unavailable' );

		const removed = await api.delete( route, { headers: adminHeaders } );
		expect( removed.status() ).toBe( 200 );
		fixture( 'feature on' );
	} );
} );
