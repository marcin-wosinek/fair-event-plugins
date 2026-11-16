<?php
/**
 * Pre-#2336 signed-link token builder, kept independent of the shared code.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Fixtures;

/**
 * Builds tokens the way the link features did before they shared an envelope:
 * URL-safe base64 of `data:hex-hmac`, keyed with the context and auth salt.
 */
final class LegacySignedLink {

	/**
	 * A legacy token.
	 *
	 * @param string $context Signing context.
	 * @param string $data    Joined payload fields.
	 * @param string $salt    Auth salt.
	 * @return string
	 */
	public static function token( string $context, string $data, string $salt = 'test-salt' ): string {
		return self::url_safe( $data . ':' . hash_hmac( 'sha256', $data, $context . $salt ) );
	}

	/**
	 * URL-safe, unpadded base64 of an arbitrary envelope.
	 *
	 * @param string $raw Decoded envelope.
	 * @return string
	 */
	public static function url_safe( string $raw ): string {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- builds legacy token fixtures.
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}
}
