<?php
/**
 * Telegram weekly notification provider.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;

defined( 'WPINC' ) || die;

/**
 * Delivers messages through the Telegram Bot API sendMessage method.
 *
 * Formatting is sent as message entities on plain text (no parse_mode), so
 * characters in titles and URLs are never interpreted as markup.
 */
class TelegramProvider implements Provider {
	public const ID            = 'telegram';
	public const API_BASE      = 'https://api.telegram.org';
	public const MESSAGE_LIMIT = 4096;

	/**
	 * Bot token override; null reads the saved token at send time.
	 *
	 * @var string|null
	 */
	private $token;

	/**
	 * Constructor.
	 *
	 * @param string|null $token Bot token, or null for the saved one.
	 */
	public function __construct( $token = null ) {
		$this->token = $token;
	}

	/**
	 * Provider key.
	 *
	 * @return string
	 */
	public function id() {
		return self::ID;
	}

	/**
	 * Configured chat and channel identifiers.
	 *
	 * @param array $settings         Weekly notification settings.
	 * @param bool  $include_disabled Include them while Telegram delivery is off.
	 * @return string[]
	 */
	public function destinations( array $settings, $include_disabled = false ) {
		$telegram = $settings['providers'][ self::ID ] ?? array();
		if ( ( ! $include_disabled && empty( $telegram['enabled'] ) ) || '' === $this->token() ) {
			return array();
		}

		return array_values( (array) ( $telegram['chat_ids'] ?? array() ) );
	}

	/**
	 * Format the summary as messages within Telegram's length limit.
	 *
	 * @param array $summary Summary from {@see SummaryBuilder::build()}.
	 * @return array{text: string, entities: array[]}[]
	 */
	public function split( array $summary ) {
		return MessageSplitter::split_lines( TelegramFormatter::lines( $summary ), self::MESSAGE_LIMIT );
	}

	/**
	 * Send one message.
	 *
	 * @param string       $destination Chat ID or @channel username.
	 * @param array|string $message     Message from split(), or plain text.
	 * @return array{state: string, code: string, message: string}
	 */
	public function send( $destination, $message ) {
		$message = is_array( $message ) ? $message : array( 'text' => (string) $message );
		$payload = array(
			'chat_id'              => $destination,
			'text'                 => (string) $message['text'],
			'link_preview_options' => array( 'is_disabled' => true ),
		);
		if ( ! empty( $message['entities'] ) ) {
			$payload['entities'] = array_values( $message['entities'] );
		}

		$token = $this->token();
		if ( '' === $token ) {
			return self::result( 'failed', 'missing_token', __( 'The Telegram bot token is not configured.', 'fair-events-experimental' ) );
		}

		$response = wp_remote_post(
			self::API_BASE . '/bot' . $token . '/sendMessage',
			array(
				'timeout' => 15,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $payload ),
			)
		);

		// A transport error can happen after Telegram received the request
		// (e.g. a timeout waiting for the response), so it may have posted.
		if ( is_wp_error( $response ) ) {
			return self::result( 'uncertain', 'transport_error', $this->redact( $response->get_error_message() ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( $status >= 200 && $status < 300 && ! empty( $data['ok'] ) ) {
			return self::result( 'sent', '', '' );
		}

		$description = is_array( $data ) && ! empty( $data['description'] ) ? (string) $data['description'] : 'HTTP ' . $status;
		$state       = $status >= 500 || 0 === $status ? 'uncertain' : 'failed';

		return self::result( $state, 'http_' . $status, $this->redact( $description ) );
	}

	/**
	 * The bot token in use.
	 *
	 * @return string
	 */
	private function token() {
		return trim( null === $this->token ? WeeklyNotificationSettings::telegram_token() : (string) $this->token );
	}

	/**
	 * Remove the bot token from a message and cap its length.
	 *
	 * @param string $message Provider or transport message.
	 * @return string
	 */
	private function redact( $message ) {
		$token = $this->token();
		if ( '' !== $token ) {
			$message = str_replace( array( $token, rawurlencode( $token ) ), '[redacted]', $message );
		}
		// Any other bot-token-shaped value (e.g. echoed in a URL).
		$message = (string) preg_replace( '/\d{5,16}:[A-Za-z0-9_-]{30,64}/', '[redacted]', $message );

		return mb_substr( $message, 0, 200 );
	}

	/**
	 * Build a delivery result.
	 *
	 * @param string $state   'sent', 'failed' or 'uncertain'.
	 * @param string $code    Safe error code.
	 * @param string $message Safe error message.
	 * @return array{state: string, code: string, message: string}
	 */
	private static function result( $state, $code, $message ) {
		return array(
			'state'   => $state,
			'code'    => $code,
			'message' => $message,
		);
	}
}
