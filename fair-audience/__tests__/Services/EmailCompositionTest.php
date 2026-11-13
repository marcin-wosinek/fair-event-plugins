<?php
/**
 * Full-output characterization of EmailService's composed messages.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairAudience\Services\EmailService;
use FairAudience\Models\Participant;

/**
 * Pins the recipient, subject and complete HTML body of every message
 * EmailService composes, against golden files recorded before the shared
 * EmailLayout refactor (#2234).
 *
 * Comparison normalizes only formatting that never renders: HTML comments
 * are dropped, whitespace runs collapse to one space, and whitespace next to
 * a block-level tag is removed. Each block tag then starts a new line so the
 * fixtures stay readable. Links, inline styles, text, escaping and
 * whitespace around inline elements are compared exactly. Tokens are deterministic HMACs under the
 * stubbed salt, so no value needs masking.
 *
 * To re-record after an intentional output change, run with
 * FAIR_AUDIENCE_UPDATE_EMAIL_FIXTURES=1 and review the fixture diff.
 */
class EmailCompositionTest extends TestCase {

	/**
	 * Golden-file directory.
	 */
	private const FIXTURE_DIR = __DIR__ . '/fixtures/email-composition';

	/**
	 * Reset recorded emails and seed deterministic site state.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails']     = array();
		$GLOBALS['_fair_test_options']         = array( 'blogname' => 'Fair &amp; Square <Club>' );
		$GLOBALS['_fair_test_post_titles']     = array( 5 => 'Meetup <Spring> & "Co"' );
		$GLOBALS['_fair_test_attachment_urls'] = array();
		$GLOBALS['_fair_test_posts']           = array(
			9 => (object) array(
				'ID'         => 9,
				'post_title' => 'Contact <us>',
			),
		);
	}

	/**
	 * Clear seeded globals.
	 */
	protected function tearDown(): void {
		unset(
			$GLOBALS['_fair_test_options'],
			$GLOBALS['_fair_test_post_titles'],
			$GLOBALS['_fair_test_attachment_urls'],
			$GLOBALS['_fair_test_posts']
		);
		parent::tearDown();
	}

	/**
	 * Participant with characters that must be escaped.
	 *
	 * @param string $name Participant name.
	 * @return Participant
	 */
	private static function participant( string $name = "Ana <O'Brien> & Co" ): Participant {
		$participant                = new Participant();
		$participant->id            = 7;
		$participant->name          = $name;
		$participant->email         = 'ana@example.test';
		$participant->email_profile = 'marketing';
		$participant->status        = 'confirmed';
		return $participant;
	}

	/**
	 * Event post-like object.
	 *
	 * @return object
	 */
	private static function event(): object {
		return (object) array(
			'ID'         => 5,
			'post_title' => 'Meetup <Spring> & "Co"',
		);
	}

	/**
	 * Questionnaire answers with escaping-sensitive text.
	 *
	 * @return array
	 */
	private static function answers(): array {
		return array(
			array(
				'question_text' => 'Why <join>?',
				'question_type' => 'long_text',
				'answer_value'  => "Fun & games\nand more",
			),
			array(
				'question_text' => 'Days',
				'question_type' => 'multiselect',
				'answer_value'  => '["Mon","Tue"]',
			),
		);
	}

	/**
	 * Custom-mail body using every resolvable placeholder.
	 *
	 * @return string
	 */
	private static function custom_content(): string {
		return '<p>Hello {participant_name}, see {event_name} on {event_date}.</p>'
			. '<p><a href="{manage_subscription_url}">Manage</a> | <a href="{unsubscribe_link}">Unsubscribe</a>'
			. ' | <a href="{event_page_url}">Your page</a> | <a href="{token_link_5}">Event</a></p>';
	}

