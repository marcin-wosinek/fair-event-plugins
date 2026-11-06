<?php
/**
 * Shared bearer token authentication for data sharing APIs
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\ApiTokens;

defined( 'WPINC' ) || die;

use WP_Error;
use WP_REST_Request;

/**
 * Authenticates public external REST endpoints via scoped bearer tokens.
 *
 * A plugin's auth class extends this one, names its token model in
 * token_model() and supplies its own translated error messages, so each
 * plugin keeps a literal text domain. Every token failure that could reveal
 * whether a token exists answers with the same 401.
 *
 * Plugins bundling different versions of this package can be active
 * together, and either copy may be the one loaded. Keep this class
 * additive: never add an abstract method or change a signature.
 */
abstract class AbstractApiTokenAuth {

	/**
	 * Request parameter the authenticated token row is stored under.
	 */
	const TOKEN_PARAM = '_fair_api_token';

	/**
	 * Token model class, a subclass of AbstractApiToken.
	 *
	 * @return string Class name.
	 */
	abstract protected static function token_model();

	/**
	 * Message for a valid token that lacks the required scope.
	 *
	 * @return string
	 */
	abstract protected static function insufficient_scope_message();

	/**
	 * Message for a missing, malformed, unknown or revoked token.
	 *
	 * @return string
	 */
	abstract protected static function unauthorized_message();

	/**
	 * Authenticate a request and verify it carries the required scope.
	 *
	 * @param WP_REST_Request $request        Incoming request.
	 * @param string|null     $required_scope Scope the endpoint requires, or null
	 *                                        to require only a valid active token.
	 * @return true|WP_Error True when authorized, WP_Error otherwise.
	 */
	public static function authenticate( WP_REST_Request $request, $required_scope = null ) {
		$model = static::token_model();
		$token = self::parse_bearer_token( $request->get_header( 'authorization' ) );

		if ( '' === $token ) {
			return static::unauthorized();
		}

		$row = $model::find_by_token( $token );

		if ( ! $row || ! $model::is_active( $row ) ) {
			return static::unauthorized();
		}

		if ( null !== $required_scope && ! $model::has_scope( $row, $required_scope ) ) {
			return new WP_Error(
				'rest_insufficient_scope',
				static::insufficient_scope_message(),
				array( 'status' => 403 )
			);
		}

		$model::touch_last_used( (int) $row->id );
		$request->set_param( self::TOKEN_PARAM, $row );

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
			return static::authenticate( $request, $scope );
		};
	}

	/**
	 * Build a permission_callback that requires only a valid active token.
	 *
	 * @return callable permission_callback for register_rest_route().
	 */
	public static function require_token() {
		return function ( WP_REST_Request $request ) {
			return static::authenticate( $request );
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
	protected static function unauthorized() {
		return new WP_Error(
			'rest_forbidden',
			static::unauthorized_message(),
			array( 'status' => 401 )
		);
	}
}
