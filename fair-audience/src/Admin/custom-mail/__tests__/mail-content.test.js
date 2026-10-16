/**
 * @jest-environment jsdom
 *
 * Unit tests for the Custom Mail content helpers: the retired photo upload
 * link (#1689) is removed the way the server removes it when sending, so a
 * body holding nothing else counts as empty.
 */

import {
	hasVisibleContent,
	stripRetiredPlaceholders,
} from '../mail-content.js';

describe( 'stripRetiredPlaceholders', () => {
	it( 'drops a link to the retired placeholder with its text', () => {
		expect(
			stripRetiredPlaceholders(
				'<p>Thanks! <a href="{photo_upload_url}">Upload photos</a></p>'
			)
		).toBe( '<p>Thanks! </p>' );
	} );

	it( 'handles attribute order, quotes, case and nested markup', () => {
		expect(
			stripRetiredPlaceholders(
				'<p>A <A class="btn" href=\'{photo_upload_url}\'><strong>Up\nload</strong></A> B</p>'
			)
		).toBe( '<p>A  B</p>' );
	} );

	it( 'removes a bare placeholder and keeps other placeholders', () => {
		expect(
			stripRetiredPlaceholders(
				'<p>{photo_upload_url} <a href="{event_page_url}">Event</a></p>'
			)
		).toBe( '<p> <a href="{event_page_url}">Event</a></p>' );
	} );

	it( 'leaves other content untouched', () => {
		const html = '<p>Hello <a href="https://example.com">there</a></p>';
		expect( stripRetiredPlaceholders( html ) ).toBe( html );
		expect( stripRetiredPlaceholders( '' ) ).toBe( '' );
	} );

	it( 'leaves nothing visible when the link was the only content', () => {
		expect(
			hasVisibleContent(
				stripRetiredPlaceholders(
					'<p><a href="{photo_upload_url}">Upload</a></p>'
				)
			)
		).toBe( false );
	} );
} );
