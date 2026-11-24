<?php
/**
 * Plugin Name: Fair Audience E2E Fee Reminders
 * Description: Test-only routes for the membership fee reminder specs, loaded
 *              ONLY inside the Playwright wp-env instance. Reads and clears
 *              the mail captured by fair-e2e-support.php, captures the mail
 *              of one REST request on its own, makes delivery to one address
 *              fail, and stores a raw participant email that the participant
 *              routes would sanitize away.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/*
 * Request-scoped mail capture (#2441).
 *
 * The shared log in fair-e2e-support.php also receives mail sent by other
 * requests, such as the WP-Cron run that delivers earlier specs' deferred
 * submission confirmations. A REST request that sends this header with a
 * token gets its own record: every wp_mail() attempt made while WordPress
 * dispatches that request, stored under the token once the dispatch ends,
 * and an empty list when nothing was attempted. A token with no record means
 * the capture never ran, so a spec reading it fails instead of seeing "no
 * mail". Mail still reaches the shared log and the delivery failure below.
 */
const FAIR_E2E_MAIL_CAPTURE_HEADER = 'x_fair_e2e_mail_capture';
const FAIR_E2E_MAIL_CAPTURE_PREFIX = 'fair_e2e_mail_capture_';
const FAIR_E2E_MAIL_CAPTURE_TOKEN  = '[A-Za-z0-9-]{16,64}';

/**
 * The capture token a request carries, or '' when it has none or it is malformed.
 *
 * @param WP_REST_Request $request REST request.
 * @return string
 */
function fair_e2e_mail_capture_token( WP_REST_Request $request ): string {
	$token = (string) $request->get_header( FAIR_E2E_MAIL_CAPTURE_HEADER );

	return 1 === preg_match( '/^' . FAIR_E2E_MAIL_CAPTURE_TOKEN . '$/', $token ) ? $token : '';
}

/**
 * Addresses listed in a wp_mail() `to` argument or in its Cc/Bcc headers.
 *
 * @param mixed  $value   Address list: an array, or a comma-separated string.
 * @param mixed  $headers wp_mail() headers, to read the given header from.
 * @param string $name   Header name ('cc' or 'bcc'); '' to read `$value`.
 * @return string[]
 */
function fair_e2e_mail_capture_addresses( $value, $headers = array(), string $name = '' ): array {
	$lists = array();
	if ( '' === $name ) {
		$lists = is_array( $value ) ? $value : explode( ',', (string) $value );
	} else {
		$lines = is_array( $headers ) ? $headers : explode( "\n", str_replace( "\r\n", "\n", (string) $headers ) );
		foreach ( $lines as $line ) {
			$parts = explode( ':', (string) $line, 2 );
			if ( 2 === count( $parts ) && strtolower( trim( $parts[0] ) ) === $name ) {
				$lists = array_merge( $lists, explode( ',', $parts[1] ) );
			}
		}
	}

	return array_values( array_filter( array_map( 'trim', array_map( 'strval', $lists ) ), 'strlen' ) );
}

add_filter(
	'rest_pre_dispatch',
	static function ( $result, $server, $request ) {
		$token = $request instanceof WP_REST_Request ? fair_e2e_mail_capture_token( $request ) : '';
		if ( '' !== $token && ! isset( $GLOBALS['fair_e2e_mail_capture'] ) ) {
			$GLOBALS['fair_e2e_mail_capture'] = array(
				'token' => $token,
				'mail'  => array(),
			);
		}

		return $result;
	},
	10,
	3
);

// Priority 1: record the attempt before the shared capture (10) and the
// delivery failure (20) decide what wp_mail() returns.
add_filter(
	'pre_wp_mail',
	static function ( $short_circuit, $atts ) {
		if ( isset( $GLOBALS['fair_e2e_mail_capture'] ) ) {
			$headers                                    = $atts['headers'] ?? array();
			$GLOBALS['fair_e2e_mail_capture']['mail'][] = array(
				'to'      => fair_e2e_mail_capture_addresses( $atts['to'] ?? array() ),
				'cc'      => fair_e2e_mail_capture_addresses( null, $headers, 'cc' ),
				'bcc'     => fair_e2e_mail_capture_addresses( null, $headers, 'bcc' ),
				'subject' => (string) ( $atts['subject'] ?? '' ),
			);
		}

		return $short_circuit;
	},
	1,
	2
);

