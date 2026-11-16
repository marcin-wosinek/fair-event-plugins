<?php
/**
 * Manage Subscription Token Service
 *
 * Generates and verifies HMAC-signed tokens for subscription management.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairEventsShared\Security\SignedLinkToken;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying subscription management tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the participant ID without needing a database table.
 */
class ManageSubscriptionToken {

	/**
	 * Signing context; keeps these tokens valid for this feature only.
	 */
	private const CONTEXT = 'fair_audience_subscription_';

	/**
	 * Generate a manage subscription token for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $participant_id ): string {
		return SignedLinkToken::encode( self::CONTEXT, array( $participant_id ) );
	}

	/**
	 * Verify a manage subscription token and extract the participant ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Participant ID if valid, false otherwise.
	 */
	public static function verify( string $token ) {
		$fields = SignedLinkToken::decode( self::CONTEXT, $token, 1 );
		$id     = null === $fields ? null : SignedLinkToken::parse_id( $fields[0] );

		return null === $id ? false : $id;
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
}
