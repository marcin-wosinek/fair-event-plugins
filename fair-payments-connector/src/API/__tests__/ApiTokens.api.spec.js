/**
 * API tokens and the data sharing API served by Fair Payments Connector
 * (#1747): token administration, the token-authenticated external endpoints,
 * tokens created before the move — including ones that still carry the retired
 * `locations:read` scope — and single ownership of the routes.
 *
 * Release pairings (#2080) run every request of a test as one mix of Fair
 * Payments Connector and Experimental releases, in either load order and
 * with an older copy of the shared package winning the autoload race.
 *
 * Fixture routes live in e2e/mu-plugins/fair-e2e-support.php; release
 * pairings in e2e/mu-plugins/fair-e2e-api-token-releases.php.
 */
import { createHash } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const bearer = ( token ) => ( { Authorization: `Bearer ${ token }` } );

const admin = basic( ADMIN_USER, ADMIN_PASSWORD );

const TOKENS = '/wp-json/fair-payments-connector/v1/admin/api-tokens';
const ME = '/wp-json/fair-payments-connector/v1/external/me';
const TRANSACTIONS =
	'/wp-json/fair-payments-connector/v1/external/transactions';
const FIXTURES = '/wp-json/fair-e2e/v1/api-tokens';
const OWNERS = '/wp-json/fair-e2e/v1/api-token-owners';
const IMPORT = '/wp-json/fair-payments-connector/v1/transactions/import';
const TX_HELPERS = '/wp-json/fair-e2e/v1/external-updates';
const RELEASES = '/wp-json/fair-e2e/v1/api-token-releases';

const TOKEN_ROUTES = {
	'/fair-payments-connector/v1/admin/api-tokens': [
		'GET ApiTokensController',
		'POST ApiTokensController',
	],
	'/fair-payments-connector/v1/admin/api-tokens/(?P<id>\\d+)': [
		'DELETE ApiTokensController',
	],
	'/fair-payments-connector/v1/external/me': [ 'GET ExternalMeController' ],
	'/fair-payments-connector/v1/external/transactions': [
		'GET ExternalTransactionsController',
	],
};

// Which plugin serves API tokens for each pairing, and what loads.
const PAIRINGS = {
	'core-only': {
		owner: 'FairPaymentsConnector',
		loaded: [ 'core' ],
	},
	'both-updated': {
		owner: 'FairPaymentsConnector',
		loaded: [ 'core', 'experimental' ],
	},
	'core-old-experimental': {
		owner: 'FairPaymentsConnectorExperimental',
		loaded: [ 'core', 'experimental (pre-handoff)' ],
	},
	'old-core-experimental': {
		owner: 'FairPaymentsConnectorExperimental',
		loaded: [ 'core (pre-token)', 'experimental' ],
	},
};

const NEW_SHARED_CLASSES = [
	'FairEventsShared\\API\\AbstractApiTokensController',
	'FairEventsShared\\API\\AbstractExternalMeController',
	'FairEventsShared\\API\\AbstractExternalTransactionsController',
	'FairEventsShared\\ApiTokens\\AbstractApiToken',
	'FairEventsShared\\ApiTokens\\AbstractApiTokenAuth',
];

const releaseHeaders = ( releases, order, oldShared ) => ( {
	'X-Fair-E2E-Payments-Releases': releases,
	'X-Fair-E2E-Plugin-Order': order,
	...( oldShared ? { 'X-Fair-E2E-Old-Shared-First': '1' } : {} ),
} );

// Every token route's handlers, as "METHOD Class", in registration order.
const routeHandlers = ( owners ) =>
	Object.fromEntries(
		Object.entries( owners ).map( ( [ route, handlers ] ) => [
			route,
			handlers.map(
				( handler ) =>
					`${ handler.methods.sort().join( '|' ) } ${ handler.class }`
			),
		] )
	);

const TOKEN_FIELDS = [
	'created_at',
	'id',
	'label',
	'last_used_at',
	'scopes',
	'status',
];
const TRANSACTION_FIELDS = [
	'amount',
	'application_fee',
	'created_at',
	'currency',
	'description',
	'event_date_id',
	'event_url',
	'id',
	'mollie_fee',
	'mollie_payment_id',
	'status',
	'testmode',
];

