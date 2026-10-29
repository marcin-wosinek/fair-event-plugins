<?php
/**
 * Fake WhatsApp Cloud API transport for E2E and API tests.
 *
 * Fair-events-experimental validates the WhatsApp connection, lists templates
 * and sends a test template with wp_remote_get()/wp_remote_post() to
 * graph.facebook.com, authenticated by an `Authorization: Bearer` header.
 * The Meta Conversions API puts its token in the body instead, so the header
 * tells the two apart; lib/meta-http-double.php leaves requests answered here
 * alone.
 *
 * Canned account (all IDs synthetic):
 * - WhatsApp Business Account 100000000000001 lists its phone numbers over
 *   two pages; the sender 200000000000002 ("Fair Events E2E",
 *   +34 600 000 002) is on the second, so validation must follow the cursor.
 * - Phone number 300000000000003 exists but belongs to another account.
 * - Any other ID is answered like an ID the token cannot see (100/33).
 * - Templates: `hello_world` (en_US) and `event_ready` (es_ES) take no
 *   parameters; `event_reminder` has a `{{1}}` body and `poster` an image
 *   header, so they must not be offered.
 * - A token containing `expired` gets error 190; one containing `noaccess`
 *   gets error 200.
 * - Sending to a number ending in 131030 gets "recipient not in allowed list".
 *
 * Each request is appended to the `fair_e2e_whatsapp_requests` option as
 * method, path and, for sends, the recipient and template. The token is
 * never stored; `token_suffix` keeps its last four characters so a spec can
 * tell which one was used. A spec can store `{transport: true}` in the
 * `fair_e2e_whatsapp_response` option to fail the next sends like a network
 * timeout, and should delete it afterwards.
 *
 * An accepted send answers with a fresh `wamid.E2E…` ID, logged as
 * `message_id` so a spec can post delivery callbacks for it. A spec can store
 * an ID in the `fair_e2e_whatsapp_message_id` option to make the next sends
 * use it instead, for callbacks that arrive before the send is stored.
 *
 * Incoming messages passed to the plugin's
 * `fair_events_experimental_whatsapp_incoming_message` hook are appended to
 * the `fair_e2e_whatsapp_incoming` option. An incoming text of `E2E_THROW`
 * makes this listener throw, like a failing consumer.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * A canned Graph API answer.
 *
 * @param int   $status HTTP status.
 * @param array $body   Body.
 * @return array
 */
function fair_e2e_whatsapp_answer( $status, array $body ) {
	return array(
		'headers'  => array(),
		'body'     => wp_json_encode( $body ),
		'response' => array(
			'code'    => $status,
			'message' => '',
		),
		'cookies'  => array(),
		'filename' => null,
	);
}

/**
 * A canned Graph API error.
 *
 * @param int $status  HTTP status.
 * @param int $code    Meta error code.
 * @param int $subcode Meta error subcode.
 * @return array
 */
