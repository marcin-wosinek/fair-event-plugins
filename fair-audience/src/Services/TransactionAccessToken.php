<?php
/**
 * Transaction Access Token Service
 *
 * Generates and verifies HMAC signatures that bind a fair-payments-connector transaction
 * id to its participant id. The signature is appended to Mollie redirect URLs
 * so the buyer can retry payment from the original link even after the
 * audience session cookie has expired, without exposing other people's
 * transactions to enumeration attacks.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Service for generating and verifying transaction-scoped access signatures.
 */
class TransactionAccessToken {

	/**
	 * Generate a signature binding a transaction to a participant.
	 *
	 * @param int $transaction_id Fair-payment transaction ID.
	 * @param int $participant_id Participant ID linked to the transaction.
	 * @return string Hex-encoded HMAC signature.
	 */
	public static function generate( int $transaction_id, int $participant_id ): string {
		return self::sign( $transaction_id . ':' . $participant_id );
	}

	/**
	 * Verify a signature against a (transaction_id, participant_id) pair.
	 *
	 * @param string $signature      Hex-encoded HMAC signature.
	 * @param int    $transaction_id Fair-payment transaction ID.
	 * @param int    $participant_id Participant ID linked to the transaction.
	 * @return bool True when the signature matches.
	 */
	public static function verify( string $signature, int $transaction_id, int $participant_id ): bool {
		if ( '' === $signature || $transaction_id <= 0 || $participant_id <= 0 ) {
			return false;
		}
		$expected = self::generate( $transaction_id, $participant_id );
		return hash_equals( $expected, $signature );
	}

	/**
	 * Sign data with HMAC-SHA256 using a service-specific salt.
	 *
	 * @param string $data Data to sign.
	 * @return string Hex-encoded signature.
	 */
	private static function sign( string $data ): string {
		$secret = 'fair_audience_tx_access_' . wp_salt( 'auth' );
		return hash_hmac( 'sha256', $data, $secret );
	}
}
