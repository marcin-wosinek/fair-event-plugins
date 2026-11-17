/**
 * Playwright API tests for OrganizersController (#2304): administrator-only
 * management of the sitewide default organizer plus additional organizers.
 *
 * Covers independent records with their own private recipients, the default
 * staying in Fair Events' `fair_events_organizer` option, validation
 * failures that leave saved data unchanged, unknown IDs, access
 * restrictions, and the `organizers` bundle hiding the routes while keeping
 * every record.
 *
 * The suite removes the organizers it creates and resets the default.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/organizers';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const INDEX_OPTION = 'fair_events_experimental_organizer_ids';
const OPTION_PREFIX = 'fair_events_experimental_organizer_';
const FEATURES_OPTION = 'fair_events_experimental_features';
const EDITOR_PASSWORD = 'Test-password-2304!';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

/** Run WP-CLI on the tests instance without blocking the event loop. */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	return stdout;
}

test.describe( 'OrganizersController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let editorId;
	let editorHeaders;
	const created = [];

	const list = () => api.get( PATH, { headers: adminHeaders } );
	const create = ( data ) =>
		api.post( PATH, { headers: adminHeaders, data } );
	const update = ( id, data ) =>
		api.put( `${ PATH }/${ id }`, { headers: adminHeaders, data } );
	const read = ( id ) =>
		api.get( `${ PATH }/${ id }`, { headers: adminHeaders } );
	const createOk = async ( data ) => {
		const res = await create( data );
		expect( res.status() ).toBe( 201 );
		const body = await res.json();
		created.push( body.id );
		return body;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { fair_events_organizer: {} },
		} );

		const login = `organizers-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: EDITOR_PASSWORD,
				roles: [ 'editor' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		editorId = ( await userRes.json() ).id;
		editorHeaders = basic( login, EDITOR_PASSWORD );
	} );

	test.afterAll( async () => {
		await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		for ( const id of created ) {
			await wp( 'option', 'delete', OPTION_PREFIX + id ).catch(
				() => {}
			);
		}
		await wp( 'option', 'delete', INDEX_OPTION ).catch( () => {} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { fair_events_organizer: {} },
		} );
		if ( editorId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ editorId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'every route is restricted to administrators', async () => {
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const calls = [
			[ 'get', PATH, undefined ],
			[ 'post', PATH, { name: 'Blocked' } ],
			[ 'get', `${ PATH }/default`, undefined ],
			[ 'put', `${ PATH }/default`, { name: 'Blocked' } ],
		];

		for ( const [ method, path, data ] of calls ) {
			const anonymous = await anon[ method ]( path, { data } );
			expect( anonymous.status(), `${ method } ${ path }` ).toBe( 401 );

			const editor = await api[ method ]( path, {
				headers: editorHeaders,
				data,
			} );
			expect( editor.status(), `${ method } ${ path }` ).toBe( 403 );
		}
		await anon.dispose();

		const listed = await ( await list() ).json();
		expect( listed.map( ( organizer ) => organizer.name ) ).not.toContain(
			'Blocked'
		);
	} );

	test( 'lists the existing sitewide organizer as the default', async () => {
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_organizer: {
					name: 'Sitewide Club',
					website: 'https://sitewide.example',
					notification_emails: [ 'board@example.com' ],
				},
			},
		} );

		const res = await list();
		expect( res.status() ).toBe( 200 );
		const [ first ] = await res.json();
		expect( first ).toMatchObject( {
			id: 'default',
			is_default: true,
			name: 'Sitewide Club',
			website: 'https://sitewide.example',
			notification_emails: [ 'board@example.com' ],
		} );
	} );

	test( 'creates independent organizers without inheriting the default', async () => {
		const north = await createOk( {
			name: 'North Club',
			notification_emails: [ ' north@example.com ', 'NORTH@example.com' ],
		} );
		const south = await createOk( {
			name: 'South Club',
			type: 'SportsClub',
			website: 'https://south.example',
			same_as: [ 'https://social.example/south', '' ],
			notification_emails: [],
		} );

		expect( north.id ).toMatch( /^[0-9a-f-]{36}$/ );
		expect( north.id ).not.toBe( south.id );
		expect( north ).toMatchObject( {
			is_default: false,
			name: 'North Club',
			type: 'Organization',
			website: '',
			logo_id: 0,
			notification_emails: [ 'north@example.com' ],
		} );
		expect( south ).toMatchObject( {
			type: 'SportsClub',
			website: 'https://south.example',
			same_as: [ 'https://social.example/south' ],
			notification_emails: [],
		} );

		const ids = ( await ( await list() ).json() ).map( ( o ) => o.id );
		expect( ids.slice( 0, 1 ) ).toEqual( [ 'default' ] );
		expect( ids.indexOf( north.id ) ).toBeLessThan(
			ids.indexOf( south.id )
		);

		const readBack = await ( await read( south.id ) ).json();
		expect( readBack ).toEqual( south );

		// Each record is its own non-autoloaded option.
		const autoload = await wp(
			'option',
			'list',
			`--search=${ OPTION_PREFIX }${ north.id }`,
			'--fields=autoload',
			'--format=json'
		);
		expect(
			JSON.parse( autoload.slice( autoload.indexOf( '[' ) ) )
		).toEqual( [ { autoload: expect.stringMatching( /^(no|off)$/ ) } ] );
	} );

	test( 'updating one organizer leaves the others untouched', async () => {
		const [ north, south ] = created;

		const res = await update( north, {
			name: 'North Club Renamed',
			notification_emails: [ 'a@example.com', 'b@example.com' ],
		} );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toMatchObject( {
			id: north,
			name: 'North Club Renamed',
			notification_emails: [ 'a@example.com', 'b@example.com' ],
		} );

		const other = await ( await read( south ) ).json();
		expect( other.name ).toBe( 'South Club' );
		expect( other.notification_emails ).toEqual( [] );

		const defaultOrganizer = await ( await read( 'default' ) ).json();
		expect( defaultOrganizer.notification_emails ).toEqual( [
			'board@example.com',
		] );
	} );

	test( 'the default is edited in its existing option', async () => {
		const res = await update( 'default', {
			name: '',
			notification_emails: [ 'team@example.com' ],
		} );
		expect( res.status() ).toBe( 200 );
		expect( await res.json() ).toMatchObject( {
			id: 'default',
			name: '',
			notification_emails: [ 'team@example.com' ],
		} );

		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		expect( settings.fair_events_organizer.notification_emails ).toEqual( [
			'team@example.com',
		] );
		expect( settings.fair_events_organizer.name ).toBeUndefined();
	} );

	test( 'person, company and NGO types save and reload for every organizer', async () => {
		for ( const type of [ 'Person', 'Corporation', 'NGO' ] ) {
			const organizer = await createOk( {
				name: `${ type } organizer`,
				type,
			} );
			expect( organizer.type ).toBe( type );
			expect( ( await ( await read( organizer.id ) ).json() ).type ).toBe(
				type
			);

			const res = await update( 'default', { type } );
			expect( res.status() ).toBe( 200 );
			expect( ( await ( await read( 'default' ) ).json() ).type ).toBe(
				type
			);
		}

		// The existing types stay selectable.
		const [ north ] = created;
		const sportsClub = await update( north, {
			name: 'North Club Renamed',
			type: 'SportsClub',
		} );
		expect( ( await sportsClub.json() ).type ).toBe( 'SportsClub' );
		const organization = await update( north, {
			name: 'North Club Renamed',
			type: 'Organization',
		} );
		expect( ( await organization.json() ).type ).toBe( 'Organization' );

		await update( 'default', { type: 'Organization' } );
	} );

	test( 'invalid submissions are rejected and keep the saved data', async () => {
		const [ north ] = created;
		const before = await ( await read( north ) ).json();

		const invalid = await update( north, {
			name: '  ',
			type: 'Club',
			website: 'not a url',
			same_as: [ 'ftp://files.example' ],
			contact_email: 'nope',
			notification_emails: [ 'valid@example.com', 'broken' ],
			logo_id: 999999,
		} );
		expect( invalid.status() ).toBe( 400 );
		const body = await invalid.json();
		expect( body.code ).toBe( 'rest_invalid_param' );
		expect( Object.keys( body.data.params ).sort() ).toEqual( [
			'contact_email',
			'logo_id',
			'name',
			'notification_emails',
			'same_as',
			'type',
			'website',
		] );
		expect( body.data.params.notification_emails ).toContain( 'broken' );

		expect( await ( await read( north ) ).json() ).toEqual( before );

		const countBefore = ( await ( await list() ).json() ).length;
		const rejectedCreate = await create( {
			name: 'Bad Recipient Club',
			notification_emails: [ 'broken' ],
		} );
		expect( rejectedCreate.status() ).toBe( 400 );
		const unnamed = await create( { name: '' } );
		expect( unnamed.status() ).toBe( 400 );
		expect( ( await unnamed.json() ).data.params ).toHaveProperty( 'name' );
		expect( ( await ( await list() ).json() ).length ).toBe( countBefore );
	} );

	test( 'unknown organizers return 404', async () => {
		for ( const id of [ MISSING_ID, 'not-an-id' ] ) {
			expect( ( await read( id ) ).status() ).toBe( 404 );
			expect( ( await update( id, { name: 'Ghost' } ) ).status() ).toBe(
				404
			);
		}
	} );

	test( 'turning the bundle off hides the routes and keeps every record', async () => {
		const before = await ( await list() ).json();

		await wp(
			'option',
			'update',
			FEATURES_OPTION,
			'{"organizers":false}',
			'--format=json'
		);
		expect( ( await list() ).status() ).toBe( 404 );
		expect( ( await read( 'default' ) ).status() ).toBe( 404 );

		await wp(
			'option',
			'update',
			FEATURES_OPTION,
			'{"organizers":true}',
			'--format=json'
		);
		const after = await list();
		expect( after.status() ).toBe( 200 );
		expect( await after.json() ).toEqual( before );
	} );
} );