	/**
	 * One send per composition path and optional-content variant.
	 *
	 * @return array<string, array{0: callable}>
	 */
	public static function emails(): array {
		$paid = (object) array(
			'amount'   => 25.5,
			'currency' => 'EUR',
		);

		return array(
			'poll-invitation'                  => array(
				static fn( EmailService $s ) => $s->send_poll_invitation( (object) array( 'id' => 3 ), self::event(), self::participant(), 'poll-key', "Line one\nLine <two>" ),
			),
			'poll-invitation-no-message'       => array(
				static fn( EmailService $s ) => $s->send_poll_invitation( (object) array( 'id' => 3 ), self::event(), self::participant(), 'poll-key' ),
			),
			'confirmation'                     => array(
				static fn( EmailService $s ) => $s->send_confirmation_email( self::participant(), 'confirm-token' ),
			),
			'audience-signup-answers'          => array(
				static fn( EmailService $s ) => $s->send_audience_signup_answers_email( self::participant(), 11, self::answers(), 9 ),
			),
			'resume-registration-paid'         => array(
				static fn( EmailService $s ) => $s->send_resume_registration_email( self::event(), self::participant(), 'https://example.com/resume?a=1&b=2', true ),
			),
			'resume-registration-free'         => array(
				static fn( EmailService $s ) => $s->send_resume_registration_email( self::event(), self::participant(), 'https://example.com/resume?a=1&b=2', false ),
			),
			'custom-mail-rendered'             => array(
				static fn( EmailService $s ) => $s->send_custom_mail_rendered(
					self::participant(),
					'Scheduled <news>',
					self::custom_content(),
					0,
					array(
						'event_name' => 'Meetup <Spring>',
						'event_date' => 'May 1 & 2',
					)
				),
			),
			'custom-mail'                      => array(
				static fn( EmailService $s ) => $s->send_custom_mail( self::event(), self::participant(), 'Event <news>', self::custom_content() ),
			),
			'custom-mail-without-event'        => array(
				static fn( EmailService $s ) => $s->send_custom_mail_without_event( self::participant(), 'General <news>', self::custom_content() ),
			),
			'fee-reminder'                     => array(
				static fn( EmailService $s ) => $s->send_fee_reminder(
					self::participant(),
					(object) array(
						'name'     => 'Dues <2026>',
						'currency' => 'EUR',
						'due_date' => '2026-12-01',
					),
					(object) array(
						'id'     => 4,
						'amount' => 12,
					)
				),
			),
			'fee-reminder-no-due-date'         => array(
				static fn( EmailService $s ) => $s->send_fee_reminder(
					self::participant(),
					(object) array(
						'name'     => 'Dues <2026>',
						'currency' => 'EUR',
						'due_date' => '',
					),
					(object) array(
						'id'     => 4,
						'amount' => 12,
					)
				),
			),
			'form-notification'                => array(
				static fn( EmailService $s ) => $s->send_form_notification( 'admin@example.test', 'Ana', "O'Brien", 'ana@example.test', self::answers(), 9 ),
			),
			'html-mail-to-address'             => array(
				static fn( EmailService $s ) => $s->send_html_mail_to_address( 'admin@example.test', 'Digest <test>', '<p>Digest & body</p>' ),
			),
			'form-confirmation'                => array(
				static fn( EmailService $s ) => $s->send_form_confirmation( self::participant(), self::answers(), 9 ),
			),
			'form-confirmation-bare'           => array(
				static fn( EmailService $s ) => $s->send_form_confirmation( self::participant(), array(), 0 ),
			),
			'signup-confirmation-free'         => array(
				static fn( EmailService $s ) => $s->send_signup_payment_confirmation( self::participant(), self::event(), null, array(), 0, 0, 42 ),
			),
			'signup-confirmation-paid-extras'  => array(
				static fn( EmailService $s ) => $s->send_signup_payment_confirmation( self::participant(), self::event(), $paid, array( 'Lunch <veg>', 'T-shirt & cap' ), 0, 0, 43 ),
			),
			'activities-added-paid'            => array(
				static fn( EmailService $s ) => $s->send_activities_added_confirmation( self::participant(), self::event(), $paid, array( 'Workshop <A>', 'Dinner & drinks' ) ),
			),
			'activities-added-free-empty'      => array(
				static fn( EmailService $s ) => $s->send_activities_added_confirmation( self::participant(), null, null, array() ),
			),
			'payment-failed'                   => array(
				static fn( EmailService $s ) => $s->send_signup_payment_failed( self::participant(), self::event(), 8, $paid ),
			),
			'payment-failed-no-amount'         => array(
				static fn( EmailService $s ) => $s->send_signup_payment_failed( self::participant(), null, 0, null ),
			),
			'event-invitation'                 => array(
				static fn( EmailService $s ) => $s->send_event_invitation( self::event(), self::participant(), 'https://example.com/signup?x=1&y=2', "Bring <friends>\n& snacks" ),
			),
			'event-invitation-no-message'      => array(
				static fn( EmailService $s ) => $s->send_event_invitation( self::event(), self::participant(), 'https://example.com/signup?x=1&y=2' ),
			),
			'event-interest'                   => array(
				static fn( EmailService $s ) => $s->send_event_interest_confirmation( self::participant(), 5, 8 ),
			),
			'event-interest-no-name'           => array(
				static fn( EmailService $s ) => $s->send_event_interest_confirmation( self::participant( '' ), 404, 0 ),
			),
			'mailing-list-welcome'             => array(
				static fn( EmailService $s ) => $s->send_mailing_list_welcome( self::participant(), 5 ),
			),
			'mailing-list-welcome-no-event'    => array(
				static fn( EmailService $s ) => $s->send_mailing_list_welcome( self::participant( '' ), 0 ),
			),
			'manage-subscription-link'         => array(
				static fn( EmailService $s ) => $s->send_manage_subscription_link( self::participant() ),
			),
			'manage-subscription-link-no-name' => array(
				static fn( EmailService $s ) => $s->send_manage_subscription_link( self::participant( '' ) ),
			),
		);
	}

