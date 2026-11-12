/**
 * Playwright API tests for the audience CSV export and import (#2218):
 * GET /fair-audience/v1/participants/export (optionally ?scope=subscribers) and
 * POST /fair-audience/v1/participants/import.
 *
 * Destination members are stored with
 * e2e/mu-plugins/scripts/audience-migration-fixture.php, which also runs the
 * pending-subscription timeout and cleans up. Feeds, subscriptions,
 * confirmation tokens and captured mail are set up and read with
 * e2e/mu-plugins/scripts/weekly-feeds-fixture.php.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const EXPORT = '/wp-json/fair-audience/v1/participants/export';
const IMPORT = '/wp-json/fair-audience/v1/participants/import';
const HEADER =
	'format_version,name,surname,email,phone,instagram,email_profile,weekly_summary_opt_out';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

// Awaited rather than blocking, so pooled sockets are not left to go stale
// while WP-CLI runs.
async function wpEval( script, marker, args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			`wp-content/mu-plugins/scripts/${ script }`,
			...args,
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( new RegExp( `${ marker }:(\\{.*\\}|null)` ) );
	if ( ! match ) {
		throw new Error( `Expected ${ marker } in output:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}
const migration = ( ...args ) =>
	wpEval( 'audience-migration-fixture.php', 'E2E_AUDIENCE_MIGRATION', args );
const feedsFixture = ( ...args ) =>
	wpEval( 'weekly-feeds-fixture.php', 'E2E_WEEKLY_FEEDS', args );

const csv = ( lines, header = HEADER ) =>
	[ header, ...lines ].join( '\r\n' ) + '\r\n';

test.describe( 'Audience CSV export and import', () => {
	test.describe.configure( { mode: 'serial' } );

	const suffix = `${ Date.now() }`;
	const emails = [];
	const email = ( label ) => {
		const address = `migration-${ label }-${ suffix }@example.test`;
		emails.push( address );
		return address;
	};
	let api;
	let feeds;
	let configurations;

	const upload = ( text, headers = adminHeaders, name = 'audience.csv' ) =>
		api.post( IMPORT, {
			headers,
			multipart: {
				file: {
					name,
					mimeType: 'text/csv',
					buffer: Buffer.from( text, 'utf8' ),
				},
			},
		} );
	const importCsv = async ( text ) => {
		const res = await upload( text );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	};
	const state = async ( address ) => feedsFixture( 'state', address );
	const member = ( address, profile, optOut, status = 'confirmed' ) =>
		migration(
			'member',
			address,
			'Ana',
			'Ruiz',
			profile,
			optOut ? '1' : '0',
			status
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		( { feeds, configurations } = await feedsFixture( 'seed', suffix ) );
	} );

	test.afterAll( async () => {
		await migration( 'cleanup', emails.join( ',' ) );
		if ( feeds ) {
			await feedsFixture(
				'cleanup',
				Object.values( feeds ).join( ',' ),
				Object.values( configurations ).join( ',' ),
				''
			);
		}
		await api.dispose();
	} );

	test( 'only administrators can export or import', async () => {
		expect( ( await api.get( EXPORT ) ).status() ).toBe( 401 );
		expect(
			( await api.get( `${ EXPORT }?scope=subscribers` ) ).status()
		).toBe( 401 );
		expect( ( await upload( csv( [] ), {} ) ).status() ).toBe( 401 );

		const username = `migration-subscriber-${ suffix }`;
		const password = 'Migration-test-2218!';
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'editor' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		const userId = ( await userRes.json() ).id;
		const editor = basicAuth( username, password );
		const address = email( 'forbidden' );

		try {
			expect(
				( await api.get( EXPORT, { headers: editor } ) ).status()
			).toBe( 403 );
			expect(
				(
					await api.get( `${ EXPORT }?scope=subscribers`, {
						headers: editor,
					} )
				).status()
			).toBe( 403 );
			expect(
				(
					await upload(
						csv( [ `1,Eve,Doe,${ address },,,minimal,0` ] ),
						editor
					)
				).status()
			).toBe( 403 );
			expect( ( await state( address ) ).participant ).toBeNull();
		} finally {
			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'export is private and imports elsewhere with details and preferences intact', async () => {
		const source = email( 'source' );
		await migration(
			'member',
			source,
			'Zoë',
			'O\'Neil, "Jr"',
			'marketing',
			'1',
			'confirmed'
		);
		await feedsFixture( 'choose', source, 'selected', `${ feeds.a }` );

		const res = await api.get( EXPORT, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		expect( res.headers()[ 'cache-control' ] ).toContain( 'no-store' );
		const body = await res.json();
		expect( body.filename ).toMatch(
			/^fair-audience-\d{4}-\d{2}-\d{2}\.csv$/
		);
		expect( body.content.startsWith( '﻿' + HEADER + '\r\n' ) ).toBe( true );
		const line = body.content
			.split( '\r\n' )
			.find( ( row ) => row.includes( source ) );
		expect( line ).toBe(
			`1,Zoë,"O'Neil, ""Jr""",${ source },,,marketing,1`
		);
		expect( body.content ).not.toMatch( /confirmed|pending/ );

		// The same row on another site: a different address stands in for an
		// empty destination.
		const destination = email( 'destination' );
		const result = await importCsv(
			csv( [
				line
					.replace( source, destination )
					.replace( ',,,', ",'+34 600 111 222,@zoe," ),
			] )
		);
		expect( result.imported ).toEqual( [
			{ line: 2, name: 'Zoë O\'Neil, "Jr"', email: destination },
		] );

		const { participant, token, mail } = await state( destination );
		expect( participant ).toMatchObject( {
			status: 'pending',
			email_profile: 'marketing',
			weekly_summary_opt_out: true,
			weekly_feed_mode: 'selected',
			feed_ids: [],
		} );
		expect( token ).toBeNull();
		expect( mail ).toEqual( [] );

		const reexport = await (
			await api.get( EXPORT, { headers: adminHeaders } )
		).json();
		expect( reexport.content ).toContain(
			`1,Zoë,"O'Neil, ""Jr""",${ destination },'+34 600 111 222,'@zoe,marketing,1`
		);

		// The source member is untouched.
		expect( ( await state( source ) ).participant ).toMatchObject( {
			status: 'confirmed',
			feed_ids: [ feeds.a ],
		} );
	} );

	test( 'subscriber-only export holds confirmed marketing members only', async () => {
		const subscriber = email( 'scope-subscriber' );
		const optedOut = email( 'scope-subscriber-opted-out' );
		const pending = email( 'scope-pending' );
		const minimal = email( 'scope-minimal' );
		const declined = email( 'scope-declined' );
		await member( subscriber, 'marketing', false );
		await member( optedOut, 'marketing', true );
		await member( pending, 'marketing', false, 'pending' );
		await member( minimal, 'minimal', false );
		await member( declined, 'declined', false );

		const exportScope = async ( query ) => {
			const res = await api.get( `${ EXPORT }${ query }`, {
				headers: adminHeaders,
			} );
			expect( res.status(), await res.text() ).toBe( 200 );
			expect( res.headers()[ 'cache-control' ] ).toContain( 'no-store' );
			const body = await res.json();
			const rows = body.content.split( '\r\n' ).filter( Boolean );
			// The header row plus one row per exported member.
			expect( rows ).toHaveLength( body.count + 1 );
			return body;
		};

		// Omitting the scope and asking for all both export everyone.
		for ( const query of [ '', '?scope=all' ] ) {
			const everyone = await exportScope( query );
			expect( everyone.scope ).toBe( 'all' );
			expect( everyone.filename ).toMatch(
				/^fair-audience-\d{4}-\d{2}-\d{2}\.csv$/
			);
			for ( const address of [
				subscriber,
				optedOut,
				pending,
				minimal,
				declined,
			] ) {
				expect( everyone.content ).toContain( address );
			}
		}

		const subscribers = await exportScope( '?scope=subscribers' );
		expect( subscribers.scope ).toBe( 'subscribers' );
		expect( subscribers.filename ).toMatch(
			/^fair-audience-subscribers-\d{4}-\d{2}-\d{2}\.csv$/
		);
		expect( subscribers.content.startsWith( '\uFEFF' + HEADER ) ).toBe(
			true
		);
		// The weekly summary opt-out does not decide who is a subscriber.
		expect( subscribers.content ).toContain(
			`1,Ana,Ruiz,${ subscriber },,,marketing,0`
		);
		expect( subscribers.content ).toContain(
			`1,Ana,Ruiz,${ optedOut },,,marketing,1`
		);
		for ( const address of [ pending, minimal, declined ] ) {
			expect( subscribers.content ).not.toContain( address );
		}
		expect( subscribers.count ).toBeLessThan(
			( await exportScope( '' ) ).count
		);

		for ( const scope of [ 'mailing', 'SUBSCRIBERS', '' ] ) {
			const res = await api.get(
				`${ EXPORT }?scope=${ encodeURIComponent( scope ) }`,
				{ headers: adminHeaders }
			);
			expect( res.status(), scope ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'rest_invalid_param' );
		}
	} );

	test( 'legacy feed modes create no subscriptions and grant no consent', async () => {
		const all = email( 'legacy-all' );
		const selected = email( 'legacy-selected' );
		const result = await importCsv(
			csv(
				[
					`1,All,Mode,${ all },,,minimal,0,all`,
					`1,Selected,Mode,${ selected },,,marketing,0,selected`,
				],
				`${ HEADER },weekly_feed_mode`
			)
		);
		expect( result.imported ).toHaveLength( 2 );

		for ( const [ address, profile ] of [
			[ all, 'minimal' ],
			[ selected, 'marketing' ],
		] ) {
			const { participant } = await state( address );
			expect( participant ).toMatchObject( {
				email_profile: profile,
				weekly_feed_mode: 'selected',
				feed_ids: [],
				status: 'pending',
			} );
		}
	} );

	test( 'identical members are already present and keep their subscriptions', async () => {
		const address = email( 'identical' );
		await member( address, 'marketing', false );
		await feedsFixture( 'choose', address, 'selected', `${ feeds.b }` );

		const file = csv(
			[ `1,Ana,Ruiz,${ address.toUpperCase() },,,marketing,0,all` ],
			`${ HEADER },weekly_feed_mode`
		);
		for ( let attempt = 0; attempt < 2; attempt++ ) {
			const result = await importCsv( file );
			expect( result.imported ).toEqual( [] );
			expect( result.already_present ).toEqual( [
				{ line: 2, name: 'Ana Ruiz', email: address },
			] );
		}

		expect( ( await state( address ) ).participant ).toMatchObject( {
			status: 'confirmed',
			email_profile: 'marketing',
			feed_ids: [ feeds.b ],
		} );
	} );

	test( 'opt-out disagreements in both directions are conflicts that change nothing', async () => {
		const optedInHere = email( 'opted-in-here' );
		const optedOutHere = email( 'opted-out-here' );
		await member( optedInHere, 'marketing', false );
		await member( optedOutHere, 'declined', true );
		await feedsFixture( 'choose', optedInHere, 'selected', `${ feeds.a }` );

		const result = await importCsv(
			csv( [
				`1,Ana,Ruiz,${ optedInHere },,,minimal,1`,
				`1,Ana,Ruiz,${ optedOutHere },,,marketing,0`,
			] )
		);

		expect( result.imported ).toEqual( [] );
		expect( result.conflicts ).toEqual( [
			{
				line: 2,
				name: 'Ana Ruiz',
				email: optedInHere,
				fields: [ 'email_profile', 'weekly_summary_opt_out' ],
				untransferred_opt_out: [
					'email_profile',
					'weekly_summary_opt_out',
				],
			},
			{
				line: 3,
				name: 'Ana Ruiz',
				email: optedOutHere,
				fields: [ 'email_profile', 'weekly_summary_opt_out' ],
				untransferred_opt_out: [],
			},
		] );
		expect( ( await state( optedInHere ) ).participant ).toMatchObject( {
			email_profile: 'marketing',
			weekly_summary_opt_out: false,
			feed_ids: [ feeds.a ],
		} );
		expect( ( await state( optedOutHere ) ).participant ).toMatchObject( {
			email_profile: 'declined',
			weekly_summary_opt_out: true,
		} );
	} );

	test( 'rows without email, invalid rows and repeated rows are reported', async () => {
		const repeated = email( 'repeated' );
		const result = await importCsv(
			csv( [
				'1,Li,Wei,,,,minimal,0',
				`1,Bo,Li,${ email( 'invalid' ) },,,subscribed,yes`,
				`1,Rep,Eated,${ repeated },,,minimal,0`,
				`1,Rep,Eated,${ repeated },,,minimal,0`,
			] )
		);

		expect( result.total ).toBe( 4 );
		expect( result.missing_email ).toEqual( [
			{ line: 2, name: 'Li Wei', email: '' },
		] );
		expect( result.invalid ).toHaveLength( 1 );
		expect( result.invalid[ 0 ].line ).toBe( 3 );
		expect( result.invalid[ 0 ].errors.map( ( e ) => e.field ) ).toEqual( [
			'email_profile',
		] );
		expect( result.imported.map( ( row ) => row.line ) ).toEqual( [ 4 ] );
		expect( result.already_present.map( ( row ) => row.line ) ).toEqual( [
			5,
		] );
		expect( result.failed ).toEqual( [] );
	} );

	test( 'structurally invalid files are rejected without changes', async () => {
		const untouched = email( 'untouched' );
		const valid = `1,Un,Touched,${ untouched },,,minimal,0`;

		const cases = [
			[ csv( [ valid ], `${ HEADER },feeds` ), 'unsupported_columns' ],
			[
				csv( [ valid ], 'format_version,name,email' ),
				'missing_columns',
			],
			[ csv( [ valid ], `${ HEADER },name` ), 'duplicate_columns' ],
			[
				csv( [ valid, '1,"Broken,,x@example.test,,,minimal,0' ] ),
				'malformed_csv',
			],
			[ csv( [ valid, '1,Short' ] ), 'malformed_csv' ],
			[ csv( [ valid.replace( /^1/, '2' ) ] ), 'unsupported_version' ],
			[ HEADER + '\r\n', 'empty_file' ],
		];
		for ( const [ text, code ] of cases ) {
			const res = await upload( text );
			expect( res.status(), code ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( code );
		}

		const latin1 = await api.post( IMPORT, {
			headers: adminHeaders,
			multipart: {
				file: {
					name: 'audience.csv',
					mimeType: 'text/csv',
					buffer: Buffer.from(
						csv( [ valid.replace( 'Un', 'Ün' ) ] ),
						'latin1'
					),
				},
			},
		} );
		expect( ( await latin1.json() ).code ).toBe( 'invalid_encoding' );

		const wrongType = await upload(
			csv( [ valid ] ),
			adminHeaders,
			'audience.xlsx'
		);
		expect( ( await wrongType.json() ).code ).toBe( 'invalid_file_type' );

		const noFile = await api.post( IMPORT, { headers: adminHeaders } );
		expect( noFile.status() ).toBe( 400 );
		expect( ( await noFile.json() ).code ).toBe( 'no_file' );

		expect( ( await state( untouched ) ).participant ).toBeNull();
	} );

	test( 'the pending timeout leaves imported marketing preferences alone', async () => {
		const imported = email( 'timeout-imported' );
		const signup = email( 'timeout-signup' );
		await importCsv( csv( [ `1,Imp,Orted,${ imported },,,marketing,0` ] ) );
		await member( signup, 'marketing', false, 'pending' );

		expect( await migration( 'sweep', imported ) ).toEqual( {
			email_profile: 'marketing',
			status: 'pending',
		} );
		// An unconfirmed signup is still reverted, as before.
		expect( await migration( 'sweep', signup ) ).toEqual( {
			email_profile: 'minimal',
			status: 'confirmed',
		} );
	} );
} );
