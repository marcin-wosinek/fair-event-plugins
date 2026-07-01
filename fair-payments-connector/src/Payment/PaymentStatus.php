<?php
/**
 * Canonical payment lifecycle status mapper
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

defined( 'WPINC' ) || die;

/**
 * Maps a raw Mollie transaction status to the canonical lifecycle state
 * consumed by both server-rendered blocks and the shared frontend poller.
 */
final class PaymentStatus {

	/**
	 * Payment confirmed and paid.
	 */
	const CONFIRMED = 'confirmed';

	/**
	 * Payment failed, canceled, or expired.
	 */
	const FAILED = 'failed';

	/**
	 * Payment still awaiting a final outcome.
	 */
	const PROCESSING = 'processing';

	/**
	 * Map a raw transaction status to the canonical lifecycle status.
	 *
	 * @param string $raw_status Raw transaction status (e.g. 'paid', 'failed', 'pending_payment').
	 * @return string One of self::CONFIRMED, self::FAILED, self::PROCESSING.
	 */
	public static function from_raw_status( string $raw_status ): string {
		if ( 'paid' === $raw_status ) {
			return self::CONFIRMED;
		}

		if ( in_array( $raw_status, array( 'failed', 'canceled', 'expired' ), true ) ) {
			return self::FAILED;
		}

		return self::PROCESSING;
	}
}
