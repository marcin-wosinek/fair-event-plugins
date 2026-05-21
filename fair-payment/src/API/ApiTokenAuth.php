<?php
/**
 * Bearer token authentication for the data sharing API.
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Models\ApiToken;
use WP_Error;
use WP_REST_Request;

defined( 'WPINC' ) || die;

/**
 * Authenticates public external REST endpoints via scoped bearer tokens.
 *
 * Note: rate limiting is a deliberate follow-up and is not implemented here.
 */
class ApiTokenAuth {
	/**
	 * Authenticate a request and verify it carries the required scope.
	 *
	 * On success the resolved token row is stashed on the request as the
	 * `_fair_api_token` param and the token's last_used_at is updated.
	 *
	 * @param WP_REST_Request $request        Incoming request.
	 * @param string          $required_scope Scope the endpoint requires.
	 * @return true|WP_Error True when authorized, WP_Error otherwise.
	 */
	public static function authenticate( WP_REST_Request $request, $required_scope ) {
		$header = $request->get_header( 'authorization' );

		$token = self::parse_bearer_token( $header );

		if ( '' === $token ) {
			return self::unauthorized();
		}

		$row = ApiToken::find_by_token( $token );

		// Generic 401 for missing/invalid/revoked tokens (no existence leak).
		if ( ! $row || ! ApiToken::is_active( $row ) ) {
			return self::unauthorized();
		}

		if ( ! ApiToken::has_scope( $row, $required_scope ) ) {
			return new WP_Error(
				'rest_insufficient_scope',
				__( 'This token does not have the required scope.', 'fair-payment' ),
				array( 'status' => 403 )
			);
		}

		ApiToken::touch_last_used( (int) $row->id );
		$request->set_param( '_fair_api_token', $row );

		return true;
	}

	/**
	 * Build a permission_callback that requires a given scope.
	 *
	 * @param string $scope Required scope.
	 * @return callable permission_callback for register_rest_route().
	 */
	public static function require_scope( $scope ) {
		return function ( WP_REST_Request $request ) use ( $scope ) {
			return self::authenticate( $request, $scope );
		};
	}

	/**
	 * Extract the token from an Authorization header value.
	 *
	 * @param string|null $header Header value.
	 * @return string Token, or empty string when not a valid Bearer header.
	 */
	private static function parse_bearer_token( $header ) {
		if ( ! is_string( $header ) || '' === $header ) {
			return '';
		}

		if ( ! preg_match( '/^Bearer\s+(.+)$/i', trim( $header ), $matches ) ) {
			return '';
		}

		return trim( $matches[1] );
	}

	/**
	 * Standard 401 error for missing/invalid tokens.
	 *
	 * @return WP_Error
	 */
	private static function unauthorized() {
		return new WP_Error(
			'rest_forbidden',
			__( 'Invalid or missing API token.', 'fair-payment' ),
			array( 'status' => 401 )
		);
	}
}
