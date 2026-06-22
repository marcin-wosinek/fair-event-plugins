<?php
/**
 * Telegram notification channel
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

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
		$bot_token = (string) get_option( 'fair_payment_telegram_bot_token', '' );
		if ( '' === trim( $bot_token ) ) {
			return false;
		}
		$result = $this->telegram->send( $bot_token, $destination, $text );
		return ! is_wp_error( $result );
	}
}
