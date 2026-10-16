<?php
/**
 * Retired placeholder tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\RetiredPlaceholders;
use PHPUnit\Framework\TestCase;

/**
 * Covers how saved messages with the retired photo upload link send.
 */
class RetiredPlaceholdersTest extends TestCase {

	/**
	 * A link to the placeholder is dropped with its text; the rest stays.
	 *
	 * @return void
	 */
	public function test_drops_the_whole_link() {
		$this->assertSame(
			'<p>Thanks for coming! </p><p>See you soon.</p>',
			RetiredPlaceholders::strip(
				'<p>Thanks for coming! <a href="{photo_upload_url}">Upload photos</a></p><p>See you soon.</p>'
			)
		);
	}

	/**
	 * Attribute order, single quotes, case and multi-line link text are
	 * handled, and every link is removed.
	 *
	 * @return void
	 */
	public function test_handles_link_variants() {
		$this->assertSame(
			'<p>A  B</p>',
			RetiredPlaceholders::strip(
				"<p>A <A class=\"btn\" href='{photo_upload_url}' target=\"_blank\"><strong>Upload\nphotos</strong></A> B<a href=\"{photo_upload_url}\">again</a></p>"
			)
		);
	}

	/**
	 * A bare placeholder is removed without touching other placeholders.
	 *
	 * @return void
	 */
	public function test_removes_bare_placeholder() {
		$this->assertSame(
			'<p>Upload here:  or open <a href="{event_page_url}">the event</a></p>',
			RetiredPlaceholders::strip(
				'<p>Upload here: {photo_upload_url} or open <a href="{event_page_url}">the event</a></p>'
			)
		);
	}

	/**
	 * Content without the placeholder is returned unchanged.
	 *
	 * @return void
	 */
	public function test_leaves_other_content_alone() {
		$content = '<p>Hello <a href="https://example.com">there</a></p>';
		$this->assertSame( $content, RetiredPlaceholders::strip( $content ) );
	}
}
