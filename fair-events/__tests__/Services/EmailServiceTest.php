<?php
/**
 * EmailService::send_signup_confirmation() tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EmailService;

/**
 * Verifies fair-events' standalone confirmation email renders through the
 * shared formatter with the registration reference and (on paid signups) the
 * amount paid. event_date_id and ticket_type_id are left at 0 throughout —
 * passing a non-zero value would make EmailService reach for
 * FairEvents\Models\EventDates / TicketType, which need a live $wpdb (see
 * SignupPaymentStateTest's same convention).
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
	 * A free signup's email includes the registration reference and omits
	 * the amount-paid row.
	 */
	public function test_free_signup_includes_registration_reference(): void {
		$email_service = new EmailService();

		$result = $email_service->send_signup_confirmation( 42, 0, 'Jane Doe', 'jane@example.test' );

		$this->assertTrue( $result );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'jane@example.test', $sent['to'] );
		$this->assertStringContainsString( '#42', $sent['message'] );
		$this->assertStringContainsString( 'Jane Doe', $sent['message'] );
		$this->assertStringNotContainsString( 'Amount paid:', $sent['message'] );
	}

	/**
	 * A paid signup's email includes the amount-paid row.
	 */
	public function test_paid_signup_includes_amount_paid(): void {
		$email_service = new EmailService();

		$email_service->send_signup_confirmation( 7, 0, 'Jane Doe', 'jane@example.test', 0, 25.5 );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( 'Amount paid:', $sent['message'] );
		$this->assertStringContainsString( '25.50 EUR', $sent['message'] );
	}

	/**
	 * A zero amount omits the amount-paid row entirely.
	 */
	public function test_zero_amount_omits_amount_paid_row(): void {
		$email_service = new EmailService();

		$email_service->send_signup_confirmation( 7, 0, 'Jane Doe', 'jane@example.test', 0, 0 );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringNotContainsString( 'Amount paid:', $sent['message'] );
	}

	/**
	 * The email is sent as HTML (wp_mail_content_type filtered to text/html).
	 */
	public function test_sends_as_html(): void {
		$email_service = new EmailService();

		$email_service->send_signup_confirmation( 7, 0, 'Jane Doe', 'jane@example.test' );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<!DOCTYPE html>', $sent['message'] );
	}
}
