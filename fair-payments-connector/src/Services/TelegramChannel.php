<?php
/**
 * Telegram notification channel
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairPaymentsConnector\Settings\TelegramCredentials;

defined( 'WPINC' ) || die;

/**
 * Thin wrapper over TelegramService that implements NotificationChannel.
 *
 * Reads the global bot token at send time so it always uses the current value.
 */
class TelegramChannel implements NotificationChannel {

	/**
	 * Underlying Telegram sender.
	 *
	 * @var TelegramService
	 */
	private $telegram;

	/**
	 * Constructor.
	 *
	 * @param TelegramService $telegram Telegram API wrapper.
	 */
	public function __construct( TelegramService $telegram ) {
		$this->telegram = $telegram;
	}

	/**
	 * Send to a single Telegram chat ID.
	 *
	 * @param string $destination Telegram chat ID (numeric or @channelname).
	 * @param string $text        HTML message text.
	 * @return bool
	 */
	public function send( string $destination, string $text ): bool {
		$bot_token = TelegramCredentials::token();
		if ( '' === $bot_token ) {
			$status = TelegramCredentials::status();
			if ( TelegramCredentials::MISSING !== $status && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Telegram send skipped: ' . TelegramCredentials::admin_message( $status ) );
			}
			return false;
		}
		$result = $this->telegram->send( $bot_token, $destination, $text );
		return ! is_wp_error( $result );
	}
}
