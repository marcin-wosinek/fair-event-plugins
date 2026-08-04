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
			'ID'         => 5,
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

	/**
	 * With no event_date_id, FairEvents\Models\EventDates is never reached
	 * (class_exists() guard no-ops), so no event URL is available and the
	 * inline event-name mention stays bold-only.
	 */
	public function test_signup_payment_confirmation_bolds_event_name_without_link(): void {
		$email_service = new EmailService();

		$email_service->send_signup_payment_confirmation( $this->participant(), $this->event(), null, array(), 0, 0, 1 );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>Community Meetup</strong>', $sent['message'] );
		$this->assertStringNotContainsString( '<a href', $sent['message'] );
	}

	/**
	 * The activities-added email bolds the event name without a link when no
	 * event_date_id is passed (default 0).
	 */
	public function test_activities_added_confirmation_bolds_event_name_without_link(): void {
		$email_service = new EmailService();

		$result = $email_service->send_activities_added_confirmation( $this->participant(), $this->event(), null, array( 'Workshop A' ) );

		$this->assertTrue( $result );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>Community Meetup</strong>', $sent['message'] );
		$this->assertStringNotContainsString( '<a href', $sent['message'] );
	}

	/**
	 * The payment-failed email keeps the inline event-name mention bold-only
	 * (no FairEvents\Models\EventDates lookup reachable in this test process)
	 * while the existing resume-link button still renders.
	 */
	public function test_signup_payment_failed_bolds_event_name_without_link(): void {
		$email_service = new EmailService();

		$result = $email_service->send_signup_payment_failed( $this->participant(), $this->event(), 0, null );

		$this->assertTrue( $result );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>Community Meetup</strong>', $sent['message'] );
		$this->assertStringContainsString( 'Resume payment', $sent['message'] );
	}

	/**
	 * The event-interest confirmation bolds the event name without a link
	 * when no event_date_id row resolves.
	 */
	public function test_event_interest_confirmation_bolds_event_name_without_link(): void {
		$GLOBALS['_fair_test_post_titles'] = array( 5 => 'Community Meetup' );

		$email_service = new EmailService();
		$result        = $email_service->send_event_interest_confirmation( $this->participant(), 5, 0 );

		$this->assertTrue( $result );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>Community Meetup</strong>', $sent['message'] );
	}

	/**
	 * The mailing-list welcome email links the event name via a plain
	 * get_permalink() lookup — no FairEvents\Models\EventDates involved.
	 */
	public function test_mailing_list_welcome_links_event_name_via_permalink(): void {
		$GLOBALS['_fair_test_post_titles'] = array( 5 => 'Community Meetup' );

		$email_service = new EmailService();
		$result        = $email_service->send_mailing_list_welcome( $this->participant(), 5 );

		$this->assertTrue( $result );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<a href="https://example.com/?p=5"', $sent['message'] );
		$this->assertStringContainsString( 'Community Meetup', $sent['message'] );
	}

	/**
	 * With no event_id, send_mailing_list_welcome() drops the "at <event>"
	 * clause entirely — only the manage-subscription link remains.
	 */
	public function test_mailing_list_welcome_omits_event_mention_without_event_id(): void {
		$email_service = new EmailService();
		$result        = $email_service->send_mailing_list_welcome( $this->participant(), 0 );

		$this->assertTrue( $result );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 1, substr_count( $sent['message'], '<a href' ) );
	}
}
