<?php
/**
 * FakeNotificationMailer test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Services\EmailService;

/**
 * Mail transport stand-in that records notification emails.
 */
class FakeNotificationMailer extends EmailService {

	/**
	 * Whether the mail system refuses the email.
	 *
	 * @var bool
	 */
	public $fail = false;

	/**
	 * Whether sending throws.
	 *
	 * @var bool
	 */
	public $throw = false;

	/**
	 * Sent emails as [to, subject, html].
	 *
	 * @var array[]
	 */
	public $sent = array();

	/**
	 * Send.
	 *
	 * @param string $to      Recipient.
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return bool
	 * @throws \RuntimeException When told to.
	 */
	public function send_notification( $to, $subject, $html ) {
		if ( $this->throw ) {
			throw new \RuntimeException( 'mailer down' );
		}
		if ( $this->fail ) {
			return false;
		}
		$this->sent[] = array( $to, $subject, $html );

		return true;
	}
}
