<?php
/**
 * Mollie OAuth request/response shaping
 *
 * @package FairPlatform
 */

namespace FairPlatform\OAuth;

defined( 'ABSPATH' ) || die;

/**
 * Side-effect-free pieces of the Mollie OAuth flow: which permissions are
 * requested, what a refresh hands back to the site, how a refresh token
 * is fingerprinted for the connection logs, and where an authorization
 * error may be returned to.
 */
class MollieOAuth {

	/**
	 * Permissions every connecting site requests.
	 */
	const BASE_SCOPE = 'payments.read payments.write refunds.read refunds.write organizations.read profiles.read profiles.write balances.read';

	/**
	 * Optional permission a site can ask for on top of the base set.
	 */
	const SETTLEMENT_SCOPE = 'settlements.read';

	/**
	 * Whether the authorize request asked for settlement access.
	 *
	 * A bounded flag rather than a scope list, so a site can only ever add
	 * the one optional permission this platform knows about.
	 *
	 * @param mixed $flag Raw `settlement_access` request value.
	 * @return bool
	 */
	public static function is_settlement_access_requested( $flag ) {
		return '1' === $flag;
	}

	/**
	 * Scope string for the Mollie authorization URL.
	 *
	 * @param bool $settlement_access Whether settlement access was requested.
	 * @return string Space-separated scopes.
	 */
	public static function authorization_scope( $settlement_access ) {
		return $settlement_access
			? self::BASE_SCOPE . ' ' . self::SETTLEMENT_SCOPE
			: self::BASE_SCOPE;
	}

	/**
	 * Data returned to the site after a token refresh.
	 *
	 * The scope and a rotated refresh token are passed on only when Mollie
	 * actually returned them, so the site never records a permission or
	 * credential this response did not carry.
	 *
	 * @param array $body Decoded Mollie token response.
	 * @return array Refresh payload for the site.
	 */
	public static function refresh_response_data( $body ) {
		$data = array(
			'access_token' => $body['access_token'],
			'expires_in'   => $body['expires_in'] ?? 3600,
		);

		if ( isset( $body['scope'] ) && is_string( $body['scope'] ) && '' !== $body['scope'] ) {
			$data['scope'] = $body['scope'];
		}

		if ( isset( $body['refresh_token'] ) && is_string( $body['refresh_token'] ) && '' !== $body['refresh_token'] ) {
			$data['refresh_token'] = $body['refresh_token'];
		}

		return $data;
	}

	/**
	 * Keyed fingerprint binding a refresh token to its connection log row.
	 *
	 * The token itself is never stored; without the server key the
	 * fingerprint cannot be matched against a guessed or leaked token.
	 *
	 * @param mixed  $refresh_token Refresh token.
	 * @param string $key           Server secret.
	 * @return string|null 64 hex characters, or null without a usable token or key.
	 */
	public static function refresh_token_fingerprint( $refresh_token, $key ) {
		if ( ! is_string( $refresh_token ) || '' === $refresh_token || ! is_string( $key ) || '' === $key ) {
			return null;
		}

		return hash_hmac( 'sha256', $refresh_token, $key );
	}

	/**
	 * The fingerprint a successful refresh leaves bound to the connection:
	 * the rotated token's when Mollie issued a different one, otherwise null
	 * so the existing binding is kept.
	 *
	 * @param array  $body          Decoded Mollie token response.
	 * @param string $refresh_token Refresh token the site sent.
	 * @param string $key           Server secret.
	 * @return string|null
	 */
	public static function rotated_refresh_token_fingerprint( $body, $refresh_token, $key ) {
		$data = self::refresh_response_data( $body );
		if ( ! isset( $data['refresh_token'] ) || $data['refresh_token'] === $refresh_token ) {
			return null;
		}

		return self::refresh_token_fingerprint( $data['refresh_token'], $key );
	}

	/**
	 * URL an authorization error is returned to, or '' when there is none.
	 *
	 * Only state data this platform stored for the authorization attempt
	 * names a site; without it the error must not be redirected anywhere.
	 *
	 * @param mixed  $state_data  Stored state data, or false when the state is unknown or expired.
	 * @param string $error       Error code.
	 * @param string $description Error description.
	 * @return string Redirect URL, or '' when the error cannot be returned to a site.
	 */
	public static function error_return_url( $state_data, $error, $description ) {
		if ( ! is_array( $state_data ) || empty( $state_data['return_url'] ) ) {
			return '';
		}

		return add_query_arg(
			array(
				'error'             => rawurlencode( $error ),
				'error_description' => rawurlencode( $description ),
				'state'             => rawurlencode( $state_data['client_state'] ?? '' ),
			),
			$state_data['return_url']
		);
	}
}