	/**
	 * Each composed message matches its recorded baseline.
	 *
	 * @param callable $send Sends one message through a fresh EmailService.
	 */
	#[DataProvider( 'emails' )]
	public function test_message_matches_baseline( callable $send ): void {
		$name = $this->dataName();

		$this->assertTrue( $send( new EmailService() ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		$this->assertMatchesFixture( $name, $GLOBALS['_fair_test_sent_emails'][0] );
	}

	/**
	 * With branding on, the attribution sits just before </body>; the rest of
	 * the message is the unbranded baseline.
	 */
	public function test_branding_footer_precedes_body_close(): void {
		$GLOBALS['_fair_test_options']['fair_events_powered_by_branding'] = true;

		( new EmailService() )->send_custom_mail_without_event( self::participant(), 'General <news>', self::custom_content() );

		$sent   = $GLOBALS['_fair_test_sent_emails'][0];
		$footer = \FairAudience\Services\Branding::email_footer_html();
		$this->assertNotSame( '', $footer );
		$this->assertSame( 1, substr_count( $sent['message'], $footer . '</body>' ) );

		$sent['message'] = str_replace( $footer, '', $sent['message'] );
		$this->assertMatchesFixture( 'custom-mail-without-event', $sent );
	}

	/**
	 * Marketing consent still gates custom and invitation mail.
	 */
	public function test_marketing_sends_skip_without_consent(): void {
		$participant                = self::participant();
		$participant->email_profile = 'minimal';

		$service = new EmailService();
		$this->assertFalse( $service->send_custom_mail_without_event( $participant, 'General', '<p>Hi</p>' ) );
		$this->assertFalse( $service->send_event_invitation( self::event(), $participant, 'https://example.com/signup' ) );
		$this->assertSame( array(), $GLOBALS['_fair_test_sent_emails'] );
	}

	/**
	 * Compare a recorded send against its golden file.
	 *
	 * @param string $name Fixture name.
	 * @param array  $sent Recorded wp_mail() call.
	 */
	private function assertMatchesFixture( string $name, array $sent ): void {
		$actual = 'To: ' . $sent['to'] . "\n"
			. 'Subject: ' . $sent['subject'] . "\n\n"
			. self::normalize( $sent['message'] ) . "\n";
		$path   = self::FIXTURE_DIR . '/' . $name . '.html';

		if ( getenv( 'FAIR_AUDIENCE_UPDATE_EMAIL_FIXTURES' ) ) {
			if ( ! is_dir( self::FIXTURE_DIR ) ) {
				mkdir( self::FIXTURE_DIR, 0777, true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_mkdir -- test fixture recording.
			}
			file_put_contents( $path, $actual ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- test fixture recording.
		}

		$this->assertFileExists( $path );
		$this->assertSame( file_get_contents( $path ), $actual ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local fixture.
	}

	/**
	 * Drop rendering-neutral formatting from an HTML body.
	 *
	 * @param string $html HTML document.
	 * @return string Normalized HTML.
	 */
	private static function normalize( string $html ): string {
		$block = '<\/?(?:!DOCTYPE|html|head|meta|body|table|tr|td|h1|p|div|ul|li)\b[^>]*>';

		$html = preg_replace( '/<!--.*?-->/s', '', $html );
		$html = preg_replace( '/\s+/', ' ', $html );
		$html = preg_replace( '/ ?(' . $block . ') ?/i', '$1', $html );
		$html = preg_replace( '/(?<=>)(' . $block . ')/i', "\n$1", $html );

		return trim( (string) $html );
	}
}
