<?php
/**
 * Mailing Signup Weekly Policy
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairEventsShared\Security\SignedLinkToken;

defined( 'WPINC' ) || die;

/**
 * How a Mailing Signup block offers weekly updates, and the signed form
 * configuration that carries the feed part of it to the signup request.
 *
 * The configuration is form policy only: it tells the server which feed a
 * hidden-feed form subscribes to, so that feed is never taken from the
 * submitted IDs. It never authorizes changes to a subscriber.
 */
class MailingSignupWeeklyPolicy {

	const WEEKLY_HIDDEN    = 'hidden';
	const WEEKLY_UNCHECKED = 'unchecked';
	const WEEKLY_CHECKED   = 'checked';

	const FEEDS_HIDDEN      = 'hidden';
	const FEEDS_MULTISELECT = 'multiselect';

	/**
	 * Signing context; keeps these tokens valid for this feature only.
	 */
	private const CONTEXT = 'fair_audience_mailing_signup_';

	/**
	 * The block's weekly-update policy.
	 *
	 * @param array $attributes Block attributes.
	 * @return array|null `weekly` (unchecked|checked), `feeds` (hidden|multiselect)
	 *     and `feed_id`; null when the block does not offer weekly updates.
	 */
	public static function from_attributes( array $attributes ) {
		$weekly = $attributes['weeklyUpdate'] ?? self::WEEKLY_HIDDEN;
		if ( ! in_array( $weekly, array( self::WEEKLY_UNCHECKED, self::WEEKLY_CHECKED ), true ) ) {
			return null;
		}

		$feeds = self::FEEDS_HIDDEN === ( $attributes['feedSelection'] ?? '' ) ? self::FEEDS_HIDDEN : self::FEEDS_MULTISELECT;

		return array(
			'weekly'  => $weekly,
			'feeds'   => $feeds,
			'feed_id' => self::FEEDS_HIDDEN === $feeds ? max( 0, (int) ( $attributes['feedId'] ?? 0 ) ) : 0,
		);
	}

	/**
	 * Sign the feed part of a policy for the signup request.
	 *
	 * @param array $policy Policy from {@see self::from_attributes()}.
	 * @return string URL-safe token.
	 */
	public static function sign( array $policy ): string {
		return SignedLinkToken::encode( self::CONTEXT, array( $policy['feeds'], (int) $policy['feed_id'] ) );
	}

	/**
	 * Verify a signed form configuration.
	 *
	 * @param string $token URL-safe token.
	 * @return array|null `feeds` and `feed_id`, or null when the token is not valid.
	 */
	public static function verify( string $token ) {
		$fields = SignedLinkToken::decode( self::CONTEXT, $token, 2 );
		if ( null === $fields ) {
			return null;
		}

		list( $feeds, $feed_id ) = $fields;
		$feed_id                 = SignedLinkToken::parse_id( $feed_id, 0 );
		if ( null === $feed_id || ! in_array( $feeds, array( self::FEEDS_HIDDEN, self::FEEDS_MULTISELECT ), true ) ) {
			return null;
		}

		return array(
			'feeds'   => $feeds,
			'feed_id' => $feed_id,
		);
	}
}
