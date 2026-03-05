<?php
/**
 * Audience Signup Token Service
 *
 * Generates and verifies HMAC-signed tokens for audience signup answer editing.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying audience signup tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the submission ID without needing a database table.
 */
class AudienceSignupToken {

	/**
	 * Generate a token for a submission.
	 *
	 * @param int $submission_id Submission ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $submission_id ): string {
		$data      = (string) $submission_id;
		$signature = self::sign( $data );

		// Format: base64(submission_id:signature)
		$token = base64_encode( $data . ':' . $signature );

		// Make URL-safe: replace +/ with -_, and remove = padding.
		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a token and extract the submission ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Submission ID if valid, false otherwise.
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

		// Validate submission ID.
		$submission_id = (int) $data;

		if ( $submission_id <= 0 ) {
			return false;
		}

		return $submission_id;
	}

	/**
	 * Generate a URL for editing audience signup answers.
	 *
	 * @param int $submission_id Submission ID.
	 * @param int $post_id       Post ID containing the signup block.
	 * @return string Full URL with token.
	 */
	public static function get_url( int $submission_id, int $post_id ): string {
		$token    = self::generate( $submission_id );
		$base_url = $post_id > 0 ? get_permalink( $post_id ) : home_url( '/' );
		return add_query_arg( 'edit_audience_signup', $token, $base_url );
	}

	/**
	 * Sign data with HMAC-SHA256.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		$secret = 'fair_audience_audience_signup_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
