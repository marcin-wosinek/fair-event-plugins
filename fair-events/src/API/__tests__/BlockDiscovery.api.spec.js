/**
 * Playwright API tests for block discovery (#1682).
 *
 * Site tooling discovers the blocks registered on a site through WordPress
 * core's /wp/v2/block-types endpoints and maps them to the plugin that
 * supplies them with each plugin's distributed block-docs/index.json. These
 * tests verify that:
 *
 * - discovery keeps core's permissions: anonymous requests get 401, a
 *   subscriber gets 403, and an editor (edit_posts) can list block types;
 * - every block registered under a Fair namespace is claimed by exactly one
 *   index (ownership does not follow the namespace: Fair Form owns its
 *   fair-audience/fair-form-* blocks);
 * - each index entry's status matches live registration: authoring and
 *   legacy blocks are registered, legacy ones hidden from the inserter, the
 *   PHP-only alias has no editor script, and "unregistered" entries
 *   (fair-events/event-proposal, whose feature never resolves on) are absent;
 * - the core/button calendar variation's attribute is registered.
 *
 * Reads the generated `<plugin>/block-docs/index.json` files, so build the
 * plugins (or run `node scripts/block-docs.mjs generate <plugin>`) first.
 * Fair Timetable and Fair Calendar Button are not activated by .wp-env.json,
 * so they are activated here and restored afterwards.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ROOT = fileURLToPath( new URL( '../../../../', import.meta.url ) );
const OPTIONAL_PLUGINS = [
	'fair-timetable/fair-timetable',
	'fair-calendar-button/fair-calendar-button',
];
const FAIR_NAMESPACES = [
	'fair-events/',
	'fair-audience/',
	'fair-timetable/',
	'fair-calendar-button/',
	'fair-payment/',
];

const authHeader = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = authHeader( ADMIN_USER, ADMIN_PASSWORD );

function loadIndexes() {
	const { workspaces } = JSON.parse(
		readFileSync( join( ROOT, 'package.json' ), 'utf8' )
	);
	return workspaces
		.map( ( plugin ) => join( ROOT, plugin, 'block-docs', 'index.json' ) )
		.filter( ( path ) => existsSync( path ) )
		.map( ( path ) => JSON.parse( readFileSync( path, 'utf8' ) ) );
}

const indexes = loadIndexes();
const documented = indexes.flatMap( ( index ) => index.blocks );

test.describe( 'Block discovery', () => {
	let api;
	let activated = [];
	const createdUsers = [];

	async function createUser( role ) {
		const login = `block-docs-${ role }-${ Date.now() }`;
		const password = 'Block-docs-password-1682!';
		const response = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password,
				roles: [ role ],
			},
		} );
		expect( response.ok() ).toBeTruthy();
		createdUsers.push( ( await response.json() ).id );
		return authHeader( login, password );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		for ( const plugin of OPTIONAL_PLUGINS ) {
			const response = await api.get(
				`/wp-json/wp/v2/plugins/${ plugin }`,
				{
					headers: adminHeaders,
				}
			);
			expect( response.ok(), `${ plugin } is installed` ).toBeTruthy();
			if ( ( await response.json() ).status !== 'active' ) {
				const activation = await api.post(
					`/wp-json/wp/v2/plugins/${ plugin }`,
					{ headers: adminHeaders, data: { status: 'active' } }
				);
				expect( activation.ok() ).toBeTruthy();
				activated.push( plugin );
			}
		}
	} );

	test.afterAll( async () => {
		for ( const id of createdUsers ) {
			await api.delete( `/wp-json/wp/v2/users/${ id }`, {
				headers: adminHeaders,
				params: { force: true, reassign: 1 },
			} );
		}
		for ( const plugin of activated ) {
			await api.post( `/wp-json/wp/v2/plugins/${ plugin }`, {
				headers: adminHeaders,
				data: { status: 'inactive' },
			} );
		}
		activated = [];
		await api.dispose();
	} );

	test( 'every block plugin ships a block-docs index', () => {
		expect( indexes.map( ( index ) => index.plugin ).sort() ).toEqual( [
			'fair-audience',
			'fair-calendar-button',
			'fair-events',
			'fair-form',
			'fair-payments-connector',
			'fair-timetable',
		] );
	} );

	test( 'rejects anonymous discovery', async () => {
		const response = await api.get(
			'/wp-json/wp/v2/block-types/fair-events/event-signup'
		);
		expect( response.status() ).toBe( 401 );

		const list = await api.get( '/wp-json/wp/v2/block-types', {
			params: { namespace: 'fair-events' },
		} );
		expect( list.status() ).toBe( 401 );
	} );

	test( 'rejects a subscriber and allows an editor', async () => {
		const subscriber = await createUser( 'subscriber' );
		const rejected = await api.get( '/wp-json/wp/v2/block-types', {
			headers: subscriber,
			params: { namespace: 'fair-events' },
		} );
		expect( rejected.status() ).toBe( 403 );

		const editor = await createUser( 'editor' );
		const allowed = await api.get( '/wp-json/wp/v2/block-types', {
			headers: editor,
			params: { namespace: 'fair-events' },
		} );
		expect( allowed.status() ).toBe( 200 );
		expect(
			( await allowed.json() ).map( ( block ) => block.name )
		).toContain( 'fair-events/event-signup' );
	} );

	test( 'maps every registered Fair block to exactly one owning plugin', async () => {
		const response = await api.get( '/wp-json/wp/v2/block-types', {
			headers: adminHeaders,
		} );
		expect( response.ok() ).toBeTruthy();
		const registered = ( await response.json() )
			.map( ( block ) => block.name )
			.filter( ( name ) =>
				FAIR_NAMESPACES.some( ( prefix ) => name.startsWith( prefix ) )
			);

		expect( registered.length ).toBeGreaterThan( 30 );
		for ( const name of registered ) {
			const owners = documented
				.filter( ( block ) => block.name === name )
				.map( ( block ) => block.ownerPlugin );
			expect( owners, `${ name } owners` ).toHaveLength( 1 );
		}

		const owner = ( name ) =>
			documented.find( ( block ) => block.name === name )?.ownerPlugin;
		expect( owner( 'fair-audience/fair-form' ) ).toBe( 'fair-form' );
		expect( owner( 'fair-audience/fair-form-short-text' ) ).toBe(
			'fair-form'
		);
		expect( owner( 'fair-audience/mailing-signup' ) ).toBe(
			'fair-audience'
		);
		expect( owner( 'fair-payment/simple-payment' ) ).toBe(
			'fair-payments-connector'
		);
	} );

	test( 'live registration matches each documented status', async () => {
		for ( const block of documented ) {
			const response = await api.get(
				`/wp-json/wp/v2/block-types/${ block.name }`,
				{ headers: adminHeaders }
			);

			if ( block.status === 'unregistered' ) {
				expect( response.status(), `${ block.name } absent` ).toBe(
					404
				);
				continue;
			}

			expect( response.status(), `${ block.name } registered` ).toBe(
				200
			);
			const registered = await response.json();
			expect( registered.name ).toBe( block.name );

			if ( block.status === 'legacy' ) {
				expect(
					registered.supports?.inserter,
					`${ block.name } hidden from the inserter`
				).toBe( false );
				expect( block.replacement ).toBeTruthy();
			}
			if ( block.metadataSource.startsWith( 'php:' ) ) {
				expect(
					registered.editor_script_handles,
					`${ block.name } has no editor script`
				).toEqual( [] );
			} else {
				expect( registered.title ).toBe(
					JSON.parse(
						readFileSync(
							join( ROOT, block.ownerPlugin, block.metadata ),
							'utf8'
						)
					).title
				);
			}
		}
	} );

	test( 'documents the legacy and conditional entries explicitly', () => {
		const entry = ( name ) =>
			documented.find( ( block ) => block.name === name );

		expect( entry( 'fair-audience/event-signup' ) ).toMatchObject( {
			status: 'legacy',
			metadata: null,
			metadataSource: 'php:src/Hooks/BlockHooks.php',
			replacement: 'fair-events/event-signup',
		} );
		expect( entry( 'fair-events/get-tickets' ) ).toMatchObject( {
			status: 'legacy',
			replacement: 'fair-events/event-signup',
		} );
		expect( entry( 'fair-events/event-proposal' ) ).toMatchObject( {
			status: 'unregistered',
			registration: { condition: 'feature' },
		} );
	} );

	test( 'registers the calendar button variation attribute on core/button', async () => {
		const variation = indexes
			.flatMap( ( index ) => index.variations )
			.find( ( item ) => item.variation === 'calendar-button' );
		expect( variation ).toMatchObject( {
			block: 'core/button',
			ownerPlugin: 'fair-events',
			isActive: { isCalendarButton: true },
		} );

		const response = await api.get(
			'/wp-json/wp/v2/block-types/core/button',
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		expect(
			( await response.json() ).attributes.isCalendarButton
		).toMatchObject( { type: 'boolean', default: false } );
	} );
} );
