<?php
/**
 * Fake Telegram Bot API transport for E2E tests.
 *
 * The weekly notifications in fair-events-experimental send messages with
 * wp_remote_post() to api.telegram.org. Short-circuiting those requests in
 * `pre_http_request` keeps the real request building and response handling
 * in play while nothing reaches the network.
 *
 * Each request's chat ID and text are appended to the
 * `fair_e2e_telegram_requests` option; the bot token in the URL is never
 * stored. Every chat is accepted except `@e2e_missing_chat`, which gets
 * Telegram's "chat not found" error so specs can exercise a failure.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( 0 !== strpos( $url, 'https://api.telegram.org/' ) ) {
			return $preempt;
		}

		$body    = isset( $parsed_args['body'] ) ? json_decode( (string) $parsed_args['body'], true ) : null;
		$chat_id = is_array( $body ) ? (string) ( $body['chat_id'] ?? '' ) : '';

		$log   = get_option( 'fair_e2e_telegram_requests', array() );
		$log[] = array(
			'chat_id' => $chat_id,
			'text'    => is_array( $body ) ? (string) ( $body['text'] ?? '' ) : '',
		);
		update_option( 'fair_e2e_telegram_requests', $log, false );

		$missing = '@e2e_missing_chat' === $chat_id;

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode(
				$missing
					? array(
						'ok'          => false,
						'error_code'  => 400,
						'description' => 'Bad Request: chat not found',
					)
					: array(
						'ok'     => true,
						'result' => array( 'message_id' => count( $log ) ),
					)
			),
			'response' => array(
				'code'    => $missing ? 400 : 200,
				'message' => $missing ? 'Bad Request' : 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);
