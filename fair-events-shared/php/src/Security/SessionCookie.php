<?php
/**
 * Session cookie transport shared by the signed session services.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Writes and clears a named, request-scoped session cookie.
 *
 * Every cookie is sent with the same attributes: `COOKIEPATH` (falling back
 * to `/`), `COOKIE_DOMAIN` (falling back to the current host), Secure on
 * HTTPS, HttpOnly, and SameSite `Lax`. The matching `$_COOKIE` entry is
 * updated as well, so later code in the same request reads the new value.
 *
 * This class only moves values. Building, signing, validating, and choosing
 * the lifetime of a value stays with each session service, so that one
 * session's value is never accepted by another.
 */
final class SessionCookie {

	/**
	 * Send a session cookie and expose it to the rest of the request.
	 *
	 * Does nothing once headers have been sent, leaving `$_COOKIE` unchanged.
	 *
	 * @param string $name       Cookie name.
	 * @param string $value      Cookie value, already signed by the caller.
	 * @param int    $expires_at Unix timestamp when the cookie expires.
	 * @return void
	 */
	public static function set( string $name, string $value, int $expires_at ): void {
		if ( headers_sent() ) {
			return;
		}

		self::send( $name, $value, $expires_at );
		$_COOKIE[ $name ] = $value;
	}

	/**
	 * Clear a session cookie.
	 *
	 * Always removes the `$_COOKIE` entry for the rest of the request; sends an
	 * expired cookie only while headers can still be sent.
	 *
	 * @param string $name Cookie name.
	 * @return void
	 */
	public static function clear( string $name ): void {
		if ( ! headers_sent() ) {
			self::send( $name, '', time() - HOUR_IN_SECONDS );
		}
		unset( $_COOKIE[ $name ] );
	}

	/**
	 * Send the Set-Cookie header.
	 *
	 * @param string $name       Cookie name.
	 * @param string $value      Cookie value (empty string clears).
	 * @param int    $expires_at Unix timestamp.
	 * @return void
	 */
	private static function send( string $name, string $value, int $expires_at ): void {
		setcookie(
			$name,
			$value,
			array(
				'expires'  => $expires_at,
				'path'     => defined( 'COOKIEPATH' ) && COOKIEPATH ? COOKIEPATH : '/',
				'domain'   => defined( 'COOKIE_DOMAIN' ) ? COOKIE_DOMAIN : '',
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Lax',
			)
		);
	}
}
