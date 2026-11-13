<?php
/**
 * FormNotificationService::send() rendering tests (#2233).
 *
 * @package FairForm
 */

namespace FairForm\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairForm\Services\FormNotificationService;
use FairEventsShared\Notifications\QuestionnaireAnswerRows;
use FairForm\Tests\Services\Fakes\FakeNotificationWpdb;

require_once __DIR__ . '/fakes/FakeNotificationWpdb.php';

/**
 * Verifies the Fair Form notification renders through the shared answer
 * rows and notification document, keeping its own submitter and context.
 */
class FormNotificationServiceTest extends TestCase {

	/**
	 * Previous global $wpdb, restored after each test.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * Install the $wpdb double and seed WordPress state.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.
		$GLOBALS['wpdb'] = new FakeNotificationWpdb();

		$GLOBALS['_fair_test_sent_emails']     = array();
		$GLOBALS['_fair_test_actions']         = array();
		$GLOBALS['_fair_test_options']         = array( 'blogname' => 'Club &amp; Co' );
		$GLOBALS['_fair_test_posts']           = array(
			9 => (object) array(
				'ID'         => 9,
				'post_title' => 'Join <us>',
			),
		);
		$GLOBALS['_fair_test_attachment_urls'] = array( 31 => 'https://example.test/uploads/id-scan.png' );
	}

	/**
	 * Restore globals.
	 */
	protected function tearDown(): void {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the test-only fake.
		$GLOBALS['wpdb'] = $this->previous_wpdb;
		unset(
			$GLOBALS['_fair_test_sent_emails'],
			$GLOBALS['_fair_test_actions'],
			$GLOBALS['_fair_test_options'],
			$GLOBALS['_fair_test_posts'],
			$GLOBALS['_fair_test_attachment_urls']
		);
		parent::tearDown();
	}

	/**
	 * Build an answer row as the repository stores it.
	 *
	 * @param string $text  Question text.
	 * @param string $type  Question type.
	 * @param string $value Stored answer value.
	 * @return array
	 */
	private function answer( string $text, string $type, string $value ): array {
		return array(
			'id'            => 1,
			'submission_id' => 4,
			'question_key'  => 'q',
			'question_text' => $text,
			'question_type' => $type,
			'answer_value'  => $value,
			'display_order' => 0,
		);
	}

	/**
	 * A submission with an email answer and a page renders the submitter row,
	 * page context and shared answer rows.
	 */
	public function test_send_renders_submitter_context_and_answers(): void {
		$GLOBALS['wpdb']->submission = array(
			'id'      => 4,
			'post_id' => 9,
			'form_id' => 'f1',
		);
		$GLOBALS['wpdb']->answers    = array(
			$this->answer( 'Email', 'email', 'sub@example.test' ),
			$this->answer( 'Topics <x>', 'multiselect', '["A","<B>"]' ),
			$this->answer( 'ID scan', 'file_upload', '31' ),
			$this->answer( 'Lost upload', 'file_upload', '777777' ),
		);

		$this->assertTrue( ( new FormNotificationService() )->send( 4, 'admin@example.test' ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'admin@example.test', $sent['to'] );
		$this->assertSame( 'New form submission — Club & Co', $sent['subject'] );

		$message = $sent['message'];
		$this->assertSame( 2, substr_count( $message, 'Club &amp; Co' ) );
		$this->assertStringContainsString( 'A new form submission has been received.', $message );
		$this->assertStringContainsString( 'Page: <strong>Join &lt;us&gt;</strong>', $message );
		$this->assertStringContainsString(
			QuestionnaireAnswerRows::row( 'Email', '<a href="mailto:sub@example.test" style="color: #0073aa;">sub@example.test</a>' ),
			$message
		);
		$this->assertStringContainsString( '>A, &lt;B&gt;</td>', $message );
		$this->assertStringContainsString( '>id-scan.png</a>', $message );
		$this->assertStringNotContainsString( '777777', $message );
		$this->assertStringNotContainsString( 'Lost upload', $message );
	}

	/**
	 * Without an email answer or page, the submitter row and context are
	 * omitted while answers still render.
	 */
	public function test_send_without_email_answer_or_page(): void {
		$GLOBALS['wpdb']->submission = array(
			'id'      => 5,
			'form_id' => 'f1',
		);
		$GLOBALS['wpdb']->answers    = array( $this->answer( 'Note', 'short_text', '' ) );

		$this->assertTrue( ( new FormNotificationService() )->send( 5, 'admin@example.test' ) );

		$message = $GLOBALS['_fair_test_sent_emails'][0]['message'];
		$this->assertStringNotContainsString( 'mailto:', $message );
		$this->assertStringNotContainsString( 'Page:', $message );
		$this->assertStringContainsString( QuestionnaireAnswerRows::row( 'Note', '' ), $message );
	}

	/**
	 * A missing submission sends nothing and reports the failure.
	 */
	public function test_missing_submission_reports_failure(): void {
		$this->assertFalse( ( new FormNotificationService() )->send( 6, 'admin@example.test' ) );
		$this->assertSame( array(), $GLOBALS['_fair_test_sent_emails'] );
		$this->assertSame( 'fair_form_notification_failed', $GLOBALS['_fair_test_actions'][0][0] );
		$this->assertSame( 'submission_not_found', $GLOBALS['_fair_test_actions'][0][1][0] );
	}
}
