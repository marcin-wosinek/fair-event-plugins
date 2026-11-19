<?php
/**
 * Plugin Name: Fair E2E Protected Credentials
 * Description: Test-only controls for the Instagram and Telegram credential
 *              encryption specs (#1319), loaded ONLY inside the Playwright
 *              wp-env instance. Seeds the stored tokens raw (plaintext, or
 *              encrypted under another site's keys), reads them back raw,
 *              seeds Unified Login connection metadata (#2427), and stands
 *              in for the Instagram APIs, recording the token each request
 *              carried.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes read and write raw option rows.

/*
 * Encryption support is switched off with `fair_e2e_encryption_unsupported`
 * (see fair-e2e-mollie-credentials.php, which registers that filter).
 */

/**
 * Credentials this fixture controls, by key.
 *
 * @return array<string, array{option: string, converted: string}>
 */
function fair_e2e_protected_credentials() {
	return array(
		'instagram' => array(
			'option'    => 'fair_audience_instagram_access_token',
			'converted' => 'fair_audience_instagram_credentials_converted',
		),
		'telegram'  => array(
			'option'    => 'fair_payment_telegram_bot_token',
			'converted' => 'fair_payment_telegram_credentials_converted',
		),
	);
}

/**
 * Record the token an outgoing request carried.
 *
 * @param string $service Service name.
 * @param string $token   Token sent.
 * @return void
 */
function fair_e2e_record_credential_request( $service, $token ) {
	$requests   = get_option( 'fair_e2e_credential_requests', array() );
	$requests[] = array(
		'service' => $service,
		'token'   => $token,
	);
	update_option( 'fair_e2e_credential_requests', $requests, false );
}

// The Telegram double (lib/telegram-http-double.php) never records the bot
// token; record it here first, then let the double answer.
add_filter(
	'pre_http_request',
	static function ( $preempt, $args, $url ) {
		if ( preg_match( '#^https://api\.telegram\.org/bot([^/]+)/#', $url, $matches ) ) {
			fair_e2e_record_credential_request( 'telegram', rawurldecode( $matches[1] ) );
		}
		return $preempt;
	},
	5,
	3
);

