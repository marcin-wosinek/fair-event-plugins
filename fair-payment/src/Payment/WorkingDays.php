<?php
/**
 * Working-day arithmetic helper
 *
 * @package FairPayment
 */

namespace FairPayment\Payment;

defined( 'WPINC' ) || die;

/**
 * Helper for counting working days (Mon–Fri) between two points in time.
 *
 * Holidays are intentionally not considered (see issue #551, "out of scope" v1).
 */
class WorkingDays {
	/**
	 * Count full working days from $from up to (but not including) $to.
	 *
	 * Each calendar day from $from (inclusive) to $to (exclusive) is checked;
	 * Mon–Fri count as 1, Sat/Sun as 0. If $to is before $from, returns 0.
	 *
	 * @param \DateTimeInterface $from Lower bound (typically "now").
	 * @param \DateTimeInterface $to   Upper bound (typically the key date).
	 * @return int Non-negative count of working days remaining.
	 */
	public static function between( \DateTimeInterface $from, \DateTimeInterface $to ) {
		$tz       = $from->getTimezone();
		$cursor   = ( new \DateTimeImmutable( $from->format( 'Y-m-d' ), $tz ) );
		$boundary = ( new \DateTimeImmutable( $to->format( 'Y-m-d' ), $tz ) );

		if ( $cursor >= $boundary ) {
			return 0;
		}

		$count   = 0;
		$one_day = new \DateInterval( 'P1D' );

		while ( $cursor < $boundary ) {
			$dow = (int) $cursor->format( 'N' ); // 1 (Mon) through 7 (Sun).
			if ( $dow >= 1 && $dow <= 5 ) {
				++$count;
			}
			$cursor = $cursor->add( $one_day );
		}

		return $count;
	}
}
