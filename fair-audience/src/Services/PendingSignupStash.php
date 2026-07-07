<?php
/**
 * Pending Signup Stash Service
 *
 * Temporarily holds a validated event-signup submission (questionnaire
 * answers, chosen ticket/options, sliding-scale amount) so a returning
 * visitor who typed a known email — but has no session for that participant
 * — can resume exactly where they left off from an emailed link, instead of
 * re-filling the whole form.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Stashes and retrieves pending signup payloads in transients, keyed by the
 * hash of a random token so the raw token (the one that goes in the emailed
 * URL) is never stored server-side.
 */
class PendingSignupStash {

	/**
	 * How long a stashed submission stays valid.
	 */
	const TTL = DAY_IN_SECONDS;

	/**
	 * Stash a validated submission and return the token to email.
	 *
	 * @param array $payload Validated/sanitized submission data.
	 * @return string Random resume token (not stored server-side, only its hash).
	 */
	public static function stash( array $payload ): string {
		$token = wp_generate_password( 32, false );
		set_transient( self::transient_key( $token ), $payload, self::TTL );
		return $token;
	}

	/**
	 * Retrieve and delete a stashed payload (single-use).
	 *
	 * Only returns the payload when it was stashed for the given participant
	 * — a guessed/stolen resume token for someone else's participant never
	 * surfaces another visitor's answers.
	 *
	 * @param string $token          Resume token from the URL.
	 * @param int    $participant_id Participant ID the caller was authenticated as.
	 * @return array|null Stashed payload, or null if missing/expired/mismatched.
	 */
	public static function consume( string $token, int $participant_id ) {
		if ( empty( $token ) ) {
			return null;
		}

		$key     = self::transient_key( $token );
		$payload = get_transient( $key );

		if ( ! is_array( $payload ) || (int) ( $payload['participant_id'] ?? 0 ) !== $participant_id ) {
			return null;
		}

		delete_transient( $key );

		return $payload;
	}

	/**
	 * Build the transient key for a resume token.
	 *
	 * @param string $token Resume token.
	 * @return string Transient key.
	 */
	private static function transient_key( string $token ): string {
		return 'fair_audience_pending_signup_' . sha1( $token );
	}
}
