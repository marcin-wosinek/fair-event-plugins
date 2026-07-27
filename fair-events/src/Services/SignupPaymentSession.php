<?php
/**
 * Signup Payment Session Service
 *
 * Manages a short-lived, HMAC-signed cookie that lets a visitor who navigates
 * directly back to the event page (no provider redirect) be recognised as the
 * owner of an in-progress get-tickets payment. The base form is anonymous —
 * there is no participant/user identity to key the lookup on — so the cookie
 * binds a (signup_id, transaction_id) pair instead, mirroring the pattern
 * fair-audience's TransactionAccessToken/AudienceSession use for the same
 * purpose.
 *
 * Cookie format: "{signup_id}.{transaction_id}.{expires_at}.{signature}"
 *
 * The expiry is part of the signed payload so a client cannot extend the
 * lifetime by editing the cookie. Overridable by fair-audience at the #1245
 * cutover, which has its own participant-based session.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Service for setting / reading / clearing the get-tickets payment session cookie.
 */
class SignupPaymentSession {

	/**
	 * Cookie name.
	 */
	const COOKIE_NAME = 'fair_events_signup_payment';

	/**
	 * Default cookie lifetime in seconds — matches the signup hold window
	 * (EventSignup::update_transaction()'s 15-minute payment_expires_at).
	 */
	const DEFAULT_LIFETIME = 15 * MINUTE_IN_SECONDS;

	/**
	 * Set the session cookie binding a signup row to its transaction.
	 *
	 * @param int $signup_id      Signup row ID.
	 * @param int $transaction_id Transaction ID.
	 * @param int $lifetime       Cookie lifetime in seconds.
	 * @return void
	 */
	public static function set( int $signup_id, int $transaction_id, int $lifetime = self::DEFAULT_LIFETIME ): void {
		if ( $signup_id <= 0 || $transaction_id <= 0 ) {
			return;
		}
		if ( headers_sent() ) {
			return;
		}

		$expires_at = time() + $lifetime;
		$value      = self::build_value( $signup_id, $transaction_id, $expires_at );

		self::send_cookie( $value, $expires_at );
		$_COOKIE[ self::COOKIE_NAME ] = $value;
	}

	/**
	 * Get the (signup_id, transaction_id) pair from a valid session cookie.
	 *
	 * Returns null when the cookie is missing, malformed, tampered, or expired.
	 *
	 * @return array{signup_id: int, transaction_id: int}|null
	 */
	public static function get(): ?array {
		if ( empty( $_COOKIE[ self::COOKIE_NAME ] ) ) {
			return null;
		}

		$raw = wp_unslash( $_COOKIE[ self::COOKIE_NAME ] );
		if ( ! is_string( $raw ) ) {
			return null;
		}

		$parts = explode( '.', $raw, 4 );
		if ( 4 !== count( $parts ) ) {
			return null;
		}

		list( $signup_id_str, $transaction_id_str, $expires_at_str, $signature ) = $parts;

		if ( ! ctype_digit( $signup_id_str ) || ! ctype_digit( $transaction_id_str ) || ! ctype_digit( $expires_at_str ) ) {
			return null;
		}

		$signup_id      = (int) $signup_id_str;
		$transaction_id = (int) $transaction_id_str;
		$expires_at     = (int) $expires_at_str;

		if ( $signup_id <= 0 || $transaction_id <= 0 || $expires_at <= time() ) {
			return null;
		}

		$expected = self::sign( $signup_id . '.' . $transaction_id . '.' . $expires_at );
		if ( ! hash_equals( $expected, $signature ) ) {
			return null;
		}

		return array(
			'signup_id'      => $signup_id,
			'transaction_id' => $transaction_id,
		);
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
	 * @param int $signup_id      Signup row ID.
	 * @param int $transaction_id Transaction ID.
	 * @param int $expires_at     Unix timestamp when the cookie should expire.
	 * @return string Signed cookie payload.
	 */
	private static function build_value( int $signup_id, int $transaction_id, int $expires_at ): string {
		$data      = $signup_id . '.' . $transaction_id . '.' . $expires_at;
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
		$secret = 'fair_events_signup_payment_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
