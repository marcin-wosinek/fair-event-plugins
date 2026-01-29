<?php
/**
 * Manage Subscription Token Service
 *
 * Generates and verifies HMAC-signed tokens for subscription management.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying subscription management tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the participant ID without needing a database table.
 */
class ManageSubscriptionToken {

	/**
	 * Generate a manage subscription token for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $participant_id ): string {
		$data      = (string) $participant_id;
		$signature = self::sign( $data );

		// Format: base64(participant_id:signature)
		$token = base64_encode( $data . ':' . $signature );

		// Make URL-safe: replace +/ with -_, and remove = padding.
		// Padding can be reconstructed during decode.
		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a manage subscription token and extract the participant ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Participant ID if valid, false otherwise.
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

		// Validate participant ID.
		$participant_id = (int) $data;

		if ( $participant_id <= 0 ) {
			return false;
		}

		return $participant_id;
	}

	/**
	 * Generate a URL for managing subscription.
	 *
	 * @param int $participant_id Participant ID.
	 * @return string Full URL with token.
	 */
	public static function get_url( int $participant_id ): string {
		$token = self::generate( $participant_id );
		return add_query_arg( 'manage_subscription', $token, home_url( '/' ) );
	}

	/**
	 * Sign data with HMAC-SHA256.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		// Use WordPress AUTH_KEY as the secret, with a plugin-specific prefix.
		$secret = 'fair_audience_subscription_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
