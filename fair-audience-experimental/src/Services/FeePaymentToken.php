<?php
/**
 * Fee Payment Token Service
 *
 * Generates and verifies HMAC-signed tokens for fee payment pages.
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Services;

use FairEventsShared\Security\SignedLinkToken;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying fee payment tokens.
 *
 * Uses HMAC-SHA256 signing to create secure, verifiable tokens that encode
 * the fee payment ID without needing a database table.
 */
class FeePaymentToken {

	/**
	 * Signing context; keeps these tokens valid for this feature only.
	 */
	private const CONTEXT = 'fair_audience_fee_payment_';

	/**
	 * Generate a fee payment token.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return string URL-safe token.
	 */
	public static function generate( int $fee_payment_id ): string {
		return SignedLinkToken::encode( self::CONTEXT, array( $fee_payment_id ) );
	}

	/**
	 * Verify a fee payment token and extract the fee payment ID.
	 *
	 * @param string $token URL-safe token.
	 * @return int|false Fee payment ID if valid, false otherwise.
	 */
	public static function verify( string $token ) {
		$fields = SignedLinkToken::decode( self::CONTEXT, $token, 1 );
		$id     = null === $fields ? null : SignedLinkToken::parse_id( $fields[0] );

		return null === $id ? false : $id;
	}

	/**
	 * Generate a URL for fee payment.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return string Full URL with token.
	 */
	public static function get_url( int $fee_payment_id ): string {
		$token = self::generate( $fee_payment_id );
		return add_query_arg( 'fee_payment', $token, home_url( '/' ) );
	}
}
