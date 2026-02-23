<?php
/**
 * Fee Payment Token Service
 *
 * Generates and verifies HMAC-signed tokens for fee payment pages.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying fee payment tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the fee payment ID without needing a database table.
 */
class FeePaymentToken {

	/**
	 * Generate a fee payment token.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $fee_payment_id ): string {
		$data      = (string) $fee_payment_id;
		$signature = self::sign( $data );

		// Format: base64(fee_payment_id:signature)
		$token = base64_encode( $data . ':' . $signature );

		// Make URL-safe: replace +/ with -_, and remove = padding.
		// Padding can be reconstructed during decode.
		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a fee payment token and extract the fee payment ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Fee payment ID if valid, false otherwise.
	 */
	public static function verify( string $token ) {
		// Restore URL-safe base64: replace -_ with +/, and restore = padding.
		$base64 = strtr( $token, '-_', '+/' );
		// Add padding: base64 length must be multiple of 4.
		$padding = ( 4 - strlen( $base64 ) % 4 ) % 4;
		$base64 .= str_repeat( '=', $padding );

		$decoded = base64_decode( $base64, true );

		if ( false === $decoded ) {
			return false;
		}

		// Split into data and signature.
		$parts = explode( ':', $decoded, 2 );

		if ( 2 !== count( $parts ) ) {
			return false;
		}

		list( $data, $signature ) = $parts;

		// Verify signature using timing-safe comparison.
		$expected_signature = self::sign( $data );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return false;
		}

		// Validate fee payment ID.
		$fee_payment_id = (int) $data;

		if ( $fee_payment_id <= 0 ) {
			return false;
		}

		return $fee_payment_id;
	}

	/**
	 * Generate a URL for fee payment.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return string Full URL with token.
	 */
	public static function get_url( int $fee_payment_id ): string {
		$token = self::generate( $fee_payment_id );
		return add_query_arg( 'fee_payment', $token, home_url( '/' ) );
	}

	/**
	 * Sign data with HMAC-SHA256.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		// Use WordPress AUTH_KEY as the secret, with a plugin-specific prefix.
		$secret = 'fair_audience_fee_payment_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