test.describe( 'API tokens in Fair Payments Connector (#1747)', () => {
	let api;
	const tokenIds = [];
	const users = [];

	const label = ( name ) => `E2E ${ name } ${ Date.now() }`;

	const createToken = async ( data, headers = admin ) =>
		api.post( TOKENS, { headers, data } );

	const createdToken = async ( name ) => {
		const res = await createToken( {
			label: label( name ),
			scopes: [ 'transactions:read' ],
		} );
		expect( res.status(), await res.text() ).toBe( 201 );
		const token = await res.json();
		tokenIds.push( token.id );
		return token;
	};

	// A row exactly as an older release stored it.
	const legacyToken = async ( name, scopes ) => {
		const res = await api.post( FIXTURES, {
			headers: admin,
			data: { label: label( name ), scopes },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const token = await res.json();
		tokenIds.push( token.id );
		return token;
	};

	const storedRow = async ( id ) =>
		(
			await api.get( `${ FIXTURES }?id=${ id }`, { headers: admin } )
		).json();

	const createUser = async ( role ) => {
		const suffix = `${ Date.now() }${ Math.floor( Math.random() * 1000 ) }`;
		const password = `pw-${ suffix }-Aa1!`;
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: admin,
			data: {
				username: `e2e_${ role }_${ suffix }`,
				email: `e2e_${ role }_${ suffix }@example.test`,
				password,
				roles: [ role ],
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const user = await res.json();
		users.push( user.id );
		return basic( user.username, password );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await api.delete( `${ TX_HELPERS }/transactions?prefix=tr_e2etok`, {
			headers: admin,
		} );
	} );

	test.afterAll( async () => {
		for ( const id of tokenIds ) {
			await api.delete( `${ FIXTURES }?id=${ id }`, { headers: admin } );
		}
		for ( const id of users ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: admin }
			);
		}
		await api.delete( `${ TX_HELPERS }/transactions?prefix=tr_e2etok`, {
			headers: admin,
		} );
		await api.dispose();
	} );

	test.describe( 'ownership', () => {
		test( 'each token route is registered once, by Fair Payments Connector', async () => {
			const res = await api.get( OWNERS, { headers: admin } );
			expect( res.ok(), await res.text() ).toBeTruthy();
			const owners = await res.json();

			const handlers = ( route ) =>
				( owners[ route ] || [] ).map(
					( handler ) =>
						`${ handler.methods.sort().join( '|' ) } ${
							handler.class
						}`
				);

			expect(
				handlers( '/fair-payments-connector/v1/admin/api-tokens' )
			).toEqual( [
				'GET FairPaymentsConnector\\API\\ApiTokensController',
				'POST FairPaymentsConnector\\API\\ApiTokensController',
			] );
			expect(
				handlers(
					'/fair-payments-connector/v1/admin/api-tokens/(?P<id>\\d+)'
				)
			).toEqual( [
				'DELETE FairPaymentsConnector\\API\\ApiTokensController',
			] );
			expect(
				handlers( '/fair-payments-connector/v1/external/me' )
			).toEqual( [
				'GET FairPaymentsConnector\\API\\ExternalMeController',
			] );
			expect(
				handlers( '/fair-payments-connector/v1/external/transactions' )
			).toEqual( [
				'GET FairPaymentsConnector\\API\\ExternalTransactionsController',
			] );
		} );
	} );

	test.describe( 'token administration', () => {
		test( 'requires an administrator', async () => {
			const anonymous = await api.get( TOKENS );
			expect( anonymous.status() ).toBe( 401 );
			expect(
				(
					await createToken(
						{ label: 'x', scopes: [ 'transactions:read' ] },
						{}
					)
				).status()
			).toBe( 401 );
			expect( ( await api.delete( `${ TOKENS }/1` ) ).status() ).toBe(
				401
			);

			const subscriber = await createUser( 'subscriber' );
			expect(
				( await api.get( TOKENS, { headers: subscriber } ) ).status()
			).toBe( 403 );
			expect(
				(
					await createToken(
						{ label: 'x', scopes: [ 'transactions:read' ] },
						subscriber
					)
				).status()
			).toBe( 403 );
			expect(
				(
					await api.delete( `${ TOKENS }/1`, { headers: subscriber } )
				).status()
			).toBe( 403 );

			// A bearer token is not an admin credential.
			const token = await createdToken( 'not admin' );
			expect(
				(
					await api.get( TOKENS, { headers: bearer( token.token ) } )
				).status()
			).toBe( 401 );
		} );

		test( 'creates a token, shows its plaintext once and stores only a hash', async () => {
			const token = await createdToken( 'create' );

			expect( Object.keys( token ).sort() ).toEqual(
				[ ...TOKEN_FIELDS, 'token' ].sort()
			);
			expect( token.token ).toMatch( /^[A-Za-z0-9]{40}$/ );
			expect( token.scopes ).toEqual( [ 'transactions:read' ] );
			expect( token.status ).toBe( 'active' );
			expect( token.last_used_at ).toBeNull();

			// Never returned again.
			const listed = await api.get( TOKENS, { headers: admin } );
			expect( listed.status() ).toBe( 200 );
			const listText = await listed.text();
			expect( listText ).not.toContain( token.token );
			expect( listText ).not.toContain( 'token_hash' );
			const row = JSON.parse( listText ).find(
				( item ) => item.id === token.id
			);
			expect( Object.keys( row ).sort() ).toEqual( TOKEN_FIELDS );

			// Stored as a SHA-256 hash, never as plaintext.
			const stored = await storedRow( token.id );
			expect( stored.token_hash ).toMatch( /^[a-f0-9]{64}$/ );
			expect( JSON.stringify( stored ) ).not.toContain( token.token );
		} );

		test( 'rejects a missing or blank label and missing scopes', async () => {
			const cases = [
				{ scopes: [ 'transactions:read' ] },
				{ label: '   ', scopes: [ 'transactions:read' ] },
				{ label: 'No scopes' },
				{ label: 'Empty scopes', scopes: [] },
			];

			for ( const data of cases ) {
				const res = await createToken( data );
				expect( res.status(), JSON.stringify( data ) ).toBe( 400 );
			}
		} );

		test( 'rejects locations:read instead of granting part of the request', async () => {
			const before = await (
				await api.get( TOKENS, { headers: admin } )
			).json();

			for ( const scopes of [
				[ 'locations:read' ],
				[ 'transactions:read', 'locations:read' ],
				[ 'transactions:read', 'everything' ],
			] ) {
				const res = await createToken( {
					label: label( 'unsupported' ),
					scopes,
				} );
				expect( res.status(), scopes.join( ',' ) ).toBe( 400 );
				expect( ( await res.json() ).code ).toBe(
					'rest_invalid_param'
				);
			}

			const after = await (
				await api.get( TOKENS, { headers: admin } )
			).json();
			expect( after.length ).toBe( before.length );
		} );

		test( 'revokes a token and reports an unknown one', async () => {
			const token = await createdToken( 'revoke' );

			const revoked = await api.delete( `${ TOKENS }/${ token.id }`, {
				headers: admin,
			} );
			expect( revoked.status() ).toBe( 200 );
			const body = await revoked.json();
			expect( Object.keys( body ).sort() ).toEqual( TOKEN_FIELDS );
			expect( body.status ).toBe( 'revoked' );

			const listed = await (
				await api.get( TOKENS, { headers: admin } )
			).json();
			expect(
				listed.find( ( item ) => item.id === token.id ).status
			).toBe( 'revoked' );

			const unknown = await api.delete( `${ TOKENS }/99999999`, {
				headers: admin,
			} );
			expect( unknown.status() ).toBe( 404 );
			expect( ( await unknown.json() ).code ).toBe(
				'rest_api_token_not_found'
			);
		} );
	} );

	test.describe( 'external endpoints', () => {
		test( 'identify a valid token and record its use', async () => {
			const token = await createdToken( 'me' );

			const res = await api.get( ME, {
				headers: bearer( token.token ),
			} );
			expect( res.status(), await res.text() ).toBe( 200 );
			const body = await res.json();
			expect( Object.keys( body ).sort() ).toEqual( TOKEN_FIELDS );
			expect( body.id ).toBe( token.id );
			expect( body.label ).toBe( token.label );
			expect( body.scopes ).toEqual( [ 'transactions:read' ] );
			expect( body.status ).toBe( 'active' );
			expect( JSON.stringify( body ) ).not.toContain( token.token );

			expect(
				( await storedRow( token.id ) ).last_used_at
			).not.toBeNull();
		} );

		test( 'answer a missing, malformed, unknown or revoked token with the same 401', async () => {
			const revoked = await createdToken( 'revoked' );
			await api.delete( `${ TOKENS }/${ revoked.id }`, {
				headers: admin,
			} );

			const attempts = {
				missing: {},
				malformed: { Authorization: 'Token abc' },
				empty: { Authorization: 'Bearer ' },
				unknown: bearer( 'x'.repeat( 40 ) ),
				revoked: bearer( revoked.token ),
			};

			for ( const url of [ ME, TRANSACTIONS ] ) {
				const bodies = [];
				for ( const [ name, headers ] of Object.entries( attempts ) ) {
					const res = await api.get( url, { headers } );
					expect( res.status(), `${ name } ${ url }` ).toBe( 401 );
					bodies.push( await res.text() );
				}
				// Nothing tells a revoked or unknown token from no token.
				expect( new Set( bodies ).size ).toBe( 1 );
				expect( JSON.parse( bodies[ 0 ] ) ).toEqual( {
					code: 'rest_forbidden',
					message: 'Invalid or missing API token.',
					data: { status: 401 },
				} );
			}

			// A revoked token's use is not recorded.
			expect( ( await storedRow( revoked.id ) ).last_used_at ).toBeNull();
		} );

		test( 'list transactions with the same shape, paging and filters', async () => {
			const imported = await api.post( IMPORT, {
				headers: admin,
				data: {
					transactions: [ 'a', 'b', 'c' ].map( ( key, index ) => ( {
						mollie_payment_id: `tr_e2etok${ key }`,
						amount: 10 + index,
						currency: 'EUR',
						status: index === 2 ? 'failed' : 'paid',
						description: `Token spec ${ key }`,
						mollie_fee: 0.29,
						created_at: `2098-0${ index + 1 }-15 10:00:00`,
					} ) ),
				},
			} );
			expect( imported.ok(), await imported.text() ).toBeTruthy();

			const token = await createdToken( 'transactions' );
			const list = async ( query ) => {
				const res = await api.get( `${ TRANSACTIONS }?${ query }`, {
					headers: bearer( token.token ),
				} );
				expect( res.status(), await res.text() ).toBe( 200 );
				return res.json();
			};

			const all = await list( 'from=2098-01-01&to=2098-12-31' );
			expect( Object.keys( all ).sort() ).toEqual( [
				'page',
				'per_page',
				'total',
				'transactions',
			] );
			expect( all.total ).toBe( 3 );
			expect( all.page ).toBe( 1 );
			expect( all.per_page ).toBe( 50 );
			// Newest first.
			expect(
				all.transactions.map( ( row ) => row.mollie_payment_id )
			).toEqual( [ 'tr_e2etokc', 'tr_e2etokb', 'tr_e2etoka' ] );
			expect( Object.keys( all.transactions[ 0 ] ).sort() ).toEqual(
				TRANSACTION_FIELDS
			);
			expect( all.transactions[ 2 ] ).toEqual(
				expect.objectContaining( {
					mollie_payment_id: 'tr_e2etoka',
					amount: 10,
					currency: 'EUR',
					mollie_fee: 0.29,
					status: 'paid',
					description: 'Token spec a',
					event_date_id: null,
					event_url: '',
					created_at: '2098-01-15 10:00:00',
				} )
			);

			const paged = await list(
				'from=2098-01-01&to=2098-12-31&per_page=2&page=2'
			);
			expect( paged.total ).toBe( 3 );
			expect( paged.page ).toBe( 2 );
			expect( paged.per_page ).toBe( 2 );
			expect(
				paged.transactions.map( ( row ) => row.mollie_payment_id )
			).toEqual( [ 'tr_e2etoka' ] );

			const failed = await list(
				'from=2098-01-01&to=2098-12-31&status=failed'
			);
			expect(
				failed.transactions.map( ( row ) => row.mollie_payment_id )
			).toEqual( [ 'tr_e2etokc' ] );

			const ranged = await list( 'from=2098-02-01&to=2098-02-28' );
			expect(
				ranged.transactions.map( ( row ) => row.mollie_payment_id )
			).toEqual( [ 'tr_e2etokb' ] );

			const invalid = await api.get(
				`${ TRANSACTIONS }?from=not-a-date`,
				{
					headers: bearer( token.token ),
				}
			);
			expect( invalid.status() ).toBe( 400 );
		} );
	} );

	test.describe( 'tokens created before the move', () => {
		test( 'a token with both scopes keeps reading transactions and still lists locations:read', async () => {
			const token = await legacyToken( 'legacy mixed', [
				'transactions:read',
				'locations:read',
			] );

			const me = await api.get( ME, { headers: bearer( token.token ) } );
			expect( me.status(), await me.text() ).toBe( 200 );
			expect( ( await me.json() ).scopes ).toEqual( [
				'transactions:read',
				'locations:read',
			] );

			const transactions = await api.get( TRANSACTIONS, {
				headers: bearer( token.token ),
			} );
			expect( transactions.status(), await transactions.text() ).toBe(
				200
			);

			// Listing and revoking it work like any other token.
			const listed = await (
				await api.get( TOKENS, { headers: admin } )
			).json();
			expect(
				listed.find( ( item ) => item.id === token.id ).scopes
			).toEqual( [ 'transactions:read', 'locations:read' ] );

			const revoked = await api.delete( `${ TOKENS }/${ token.id }`, {
				headers: admin,
			} );
			expect( revoked.status() ).toBe( 200 );
			expect(
				(
					await api.get( TRANSACTIONS, {
						headers: bearer( token.token ),
					} )
				).status()
			).toBe( 401 );
		} );

		test( 'a locations-only token still authenticates but cannot read transactions', async () => {
			const token = await legacyToken( 'legacy locations', [
				'locations:read',
			] );

			const me = await api.get( ME, { headers: bearer( token.token ) } );
			expect( me.status(), await me.text() ).toBe( 200 );
			expect( ( await me.json() ).scopes ).toEqual( [
				'locations:read',
			] );

			const transactions = await api.get( TRANSACTIONS, {
				headers: bearer( token.token ),
			} );
			expect( transactions.status() ).toBe( 403 );
			expect( await transactions.json() ).toEqual( {
				code: 'rest_insufficient_scope',
				message: 'This token does not have the required scope.',
				data: { status: 403 },
			} );
		} );
	} );
	test.describe( 'release pairings (#2080)', () => {
		const contexts = [];

		const pairing = async ( releases, order, oldShared ) => {
			const context = await request.newContext( {
				baseURL: BASE_URL,
				extraHTTPHeaders: releaseHeaders( releases, order, oldShared ),
			} );
			contexts.push( context );
			return context;
		};

		test.afterAll( async () => {
			for ( const context of contexts ) {
				await context.dispose();
			}
		} );

		for ( const [ releases, expected ] of Object.entries( PAIRINGS ) ) {
			for ( const order of [ 'core-first', 'experimental-first' ] ) {
				for ( const oldShared of [ false, true ] ) {
					const name = `${ releases }, ${ order }${
						oldShared ? ', older shared package first' : ''
					}`;

					test( `${ name }: one plugin serves the whole token lifecycle`, async () => {
						const site = await pairing(
							releases,
							order,
							oldShared
						);

						const ran = await (
							await site.get( RELEASES, { headers: admin } )
						).json();
						expect( ran.releases ).toBe( releases );
						expect( ran.loaded ).toEqual(
							'experimental-first' === order
								? [ ...expected.loaded ].reverse()
								: expected.loaded
						);
						if ( oldShared ) {
							// The older copy was asked first and lacks the new classes,
							// so they came from a plugin that bundles them.
							expect( ran.declined.sort() ).toEqual(
								NEW_SHARED_CLASSES
							);
							expect( ran.served.length ).toBeGreaterThan( 0 );
						}
						for ( const source of Object.values(
							ran.shared_source
						) ) {
							expect( source ).toMatch(
								/^[a-z-]+\/vendor\/fair-events\/shared\/src\//
							);
						}

						// Exactly one handler per route and method, all from the owner.
						const owners = await site.get( OWNERS, {
							headers: admin,
						} );
						expect( owners.ok(), await owners.text() ).toBeTruthy();
						const handlers = routeHandlers( await owners.json() );
						expect( Object.keys( handlers ).sort() ).toEqual(
							Object.keys( TOKEN_ROUTES ).sort()
						);
						for ( const [
							route,
							expectedHandlers,
						] of Object.entries( TOKEN_ROUTES ) ) {
							expect( handlers[ route ], route ).toEqual(
								expectedHandlers.map( ( handler ) =>
									handler.replace(
										' ',
										` ${ expected.owner }\\API\\`
									)
								)
							);
						}

						// Created with its plaintext shown once, stored as a hash.
						const created = await site.post( TOKENS, {
							headers: admin,
							data: {
								label: label( `pairing ${ name }` ),
								scopes: [ 'transactions:read' ],
							},
						} );
						expect( created.status(), await created.text() ).toBe(
							201
						);
						const token = await created.json();
						tokenIds.push( token.id );
						expect( Object.keys( token ).sort() ).toEqual(
							[ ...TOKEN_FIELDS, 'token' ].sort()
						);
						expect( token.token ).toMatch( /^[A-Za-z0-9]{40}$/ );

						const listText = await (
							await site.get( TOKENS, { headers: admin } )
						).text();
						expect( listText ).not.toContain( token.token );
						expect( listText ).not.toContain( 'token_hash' );
						expect(
							( await storedRow( token.id ) ).token_hash
						).toBe(
							createHash( 'sha256' )
								.update( token.token )
								.digest( 'hex' )
						);

						// Authorized for what it was granted.
						const me = await site.get( ME, {
							headers: bearer( token.token ),
						} );
						expect( me.status(), await me.text() ).toBe( 200 );
						const meText = await me.text();
						expect( meText ).not.toContain( token.token );
						expect(
							Object.keys( JSON.parse( meText ) ).sort()
						).toEqual( TOKEN_FIELDS );
						const transactions = await site.get( TRANSACTIONS, {
							headers: bearer( token.token ),
						} );
						expect(
							transactions.status(),
							await transactions.text()
						).toBe( 200 );
						expect(
							Object.keys( await transactions.json() ).sort()
						).toEqual( [
							'page',
							'per_page',
							'total',
							'transactions',
						] );

						// Rejected without the scope, when invalid, and once revoked.
						const locations = await legacyToken(
							`pairing locations ${ name }`,
							[ 'locations:read' ]
						);
						const underScoped = await site.get( TRANSACTIONS, {
							headers: bearer( locations.token ),
						} );
						expect( underScoped.status() ).toBe( 403 );
						expect( ( await underScoped.json() ).message ).toBe(
							'This token does not have the required scope.'
						);

						const invalid = await site.get( ME, {
							headers: bearer( 'x'.repeat( 40 ) ),
						} );
						expect( invalid.status() ).toBe( 401 );
						expect( ( await invalid.json() ).message ).toBe(
							'Invalid or missing API token.'
						);

						const revoked = await site.delete(
							`${ TOKENS }/${ token.id }`,
							{ headers: admin }
						);
						expect( revoked.status() ).toBe( 200 );
						expect( ( await revoked.json() ).status ).toBe(
							'revoked'
						);
						for ( const url of [ ME, TRANSACTIONS ] ) {
							expect(
								(
									await site.get( url, {
										headers: bearer( token.token ),
									} )
								).status(),
								url
							).toBe( 401 );
						}
					} );
				}
			}
		}

		test( 'a token keeps working when the serving plugin changes', async () => {
			const fallback = await pairing(
				'old-core-experimental',
				'core-first',
				false
			);
			const updated = await pairing( 'core-only', 'core-first', false );

			const created = await fallback.post( TOKENS, {
				headers: admin,
				data: {
					label: label( 'handover' ),
					scopes: [ 'transactions:read' ],
				},
			} );
			expect( created.status(), await created.text() ).toBe( 201 );
			const token = await created.json();
			tokenIds.push( token.id );

			for ( const site of [ updated, fallback ] ) {
				const me = await site.get( ME, {
					headers: bearer( token.token ),
				} );
				expect( me.status(), await me.text() ).toBe( 200 );
				expect( ( await me.json() ).id ).toBe( token.id );
			}

			// Revoked by the updated plugin, rejected by the fallback.
			await updated.delete( `${ TOKENS }/${ token.id }`, {
				headers: admin,
			} );
			expect(
				(
					await fallback.get( TRANSACTIONS, {
						headers: bearer( token.token ),
					} )
				).status()
			).toBe( 401 );
		} );
	} );
} );
