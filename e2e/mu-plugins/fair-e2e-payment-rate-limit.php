<?php
/**
 * Plugin Name: Fair Payments E2E Rate Limit
 * Description: Test-only support for the public payment/nonce/webhook rate
 *              limit specs (#855), loaded ONLY inside the Playwright wp-env
 *              instance. Lets a request pose as another client address,
 *              resets and ages the counters, seeds a payment page, and
 *              reports what a request created or sent to Mollie.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only counts and cleanup.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairPaymentsConnector\Database\Schema;
use FairPaymentsConnector\Services\PublicEndpointRateLimiter;

/*
 * Every spec reaches the site from one address. A request carrying
 * X-Fair-E2E-Client-Ip poses as that client instead, so a spec can use its
 * own counters, and "none" drops REMOTE_ADDR to exercise the fallback
 * bucket. Only REMOTE_ADDR changes: forwarded headers a spec sends stay as
 * they are, which is how the specs show they are ignored.
 */
if ( isset( $_SERVER['HTTP_X_FAIR_E2E_CLIENT_IP'] ) ) {
	$fair_e2e_client_ip = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FAIR_E2E_CLIENT_IP'] ) );
	if ( 'none' === $fair_e2e_client_ip ) {
		unset( $_SERVER['REMOTE_ADDR'] );
	} else {
		$_SERVER['REMOTE_ADDR'] = $fair_e2e_client_ip;
	}
	unset( $fair_e2e_client_ip );
}

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( PublicEndpointRateLimiter::class ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Transient key of { bucket, ip }; ip "none" names the fallback bucket.
		$key = static function ( WP_REST_Request $request ) {
			$ip = (string) $request->get_param( 'ip' );
			return PublicEndpointRateLimiter::key(
				sanitize_key( (string) $request->get_param( 'bucket' ) ),
				'none' === $ip ? PublicEndpointRateLimiter::UNKNOWN_CLIENT : $ip
			);
		};

		register_rest_route(
			'fair-e2e/v1',
			'/payment-rate-limit',
			array(
				// Rows and Mollie calls so far, and one counter when
				// { bucket, ip } is given.
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $key ) {
						global $wpdb;

						$window = $request->get_param( 'bucket' ) ? get_transient( $key( $request ) ) : false;

						return rest_ensure_response(
							array(
								'count'          => is_array( $window ) ? (int) $window['count'] : 0,
								'expires_in'     => is_array( $window ) ? (int) $window['expires'] - time() : 0,
								'transactions'   => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', Schema::get_payments_table_name() ) ),
								'payment_logs'   => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', Schema::get_log_table_name() ) ),
								'mollie_creates' => (int) get_option( 'fair_e2e_mollie_create_count', 0 ),
								'mollie_gets'    => (int) get_option( 'fair_e2e_mollie_get_count', 0 ),
							)
						);
					},
				),
				// Clear every rate-limit counter.
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function () {
						global $wpdb;

						$names = $wpdb->get_col(
							$wpdb->prepare(
								'SELECT option_name FROM %i WHERE option_name LIKE %s',
								$wpdb->options,
								$wpdb->esc_like( '_transient_' . PublicEndpointRateLimiter::KEY_PREFIX ) . '%'
							)
						);
						foreach ( $names as $name ) {
							delete_transient( substr( $name, strlen( '_transient_' ) ) );
						}

						return rest_ensure_response( array( 'deleted' => count( $names ) ) );
					},
				),
			)
		);

		// Let { seconds } of a { bucket, ip } window pass.
		register_rest_route(
			'fair-e2e/v1',
			'/payment-rate-limit/elapse',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $key ) {
					$transient = $key( $request );
					$window    = get_transient( $transient );
					if ( ! is_array( $window ) ) {
						return new WP_Error( 'no_window', 'No open window for that bucket and address.', array( 'status' => 404 ) );
					}

					$seconds            = absint( $request->get_param( 'seconds' ) );
					$window['expires'] -= $seconds;
					update_option( '_transient_' . $transient, $window, false );

					$timeout = (int) get_option( '_transient_timeout_' . $transient, 0 );
					if ( $timeout ) {
						update_option( '_transient_timeout_' . $transient, $timeout - $seconds, false );
					}

					return rest_ensure_response( array( 'expires_in' => $window['expires'] - time() ) );
				},
			)
		);

		// A published page with one simple-payment block, and its removal.
		register_rest_route(
			'fair-e2e/v1',
			'/payment-rate-limit/page',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function () {
						$block_id = wp_generate_uuid4();
						$page_id  = wp_insert_post(
							array(
								'post_type'    => 'page',
								'post_status'  => 'publish',
								'post_title'   => 'E2E Payment Rate Limit',
								'post_content' => '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
									array(
										'blockId'     => $block_id,
										'amount'      => '5.00',
										'description' => 'E2E rate limit',
									)
								) . ' /-->',
							),
							true
						);
						if ( is_wp_error( $page_id ) ) {
							return $page_id;
						}

						return rest_ensure_response(
							array(
								'page_id'  => $page_id,
								'block_id' => $block_id,
							)
						);
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						wp_delete_post( absint( $request->get_param( 'page_id' ) ), true );
						return rest_ensure_response( array( 'deleted' => true ) );
					},
				),
			)
		);
	}
);
