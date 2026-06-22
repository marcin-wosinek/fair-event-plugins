<?php
/**
 * Notification channel interface
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Abstraction over a single notification delivery channel (email, Telegram, …).
 */
interface NotificationChannel {

	/**
	 * Send a message to one destination address/ID.
	 *
	 * @param string $destination Email address or Telegram chat ID.
	 * @param string $text        Pre-rendered message body (HTML allowed for both channels).
	 * @return bool True on success, false on failure.
	 */
	public function send( string $destination, string $text ): bool;
}
