/**
 * Playwright API tests for the `fair_events_organizer` setting exposed
 * through core's /wp/v2/settings endpoint.
 *
 * Verifies the write -> read-back round trip is sanitized (malformed
 * same_as entries dropped) and that the setting is gated on manage_options.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeader = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'fair_events_organizer setting', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		// Reset to empty so later suites see the fallback organizer.
		await api.post( '/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: { fair_events_organizer: {} },
		} );
		await api.dispose();
	} );

	test( 'writes then reads back a sanitized organizer identity', async () => {
		const res = await api.post( '/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: {
				fair_events_organizer: {
					name: 'Acme Club',
					type: 'SportsClub',
					street_address: 'Main St 1',
					address_locality: 'Madrid',
					address_country: 'ES',
					same_as: [ 'https://example.com/acme', 'not a valid url' ],
					website: 'https://acme.example',
					contact_email: 'info@example.com',
					contact_phone: '+34 600 000 000',
				},
			},
		} );

		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body.fair_events_organizer.name ).toBe( 'Acme Club' );
		expect( body.fair_events_organizer.type ).toBe( 'SportsClub' );
		expect( body.fair_events_organizer.same_as ).toEqual( [
			'https://example.com/acme',
		] );
		expect( body.fair_events_organizer.website ).toBe(
			'https://acme.example'
		);
		expect( body.fair_events_organizer.contact_email ).toBe(
			'info@example.com'
		);
		expect( body.fair_events_organizer.contact_phone ).toBe(
			'+34 600 000 000'
		);

		const read = await api.get( '/wp-json/wp/v2/settings', {
			headers: authHeader,
		} );
		const readBody = await read.json();
		expect( readBody.fair_events_organizer.name ).toBe( 'Acme Club' );
		expect( readBody.fair_events_organizer.same_as ).toEqual( [
			'https://example.com/acme',
		] );
		expect( readBody.fair_events_organizer.website ).toBe(
			'https://acme.example'
		);
	} );

	test( 'drops a malformed website URL and an invalid contact email', async () => {
		const res = await api.post( '/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: {
				fair_events_organizer: {
					name: 'Acme Club',
					website: 'not a url',
					contact_email: 'not an email',
				},
			},
		} );

		expect( res.status() ).toBe( 200 );
		const body = await res.json();

		expect( body.fair_events_organizer.website ).toBeUndefined();
		expect( body.fair_events_organizer.contact_email ).toBeUndefined();
	} );

	test( 'saves and reloads the person, company and NGO types', async () => {
		for ( const type of [
			'Person',
			'Corporation',
			'NGO',
			'Organization',
		] ) {
			const res = await api.post( '/wp-json/wp/v2/settings', {
				headers: authHeader,
				data: { fair_events_organizer: { name: 'Acme', type } },
			} );
			expect( res.status(), type ).toBe( 200 );

			const read = await api.get( '/wp-json/wp/v2/settings', {
				headers: authHeader,
			} );
			expect( ( await read.json() ).fair_events_organizer.type ).toBe(
				type
			);
		}
	} );

	test( 'rejects an unknown type and keeps the saved one', async () => {
		await api.post( '/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: { fair_events_organizer: { name: 'Acme', type: 'NGO' } },
		} );

		const res = await api.post( '/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: { fair_events_organizer: { name: 'Acme', type: 'Club' } },
		} );
		expect( res.status() ).toBe( 400 );

		const read = await api.get( '/wp-json/wp/v2/settings', {
			headers: authHeader,
		} );
		expect( ( await read.json() ).fair_events_organizer.type ).toBe(
			'NGO'
		);
	} );

	test( 'rejects an unauthenticated write', async () => {
		const anonymousApi = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymousApi.post( '/wp-json/wp/v2/settings', {
			data: { fair_events_organizer: { name: 'Should Not Save' } },
		} );

		expect( res.status() ).toBe( 401 );
		await anonymousApi.dispose();
	} );

	test.describe( 'notification_emails', () => {
		const writeOrganizer = ( data, headers = authHeader ) =>
			api.post( '/wp-json/wp/v2/settings', {
				headers,
				data: { fair_events_organizer: data },
			} );

		const readOrganizer = async () => {
			const res = await api.get( '/wp-json/wp/v2/settings', {
				headers: authHeader,
			} );
			return ( await res.json() ).fair_events_organizer;
		};

		test( 'saves recipients, dropping case-insensitive duplicates in first-entry order', async () => {
			const res = await writeOrganizer( {
				name: 'Acme Club',
				contact_email: 'info@example.com',
				notification_emails: [
					'Team@Example.com',
					'board@example.com',
					'team@example.com',
				],
			} );

			expect( res.status() ).toBe( 200 );
			const saved = await readOrganizer();
			expect( saved.notification_emails ).toEqual( [
				'Team@Example.com',
				'board@example.com',
			] );
			expect( saved.name ).toBe( 'Acme Club' );
			expect( saved.contact_email ).toBe( 'info@example.com' );
		} );

		test( 'clearing recipients keeps the identity and public contact', async () => {
			await writeOrganizer( {
				name: 'Acme Club',
				contact_email: 'info@example.com',
				notification_emails: [ 'team@example.com' ],
			} );

			const res = await writeOrganizer( {
				name: 'Acme Club',
				contact_email: 'info@example.com',
				notification_emails: [],
			} );

			expect( res.status() ).toBe( 200 );
			const saved = await readOrganizer();
			expect( saved.notification_emails ).toEqual( [] );
			expect( saved.name ).toBe( 'Acme Club' );
			expect( saved.contact_email ).toBe( 'info@example.com' );
		} );

		test( 'rejects a malformed address and keeps the saved organizer', async () => {
			await writeOrganizer( {
				name: 'Acme Club',
				notification_emails: [ 'team@example.com' ],
			} );

			for ( const malformed of [
				[ 'team@example.com', 'not an email' ],
				[ '' ],
				[ 42 ],
				// Core parses a string as a comma-separated list, so each
				// listed address is still validated.
				'team@example.com, not an email',
			] ) {
				const res = await writeOrganizer( {
					name: 'Changed Name',
					notification_emails: malformed,
				} );

				expect( res.status() ).toBe( 400 );
				const body = await res.json();
				expect( body.code ).toBe( 'rest_invalid_param' );
				expect( body.data.params.fair_events_organizer ).toBeTruthy();
			}

			const saved = await readOrganizer();
			expect( saved.name ).toBe( 'Acme Club' );
			expect( saved.notification_emails ).toEqual( [
				'team@example.com',
			] );
		} );

		test( 'anonymous and non-administrator users can neither read nor write recipients', async () => {
			await writeOrganizer( {
				name: 'Acme Club',
				notification_emails: [ 'private-team@example.com' ],
			} );

			const anonymous = await request.newContext( { baseURL: BASE_URL } );
			const anonRead = await anonymous.get( '/wp-json/wp/v2/settings' );
			expect( anonRead.status() ).toBe( 401 );
			expect( await anonRead.text() ).not.toContain(
				'private-team@example.com'
			);
			await anonymous.dispose();

			const username = `organizer-editor-${ Date.now() }`;
			const password = 'Organizer-editor-test-2303!';
			const userRes = await api.post( '/wp-json/wp/v2/users', {
				headers: authHeader,
				data: {
					username,
					password,
					email: `${ username }@example.test`,
					roles: [ 'editor' ],
				},
			} );
			expect( userRes.ok() ).toBeTruthy();
			const userId = ( await userRes.json() ).id;
			const editorHeader = {
				Authorization:
					'Basic ' +
					Buffer.from( `${ username }:${ password }` ).toString(
						'base64'
					),
			};

			try {
				const editorRead = await api.get( '/wp-json/wp/v2/settings', {
					headers: editorHeader,
				} );
				expect( editorRead.status() ).toBe( 403 );
				expect( await editorRead.text() ).not.toContain(
					'private-team@example.com'
				);

				const editorWrite = await writeOrganizer(
					{ notification_emails: [ 'editor@example.com' ] },
					editorHeader
				);
				expect( editorWrite.status() ).toBe( 403 );
			} finally {
				await api.delete(
					`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
					{ headers: authHeader }
				);
			}

			expect( ( await readOrganizer() ).notification_emails ).toEqual( [
				'private-team@example.com',
			] );
		} );
	} );
} );
