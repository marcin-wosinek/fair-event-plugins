<?php
/**
 * Plugin Name: Fair Events E2E Rate Limit
 * Description: Test-only routes for the get-tickets rate limit specs, loaded
 *              ONLY inside the Playwright wp-env instance. Reads and resets
 *              the per-email and per-IP counters, lets their windows run out
 *              without waiting, and switches the per-IP limit back on for a
 *              spec (fair-e2e-support.php bypasses it for the whole run).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// Enforce the per-IP limit while a spec asks for it. Runs after the
// suite-wide bypass registered in fair-e2e-support.php.
add_filter(
	'fair_events_get_tickets_rate_limit_bypass_ip',
	static function ( $bypass ) {
		return get_option( 'fair_e2e_enforce_ip_rate_limit' ) ? false : $bypass;
	},
	20
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Transient keys, as GetTicketsController builds them. Specs and
		// buyers reach the site from one address, so the fixture request's
		// own IP names the buyers' counter.
		$email_key = static function ( WP_REST_Request $request ) {
			$email = sanitize_email( (string) $request->get_param( 'email' ) );
			return '' === $email ? '' : 'fair_events_get_tickets_checkout_email_' . md5( strtolower( $email ) );
		};
		$ip_key    = static function () {
			return 'fair_events_get_tickets_rl_ip_' . md5( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		};

		// A counter and the seconds left before it expires.
		$counter = static function ( $key ) {
			if ( '' === $key ) {
				return array(
					'count' => 0,
					'ttl'   => 0,
				);
			}

			$count   = (int) get_transient( $key );
			$timeout = (int) get_option( '_transient_timeout_' . $key, 0 );

			return array(
				'count' => $count,
				'ttl'   => $count && $timeout ? max( 0, $timeout - time() ) : 0,
			);
		};

		$state = static function ( WP_REST_Request $request ) use ( $email_key, $ip_key, $counter ) {
			return rest_ensure_response(
				array(
					'email'       => $counter( $email_key( $request ) ),
					'ip'          => $counter( $ip_key() ),
					'ip_enforced' => (bool) get_option( 'fair_e2e_enforce_ip_rate_limit' ),
				)
			);
		};

		register_rest_route(
			'fair-e2e/v1',
			'/rate-limit',
			array(
				// Counters of an email (optional) and of the caller's IP.
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => $state,
				),
				// { enforce_ip } switches the per-IP limit on or off.
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $state ) {
						if ( rest_sanitize_boolean( $request->get_param( 'enforce_ip' ) ) ) {
							update_option( 'fair_e2e_enforce_ip_rate_limit', 1, false );
						} else {
							delete_option( 'fair_e2e_enforce_ip_rate_limit' );
						}

						return $state( $request );
					},
				),
				// Clear the IP counter, an email's counter when one is named,
				// and the per-IP enforcement.
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $email_key, $ip_key, $state ) {
						delete_transient( $ip_key() );
						if ( '' !== $email_key( $request ) ) {
							delete_transient( $email_key( $request ) );
						}
						delete_option( 'fair_e2e_enforce_ip_rate_limit' );

						return $state( $request );
					},
				),
			)
		);

		// Let { seconds } pass for one counter: { target: 'email', email }
		// or { target: 'ip' }. The counter then expires as it would in time.
		register_rest_route(
			'fair-e2e/v1',
			'/rate-limit/elapse',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $email_key, $ip_key, $state ) {
					$key = 'ip' === $request->get_param( 'target' ) ? $ip_key() : $email_key( $request );
					if ( '' === $key ) {
						return new WP_Error( 'invalid_target', 'Name an email or the ip target.', array( 'status' => 400 ) );
					}

					$timeout = (int) get_option( '_transient_timeout_' . $key, 0 );
					if ( $timeout ) {
						update_option( '_transient_timeout_' . $key, $timeout - absint( $request->get_param( 'seconds' ) ) );
					}

					return $state( $request );
				},
			)
		);
	}
);
