<?php
/**
 * Canonical monetary totals for a list of line items.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared;

/**
 * The one rounding policy for every amount derived from line items: what a
 * signup stores, what a transaction charges and what the finance ledger
 * records.
 *
 * Amounts have two decimal places and are rounded half up — a value exactly
 * halfway between two cents moves away from zero (0.005 becomes 0.01, -0.005
 * becomes -0.01), which is PHP's PHP_ROUND_HALF_UP. Rounding happens at
 * three steps, in this order:
 *
 * 1. the unit amount,
 * 2. the extended line total (quantity × rounded unit amount),
 * 3. the aggregate (sum of the rounded line totals).
 *
 * Rounding only the aggregate would let a transaction disagree with its own
 * ledger rows, which are stored with two decimals each.
 *
 * Quantities are integers; a line without a quantity counts once. Negative
 * amounts are kept, so a discount is an ordinary line.
 */
class LineItemTotals {

	/**
	 * Decimal places of every supported currency.
	 *
	 * @var int
	 */
	const DECIMALS = 2;

	/**
	 * Round one monetary amount to two decimals, half up.
	 *
	 * @param float|int|string $amount Amount to normalize.
	 * @return float Normalized amount.
	 */
	public static function normalize_amount( $amount ) {
		// Adding 0.0 turns a negative zero (e.g. from -0.004) into plain zero.
		return round( (float) $amount, self::DECIMALS, PHP_ROUND_HALF_UP ) + 0.0;
	}

	/**
	 * Extended total of one line: the quantity times the normalized unit
	 * amount, normalized again.
	 *
	 * @param int              $quantity    Number of units.
	 * @param float|int|string $unit_amount Amount of one unit.
	 * @return float Normalized line total.
	 */
	public static function line_total( $quantity, $unit_amount ) {
		return self::normalize_amount( (int) $quantity * self::normalize_amount( $unit_amount ) );
	}

	/**
	 * Aggregate total of a list of line items: the sum of their normalized
	 * line totals, normalized.
	 *
	 * @param array[] $line_items Line items, each with 'amount' (one unit) and an optional 'quantity' (default 1).
	 * @return float Normalized total.
	 */
	public static function total( array $line_items ) {
		$total = 0.0;

		foreach ( $line_items as $item ) {
			$total += self::line_total(
				isset( $item['quantity'] ) ? $item['quantity'] : 1,
				isset( $item['amount'] ) ? $item['amount'] : 0
			);
		}

		return self::normalize_amount( $total );
	}

	/**
	 * Whether two amounts are the same once normalized. Compares whole cents,
	 * never raw floats.
	 *
	 * @param float|int|string $first  One amount.
	 * @param float|int|string $second The other amount.
	 * @return bool
	 */
	public static function amounts_match( $first, $second ) {
		return self::to_minor_units( $first ) === self::to_minor_units( $second );
	}

	/**
	 * A normalized amount as a whole number of cents.
	 *
	 * @param float|int|string $amount Amount to convert.
	 * @return int
	 */
	private static function to_minor_units( $amount ) {
		return (int) round( self::normalize_amount( $amount ) * 100 );
	}
}
