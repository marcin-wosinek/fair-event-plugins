<?php
/**
 * Plugin Name: Fair E2E Instagram Unified Login
 * Description: Test-only. Runs the Instagram Unified Login connection (#2427)
 *              offline inside the Playwright wp-env instance: this site acts
 *              as its own Fair Platform OAuth service, and Meta's Graph API
 *              OAuth calls are answered here.
 *
 * - Fair Platform gets a Unified Login configuration (META_* constants).
 * - Fair Events Experimental uses this site as its OAuth service.
 * - The service's redemption endpoint, which the site calls over HTTP, is
 *   dispatched in-process: the container cannot reach its own published port.
 * - graph.facebook.com code exchange, `debug_token` and
 *   `/me/assigned_instagram_accounts` answer by the authorization code:
 *     e2e-code-ok         one account, publish permission, never expires
 *     e2e-code-multiple   two shared accounts
 *     e2e-code-none       no shared account
 *     e2e-code-noperm     no publish permission
 *     e2e-code-expiring   one account, a token expiring in 30 days
 *     anything else       the exchange fails
 *   The access token is `e2e-ig-unified-<scenario>`, so fair-e2e-protected-credentials.php
 *   answers publishing and connection tests for it.
 *
 * Mounted only into the wp-env tests instance via .wp-env.json — never shipped.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'META_APP_ID' ) ) {
	define( 'META_APP_ID', '880000000000001' );
	define( 'META_APP_SECRET', 'e2e-meta-app-secret' );
	define( 'META_INSTAGRAM_CONFIG_ID', '880000000000002' );
}

/**
 * Account the e2e Instagram business shares.
 */
const FAIR_E2E_IG_ACCOUNT = array(
	'id'       => '17841400000000001',
	'username' => 'e2e_unified_club',
);

add_filter(
	'fair_events_experimental_instagram_oauth_service_url',
	static function () {
		return home_url();
	}
);

/**
 * A JSON HTTP response.
 *
 * @param int   $code Status.
 * @param array $body Body.
 * @return array
 */
function fair_e2e_unified_json( $code, $body ) {
	return array(
		'headers'  => array(),
		'body'     => wp_json_encode( $body ),
		'response' => array(
			'code'    => $code,
			'message' => 200 === $code ? 'OK' : 'Error',
		),
		'cookies'  => array(),
		'filename' => null,
	);
}

add_filter(
	'pre_http_request',
	static function ( $preempt, $args, $url ) {
		// The site redeeming a handoff code with "the service" (this site).
		if ( 0 === strpos( $url, home_url( '/wp-json/fair-platform/v1/instagram/redeem' ) ) ) {
			$request = new WP_REST_Request( 'POST', '/fair-platform/v1/instagram/redeem' );
			$request->set_body_params( is_array( $args['body'] ?? null ) ? $args['body'] : array() );
			$response = rest_do_request( $request );
			return fair_e2e_unified_json( $response->get_status(), (array) rest_get_server()->response_to_data( $response, false ) );
		}

		if ( 0 !== strpos( $url, 'https://graph.facebook.com/' ) ) {
			return $preempt;
		}

		$path  = (string) wp_parse_url( $url, PHP_URL_PATH );
		$query = array();
		wp_parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );

		if ( preg_match( '#/oauth/access_token$#', $path ) ) {
			$scenario = preg_match( '/^e2e-code-(ok|multiple|none|noperm|expiring)$/', $query['code'] ?? '', $m ) ? $m[1] : '';
			if (
				'' === $scenario
				|| META_APP_SECRET !== ( $query['client_secret'] ?? '' )
				|| home_url( '/oauth/instagram/callback' ) !== ( $query['redirect_uri'] ?? '' )
			) {
				return fair_e2e_unified_json(
					400,
					array(
						'error' => array(
							'message' => 'Invalid verification code format.',
							'code'    => 100,
						),
					)
				);
			}
			return fair_e2e_unified_json(
				200,
				array(
					'access_token' => 'e2e-ig-unified-' . $scenario,
					'token_type'   => 'bearer',
				)
			);
		}

		if ( preg_match( '#/debug_token$#', $path ) ) {
			$scenario = substr( (string) ( $query['input_token'] ?? '' ), strlen( 'e2e-ig-unified-' ) );
			$scopes   = array( 'instagram_basic', 'instagram_content_publish', 'public_profile' );
			return fair_e2e_unified_json(
				200,
				array(
					'data' => array(
						'app_id'     => META_APP_ID,
						'type'       => 'SYSTEM_USER',
						'is_valid'   => META_APP_ID . '|' . META_APP_SECRET === ( $query['access_token'] ?? '' ),
						'expires_at' => 'expiring' === $scenario ? time() + 30 * DAY_IN_SECONDS : 0,
						'scopes'     => 'noperm' === $scenario ? array( 'instagram_basic', 'public_profile' ) : $scopes,
						'user_id'    => '900000000000001',
					),
				)
			);
		}

		if ( preg_match( '#/me/assigned_instagram_accounts$#', $path ) ) {
			$scenario = substr( (string) ( $query['access_token'] ?? '' ), strlen( 'e2e-ig-unified-' ) );
			$accounts = array( FAIR_E2E_IG_ACCOUNT );
			if ( 'multiple' === $scenario ) {
				$accounts[] = array(
					'id'       => '17841400000000002',
					'username' => 'e2e_other_club',
				);
			} elseif ( 'none' === $scenario ) {
				$accounts = array();
			}
			return fair_e2e_unified_json( 200, array( 'data' => $accounts ) );
		}

		return $preempt;
	},
	8,
	3
);
