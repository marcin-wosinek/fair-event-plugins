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
	 * With no event_date_id, EventDates::get_by_id() finds no row, so no event
	 * URL is available and the inline event-name mention stays bold-only.
	 */
	public function test_free_signup_bolds_event_name_without_link(): void {
		$email_service = new EmailService();

		$email_service->send_signup_confirmation( 42, 0, 'Jane Doe', 'jane@example.test' );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>the event</strong>', $sent['message'] );
		$this->assertStringNotContainsString( '<a href', $sent['message'] );
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

	/**
	 * A payment-failed email links back to the site's home URL (event_date_id
	 * 0 means EventDates::get_by_id() finds no row, so the fallback link
	 * applies) with a plain, non-token link.
	 */
	public function test_payment_failed_links_back_to_event(): void {
		$email_service = new EmailService();

		$result = $email_service->send_signup_payment_failed( 42, 0, 'Jane Doe', 'jane@example.test' );

		$this->assertTrue( $result );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'jane@example.test', $sent['to'] );
		$this->assertStringContainsString( 'href="https://example.com/"', $sent['message'] );
		$this->assertStringContainsString( 'Return to the event page to try again', $sent['message'] );
	}

	/**
	 * The failed-payment email's subject calls out that the payment didn't
	 * go through, distinguishing it from the paid confirmation email.
	 */
	public function test_payment_failed_subject_mentions_payment(): void {
		$email_service = new EmailService();

		$email_service->send_signup_payment_failed( 42, 0, 'Jane Doe', 'jane@example.test' );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( 'Payment', $sent['subject'] );
	}

	/**
	 * With no event_date_id, the action button still falls back to the home
	 * URL, but the inline event-name mention in the sentence must not link
	 * there too — it stays bold-only. Only the action button's href appears.
	 */
	public function test_payment_failed_inline_event_name_not_linked_on_fallback(): void {
		$email_service = new EmailService();

		$email_service->send_signup_payment_failed( 42, 0, 'Jane Doe', 'jane@example.test' );

		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( '<strong>the event</strong>', $sent['message'] );
		$this->assertSame( 1, substr_count( $sent['message'], '<a href' ) );
	}

	/**
	 * A weekly notification goes to the one given address as an HTML document.
	 */
	public function test_notification_is_sent_to_the_given_address(): void {
		$result = ( new EmailService() )->send_notification( 'organizer@example.test', 'Events', '<p>Concert</p>' );

		$this->assertTrue( $result );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'organizer@example.test', $sent['to'] );
		$this->assertSame( 'Events', $sent['subject'] );
		$this->assertStringContainsString( '<!DOCTYPE html>', $sent['message'] );
		$this->assertStringContainsString( '<p>Concert</p>', $sent['message'] );
	}

	/**
	 * A weekly notification uses the subscribers' branded layout, narrowing on
	 * small screens, without a personal greeting or subscription link.
	 */
	public function test_notification_uses_the_branded_layout(): void {
		$GLOBALS['_fair_test_options']['blogname'] = 'Dance Club';
		try {
			( new EmailService() )->send_notification( 'organizer@example.test', 'Events', '<p>Concert</p>' );
		} finally {
			unset( $GLOBALS['_fair_test_options']['blogname'] );
		}

		$message = $GLOBALS['_fair_test_sent_emails'][0]['message'];
		$this->assertStringContainsString( '<h1 style="margin: 0; font-size: 24px; font-weight: bold;">Dance Club</h1>', $message );
		$this->assertStringContainsString( 'max-width: 600px', $message );
		$this->assertStringContainsString( 'name="viewport"', $message );
		$this->assertStringContainsString( 'Thanks,<br>The Dance Club Team', $message );
		$this->assertStringContainsString( '<p style="margin: 0;">Dance Club</p>', $message );
		$this->assertStringNotContainsString( 'Hi ', $message );
		$this->assertStringNotContainsString( 'Manage your preferences', $message );
	}

	/**
	 * Content handed to the layout loses scripts.
	 */
	public function test_notification_content_is_sanitized(): void {
		( new EmailService() )->send_notification( 'organizer@example.test', 'Events', '<p>Concert</p><script>alert(1)</script>' );

		$this->assertStringNotContainsString( '<script', $GLOBALS['_fair_test_sent_emails'][0]['message'] );
	}

	/**
	 * The temporary HTML content-type filter is removed even when sending
	 * throws, so later mail does not inherit it.
	 */
	public function test_content_type_filter_is_removed_when_sending_throws(): void {
		$GLOBALS['_fair_test_filters']     = array();
		$GLOBALS['_fair_test_mail_throws'] = true;

		try {
			( new EmailService() )->send_notification( 'organizer@example.test', 'Events', '<p>Concert</p>' );
			$this->fail( 'Expected the mail transport to throw.' );
		} catch ( \RuntimeException $e ) {
			$this->assertSame( 0, $GLOBALS['_fair_test_filters']['wp_mail_content_type'] );
		} finally {
			unset( $GLOBALS['_fair_test_mail_throws'] );
		}
	}
}