add_filter(
	'rest_post_dispatch',
	static function ( $response, $server, $request ) {
		$capture = $GLOBALS['fair_e2e_mail_capture'] ?? null;
		if ( $capture && $request instanceof WP_REST_Request && fair_e2e_mail_capture_token( $request ) === $capture['token'] ) {
			unset( $GLOBALS['fair_e2e_mail_capture'] );
			update_option( FAIR_E2E_MAIL_CAPTURE_PREFIX . $capture['token'], $capture['mail'], false );
		}

		return $response;
	},
	10,
	3
);

// Fail delivery to the address configured through fair-e2e/v1/fee-reminders/mail-failure.
// Runs after the capture filter in fair-e2e-support.php, so wp_mail() reports
// the failure while still sending nothing.
add_filter(
	'pre_wp_mail',
	static function ( $short_circuit, $atts ) {
		$failing = (string) get_option( 'fair_e2e_fail_mail_to', '' );
		if ( '' === $failing ) {
			return $short_circuit;
		}

		return in_array( $failing, (array) ( $atts['to'] ?? array() ), true ) ? false : $short_circuit;
	},
	20,
	2
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Mail captured for one address (recipient and subject only), or
		// cleared entirely so a spec starts from an empty log.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						$email = sanitize_email( (string) $request->get_param( 'to' ) );
						$found = array();
						foreach ( get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
							$to = (array) ( $entry['to'] ?? array() );
							if ( '' !== $email && ! in_array( $email, $to, true ) ) {
								continue;
							}
							$found[] = array(
								'to'      => $to,
								'subject' => (string) ( $entry['subject'] ?? '' ),
							);
						}

						return rest_ensure_response( $found );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function () {
						delete_option( 'fair_e2e_captured_mail' );

						return rest_ensure_response( array( 'cleared' => true ) );
					},
				),
			)
		);

		// The mail one request captured under its token (see the header
		// above), or 404 when no capture was recorded; DELETE removes it.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail-capture/(?P<token>' . FAIR_E2E_MAIL_CAPTURE_TOKEN . ')',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						$mail = get_option( FAIR_E2E_MAIL_CAPTURE_PREFIX . $request['token'], false );
						if ( ! is_array( $mail ) ) {
							return new WP_Error( 'fair_e2e_mail_capture_missing', 'No mail capture was recorded for this token.', array( 'status' => 404 ) );
						}

						return rest_ensure_response( array( 'mail' => $mail ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						return rest_ensure_response( array( 'deleted' => delete_option( FAIR_E2E_MAIL_CAPTURE_PREFIX . $request['token'] ) ) );
					},
				),
			)
		);

		// Send one message per listed address through wp_mail(), so a spec can
		// put unrelated mail in the shared log or, with the capture header,
		// check its assertions against duplicate or misaddressed messages.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail-probe',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$subject = sanitize_text_field( (string) $request->get_param( 'subject' ) );
					$sent    = 0;
					foreach ( (array) $request->get_param( 'to' ) as $address ) {
						$sent += wp_mail( sanitize_email( (string) $address ), $subject, 'Fair E2E mail probe.' ) ? 1 : 0;
					}

					return rest_ensure_response( array( 'sent' => $sent ) );
				},
			)
		);

		// Make wp_mail() fail for one recipient (an empty address clears it).
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail-failure',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$email = sanitize_email( (string) $request->get_param( 'email' ) );
					if ( '' === $email ) {
						delete_option( 'fair_e2e_fail_mail_to' );
					} else {
						update_option( 'fair_e2e_fail_mail_to', $email, false );
					}

					return rest_ensure_response( array( 'failing' => $email ) );
				},
			)
		);

		// Store a participant email exactly as given, the way imported or
		// legacy data can hold an address the participant routes reject.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/participant-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test-only fixture write.
					$updated = $wpdb->update(
						$wpdb->prefix . 'fair_audience_participants',
						array( 'email' => (string) $request->get_param( 'email' ) ),
						array( 'id' => absint( $request->get_param( 'participant_id' ) ) ),
						array( '%s' ),
						array( '%d' )
					);

					return rest_ensure_response( array( 'updated' => (int) $updated ) );
				},
			)
		);
	}
);
