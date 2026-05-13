<?php
/**
 * Telegram notification sender for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Services;

defined( 'WPINC' ) || die;

/**
 * Sends messages to Telegram chats via the Bot API.
 *
 * Failures never throw — the caller (cron handler) should keep going so a single
 * misconfigured chat ID does not block the rest of the notifications.
 */
class TelegramService {

	/**
	 * Telegram Bot API base URL.
	 */
	const API_BASE = 'https://api.telegram.org';

	/**
	 * Send a message to a single chat.
	 *
	 * @param string $bot_token Telegram bot token.
	 * @param string $chat_id   Telegram chat ID (numeric or @channelname).
	 * @param string $text      Message text (parse_mode=HTML).
	 * @return array|\WP_Error Array with Telegram API response data on success, WP_Error on failure.
	 */
	public function send( $bot_token, $chat_id, $text ) {
		$bot_token = trim( (string) $bot_token );
		$chat_id   = trim( (string) $chat_id );

		if ( '' === $bot_token ) {
			return new \WP_Error( 'fair_payment_telegram_missing_token', __( 'Telegram bot token is not configured.', 'fair-payment' ) );
		}
		if ( '' === $chat_id ) {
			return new \WP_Error( 'fair_payment_telegram_missing_chat_id', __( 'Telegram chat ID is empty.', 'fair-payment' ) );
		}

		$url = self::API_BASE . '/bot' . rawurlencode( $bot_token ) . '/sendMessage';

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 10,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'chat_id'                  => $chat_id,
						'text'                     => $text,
						'parse_mode'               => 'HTML',
						'disable_web_page_preview' => true,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( '[Fair Payment] Telegram send failed: ' . $response->get_error_message() );
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( $code < 200 || $code >= 300 || empty( $data['ok'] ) ) {
			$description = is_array( $data ) && ! empty( $data['description'] ) ? $data['description'] : 'HTTP ' . $code;
			error_log( '[Fair Payment] Telegram send returned non-OK: ' . $description );
			return new \WP_Error(
				'fair_payment_telegram_api_error',
				$description,
				array(
					'status' => $code,
					'body'   => $data,
				)
			);
		}

		return is_array( $data ) ? $data : array();
	}

	/**
	 * Render a template by substituting placeholders.
	 *
	 * PII placeholders ({participant_name}, {participant_email}) substitute to an
	 * empty string when $include_pii is false.
	 *
	 * @param string $template    Template string.
	 * @param array  $context     Context with raw values (will be HTML-escaped on insertion).
	 * @param bool   $include_pii Whether to substitute PII placeholders.
	 * @return string
	 */
	public function render_template( $template, array $context, $include_pii = true ) {
		$pii_keys = array( 'participant_name', 'participant_email' );

		$replacements = array();
		$placeholders = array(
			'test_label',
			'site_domain',
			'event_title',
			'event_url',
			'participant_name',
			'participant_url',
			'participant_email',
			'amount',
			'currency',
			'ticket_label',
			'activities',
			'discounts',
			'transaction_id',
			'date',
		);

		foreach ( $placeholders as $key ) {
			$value = '';

			if ( in_array( $key, $pii_keys, true ) && ! $include_pii ) {
				$value = '';
			} elseif ( isset( $context[ $key ] ) && null !== $context[ $key ] && '' !== $context[ $key ] ) {
				// URLs use esc_url, everything else uses esc_html.
				if ( in_array( $key, array( 'event_url', 'participant_url' ), true ) ) {
					$value = esc_url( (string) $context[ $key ] );
				} else {
					$value = esc_html( (string) $context[ $key ] );
				}
			}

			$replacements[ '{' . $key . '}' ] = $value;
		}

		return strtr( (string) $template, $replacements );
	}
}
