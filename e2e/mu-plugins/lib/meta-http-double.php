<?php
/**
 * Fake Meta Conversions API transport for E2E tests.
 *
 * Fair-events-experimental delivers queued conversions, and sends button
 * clicks immediately, with wp_remote_post() straight to graph.facebook.com. WordPress routes every
 * outbound HTTP request through the `pre_http_request` filter before it ever
 * reaches a transport, so short-circuiting requests aimed at that host here
 * is enough to keep the real request building, response parsing, and outbox
 * state machine in `FairEventsExperimental\Meta\Conversions`/`Outbox` all in
 * play while nothing reaches the real network.
 *
 * The decoded body of the most recent matching request is captured into the
 * `fair_e2e_meta_last_request` option so a spec can assert on what was
 * actually sent (event name, `custom_data.payment_mode`, `test_event_code`)
 * without a real Meta dataset or access token. Each request's `timeout`
 * argument is captured alongside, into `fair_e2e_meta_last_timeout` and the
 * `fair_e2e_meta_timeouts` log, in the same order as the request log.
 * Every request is answered
 * with Meta's canned "received" response (`events_received: 1`), so
 * delivery succeeds — unless a spec stores `{status, body}` in the
 * `fair_e2e_meta_response` option to simulate another answer, such as zero
 * received events or a rejection; it should delete the option afterwards.
 * `{transport: true}` fails the request like a network error, and `delay`
 * (seconds, up to 5) answers slowly.
 *
 * WhatsApp Cloud API requests go to the same host; lib/whatsapp-http-double.php
 * answers them first, and a request it already answered is left alone here.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false !== $preempt || false === strpos( $url, 'graph.facebook.com' ) ) {
			return $preempt;
		}

		$body    = isset( $parsed_args['body'] ) ? json_decode( (string) $parsed_args['body'], true ) : null;
		$request = is_array( $body ) ? $body : array();
		update_option( 'fair_e2e_meta_last_request', $request, false );

		$log   = get_option( 'fair_e2e_meta_requests', array() );
		$log[] = $request;
		update_option( 'fair_e2e_meta_requests', $log, false );

		$timeout = isset( $parsed_args['timeout'] ) ? (float) $parsed_args['timeout'] : null;
		update_option( 'fair_e2e_meta_last_timeout', $timeout, false );
		$timeouts   = get_option( 'fair_e2e_meta_timeouts', array() );
		$timeouts[] = $timeout;
		update_option( 'fair_e2e_meta_timeouts', $timeouts, false );

		$override = get_option( 'fair_e2e_meta_response', null );
		if ( is_array( $override ) && ! empty( $override['delay'] ) ) {
			sleep( min( 5, (int) $override['delay'] ) );
		}
		if ( is_array( $override ) && ! empty( $override['transport'] ) ) {
			return new WP_Error( 'http_request_failed', 'E2E simulated network failure' );
		}
		$status = is_array( $override ) && isset( $override['status'] ) ? (int) $override['status'] : 200;
		$answer = is_array( $override ) && array_key_exists( 'body', $override )
			? $override['body']
			: array(
				'events_received' => 1,
				'messages'        => array(),
				'fbtrace_id'      => 'E2Efbtrace00000',
			);

		return array(
			'headers'  => array(),
			'body'     => is_string( $answer ) ? $answer : wp_json_encode( $answer ),
			'response' => array(
				'code'    => $status,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);
