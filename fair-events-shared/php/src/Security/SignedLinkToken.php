<?php
/**
 * HMAC-signed tokens for links sent to people.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Encodes and verifies the signed envelope used by link features such as
 * participant links, subscription management and signup editing.
 *
 * A token is URL-safe base64 (`+/` as `-_`, no `=` padding) of the payload
 * fields and a signature, all joined with `:`. The signature is the
 * hexadecimal HMAC-SHA256 of the joined fields, keyed with the feature's
 * signing context followed by `wp_salt( 'auth' )`. Distinct contexts keep
 * each feature's tokens valid for that feature only.
 *
 * This class checks the envelope and the signature only. What the fields
 * mean, and which values are acceptable, stays with each feature.
 */
final class SignedLinkToken {

	/**
	 * Separator between payload fields and the signature.
	 */
	const SEPARATOR = ':';

	/**
	 * Encode payload fields into a signed, URL-safe token.
	 *
	 * @param string            $context Signing context naming the feature, e.g. `fair_audience_participant_`.
	 * @param array<int|string> $fields  Payload fields, in order. None may be empty or contain `:`.
	 * @return string URL-safe token.
	 * @throws \InvalidArgumentException When the context is empty or a field cannot be encoded.
	 */
	public static function encode( string $context, array $fields ): string {
		$fields = self::normalize_fields( $fields );
		$data   = implode( self::SEPARATOR, $fields );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- URL-safe text encoding of a signed link, not obfuscation.
		$token = base64_encode( $data . self::SEPARATOR . self::sign( $context, $data ) );

		return rtrim( strtr( $token, '+/', '-_' ), '=' );
	}

	/**
	 * Verify a token and return its payload fields.
	 *
	 * @param string $context     Signing context the token must have been signed with.
	 * @param string $token       URL-safe token.
	 * @param int    $field_count Number of payload fields the feature expects.
	 * @return string[]|null Payload fields, in order, or null when the token is
	 *     malformed, has a different number of fields, or its signature does
	 *     not match this context.
	 * @throws \InvalidArgumentException When the context is empty.
	 */
	public static function decode( string $context, string $token, int $field_count ) {
		if ( $field_count < 1 || '' === $token || ! preg_match( '/^[A-Za-z0-9_-]+\z/', $token ) ) {
			return null;
		}

		$base64  = strtr( $token, '-_', '+/' );
		$base64 .= str_repeat( '=', ( 4 - strlen( $base64 ) % 4 ) % 4 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- decoding our own signed link envelope.
		$decoded = base64_decode( $base64, true );
		if ( false === $decoded ) {
			return null;
		}

		$parts = explode( self::SEPARATOR, $decoded );
		if ( count( $parts ) !== $field_count + 1 ) {
			return null;
		}

		$signature = array_pop( $parts );
		$expected  = self::sign( $context, implode( self::SEPARATOR, $parts ) );
		if ( ! hash_equals( $expected, $signature ) ) {
			return null;
		}

		return $parts;
	}

	/**
	 * Parse a decimal ID field.
	 *
	 * Accepts only the canonical form PHP writes for an integer (digits, no
	 * sign, no leading zeros) within the integer range, so a field is never
	 * silently truncated by an integer cast.
	 *
	 * @param string $value Field value.
	 * @param int    $min   Smallest accepted ID: 1 for record IDs, 0 where `0` is a sentinel.
	 * @return int|null The ID, or null when the field is not an acceptable ID.
	 */
	public static function parse_id( string $value, int $min = 1 ) {
		if ( ! preg_match( '/^(0|[1-9][0-9]*)\z/', $value ) ) {
			return null;
		}

		$id = filter_var( $value, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => $min ) ) );

		return false === $id ? null : $id;
	}

	/**
	 * Hexadecimal HMAC-SHA256 of the payload data.
	 *
	 * @param string $context Signing context.
	 * @param string $data    Joined payload fields.
	 * @return string
	 * @throws \InvalidArgumentException When the context is empty.
	 */
	private static function sign( string $context, string $data ): string {
		if ( '' === $context ) {
			throw new \InvalidArgumentException( 'A signing context is required.' );
		}

		return hash_hmac( 'sha256', $data, $context . wp_salt( 'auth' ) );
	}

	/**
	 * Convert payload fields to strings and reject ones the envelope cannot hold.
	 *
	 * @param array<int|string> $fields Payload fields.
	 * @return string[]
	 * @throws \InvalidArgumentException When there are no fields, or one is empty or contains the separator.
	 */
	private static function normalize_fields( array $fields ): array {
		if ( array() === $fields ) {
			throw new \InvalidArgumentException( 'A signed link needs at least one payload field.' );
		}

		$normalized = array();
		foreach ( $fields as $field ) {
			$field = (string) $field;
			if ( '' === $field || false !== strpos( $field, self::SEPARATOR ) ) {
				throw new \InvalidArgumentException( 'Signed link payload fields must be non-empty and must not contain ":".' );
			}
			$normalized[] = $field;
		}

		return $normalized;
	}
}
