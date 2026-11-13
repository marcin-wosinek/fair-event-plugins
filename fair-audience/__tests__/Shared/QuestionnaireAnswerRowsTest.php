<?php
/**
 * FairEventsShared\Notifications\QuestionnaireAnswerRows and
 * FormSubmissionEmail formatting tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Notifications\FormSubmissionEmail;
use FairEventsShared\Notifications\QuestionnaireAnswerRows;

/**
 * Unit tests for the shared questionnaire-answer rows and the
 * form-submission notification document (#2233).
 */
class QuestionnaireAnswerRowsTest extends TestCase {

	/**
	 * Seed attachments and reset post titles before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_attachment_urls'] = array(
			11 => 'https://example.test/uploads/report.pdf',
			12 => 'https://example.test/uploads/photo.jpg',
			13 => 'https://example.test/uploads/a"b.pdf?x=<y>',
		);
		$GLOBALS['_fair_test_post_titles']     = array(
			11 => 'Quarterly <b>Report</b>',
			13 => '',
		);
	}

	/**
	 * Clear seeded globals after each test.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_attachment_urls'], $GLOBALS['_fair_test_post_titles'] );
		parent::tearDown();
	}

	/**
	 * Extract each row's label and value cell contents, in order.
	 *
	 * @param string $html `<tr>` markup.
	 * @return array List of [label, value] pairs.
	 */
	private function cells( string $html ): array {
		preg_match_all( '#<tr>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*</tr>#s', $html, $matches, PREG_SET_ORDER );

		return array_map(
			static function ( $found ) {
				return array( $found[1], $found[2] );
			},
			$matches
		);
	}

	/**
	 * Array and object answers render identically, in their given order.
	 */
	public function test_array_and_object_answers_render_in_order(): void {
		$answers = array(
			array(
				'question_text' => 'First',
				'question_type' => 'short_text',
				'answer_value'  => 'one',
			),
			(object) array(
				'question_text' => 'Second',
				'question_type' => 'short_text',
				'answer_value'  => 'two',
			),
		);

		$this->assertSame(
			array( array( 'First', 'one' ), array( 'Second', 'two' ) ),
			$this->cells( QuestionnaireAnswerRows::html( $answers ) )
		);
	}

	/**
	 * JSON selections join with commas; empty, zero and invalid-JSON values
	 * keep their rows and raw text.
	 */
	public function test_text_selection_empty_zero_and_invalid_json_values(): void {
		$answers = array(
			array(
				'question_text' => 'Colors',
				'question_type' => 'multiselect',
				'answer_value'  => '["Red","Blue"]',
			),
			array(
				'question_text' => 'Empty',
				'question_type' => 'short_text',
				'answer_value'  => '',
			),
			array(
				'question_text' => 'Missing value',
				'question_type' => 'short_text',
			),
			array(
				'question_text' => 'Zero',
				'question_type' => 'number',
				'answer_value'  => '0',
			),
			array(
				'question_text' => 'Broken',
				'question_type' => 'long_text',
				'answer_value'  => '[1, 2',
			),
		);

		$this->assertSame(
			array(
				array( 'Colors', 'Red, Blue' ),
				array( 'Empty', '' ),
				array( 'Missing value', '' ),
				array( 'Zero', '0' ),
				array( 'Broken', '[1, 2' ),
			),
			$this->cells( QuestionnaireAnswerRows::html( $answers ) )
		);
	}

