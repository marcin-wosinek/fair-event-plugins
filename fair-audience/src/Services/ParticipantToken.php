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

use FairEventsShared\Security\SignedLinkToken;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying participant tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the participant ID and event date ID without needing a database table.
 */
class ParticipantToken {

	/**
	 * Signing context; keeps these tokens valid for this feature only.
	 */
	private const CONTEXT = 'fair_audience_participant_';

	/**
	 * Generate a token for a participant and event date.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $event_date_id  Event date ID (0 if not linked to an event date).
	 * @return string URL-safe token.
	 */
	public static function generate( int $participant_id, int $event_date_id = 0 ): string {
		return SignedLinkToken::encode( self::CONTEXT, array( $participant_id, $event_date_id ) );
	}

	/**
	 * Verify a token and extract the participant ID and event date ID.
	 *
	 * @param string $token URL-safe token.
	 * @return array{participant_id: int, event_date_id: int}|false Parsed data if valid, false otherwise.
	 */
	public static function verify( string $token ) {
		$fields = SignedLinkToken::decode( self::CONTEXT, $token, 2 );
		if ( null === $fields ) {
			return false;
		}

		// Event date ID 0 means the token is not linked to an event date.
		$participant_id = SignedLinkToken::parse_id( $fields[0] );
		$event_date_id  = SignedLinkToken::parse_id( $fields[1], 0 );
		if ( null === $participant_id || null === $event_date_id ) {
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
}
