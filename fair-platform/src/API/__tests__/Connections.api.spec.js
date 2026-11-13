/**
 * Connection administration API (#2230): the ordinary (Mollie) and
 * Instagram connection logs share listing, statistics and cleanup
 * behavior, while each keeps its own table, status values, statistics and
 * wording.
 *
 * Rows come from e2e/mu-plugins/scripts/platform-connections.php, which
 * empties both connection tables before seeding.
 */
import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const admin = basic( ADMIN_USER, ADMIN_PASSWORD );

// Non-blocking, so idle keep-alive sockets are not closed under a long
// synchronous fixture run ("socket hang up").
async function fixture( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/platform-connections.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( /E2E_PLATFORM_CONNECTIONS:(.*)$/m );
	if ( ! match ) {
		throw new Error(
			`Expected platform connections output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

const SHARED_FIELDS = [
	'id',
	'site_id',
	'site_name',
	'site_url',
	'status',
	'error_code',
	'error_message',
	'scope_granted',
	'connected_at',
	'last_token_refresh',
	'ip_address',
	'user_agent',
];

const TYPES = {
	ordinary: {
		route: '/wp-json/fair-platform/v1/connections',
		statuses: [ 'connected', 'failed', 'disconnected' ],
		fields: [
			...SHARED_FIELDS,
			'mollie_organization_id',
			'mollie_profile_id',
			'profile_created',
		],
		forbidden: 'You do not have permission to view connection logs.',
		cleanupMessage: ( count ) => `Deleted ${ count } old connection logs.`,
	},
	instagram: {
		route: '/wp-json/fair-platform/v1/instagram-connections',
		statuses: [ 'connected', 'failed' ],
		fields: [ ...SHARED_FIELDS, 'instagram_user_id', 'instagram_username' ],
		forbidden:
			'You do not have permission to view Instagram connection logs.',
		cleanupMessage: ( count ) =>
			`Deleted ${ count } old Instagram connection logs.`,
	},
};

// Newest first by connected_at; the last row of each table is past the
// default 90-day retention.
const SEED = {
	ordinary: [
		{
			site_id: 'site-a',
			site_name: 'Alpha',
			site_url: 'https://alpha.example.test',
			mollie_organization_id: 'org_1',
			mollie_profile_id: 'pfl_1',
			status: 'connected',
			scope_granted: 'payments.read',
			profile_created: true,
			daysAgo: 1,
		},
		{
			site_id: 'site-b',
			site_name: 'Bravo',
			mollie_organization_id: 'org_1',
			status: 'failed',
			error_code: 'access_denied',
			error_message: 'Denied',
			daysAgo: 5,
		},
		{
			site_id: 'site-c',
			site_name: 'Charlie',
			mollie_organization_id: 'org_2',
			status: 'disconnected',
			daysAgo: 10,
		},
		{
			site_id: 'site-a',
			site_name: 'Delta',
			mollie_organization_id: 'org_3',
			status: 'connected',
			daysAgo: 200,
		},
	],
	instagram: [
		{
			site_id: 'site-a',
			site_name: 'Alpha',
			instagram_user_id: 'ig_1',
			instagram_username: 'alpha_ig',
			status: 'connected',
			daysAgo: 1,
		},
		{
			site_id: 'site-b',
			site_name: 'Bravo',
			instagram_user_id: 'ig_2',
			instagram_username: 'bravo_ig',
			status: 'failed',
			error_code: 'oauth_error',
			daysAgo: 10,
		},
		{
			site_id: 'site-c',
			site_name: 'Charlie',
			instagram_user_id: 'ig_3',
			instagram_username: 'alpha_ig',
			status: 'connected',
			daysAgo: 150,
		},
	],
};

const STATS = {
	ordinary: {
		total_connections: '4',
		successful: '2',
		failed: '1',
		profiles_created: '1',
		unique_sites: '3',
		unique_organizations: '3',
	},
	instagram: {
		total_connections: '3',
		successful: '2',
		failed: '1',
		unique_sites: '3',
		unique_usernames: '2',
	},
};

const EMPTY_STATS = {
	ordinary: {
		total_connections: '0',
		successful: null,
		failed: null,
		profiles_created: null,
		unique_sites: '0',
		unique_organizations: '0',
	},
	instagram: {
		total_connections: '0',
		successful: null,
		failed: null,
		unique_sites: '0',
		unique_usernames: '0',
	},
};

test.describe.serial( 'Connection administration API', () => {
	let api;
	let ids;
	const users = [];

	const createUser = async ( role ) => {
		const suffix = `${ Date.now() }${ Math.floor( Math.random() * 1000 ) }`;
		const password = `pw-${ suffix }-Aa1!`;
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: admin,
			data: {
				username: `e2e_platform_${ role }_${ suffix }`,
				email: `e2e_platform_${ role }_${ suffix }@example.test`,
				password,
				roles: [ role ],
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const user = await res.json();
		users.push( user.id );
		return basic( user.username, password );
	};

	const seed = async () => {
		ids = await fixture( 'seed', SEED );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await fixture( 'clear' );
		for ( const id of users ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: admin }
			);
		}
		await api.dispose();
	} );

	test( 'every route requires manage_options', async () => {
		await seed();
		const subscriber = await createUser( 'subscriber' );
		const editor = await createUser( 'editor' );

		for ( const type of Object.values( TYPES ) ) {
			const calls = [
				( headers ) => api.get( type.route, { headers } ),
				( headers ) => api.get( `${ type.route }/stats`, { headers } ),
				( headers ) =>
					api.delete( `${ type.route }/cleanup?days=0`, {
						headers,
					} ),
			];
			for ( const call of calls ) {
				for ( const headers of [ {}, subscriber, editor ] ) {
					const res = await call( headers );
					expect( res.status() ).toBe( 403 );
					expect( await res.json() ).toEqual( {
						code: 'rest_forbidden',
						message: type.forbidden,
						data: { status: 403 },
					} );
				}
			}
		}

		// The refused cleanups deleted nothing.
		const rows = await fixture( 'rows' );
		expect( rows.ordinary ).toHaveLength( SEED.ordinary.length );
		expect( rows.instagram ).toHaveLength( SEED.instagram.length );
	} );

	for ( const [ name, type ] of Object.entries( TYPES ) ) {
		test.describe( `${ name } connections`, () => {
			test( 'lists newest first with the default page', async () => {
				await seed();
				const res = await api.get( type.route, { headers: admin } );
				expect( res.status() ).toBe( 200 );
				const body = await res.json();

				expect( Object.keys( body ).sort() ).toEqual(
					[
						'items',
						'page',
						'per_page',
						'total',
						'total_pages',
					].sort()
				);
				expect( body ).toMatchObject( {
					total: SEED[ name ].length,
					page: 1,
					per_page: 50,
					total_pages: 1,
				} );
				expect( body.items.map( ( item ) => item.id ) ).toEqual(
					ids[ name ].map( String )
				);
				// Connection-specific fields only; nothing else, no secrets.
				for ( const item of body.items ) {
					expect( Object.keys( item ).sort() ).toEqual(
						[ ...type.fields ].sort()
					);
				}
				expect( body.items[ 0 ] ).toMatchObject( {
					site_id: 'site-a',
					site_name: 'Alpha',
					status: 'connected',
				} );
			} );

			test( 'keeps connection-specific values', async () => {
				await seed();
				const body = await (
					await api.get( type.route, { headers: admin } )
				).json();
				const [ first, second ] = body.items;
				if ( name === 'ordinary' ) {
					expect( first ).toMatchObject( {
						mollie_organization_id: 'org_1',
						mollie_profile_id: 'pfl_1',
						profile_created: '1',
						site_url: 'https://alpha.example.test',
						scope_granted: 'payments.read',
						error_code: null,
						last_token_refresh: null,
					} );
					expect( second ).toMatchObject( {
						error_code: 'access_denied',
						error_message: 'Denied',
						profile_created: '0',
					} );
				} else {
					expect( first ).toMatchObject( {
						instagram_user_id: 'ig_1',
						instagram_username: 'alpha_ig',
						error_code: null,
					} );
					expect( second ).toMatchObject( {
						error_code: 'oauth_error',
					} );
				}
			} );

			test( 'filters by each supported status', async () => {
				await seed();
				for ( const status of type.statuses ) {
					const body = await (
						await api.get( `${ type.route }?status=${ status }`, {
							headers: admin,
						} )
					).json();
					const expected = SEED[ name ].filter(
						( row ) => row.status === status
					).length;
					expect( body.total ).toBe( expected );
					expect( body.items ).toHaveLength( expected );
					for ( const item of body.items ) {
						expect( item.status ).toBe( status );
					}
				}
			} );

			test( 'orders and paginates', async () => {
				await seed();
				const byName = await (
					await api.get(
						`${ type.route }?orderby=site_name&order=ASC`,
						{ headers: admin }
					)
				).json();
				expect(
					byName.items.map( ( item ) => item.site_name )
				).toEqual(
					SEED[ name ].map( ( row ) => row.site_name ).sort()
				);

				const byId = await (
					await api.get( `${ type.route }?orderby=id&order=ASC`, {
						headers: admin,
					} )
				).json();
				expect( byId.items.map( ( item ) => item.id ) ).toEqual(
					[ ...ids[ name ] ].sort( ( a, b ) => a - b ).map( String )
				);

				const page = await (
					await api.get( `${ type.route }?per_page=2&page=2`, {
						headers: admin,
					} )
				).json();
				expect( page ).toMatchObject( {
					total: SEED[ name ].length,
					page: 2,
					per_page: 2,
					total_pages: 2,
				} );
				expect( page.items.map( ( item ) => item.id ) ).toEqual(
					ids[ name ].slice( 2, 4 ).map( String )
				);

				const beyond = await (
					await api.get( `${ type.route }?per_page=2&page=5`, {
						headers: admin,
					} )
				).json();
				expect( beyond.items ).toEqual( [] );
				expect( beyond.total ).toBe( SEED[ name ].length );
			} );

			// The arguments advertise their enums, but a custom
			// sanitize_callback without a validate_callback means WordPress
			// never enforces them: unsupported values fall back in the
			// repository. Pinned as-is (#2230 preserves validation).
			test( 'falls back on unsupported parameters', async () => {
				await seed();
				const list = async ( query ) => {
					const res = await api.get( `${ type.route }?${ query }`, {
						headers: admin,
					} );
					expect( res.status(), query ).toBe( 200 );
					return res.json();
				};
				const newestFirst = ids[ name ].map( String );

				expect( await list( 'status=pending' ) ).toMatchObject( {
					items: [],
					total: 0,
				} );
				expect( ( await list( 'status=disconnected' ) ).total ).toBe(
					name === 'ordinary' ? 1 : 0
				);
				expect(
					( await list( 'orderby=ip_address' ) ).items.map(
						( item ) => item.id
					)
				).toEqual( newestFirst );
				expect(
					( await list( 'order=asc' ) ).items.map(
						( item ) => item.id
					)
				).toEqual( [ ...newestFirst ].reverse() );
				expect(
					( await list( 'order=sideways' ) ).items.map(
						( item ) => item.id
					)
				).toEqual( newestFirst );
				expect( await list( 'page=abc' ) ).toEqual( {
					items: [],
					total: SEED[ name ].length,
					page: 0,
					per_page: 50,
					total_pages: 1,
				} );

				// A non-numeric retention is read as zero days.
				const cleanup = await api.delete(
					`${ type.route }/cleanup?days=soon`,
					{ headers: admin }
				);
				expect( await cleanup.json() ).toEqual( {
					deleted: SEED[ name ].length,
					message: type.cleanupMessage( SEED[ name ].length ),
				} );
			} );

			test( 'advertises its arguments and supported statuses', async () => {
				const index = await (
					await api.get( '/wp-json/fair-platform/v1', {
						headers: admin,
					} )
				).json();
				const path = type.route.replace( '/wp-json', '' );
				const endpoints = ( route ) =>
					index.routes[ route ].endpoints.map( ( endpoint ) => ( {
						methods: endpoint.methods,
						args: endpoint.args,
					} ) );

				expect( endpoints( path ) ).toEqual( [
					{
						methods: [ 'GET' ],
						args: {
							page: {
								description: 'Page number.',
								type: 'integer',
								default: 1,
								required: false,
							},
							per_page: {
								description: 'Items per page.',
								type: 'integer',
								default: 50,
								required: false,
							},
							status: {
								description: 'Filter by status.',
								type: 'string',
								enum: type.statuses,
								required: false,
							},
							orderby: {
								description: 'Order by field.',
								type: 'string',
								default: 'connected_at',
								enum: [
									'id',
									'site_name',
									'status',
									'connected_at',
								],
								required: false,
							},
							order: {
								description: 'Order direction.',
								type: 'string',
								default: 'DESC',
								enum: [ 'ASC', 'DESC' ],
								required: false,
							},
						},
					},
				] );
				expect( endpoints( `${ path }/stats` ) ).toEqual( [
					{ methods: [ 'GET' ], args: [] },
				] );
				expect( endpoints( `${ path }/cleanup` ) ).toEqual( [
					{
						methods: [ 'DELETE' ],
						args: {
							days: {
								description: 'Delete logs older than X days.',
								type: 'integer',
								default: 90,
								required: false,
							},
						},
					},
				] );
			} );

			test( 'reports statistics, including when empty', async () => {
				await seed();
				const res = await api.get( `${ type.route }/stats`, {
					headers: admin,
				} );
				expect( res.status() ).toBe( 200 );
				const stats = await res.json();
				expect( stats ).toEqual( STATS[ name ] );
				expect( Object.keys( stats ) ).toEqual(
					Object.keys( STATS[ name ] )
				);

				await fixture( 'clear' );
				const empty = await (
					await api.get( `${ type.route }/stats`, { headers: admin } )
				).json();
				expect( empty ).toEqual( EMPTY_STATS[ name ] );

				const list = await (
					await api.get( type.route, { headers: admin } )
				).json();
				expect( list ).toEqual( {
					items: [],
					total: 0,
					page: 1,
					per_page: 50,
					total_pages: 0,
				} );
			} );

			test( 'cleans up only its own old logs', async () => {
				await seed();
				const other = name === 'ordinary' ? 'instagram' : 'ordinary';
				const before = await fixture( 'rows' );

				const res = await api.delete( `${ type.route }/cleanup`, {
					headers: admin,
				} );
				expect( res.status() ).toBe( 200 );
				expect( await res.json() ).toEqual( {
					deleted: 1,
					message: type.cleanupMessage( 1 ),
				} );

				const after = await fixture( 'rows' );
				expect( after[ other ] ).toEqual( before[ other ] );
				expect( after[ name ].map( ( row ) => row.id ) ).toEqual(
					before[ name ].slice( 0, -1 ).map( ( row ) => row.id )
				);

				// Nothing older than the default retention remains.
				expect(
					await (
						await api.delete( `${ type.route }/cleanup`, {
							headers: admin,
						} )
					).json()
				).toEqual( { deleted: 0, message: type.cleanupMessage( 0 ) } );

				// A shorter retention removes the remaining older rows.
				expect(
					await (
						await api.delete( `${ type.route }/cleanup?days=7`, {
							headers: admin,
						} )
					).json()
				).toEqual( { deleted: 1, message: type.cleanupMessage( 1 ) } );
				const final = await fixture( 'rows' );
				expect( final[ other ] ).toEqual( before[ other ] );
			} );
		} );
	}

	test( 'repository filters by site and records token refreshes per table', async () => {
		await seed();

		const ordinary = await fixture( 'site-filter', {
			type: 'ordinary',
			siteId: 'site-a',
		} );
		expect( ordinary ).toMatchObject( { total: 2, total_pages: 1 } );
		expect( ordinary.items.map( ( item ) => item.site_name ) ).toEqual( [
			'Alpha',
			'Delta',
		] );
		const instagram = await fixture( 'site-filter', {
			type: 'instagram',
			siteId: 'site-a',
		} );
		expect( instagram.items.map( ( item ) => item.site_name ) ).toEqual( [
			'Alpha',
		] );

		expect(
			await fixture( 'token-refresh', {
				type: 'ordinary',
				siteId: 'site-a',
			} )
		).toEqual( { updated: true } );
		expect(
			await fixture( 'token-refresh', {
				type: 'ordinary',
				siteId: 'unknown-site',
			} )
		).toEqual( { updated: false } );

		const rows = await fixture( 'rows' );
		for ( const row of rows.ordinary ) {
			if ( row.site_id === 'site-a' ) {
				expect( row.last_token_refresh ).not.toBeNull();
			} else {
				expect( row.last_token_refresh ).toBeNull();
			}
		}
		for ( const row of rows.instagram ) {
			expect( row.last_token_refresh ).toBeNull();
		}

		expect(
			await fixture( 'token-refresh', {
				type: 'instagram',
				siteId: 'site-b',
			} )
		).toEqual( { updated: true } );
		const afterInstagram = await fixture( 'rows' );
		expect(
			afterInstagram.instagram.map( ( row ) =>
				row.last_token_refresh === null ? row.site_id : 'refreshed'
			)
		).toEqual( [ 'site-a', 'refreshed', 'site-c' ] );
		expect( afterInstagram.ordinary ).toEqual( rows.ordinary );
	} );
} );