	/**
	 * File answers link to the attachment, labelled by title or filename;
	 * unresolved attachments are skipped without exposing their ID.
	 */
	public function test_file_answers_resolve_or_are_skipped(): void {
		$answers = array(
			array(
				'question_text' => 'Report',
				'question_type' => 'file_upload',
				'answer_value'  => '11',
			),
			array(
				'question_text' => 'Photo',
				'question_type' => 'file_upload',
				'answer_value'  => 12,
			),
			array(
				'question_text' => 'Missing',
				'question_type' => 'file_upload',
				'answer_value'  => '987654',
			),
			array(
				'question_text' => 'Invalid',
				'question_type' => 'file_upload',
				'answer_value'  => 'not-an-id',
			),
			array(
				'question_text' => 'Empty file',
				'question_type' => 'file_upload',
				'answer_value'  => '',
			),
		);

		$html = QuestionnaireAnswerRows::html( $answers );

		$this->assertSame(
			array(
				array( 'Report', '<a href="https://example.test/uploads/report.pdf" style="color: #0073aa;">Quarterly &lt;b&gt;Report&lt;/b&gt;</a>' ),
				array( 'Photo', '<a href="https://example.test/uploads/photo.jpg" style="color: #0073aa;">photo.jpg</a>' ),
			),
			$this->cells( $html )
		);
		$this->assertStringNotContainsString( '987654', $html );
		$this->assertStringNotContainsString( 'not-an-id', $html );
		$this->assertStringNotContainsString( 'Missing', $html );
	}

	/**
	 * Question text, answers, attachment labels and URLs are escaped.
	 */
	public function test_user_content_is_escaped(): void {
		$answers = array(
			array(
				'question_text' => 'Q <script>alert(1)</script>',
				'question_type' => 'short_text',
				'answer_value'  => 'A & <img src=x onerror=1>',
			),
			array(
				'question_text' => 'Picks',
				'question_type' => 'multiselect',
				'answer_value'  => '["<b>bold</b>","x\"y"]',
			),
			array(
				'question_text' => 'File',
				'question_type' => 'file_upload',
				'answer_value'  => '13',
			),
		);

		$html = QuestionnaireAnswerRows::html( $answers );

		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringNotContainsString( '<img', $html );
		$this->assertStringNotContainsString( '<b>', $html );
		$this->assertSame(
			array(
				array( 'Q &lt;script&gt;alert(1)&lt;/script&gt;', 'A &amp; &lt;img src=x onerror=1&gt;' ),
				array( 'Picks', '&lt;b&gt;bold&lt;/b&gt;, x&quot;y' ),
				array( 'File', '<a href="https://example.test/uploads/a&quot;b.pdf?x=&lt;y&gt;" style="color: #0073aa;">a&quot;b.pdf?x=&lt;y&gt;</a>' ),
			),
			$this->cells( $html )
		);
	}

	/**
	 * No answers render no rows.
	 */
	public function test_no_answers_render_nothing(): void {
		$this->assertSame( '', QuestionnaireAnswerRows::html( array() ) );
	}

	/**
	 * The notification document places context and submitter rows before
	 * the answers, and omits both when empty.
	 */
	public function test_notification_document_with_and_without_optional_parts(): void {
		$answers_html = QuestionnaireAnswerRows::row( 'Q', 'A' );

		$full = FormSubmissionEmail::html(
			array(
				'site_name'      => 'Site &amp; Co',
				'intro'          => 'A new form submission has been received.',
				'context_html'   => '<p class="ctx">Page: <strong>Contact</strong></p>',
				'submitter_html' => QuestionnaireAnswerRows::row( 'Email', 'sub@example.test' ),
				'answers_html'   => $answers_html,
			)
		);

		$this->assertStringStartsWith( '<!DOCTYPE html>', $full );
		$this->assertSame( 2, substr_count( $full, 'Site &amp; Co' ) );
		$this->assertStringContainsString( 'A new form submission has been received.', $full );
		$intro_pos     = strpos( $full, 'A new form submission' );
		$context_pos   = strpos( $full, 'class="ctx"' );
		$submitter_pos = strpos( $full, 'sub@example.test' );
		$answers_pos   = strpos( $full, '>Q</td>' );
		$this->assertTrue( $intro_pos < $context_pos && $context_pos < $submitter_pos && $submitter_pos < $answers_pos );

		$bare = FormSubmissionEmail::html(
			array(
				'site_name'    => 'Site',
				'intro'        => 'Intro.',
				'answers_html' => $answers_html,
			)
		);

		$this->assertStringNotContainsString( 'class="ctx"', $bare );
		$this->assertStringNotContainsString( 'sub@example.test', $bare );
		$this->assertStringContainsString( $answers_html, $bare );
	}
}