// Stand in for the Instagram API with Unified Login (graph.facebook.com,
// #2427), the retired Instagram Login host, and the retired token refresh
// service. fair-e2e-instagram-unified-login.php answers the OAuth calls first.
add_filter(
	'pre_http_request',
	static function ( $preempt, $args, $url ) {
		if ( false !== $preempt ) {
			return $preempt;
		}

		$is_refresh = 0 === strpos( $url, 'https://fair-event-plugins.com/oauth/instagram/refresh' );
		$is_graph   = 0 === strpos( $url, 'https://graph.facebook.com/' );
		if ( ! $is_refresh && ! $is_graph && 0 !== strpos( $url, 'https://graph.instagram.com/' ) ) {
			return $preempt;
		}

		$query = array();
		wp_parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$header = (string) ( $args['headers']['Authorization'] ?? '' );
		if ( 0 === strpos( $header, 'Bearer ' ) ) {
			$token = substr( $header, 7 );
		} else {
			$token = isset( $args['body']['access_token'] ) ? $args['body']['access_token'] : ( $query['access_token'] ?? '' );
		}
		// graph.facebook.com also serves WhatsApp and the Conversions API:
		// claim only the Instagram test tokens.
		if ( $is_graph && ! preg_match( '/^(instagram_e2e|e2e-ig-)/', (string) $token ) ) {
			return $preempt;
		}

		fair_e2e_record_credential_request( $is_refresh ? 'instagram_refresh' : ( $is_graph ? 'instagram_graph' : 'instagram' ), (string) $token );

		$path = (string) wp_parse_url( $url, PHP_URL_PATH );

		// The platform retired token renewal (#2427).
		if ( $is_refresh ) {
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode(
					array(
						'success' => false,
						'data'    => array( 'code' => 'instagram_refresh_retired' ),
					)
				),
				'response' => array(
					'code'    => 410,
					'message' => 'Gone',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		}

		// A revoked token (#2076): Instagram's error, echoing the token the
		// way its messages can, so specs check it is redacted.
		if ( 0 === strpos( (string) $token, 'e2e-ig-revoked' ) ) {
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode(
					array(
						'error' => array(
							'message' => 'Invalid OAuth access token - Cannot parse access token ' . $token,
							'type'    => 'OAuthException',
							'code'    => 190,
						),
					)
				),
				'response' => array(
					'code'    => 400,
					'message' => 'Bad Request',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		}

		if ( $is_graph && isset( $query['fields'] ) && 'id,username' === $query['fields'] && preg_match( '#^/v\d+\.\d+/(\d+)$#', $path, $account ) ) {
			// The connection test reads the connected account.
			$body = array(
				'id'       => $account[1],
				'username' => 'e2e_demo_account',
			);
		} elseif ( '/me' === $path ) {
			$body = array(
				'user_id'  => '17840000000000001',
				'username' => 'e2e_demo_account',
			);
		} elseif ( '/media' === substr( $path, -6 ) ) {
			$body = array( 'id' => 'e2e_container_1319' );
		} elseif ( '/media_publish' === substr( $path, -14 ) ) {
			$body = array( 'id' => 'e2e_media_1319' );
		} elseif ( isset( $query['fields'] ) && 'status_code' === $query['fields'] ) {
			$body = array( 'status_code' => 'FINISHED' );
		} else {
			$body = array( 'permalink' => 'https://www.instagram.com/p/e2e1319/' );
		}

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $body ),
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	// Before lib/whatsapp-http-double.php, which answers every Bearer request.
	9,
	3
);

add_action(
	'rest_api_init',
	static function () {
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

		$admin = static function () {
			return current_user_can( 'manage_options' );
		};

		register_rest_route(
			'fair-e2e/v1',
			'/protected-credentials',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin,
					'callback'            => static function () use ( $raw_value ) {
						$body = array(
							'requests'              => get_option( 'fair_e2e_credential_requests', array() ),
							'instagram_expires'     => (int) get_option( 'fair_audience_instagram_token_expires', 0 ),
							'instagram_connected'   => (bool) get_option( 'fair_audience_instagram_connected', false ),
							'instagram_option_rows' => null !== $raw_value( 'fair_audience_instagram_access_token' ),
						);
						foreach ( fair_e2e_protected_credentials() as $key => $credential ) {
							$read                         = \FairEventsShared\Security\ProtectedOptions::read( $credential['option'] );
							$body[ $key ]                 = $raw_value( $credential['option'] );
							$body[ $key . '_status' ]     = $read->status();
							$body[ $key . '_decrypted' ]  = $read->is_readable() ? $read->value() : null;
							$body[ $key . '_converted' ]  = (bool) get_option( $credential['converted'] );
						}
						return rest_ensure_response( $body );
					},
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => $admin,
					'callback'            => static function ( WP_REST_Request $request ) use ( $raw_value, $write_raw ) {
						if ( null !== $request->get_param( 'supported' ) ) {
							if ( $request->get_param( 'supported' ) ) {
								delete_option( 'fair_e2e_encryption_unsupported' );
							} else {
								update_option( 'fair_e2e_encryption_unsupported', 1, false );
							}
						}

						// The experimental Instagram bundle on or off.
						if ( null !== $request->get_param( 'instagram_feature' ) ) {
							$features              = get_option( 'fair_audience_experimental_features', array() );
							$features              = is_array( $features ) ? $features : array();
							$features['instagram'] = (bool) $request->get_param( 'instagram_feature' );
							update_option( 'fair_audience_experimental_features', $features );
						}

						// Fair Events Experimental's Instagram feature: on, it
						// takes the connection over from Fair Audience.
						if ( null !== $request->get_param( 'events_instagram_feature' ) ) {
							$features              = get_option( 'fair_events_experimental_features', array() );
							$features              = is_array( $features ) ? $features : array();
							$features['instagram'] = (bool) $request->get_param( 'events_instagram_feature' );
							update_option( 'fair_events_experimental_features', $features );
						}

						foreach ( fair_e2e_protected_credentials() as $key => $credential ) {
							$seed = $request->get_param( $key );
							if ( ! is_array( $seed ) ) {
								continue;
							}

							// A token as an older release stored it, with the
							// one-time conversion still to run.
							if ( isset( $seed['plaintext'] ) ) {
								$write_raw( $credential['option'], (string) $seed['plaintext'] );
								delete_option( $credential['converted'] );
							}

							// A token written through the option API (encrypted when supported).
							if ( isset( $seed['token'] ) ) {
								update_option( $credential['option'], (string) $seed['token'] );
							}

							// The token as another site's keys would have encrypted it.
							if ( isset( $seed['foreign_key'] ) ) {
								$foreign = \FairEventsShared\Security\SecretBox::derive_key(
									'another-site-security-keys',
									\FairEventsShared\Security\ProtectedOptions::KEY_CONTEXT . '|' . $credential['option']
								);
								$write_raw( $credential['option'], \FairEventsShared\Security\SecretBox::encrypt( (string) $seed['foreign_key'], $foreign ) );
							}

							if ( ! empty( $seed['delete'] ) ) {
								delete_option( $credential['option'] );
							}
						}

						// The metadata of a Unified Login connection (#2427),
						// as Fair Events Experimental stores it, or none for
						// a connection from before.
						$unified = $request->get_param( 'instagram_unified' );
						if ( true === $unified ) {
							update_option( 'fair_audience_instagram_user_id', '17840000000000001' );
							update_option( 'fair_audience_instagram_username', 'e2e_demo_account' );
							update_option( 'fair_audience_instagram_token_type', 'system_user' );
							update_option( 'fair_audience_instagram_scopes', array( 'instagram_basic', 'instagram_content_publish' ) );
							update_option( 'fair_audience_instagram_graph_version', 'v27.0' );
							update_option( 'fair_audience_instagram_token_expiry', 'never' );
							update_option( 'fair_audience_instagram_token_expires', 4102444800 );
							update_option( 'fair_audience_instagram_connected', true );
							update_option( 'fair_audience_instagram_connection_format', 'unified_login' );
						} elseif ( false === $unified ) {
							foreach ( array( 'fair_audience_instagram_connection_format', 'fair_audience_instagram_token_type', 'fair_audience_instagram_scopes', 'fair_audience_instagram_graph_version', 'fair_audience_instagram_token_expiry' ) as $option ) {
								delete_option( $option );
							}
							update_option( 'fair_audience_instagram_user_id', '17840000000000001' );
							update_option( 'fair_audience_instagram_connected', true );
						}

						if ( null !== $request->get_param( 'instagram_expires' ) ) {
							update_option( 'fair_audience_instagram_token_expires', (int) $request->get_param( 'instagram_expires' ) );
						}

						if ( $request->get_param( 'reset_requests' ) ) {
							delete_option( 'fair_e2e_credential_requests' );
						}

						// Run the retired daily Instagram token refreshes now:
						// nothing is hooked to them any more (#2427).
						if ( $request->get_param( 'refresh_instagram' ) ) {
							do_action( 'fair_audience_refresh_instagram_token' );
							do_action( 'fair_events_experimental_instagram_token_refresh' );
						}

						$response = array();
						foreach ( fair_e2e_protected_credentials() as $key => $credential ) {
							$response[ $key ] = $raw_value( $credential['option'] );
						}
						return rest_ensure_response( $response );
					},
				),
			)
		);
	}
);
