<?php
/**
 * Fake Meta Conversions API transport for E2E tests.
 *
 * Fair-events-experimental's outbox delivers queued conversions with
 * wp_remote_post() straight to graph.facebook.com. WordPress routes every
 * outbound HTTP request through the `pre_http_request` filter before it ever
 * reaches a transport, so short-circuiting requests aimed at that host here
 * is enough to keep the real request building, response parsing, and outbox
 * state machine in `FairEventsExperimental\Meta\Conversions`/`Outbox` all in
 * play while nothing reaches the real network.
 *
 * The decoded body of the most recent matching request is captured into the
 * `fair_e2e_meta_last_request` option so a spec can assert on what was
 * actually sent (event name, `custom_data.payment_mode`, `test_event_code`)
 * without a real Meta dataset or access token. Every request is answered
 * with Meta's canned "accepted" response, so delivery always succeeds.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false === strpos( $url, 'graph.facebook.com' ) ) {
			return $preempt;
		}

		$body    = isset( $parsed_args['body'] ) ? json_decode( (string) $parsed_args['body'], true ) : null;
		$request = is_array( $body ) ? $body : array();
		update_option( 'fair_e2e_meta_last_request', $request, false );

		$log   = get_option( 'fair_e2e_meta_requests', array() );
		$log[] = $request;
		update_option( 'fair_e2e_meta_requests', $log, false );

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode(
				array(
					'events_received' => 1,
					'messages'        => array(),
					'fbtrace_id'      => 'E2Efbtrace00000',
				)
			),
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);
