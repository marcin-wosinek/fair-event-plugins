<?php
/**
 * Mailing Signup Weekly Policy
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

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
		$data  = $policy['feeds'] . ':' . (int) $policy['feed_id'];
		$token = base64_encode( $data . ':' . self::signature( $data ) );

		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a signed form configuration.
	 *
	 * @param string $token URL-safe token.
	 * @return array|null `feeds` and `feed_id`, or null when the token is not valid.
	 */
	public static function verify( string $token ) {
		$base64  = strtr( $token, '-_', '+/' );
		$base64 .= str_repeat( '=', ( 4 - strlen( $base64 ) % 4 ) % 4 );
		$decoded = base64_decode( $base64, true );
		if ( false === $decoded ) {
			return null;
		}

		$parts = explode( ':', $decoded );
		if ( 3 !== count( $parts ) ) {
			return null;
		}

		list( $feeds, $feed_id, $signature ) = $parts;
		if ( ! hash_equals( self::signature( $feeds . ':' . $feed_id ), $signature ) ) {
			return null;
		}

		if ( ! in_array( $feeds, array( self::FEEDS_HIDDEN, self::FEEDS_MULTISELECT ), true ) ) {
			return null;
		}

		return array(
			'feeds'   => $feeds,
			'feed_id' => (int) $feed_id,
		);
	}

	/**
	 * HMAC signature of the configuration data.
	 *
	 * @param string $data Data to sign.
	 * @return string
	 */
	private static function signature( string $data ): string {
		return hash_hmac( 'sha256', $data, 'fair_audience_mailing_signup_' . wp_salt( 'auth' ) );
	}
}