function fair_e2e_whatsapp_error( $status, $code, $subcode = 0 ) {
	return fair_e2e_whatsapp_answer(
		$status,
		array(
			'error' => array_filter(
				array(
					'message'       => 'E2E simulated error; token secret-should-not-leak',
					'type'          => 'OAuthException',
					'code'          => $code,
					'error_subcode' => $subcode,
					'fbtrace_id'    => 'E2Ewhatsapptrace',
				)
			),
		)
	);
}

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		$headers       = isset( $parsed_args['headers'] ) ? (array) $parsed_args['headers'] : array();
		$authorization = (string) ( $headers['Authorization'] ?? '' );
		if (
			false !== $preempt
			|| 0 !== strpos( $url, 'https://graph.facebook.com/' )
			|| 0 !== strpos( $authorization, 'Bearer ' )
		) {
			return $preempt;
		}

		$token  = substr( $authorization, 7 );
		$method = strtoupper( (string) ( $parsed_args['method'] ?? 'GET' ) );
		$path   = preg_replace( '#^/v\d+\.\d+/#', '', (string) wp_parse_url( $url, PHP_URL_PATH ) );
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$body = isset( $parsed_args['body'] ) ? json_decode( (string) $parsed_args['body'], true ) : null;

		$entry = array(
			'method'       => $method,
			'path'         => $path,
			'token_suffix' => substr( $token, -4 ),
		);
		if ( is_array( $body ) ) {
			$entry['to']         = (string) ( $body['to'] ?? '' );
			$entry['template']   = (string) ( $body['template']['name'] ?? '' );
			$entry['language']   = (string) ( $body['template']['language']['code'] ?? '' );
			$forced              = get_option( 'fair_e2e_whatsapp_message_id', '' );
			$entry['message_id'] = is_string( $forced ) && '' !== $forced ? $forced : 'wamid.E2E' . wp_generate_password( 12, false );
		}
		$log   = get_option( 'fair_e2e_whatsapp_requests', array() );
		$log[] = $entry;
		update_option( 'fair_e2e_whatsapp_requests', $log, false );

		if ( false !== strpos( $token, 'expired' ) ) {
			return fair_e2e_whatsapp_error( 401, 190, 463 );
		}
		if ( false !== strpos( $token, 'noaccess' ) ) {
			return fair_e2e_whatsapp_error( 403, 200 );
		}

		$waba  = '100000000000001';
		$phone = '200000000000002';
		$other = '300000000000003';

		if ( 'POST' === $method && "$phone/messages" === $path ) {
			$override = get_option( 'fair_e2e_whatsapp_response', null );
			if ( is_array( $override ) && ! empty( $override['transport'] ) ) {
				return new WP_Error( 'http_request_failed', 'E2E simulated timeout' );
			}
			if ( '131030' === substr( $entry['to'] ?? '', -6 ) ) {
				return fair_e2e_whatsapp_error( 400, 131030 );
			}
			return fair_e2e_whatsapp_answer(
				200,
				array(
					'messaging_product' => 'whatsapp',
					'contacts'          => array(
						array(
							'input' => $entry['to'] ?? '',
							'wa_id' => $entry['to'] ?? '',
						),
					),
					'messages'          => array(
						array(
							'id'             => $entry['message_id'],
							'message_status' => 'accepted',
						),
					),
				)
			);
		}

		if ( 'GET' === $method && $waba === $path ) {
			return fair_e2e_whatsapp_answer(
				200,
				array(
					'id'   => $waba,
					'name' => 'Fair Events E2E',
				)
			);
		}

		if ( 'GET' === $method && "$waba/phone_numbers" === $path ) {
			if ( empty( $query['after'] ) ) {
				return fair_e2e_whatsapp_answer(
					200,
					array(
						'data'   => array(
							array(
								'id'                   => '200000000000099',
								'display_phone_number' => '+34 600 000 099',
								'verified_name'        => 'Fair Events E2E (old)',
								'quality_rating'       => 'UNKNOWN',
							),
						),
						'paging' => array(
							'cursors' => array( 'after' => 'E2Epage2' ),
							'next'    => 'https://graph.facebook.com/v26.0/' . $waba . '/phone_numbers?after=E2Epage2',
						),
					)
				);
			}
			return fair_e2e_whatsapp_answer(
				200,
				array(
					'data'   => array(
						array(
							'id'                   => $phone,
							'display_phone_number' => '+34 600 000 002',
							'verified_name'        => 'Fair Events E2E',
							'quality_rating'       => 'GREEN',
						),
					),
					'paging' => array( 'cursors' => array( 'before' => 'E2Epage2' ) ),
				)
			);
		}

		if ( 'GET' === $method && "$waba/message_templates" === $path ) {
			return fair_e2e_whatsapp_answer(
				200,
				array(
					'data' => array(
						array(
							'name'       => 'hello_world',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'category'   => 'UTILITY',
							'components' => array(
								array(
									'type'   => 'HEADER',
									'format' => 'TEXT',
									'text'   => 'Hello World',
								),
								array(
									'type' => 'BODY',
									'text' => 'Welcome and congratulations!',
								),
							),
						),
						array(
							'name'       => 'event_reminder',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'category'   => 'UTILITY',
							'components' => array(
								array(
									'type' => 'BODY',
									'text' => 'See you at {{1}}',
								),
							),
						),
						array(
							'name'       => 'poster',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'category'   => 'MARKETING',
							'components' => array(
								array(
									'type'   => 'HEADER',
									'format' => 'IMAGE',
								),
							),
						),
						array(
							'name'       => 'event_ready',
							'language'   => 'es_ES',
							'status'     => 'APPROVED',
							'category'   => 'UTILITY',
							'components' => array(
								array(
									'type' => 'BODY',
									'text' => 'Tu evento está listo.',
								),
							),
						),
					),
				)
			);
		}

		if ( 'GET' === $method && $other === $path ) {
			return fair_e2e_whatsapp_answer( 200, array( 'id' => $other ) );
		}

		return fair_e2e_whatsapp_error( 400, 100, 33 );
	},
	9,
	3
);

add_action(
	'fair_events_experimental_whatsapp_incoming_message',
	static function ( $message ) {
		if ( 'E2E_THROW' === ( $message['text'] ?? null ) ) {
			throw new RuntimeException( 'E2E simulated consumer failure' );
		}
		$log   = get_option( 'fair_e2e_whatsapp_incoming', array() );
		$log[] = $message;
		update_option( 'fair_e2e_whatsapp_incoming', $log, false );
	}
);
