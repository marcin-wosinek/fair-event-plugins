/**
 * Playwright API tests for the Entradium spreadsheet import (#1853):
 *   POST /fair-audience/v1/import/entradium
 *
 * Guards spreadsheet parsing across PhpSpreadsheet updates: a valid sheet
 * imports its rows with the expected participant data and per-row errors,
 * a sheet missing required columns is rejected with the columns it found,
 * and a corrupt file fails with a controlled error. Also covers who may
 * import and the upload checks that run before parsing.
 *
 * Fixtures in ./fixtures/ were written with SheetJS, independently of the
 * library under test. Their participants use the import-1853.example.test
 * domain and are deleted before and after the suite.
 */

import { test, expect, request } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const FIXTURE_DIR = join(
	dirname( fileURLToPath( import.meta.url ) ),
	'fixtures'
);
const FIXTURE_DOMAIN = 'import-1853.example.test';
const XLSX_MIME =
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ROUTE = '/wp-json/fair-audience/v1/import/entradium';

function basicAuth( user, password ) {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
	};
}

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

function fixtureFile( name, mimeType = XLSX_MIME ) {
	return {
		name,
		mimeType,
		buffer: readFileSync( join( FIXTURE_DIR, name ) ),
	};
}

test.describe( 'ImportController: Entradium spreadsheet import', () => {
	let api;

	const importFile = async ( file, { headers = adminHeaders } = {} ) => {
		const res = await api.post( ROUTE, {
			headers,
			multipart: { file },
		} );
		return { status: res.status(), body: await res.json() };
	};

	const fixtureParticipants = async () => {
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants?search=${ FIXTURE_DOMAIN }`,
			{ headers: adminHeaders }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const deleteFixtureParticipants = async () => {
		for ( const participant of await fixtureParticipants() ) {
			const res = await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participant.id }`,
				{ headers: adminHeaders }
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
		}
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await deleteFixtureParticipants();
	} );

	test.afterAll( async () => {
		await deleteFixtureParticipants();
		await api.dispose();
	} );

	test( 'rejects requests without manage_options', async () => {
		const res = await api.post( ROUTE, {
			multipart: { file: fixtureFile( 'entradium-valid.xlsx' ) },
		} );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'rejects a request without a file', async () => {
		const res = await api.post( ROUTE, {
			headers: adminHeaders,
			multipart: { event_id: '' },
		} );
		const body = await res.json();
		expect( res.status() ).toBe( 400 );
		expect( body.code ).toBe( 'no_file' );
	} );

	test( 'rejects a file that is not declared as a spreadsheet', async () => {
		const { status, body } = await importFile(
			fixtureFile( 'entradium-valid.xlsx', 'text/csv' )
		);
		expect( status ).toBe( 400 );
		expect( body.code ).toBe( 'invalid_file_type' );
	} );

	test( 'imports valid rows and reports invalid ones', async () => {
		const { status, body } = await importFile(
			fixtureFile( 'entradium-valid.xlsx' )
		);
		expect( status ).toBe( 200 );
		expect( body ).toEqual( {
			imported: 3,
			existing_linked: 0,
			skipped: 0,
			auto_resolved: 0,
			marketing: 2,
			errors: [
				'Row 4: Missing required fields (name or surname)',
				'Row 5: Invalid email format: not-an-email',
			],
			duplicates: [],
		} );

		const stored = ( await fixtureParticipants() )
			.map( ( { name, surname, email, email_profile: profile } ) => ( {
				name,
				surname,
				email,
				profile,
			} ) )
			.sort( ( a, b ) => a.email.localeCompare( b.email ) );
		expect( stored ).toEqual( [
			{
				name: 'Ana',
				surname: 'García López',
				email: `ana@${ FIXTURE_DOMAIN }`,
				profile: 'marketing',
			},
			{
				name: 'Bob',
				surname: 'Smith',
				email: `bob@${ FIXTURE_DOMAIN }`,
				profile: 'minimal',
			},
			{
				name: 'Eve',
				surname: "O'Neil",
				email: `eve@${ FIXTURE_DOMAIN }`,
				profile: 'marketing',
			},
		] );
	} );

	test( 'skips rows whose participants already exist', async () => {
		const { status, body } = await importFile(
			fixtureFile( 'entradium-valid.xlsx' )
		);
		expect( status ).toBe( 200 );
		expect( body.imported ).toBe( 0 );
		expect( body.skipped ).toBe( 3 );
		expect( body.errors ).toHaveLength( 2 );
		expect( await fixtureParticipants() ).toHaveLength( 3 );
	} );

	test( 'rejects a sheet missing required columns', async () => {
		const { status, body } = await importFile(
			fixtureFile( 'entradium-missing-columns.xlsx' )
		);
		expect( status ).toBe( 400 );
		expect( body.code ).toBe( 'invalid_format' );
		expect( body.message ).toBe(
			'Invalid file format. Required columns: Nombre, Apellidos, Email. Found columns: Nombre, Email, Newsletter'
		);
	} );

	test( 'fails a corrupt spreadsheet with a controlled error', async () => {
		const { status, body } = await importFile(
			fixtureFile( 'entradium-corrupt.xlsx' )
		);
		expect( status ).toBe( 500 );
		expect( body.code ).toBe( 'import_failed' );
		expect( body.message ).toBe(
			'Import failed: Unable to identify a reader for this file'
		);
	} );
} );
