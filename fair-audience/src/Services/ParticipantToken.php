<?php
/**
 * Participant Token Service
 *
 * Generates and verifies HMAC-signed tokens for participant identification.
 * Used across multiple blocks to identify a participant for a given event date.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying participant tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the participant ID and event date ID without needing a database table.
 */
class ParticipantToken {

	/**
	 * Generate a token for a participant and event date.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $event_date_id  Event date ID (0 if not linked to an event date).
	 * @return string URL-safe token.
	 */
	public static function generate( int $participant_id, int $event_date_id = 0 ): string {
		$data      = $participant_id . ':' . $event_date_id;
		$signature = self::sign( $data );

		// Format: base64(participant_id:event_date_id:signature)
		$token = base64_encode( $data . ':' . $signature );

		// Make URL-safe: replace +/ with -_, and remove = padding.
		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a token and extract the participant ID and event date ID.
	 *
	 * @param string $token URL-safe token.
	 * @return array{participant_id: int, event_date_id: int}|false Parsed data if valid, false otherwise.
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

		// Split into participant_id, event_date_id, and signature.
		$parts = explode( ':', $decoded, 3 );

		if ( 3 !== count( $parts ) ) {
			return false;
		}

		list( $participant_id_str, $event_date_id_str, $signature ) = $parts;

		// Verify signature using timing-safe comparison.
		$data               = $participant_id_str . ':' . $event_date_id_str;
		$expected_signature = self::sign( $data );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return false;
		}

		// Validate IDs.
		$participant_id = (int) $participant_id_str;
		$event_date_id  = (int) $event_date_id_str;

		if ( $participant_id <= 0 ) {
			return false;
		}

		return array(
			'participant_id' => $participant_id,
			'event_date_id'  => $event_date_id,
		);
	}

	/**
	 * Generate a URL with participant token.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $event_date_id  Event date ID.
	 * @param int $post_id        Post ID for the permalink base.
	 * @return string Full URL with token.
	 */
	public static function get_url( int $participant_id, int $event_date_id, int $post_id = 0 ): string {
		$token    = self::generate( $participant_id, $event_date_id );
		$base_url = $post_id > 0 ? get_permalink( $post_id ) : home_url( '/' );
		return add_query_arg( 'participant_token', $token, $base_url );
	}

	/**
	 * Sign data with HMAC-SHA256.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		$secret = 'fair_audience_participant_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
