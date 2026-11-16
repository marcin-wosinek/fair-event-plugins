<?php
/**
 * Audience Signup Token Service
 *
 * Generates and verifies HMAC-signed tokens for audience signup answer editing.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairEventsShared\Security\SignedLinkToken;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying audience signup tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the submission ID without needing a database table.
 */
class AudienceSignupToken {

	/**
	 * Signing context; keeps these tokens valid for this feature only.
	 */
	private const CONTEXT = 'fair_audience_audience_signup_';

	/**
	 * Generate a token for a submission.
	 *
	 * @param int $submission_id Submission ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $submission_id ): string {
		return SignedLinkToken::encode( self::CONTEXT, array( $submission_id ) );
	}

	/**
	 * Verify a token and extract the submission ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Submission ID if valid, false otherwise.
	 */
	public static function verify( string $token ) {
		$fields = SignedLinkToken::decode( self::CONTEXT, $token, 1 );
		$id     = null === $fields ? null : SignedLinkToken::parse_id( $fields[0] );

		return null === $id ? false : $id;
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
}
