<?php
/**
 * Telegram notification sender for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

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
			return new \WP_Error( 'fair_payment_telegram_missing_token', __( 'Telegram bot token is not configured.', 'fair-payments-connector-experimental' ) );
		}
		if ( '' === $chat_id ) {
			return new \WP_Error( 'fair_payment_telegram_missing_chat_id', __( 'Telegram chat ID is empty.', 'fair-payments-connector-experimental' ) );
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
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector Experimental] Telegram send failed: ' . $response->get_error_message() );
			}
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( $code < 200 || $code >= 300 || empty( $data['ok'] ) ) {
			$description = is_array( $data ) && ! empty( $data['description'] ) ? $data['description'] : 'HTTP ' . $code;
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector Experimental] Telegram send returned non-OK: ' . $description );
			}
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
	 * When $include_pii is false, {participant_email} renders empty and
	 * {participant_name} falls back to an abbreviated form (first name + surname
	 * initial, e.g. "Lucianna C.") so the channel still shows who paid without
	 * exposing the full identity.
	 *
	 * @param string $template    Template string.
	 * @param array  $context     Context with raw values (will be HTML-escaped on insertion).
	 * @param bool   $include_pii Whether to substitute PII placeholders.
	 * @return string
	 */
	public function render_template( $template, array $context, $include_pii = true ) {
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

			if ( 'participant_name' === $key ) {
				if ( $include_pii ) {
					$value = esc_html( (string) ( $context['participant_name'] ?? '' ) );
				} else {
					$short = ( isset( $context['participant_name_short'] ) && '' !== $context['participant_name_short'] )
						? (string) $context['participant_name_short']
						: self::abbreviate_name( (string) ( $context['participant_name'] ?? '' ) );
					$value = esc_html( $short );
				}
			} elseif ( 'participant_email' === $key && ! $include_pii ) {
				$value = '';
			} elseif ( isset( $context[ $key ] ) && null !== $context[ $key ] && '' !== $context[ $key ] ) {
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

	/**
	 * Abbreviate a full name to "First S." (first name + first surname initial).
	 *
	 * @param string $full_name Full name.
	 * @return string Abbreviated name, or the input unchanged when it has one token.
	 */
	private static function abbreviate_name( $full_name ) {
		$full_name = trim( (string) preg_replace( '/\s+/', ' ', (string) $full_name ) );
		if ( '' === $full_name ) {
			return '';
		}

		$parts = explode( ' ', $full_name );
		if ( count( $parts ) < 2 ) {
			return $full_name;
		}

		$first   = $parts[0];
		$initial = mb_strtoupper( mb_substr( $parts[1], 0, 1 ) );

		return $first . ' ' . $initial . '.';
	}
}
