/**
 * Playwright API tests for InstagramPostsController.
 *
 * Covers the routes the Instagram Posts admin page still uses, and the
 * retirement of the upload-blob route that only the removed Weekly Schedule
 * page called (#1809):
 *
 *   GET  /fair-audience/v1/instagram/posts
 *   POST /fair-audience/v1/instagram/posts
 *   POST /fair-audience/v1/instagram/upload-image
 *   POST /fair-audience/v1/instagram/upload-blob (retired)
 *
 * Out of HTTP scope (validated manually per TESTING.md's WP-CLI eval-file
 * recipe): the live Instagram Graph API round-trip, which requires
 * configured Instagram credentials.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

// Well-known 1x1 transparent PNG.
const VALID_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe( 'InstagramPostsController', () => {
	let api;
	const createdAttachmentIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of createdAttachmentIds ) {
			await api.delete( `/wp-json/wp/v2/media/${ id }`, {
				headers: authHeaders,
				params: { force: true },
			} );
		}
		await api.dispose();
	} );

	test( 'the retired upload-blob route is not registered', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-blob',
			{
				headers: authHeaders,
				data: { image_data: VALID_PNG_BASE64 },
			}
		);
		expect( res.status() ).toBe( 404 );

		const body = await res.json();
		expect( body.code ).toBe( 'rest_no_route' );
	} );

	test( 'lists posts for an administrator', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/instagram/posts',
			{
				headers: authHeaders,
			}
		);
		expect( res.ok() ).toBeTruthy();
		expect( Array.isArray( await res.json() ) ).toBe( true );
	} );

	test( 'rejects unauthenticated list and create requests', async () => {
		const list = await api.get(
			'/wp-json/fair-audience/v1/instagram/posts'
		);
		expect( list.status() ).toBe( 401 );

		const create = await api.post(
			'/wp-json/fair-audience/v1/instagram/posts',
			{
				data: {
					image_url: 'https://example.com/image.png',
					caption: 'Caption',
				},
			}
		);
		expect( create.status() ).toBe( 401 );
	} );

	test( 'rejects a post without a caption', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/posts',
			{
				headers: authHeaders,
				data: { image_url: 'https://example.com/image.png' },
			}
		);
		expect( res.status() ).toBe( 400 );

		const body = await res.json();
		expect( body.code ).toBe( 'rest_missing_callback_param' );
	} );

	test( 'resolves the public URL of a media-library image', async () => {
		const upload = await api.post( '/wp-json/wp/v2/media', {
			headers: {
				...authHeaders,
				'Content-Type': 'image/png',
				'Content-Disposition':
					'attachment; filename="instagram-api-spec.png"',
			},
			data: Buffer.from( VALID_PNG_BASE64, 'base64' ),
		} );
		expect( upload.ok() ).toBeTruthy();
		const attachment = await upload.json();
		createdAttachmentIds.push( attachment.id );

		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-image',
			{
				headers: authHeaders,
				data: { attachment_id: attachment.id },
			}
		);
		expect( res.ok() ).toBeTruthy();

		const body = await res.json();
		expect( body.url ).toBe( attachment.source_url );

		// The Graph API needs a URL that actually serves image bytes.
		const imageRes = await api.get( body.url );
		expect( imageRes.ok() ).toBeTruthy();
		expect( imageRes.headers()[ 'content-type' ] ).toBe( 'image/png' );
	} );

	test( 'rejects an attachment that is not an image', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/instagram/upload-image',
			{
				headers: authHeaders,
				data: { attachment_id: 999999999 },
			}
		);
		expect( res.status() ).toBe( 400 );

		const body = await res.json();
		expect( body.code ).toBe( 'invalid_attachment' );
	} );
} );
