<?php
/**
 * Tests for the payment notification email.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Services;

use FairPaymentsConnector\Services\EmailChannel;
use PHPUnit\Framework\TestCase;

/**
 * The payment notification email uses the common email layout (#2322)
 * while keeping its recipient, subject and already-rendered body.
 */
class EmailChannelTest extends TestCase {

	/**
	 * Seed the site name and reset recorded mail.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails']         = array();
		$GLOBALS['_fair_test_options']['blogname'] = 'Dance &amp; Co';
	}

	/**
	 * Clear seeded globals.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_sent_emails'], $GLOBALS['_fair_test_options']['blogname'] );
		parent::tearDown();
	}

	/**
	 * Send one notification and return the recorded mail.
	 *
	 * @param string $text Rendered body.
	 * @return array Recorded wp_mail() call.
	 */
	private function send( string $text ): array {
		$this->assertTrue( ( new EmailChannel() )->send( 'owner@example.test', $text ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );
		return $GLOBALS['_fair_test_sent_emails'][0];
	}

	/**
	 * Recipient, subject and body lines are kept.
	 */
	public function test_keeps_recipient_subject_and_body(): void {
		$sent = $this->send( "<b>New payment</b>\nAmount: 10.00 EUR" );

		$this->assertSame( 'owner@example.test', $sent['to'] );
		$this->assertSame( 'Payment notification — Dance & Co', $sent['subject'] );
		$this->assertStringContainsString( '<b>New payment</b><br />', $sent['message'] );
		$this->assertStringContainsString( 'Amount: 10.00 EUR', $sent['message'] );
	}

	/**
	 * The body sits in the shared fluid layout with the site name in the
	 * header and footer. (The esc_html() stub here does not encode.)
	 */
	public function test_uses_the_shared_fluid_layout(): void {
		$message = $this->send( 'Paid' )['message'];

		$this->assertSame( 1, substr_count( $message, '<!DOCTYPE html>' ) );
		$this->assertStringContainsString( 'max-width: 600px', $message );
		$this->assertStringNotContainsString( '<table width="600"', $message );
		$this->assertMatchesRegularExpression( '#<h1 [^>]*>Dance & Co</h1>#', $message );
		$this->assertMatchesRegularExpression( '#<p style="margin: 0;">\s*Dance & Co\s*</p>#', $message );
	}

	/**
	 * The body is still sanitized before it is sent.
	 */
	public function test_body_is_sanitized(): void {
		$message = $this->send( 'Paid<script>alert(1)</script>' )['message'];

		$this->assertStringNotContainsString( '<script', $message );
	}
}
