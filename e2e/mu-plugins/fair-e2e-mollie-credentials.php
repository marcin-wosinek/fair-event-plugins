<?php
/**
 * Plugin Name: Fair E2E Mollie Credentials
 * Description: Test-only controls for the Mollie credential encryption specs
 *              (#1318), loaded ONLY inside the Playwright wp-env instance.
 *              Switches the connector from the forced fake access token to
 *              the stored credentials, switches encryption support off and
 *              on, stands in for the token refresh service, and reads and
 *              rewrites the raw stored values.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes read and write raw option rows.

/*
 * While `fair_e2e_mollie_stored_credentials` is set, fair-e2e-support.php
 * stops forcing the access token and its expiry, so the connector reads,
 * refreshes and rewrites the stored (encrypted) tokens like a real site.
 */

// Encryption support follows `fair_e2e_encryption_unsupported`.
add_filter(
	'fair_events_shared_encryption_supported',
	static function ( $supported ) {
		return get_option( 'fair_e2e_encryption_unsupported' ) ? false : $supported;
	}
);

// Stand in for https://fair-event-plugins.com/oauth/refresh: record the
// refresh token it receives and answer with a rotated pair.
add_filter(
	'pre_http_request',
	static function ( $preempt, $args, $url ) {
		if ( 0 !== strpos( $url, 'https://fair-event-plugins.com/oauth/refresh' ) || ! get_option( 'fair_e2e_mollie_stored_credentials' ) ) {
			return $preempt;
		}

		$received   = isset( $args['body']['refresh_token'] ) ? (string) $args['body']['refresh_token'] : '';
		$requests   = get_option( 'fair_e2e_mollie_refresh_requests', array() );
		$requests[] = $received;
		update_option( 'fair_e2e_mollie_refresh_requests', $requests, false );

		$count = count( $requests );

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode(
				array(
					'success' => true,
					'data'    => array(
						'data' => array(
							'access_token'  => 'access_e2e_refreshed_' . $count,
							'refresh_token' => 'refresh_e2e_rotated_' . $count,
							'expires_in'    => 3600,
						),
					),
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

add_action(
	'rest_api_init',
	static function () {
		$options = array(
			'access_token'  => 'fair_payment_mollie_access_token',
			'refresh_token' => 'fair_payment_mollie_refresh_token',
		);

		$raw_value = static function ( $option ) {
			global $wpdb;
			return $wpdb->get_var(
				$wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, $option )
			);
		};

		$write_raw = static function ( $option, $value ) {
			global $wpdb;
			$wpdb->replace(
				$wpdb->options,
				array(
					'option_name'  => $option,
					'option_value' => $value,
					'autoload'     => 'auto',
				)
			);
			wp_cache_delete( $option, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
			wp_cache_delete( 'notoptions', 'options' );
		};

		register_rest_route(
			'fair-e2e/v1',
			'/mollie-credentials',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => static function () {
						return current_user_can( 'manage_options' );
					},
					'callback'            => static function () use ( $options, $raw_value ) {
						$body = array(
							'converted'        => (bool) get_option( 'fair_payment_mollie_credentials_converted' ),
							'refresh_requests' => get_option( 'fair_e2e_mollie_refresh_requests', array() ),
						);
						foreach ( $options as $key => $option ) {
							$read                      = \FairEventsShared\Security\ProtectedOptions::read( $option );
							$body[ $key ]              = $raw_value( $option );
							$body[ $key . '_status' ]  = $read->status();
							$body[ $key . '_decrypted' ] = $read->is_readable() ? $read->value() : null;
						}
						return rest_ensure_response( $body );
					},
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => static function () {
						return current_user_can( 'manage_options' );
					},
					'callback'            => static function ( WP_REST_Request $request ) use ( $options, $raw_value, $write_raw ) {
						if ( null !== $request->get_param( 'stored' ) ) {
							if ( $request->get_param( 'stored' ) ) {
								update_option( 'fair_e2e_mollie_stored_credentials', 1, false );
							} else {
								delete_option( 'fair_e2e_mollie_stored_credentials' );
							}
						}

						if ( null !== $request->get_param( 'supported' ) ) {
							if ( $request->get_param( 'supported' ) ) {
								delete_option( 'fair_e2e_encryption_unsupported' );
							} else {
								update_option( 'fair_e2e_encryption_unsupported', 1, false );
							}
						}

						// Plaintext tokens as an older release stored them, with
						// the one-time conversion still to run.
						$plaintext = $request->get_param( 'plaintext' );
						if ( is_array( $plaintext ) ) {
							foreach ( $options as $key => $option ) {
								$write_raw( $option, (string) $plaintext[ $key ] );
							}
							delete_option( 'fair_payment_mollie_credentials_converted' );
						}

						// Tokens written through the option API (encrypted when supported).
						$tokens = $request->get_param( 'tokens' );
						if ( is_array( $tokens ) ) {
							foreach ( $options as $key => $option ) {
								update_option( $option, (string) $tokens[ $key ] );
							}
						}

						if ( null !== $request->get_param( 'expires' ) ) {
							update_option( 'fair_payment_mollie_token_expires', time() + (int) $request->get_param( 'expires' ) );
						}

						// The access token as another site's keys would have encrypted it.
						if ( $request->get_param( 'foreign_key' ) ) {
							$key = \FairEventsShared\Security\SecretBox::derive_key(
								'another-site-security-keys',
								\FairEventsShared\Security\ProtectedOptions::KEY_CONTEXT . '|' . $options['access_token']
							);
							$write_raw( $options['access_token'], \FairEventsShared\Security\SecretBox::encrypt( 'access_e2e_foreign', $key ) );
						}

						if ( $request->get_param( 'reset_refresh_requests' ) ) {
							delete_option( 'fair_e2e_mollie_refresh_requests' );
						}

						// What the Mollie HTTP double reports for GET /v2/payments/{id}.
						if ( null !== $request->get_param( 'mollie_get_status' ) ) {
							if ( $request->get_param( 'mollie_get_status' ) ) {
								update_option( 'fair_e2e_mollie_get_status', sanitize_key( $request->get_param( 'mollie_get_status' ) ) );
							} else {
								delete_option( 'fair_e2e_mollie_get_status' );
							}
						}

						if ( $request->get_param( 'delete_page' ) ) {
							wp_delete_post( (int) $request->get_param( 'delete_page' ), true );
						}

						$response = array(
							'access_token'  => $raw_value( $options['access_token'] ),
							'refresh_token' => $raw_value( $options['refresh_token'] ),
						);

						// A published page with a simple-payment block, for a
						// visitor checkout through POST /payments.
						if ( $request->get_param( 'payment_page' ) ) {
							$block_id            = wp_generate_uuid4();
							$response['page_id'] = wp_insert_post(
								array(
									'post_type'    => 'page',
									'post_status'  => 'publish',
									'post_title'   => 'E2E Credential Encryption Payment',
									'post_content' => '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
										array(
											'blockId'     => $block_id,
											'amount'      => '7.50',
											'description' => 'E2E credential encryption',
										)
									) . ' /-->',
								)
							);
							$response['block_id'] = $block_id;
							$response['page_url'] = get_permalink( $response['page_id'] );
						}

						return rest_ensure_response( $response );
					},
				),
			)
		);
	}
);
