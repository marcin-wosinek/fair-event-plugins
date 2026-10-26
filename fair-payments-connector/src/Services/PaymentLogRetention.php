<?php
/**
 * Payment log retention policy
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

defined( 'WPINC' ) || die;

/**
 * How long payment log rows are kept.
 *
 * The window applies to every level and to rows written before the policy
 * existed. Sites change it with the `fair_payment_log_retention_days` filter:
 *
 *     add_filter( 'fair_payment_log_retention_days', fn() => 30 );
 *
 * Pruning runs through WP-Cron, so it happens on the first request after the
 * daily event is due. Sites that need it on time should trigger WordPress
 * cron from a system scheduler.
 */
class PaymentLogRetention {

	const DEFAULT_DAYS = 90;
	const FILTER       = 'fair_payment_log_retention_days';

	/**
	 * Retention window in days.
	 *
	 * The filter must return a positive integer (a digit string is accepted);
	 * anything else falls back to the default.
	 *
	 * @return int
	 */
	public static function days() {
		$days = apply_filters( self::FILTER, self::DEFAULT_DAYS );

		if ( is_int( $days ) && $days > 0 ) {
			return $days;
		}
		if ( is_string( $days ) && preg_match( '/^[1-9][0-9]{0,5}$/', $days ) ) {
			return (int) $days;
		}

		return self::DEFAULT_DAYS;
	}
}
