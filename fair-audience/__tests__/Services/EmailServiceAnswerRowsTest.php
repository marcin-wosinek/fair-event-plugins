<?php
/**
 * EmailService answer-row integration tests (#2233).
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use FairEventsShared\Notifications\QuestionnaireAnswerRows;

/**
 * Verifies that each EmailService email with questionnaire answers renders
 * them through the shared QuestionnaireAnswerRows formatter, and that the
 * deprecated form notification keeps its submitter rows and page context.
 */
class EmailServiceAnswerRowsTest extends TestCase {

	/**
	 * Seed answers' dependencies and reset recorded emails.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails']     = array();
		$GLOBALS['_fair_test_attachment_urls'] = array( 21 => 'https://example.test/uploads/cv.pdf' );
		$GLOBALS['_fair_test_post_titles']     = array( 21 => 'My CV' );
		$GLOBALS['_fair_test_posts']           = array(
			5 => (object) array(
				'ID'         => 5,
				'post_title' => 'Contact <us>',
			),
		);
	}

	/**
	 * Clear seeded globals.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_attachment_urls'], $GLOBALS['_fair_test_post_titles'], $GLOBALS['_fair_test_posts'] );
		parent::tearDown();
	}

	/**
	 * Answers covering text, a selection, a resolved and a missing file.
	 *
	 * @return array
	 */
	private function answers(): array {
		return array(
			array(
				'question_text' => 'Why <join>?',
				'question_type' => 'long_text',
				'answer_value'  => 'Fun & games',
			),
			array(
				'question_text' => 'Days',
				'question_type' => 'multiselect',
				'answer_value'  => '["Mon","Tue"]',
			),
			array(
				'question_text' => 'CV',
				'question_type' => 'file_upload',
				'answer_value'  => '21',
			),
			array(
				'question_text' => 'Portfolio',
				'question_type' => 'file_upload',
				'answer_value'  => '404404',
			),
		);
	}

	/**
	 * Build a valid-email participant.
	 *
	 * @return Participant
	 */
	private function participant(): Participant {
		$participant        = new Participant();
		$participant->id    = 7;
		$participant->name  = 'Jane';
		$participant->email = 'jane@example.test';
		return $participant;
	}

	/**
	 * The latest recorded email.
	 *
	 * @return array
	 */
	private function sent(): array {
		$this->assertNotEmpty( $GLOBALS['_fair_test_sent_emails'] );
		return end( $GLOBALS['_fair_test_sent_emails'] );
	}

	/**
	 * The deprecated notification keeps submitter rows and page context
	 * ahead of the shared answer rows.
	 */
	public function test_form_notification_renders_submitter_context_and_answers(): void {
		$result = ( new EmailService() )->send_form_notification(
			'admin@example.test',
			'Ann',
			'<Smith>',
			'ann@example.test',
			$this->answers(),
			5
		);

		$this->assertTrue( $result );
		$sent = $this->sent();
		$this->assertSame( 'admin@example.test', $sent['to'] );
		$this->assertStringContainsString( 'New form submission', $sent['subject'] );

		$message = $sent['message'];
		$this->assertStringContainsString( 'A new form submission has been received.', $message );
		$this->assertStringContainsString( 'Page: <strong>Contact &lt;us&gt;</strong>', $message );
		$this->assertStringContainsString( QuestionnaireAnswerRows::row( 'Name', 'Ann &lt;Smith&gt;' ), $message );
		$this->assertStringContainsString(
			QuestionnaireAnswerRows::row( 'Email', '<a href="mailto:ann@example.test" style="color: #0073aa;">ann@example.test</a>' ),
			$message
		);
		$this->assertStringContainsString( QuestionnaireAnswerRows::html( $this->answers() ), $message );
		$this->assertStringNotContainsString( '404404', $message );
		$this->assertLessThan( strpos( $message, 'Why &lt;join&gt;?' ), strpos( $message, 'ann@example.test' ) );
	}

	/**
	 * Without a page, the notification omits the page context.
	 */
	public function test_form_notification_without_page_omits_context(): void {
		( new EmailService() )->send_form_notification( 'admin@example.test', 'Ann', '', 'ann@example.test', $this->answers() );

		$this->assertStringNotContainsString( 'Page:', $this->sent()['message'] );
	}

	/**
	 * The submitter confirmation renders the shared answer rows.
	 */
	public function test_form_confirmation_uses_shared_answer_rows(): void {
		$this->assertTrue( ( new EmailService() )->send_form_confirmation( $this->participant(), $this->answers(), 5 ) );

		$message = $this->sent()['message'];
		$this->assertStringContainsString( QuestionnaireAnswerRows::html( $this->answers() ), $message );
		$this->assertStringContainsString( '>Mon, Tue</td>', $message );
		$this->assertStringContainsString( '>My CV</a>', $message );
		$this->assertStringNotContainsString( '404404', $message );
	}
}
