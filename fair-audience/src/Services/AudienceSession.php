<?php
/**
 * Audience Session Service
 *
 * Manages a short-lived, HMAC-signed cookie that identifies a participant
 * across signup forms on the site. The cookie lets the next signup form a
 * visitor opens pre-fill name / surname / email / phone without re-asking.
 *
 * Cookie format: "{participant_id}.{expires_at}.{signature}"
 *
 * The expiry is part of the signed payload so a client cannot extend the
 * lifetime by editing the cookie.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for setting / reading / clearing the audience session cookie.
 */
class AudienceSession {

	/**
	 * Cookie name.
	 */
	const COOKIE_NAME = 'fair_audience_session';

	/**
	 * Cookie lifetime in seconds (1 hour).
	 */
	const LIFETIME = HOUR_IN_SECONDS;

	/**
	 * Set or refresh the session cookie for a participant.
	 *
	 * Safe to call multiple times per request; each call replaces the cookie
	 * value and slides the expiry forward to LIFETIME seconds from now.
	 *
	 * @param int $participant_id Participant ID to bind the session to.
	 * @return void
	 */
	public static function set( int $participant_id ): void {
		if ( $participant_id <= 0 ) {
			return;
		}
		if ( headers_sent() ) {
			return;
		}

		$expires_at = time() + self::LIFETIME;
		$value      = self::build_value( $participant_id, $expires_at );

		self::send_cookie( $value, $expires_at );
		$_COOKIE[ self::COOKIE_NAME ] = $value;
	}

	/**
	 * Get the participant ID from a valid session cookie, or null.
	 *
	 * Returns null when the cookie is missing, malformed, tampered, or expired.
	 *
	 * @return int|null Participant ID, or null when no valid session.
	 */
	public static function get_participant_id(): ?int {
		if ( empty( $_COOKIE[ self::COOKIE_NAME ] ) ) {
			return null;
		}

		$raw = wp_unslash( $_COOKIE[ self::COOKIE_NAME ] );
		if ( ! is_string( $raw ) ) {
			return null;
		}

		$parts = explode( '.', $raw, 3 );
		if ( 3 !== count( $parts ) ) {
			return null;
		}

		list( $participant_id_str, $expires_at_str, $signature ) = $parts;

		if ( ! ctype_digit( $participant_id_str ) || ! ctype_digit( $expires_at_str ) ) {
			return null;
		}

		$participant_id = (int) $participant_id_str;
		$expires_at     = (int) $expires_at_str;

		if ( $participant_id <= 0 || $expires_at <= time() ) {
			return null;
		}

		$expected = self::sign( $participant_id . '.' . $expires_at );
		if ( ! hash_equals( $expected, $signature ) ) {
			return null;
		}

		return $participant_id;
	}

	/**
	 * Slide the expiry forward on a valid session.
	 *
	 * No-op when no valid cookie is present. Equivalent to calling set() with
	 * the participant id currently stored in the cookie.
	 *
	 * @return void
	 */
	public static function slide(): void {
		$participant_id = self::get_participant_id();
		if ( null === $participant_id ) {
			return;
		}
		self::set( $participant_id );
	}

	/**
	 * Clear the session cookie.
	 *
	 * @return void
	 */
	public static function clear(): void {
		if ( headers_sent() ) {
			unset( $_COOKIE[ self::COOKIE_NAME ] );
			return;
		}
		self::send_cookie( '', time() - HOUR_IN_SECONDS );
		unset( $_COOKIE[ self::COOKIE_NAME ] );
	}

	/**
	 * Build the signed cookie value.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $expires_at     Unix timestamp when the cookie should expire.
	 * @return string Signed cookie payload.
	 */
	private static function build_value( int $participant_id, int $expires_at ): string {
		$data      = $participant_id . '.' . $expires_at;
		$signature = self::sign( $data );
		return $data . '.' . $signature;
	}

	/**
	 * Send the Set-Cookie header.
	 *
	 * @param string $value      Cookie value (empty string clears).
	 * @param int    $expires_at Unix timestamp.
	 * @return void
	 */
	private static function send_cookie( string $value, int $expires_at ): void {
		setcookie(
			self::COOKIE_NAME,
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

	/**
	 * Sign data with HMAC-SHA256 using a service-specific salt.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		$secret = 'fair_audience_session_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
