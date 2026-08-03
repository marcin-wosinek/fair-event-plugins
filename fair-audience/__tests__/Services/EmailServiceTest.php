<?php
/**
 * EmailService::send_signup_payment_confirmation() tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\EmailService;
use FairAudience\Models\Participant;

/**
 * Verifies the new registration-reference and ticket-type fields reach the
 * rendered email for both the free and paid signup paths. FairEvents\Models
 * classes are never loaded in fair-audience's test process, so the
 * event-date/ticket-type lookups inside EmailService no-op via their
 * class_exists() guards — these tests exercise everything reachable without
 * them (participant name, transaction amount, options, registration reference).
 */
class EmailServiceTest extends TestCase {

	/**
	 * Reset recorded test emails before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails'] = array();
	}

	/**
	 * Build a valid-email participant.
	 *
	 * @param string $name Participant name.
	 * @return Participant
	 */
	private function participant( $name = 'Jane Doe' ) {
		$participant        = new Participant();
		$participant->id    = 7;
		$participant->name  = $name;
		$participant->email = 'jane@example.test';
		return $participant;
	}

	/**
	 * Build a fake event post object.
	 *
	 * @return object
	 */
	private function event() {
		return (object) array(
			'post_title' => 'Community Meetup',
		);
	}

	/**
	 * The free-signup path includes the registration reference and omits the
	 * amount-paid row (no transaction).
	 */
	public function test_free_signup_includes_registration_reference(): void {
		$email_service = new EmailService();

		$result = $email_service->send_signup_payment_confirmation(
			$this->participant(),
			$this->event(),
			null,
			array(),
			0,
			0,
			42
		);

		$this->assertTrue( $result );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'jane@example.test', $sent['to'] );
		$this->assertStringContainsString( 'Community Meetup', $sent['subject'] );
		$this->assertStringContainsString( '#42', $sent['message'] );
		$this->assertStringNotContainsString( 'Amount paid:', $sent['message'] );
		$this->assertStringContainsString( 'has been confirmed.', $sent['message'] );
	}

	/**
	 * The paid-signup path includes the amount-paid row and the
	 * payment-received confirmation sentence.
	 */
	public function test_paid_signup_includes_amount_paid(): void {
		$email_service = new EmailService();

		$transaction = (object) array(
			'amount'   => 25.5,
			'currency' => 'EUR',
		);

		$email_service->send_signup_payment_confirmation(
			$this->participant(),
			$this->event(),
			$transaction,
			array(),
			0,
			0,
			99
		);

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( 'Amount paid:', $sent['message'] );
		$this->assertStringContainsString( '25.50 EUR', $sent['message'] );
		$this->assertStringContainsString( 'payment has been received', $sent['message'] );
	}

	/**
	 * Selected ticket-activity option names render as a list.
	 */
	public function test_includes_selected_option_names(): void {
		$email_service = new EmailService();

		$email_service->send_signup_payment_confirmation(
			$this->participant(),
			$this->event(),
			null,
			array( 'Workshop A', 'Workshop B' ),
			0,
			0,
			1
		);

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( 'Selected options:', $sent['message'] );
		$this->assertStringContainsString( 'Workshop A', $sent['message'] );
		$this->assertStringContainsString( 'Workshop B', $sent['message'] );
	}

	/**
	 * A registration reference of 0 (not yet known) omits the row entirely.
	 */
	public function test_omits_registration_reference_when_zero(): void {
		$email_service = new EmailService();

		$email_service->send_signup_payment_confirmation(
			$this->participant(),
			$this->event(),
			null,
			array(),
			0,
			0,
			0
		);

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringNotContainsString( 'Registration reference:', $sent['message'] );
	}

	/**
	 * An invalid (empty) participant email skips the send entirely.
	 */
	public function test_skips_send_for_invalid_email(): void {
		$email_service = new EmailService();

		$participant        = new Participant();
		$participant->name  = 'No Email';
		$participant->email = '';

		$result = $email_service->send_signup_payment_confirmation( $participant, $this->event(), null, array(), 0, 0, 1 );

		$this->assertFalse( $result );
		$this->assertCount( 0, $GLOBALS['_fair_test_sent_emails'] );
	}
}
