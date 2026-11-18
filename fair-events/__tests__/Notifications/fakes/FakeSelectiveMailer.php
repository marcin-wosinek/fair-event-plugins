<?php
/**
 * FakeSelectiveMailer test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

require_once __DIR__ . '/FakeNotificationMailer.php';

/**
 * Mailer that refuses or throws for chosen addresses.
 */
class FakeSelectiveMailer extends FakeNotificationMailer {

	/**
	 * Addresses the mail system refuses.
	 *
	 * @var string[]
	 */
	public $refuse = array();

	/**
	 * Addresses that make sending throw.
	 *
	 * @var string[]
	 */
	public $explode = array();

	/**
	 * Send.
	 *
	 * @param string $to      Recipient.
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return bool
	 * @throws \RuntimeException For an exploding address.
	 */
	public function send_notification( $to, $subject, $html ) {
		if ( in_array( $to, $this->explode, true ) ) {
			throw new \RuntimeException( 'mailer down' );
		}
		if ( in_array( $to, $this->refuse, true ) ) {
			return false;
		}
		return parent::send_notification( $to, $subject, $html );
	}
}
