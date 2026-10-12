<?php
/**
 * Mollie settlement report lines and their summary
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Pure rules for the per-period report Mollie attaches to a settlement.
 *
 * A report line is a revenue or cost total for one period and payment
 * method. Its amounts are kept exactly as Mollie supplied them, with their
 * sign and scale, in an allowlisted structure: nothing else from the
 * provider response is stored.
 *
 * Every amount carries a state, so a value Mollie did not send (`missing`)
 * is never confused with one that could not be read (`invalid`) or with
 * zero.
 */
class Report {

	/**
	 * Version of the stored report structure. A revision without one was
	 * saved before report details were kept.
	 */
	const VERSION = 1;

	const GROUP_REVENUE = 'revenue';
	const GROUP_COSTS   = 'costs';

	const STATE_PROVIDED = 'provided';
	const STATE_MISSING  = 'missing';
	const STATE_INVALID  = 'invalid';

	/**
	 * Method Mollie gives the report lines that total refunds.
	 */
	const METHOD_REFUND = 'refund';

	/**
	 * Amount fields of a report line.
	 */
	const AMOUNTS = array( 'amount_net', 'amount_vat', 'amount_gross' );

	/**
	 * Read one report line into the stored structure.
	 *
	 * @param mixed  $year   Period year, as keyed by Mollie.
	 * @param mixed  $month  Period month, as keyed by Mollie.
	 * @param string $group GROUP_REVENUE or GROUP_COSTS.
	 * @param array  $line  Report line with Mollie's field names.
	 * @param array  $period The period the line belongs to.
	 * @return array
	 */
	public static function line( $year, $month, $group, array $line, array $period = array() ) {
		$rate  = (array) ( $line['rate'] ?? array() );
		$count = $line['count'] ?? null;

		return array(
			'year'              => 1 === preg_match( '/^\d{4}$/', (string) $year ) ? (string) $year : null,
			'month'             => 1 === preg_match( '/^(0?[1-9]|1[0-2])$/', (string) $month ) ? str_pad( (string) $month, 2, '0', STR_PAD_LEFT ) : null,
			'group'             => self::GROUP_COSTS === $group ? self::GROUP_COSTS : self::GROUP_REVENUE,
			'method'            => self::text( $line['method'] ?? null, 40 ),
			'count'             => is_int( $count ) && $count >= 0 ? $count : null,
			'rate_fixed'        => self::money( $rate['fixed'] ?? null ),
			// Mollie has named this field both `percentage` and `variable`.
			'rate_percentage'   => self::rate( $rate['percentage'] ?? ( $rate['variable'] ?? null ) ),
			'amount_net'        => self::money( $line['amountNet'] ?? null ),
			'amount_vat'        => self::money( $line['amountVat'] ?? null ),
			'amount_gross'      => self::money( $line['amountGross'] ?? null ),
			'invoice_id'        => self::text( $period['invoiceId'] ?? null, 64 ),
			'invoice_reference' => self::text( $period['invoiceReference'] ?? null, 64 ),
		);
	}

	/**
	 * Rebuild a stored report line, keeping only what the structure allows.
	 *
	 * @param mixed $stored Decoded stored value.
	 * @return array|null Report line, or null when there is none.
	 */
	public static function from_stored( $stored ) {
		if ( ! is_array( $stored ) || empty( $stored ) ) {
			return null;
		}

		$stored_money = static function ( $money ) {
			$money = (array) $money;
			$state = $money['state'] ?? self::STATE_MISSING;
			$value = self::STATE_PROVIDED === $state ? ReportDecimal::parse( $money['value'] ?? null ) : null;

			if ( self::STATE_PROVIDED === $state && null === $value ) {
				$state = self::STATE_INVALID;
			}

			return array(
				'value'    => $value,
				'currency' => null !== $value && Decimal::is_currency( $money['currency'] ?? null ) ? $money['currency'] : null,
				'state'    => in_array( $state, array( self::STATE_PROVIDED, self::STATE_MISSING, self::STATE_INVALID ), true ) ? $state : self::STATE_MISSING,
			);
		};

		$line = self::line( $stored['year'] ?? null, $stored['month'] ?? null, $stored['group'] ?? null, array() );

		$line['method']            = self::text( $stored['method'] ?? null, 40 );
		$line['count']             = isset( $stored['count'] ) && is_int( $stored['count'] ) && $stored['count'] >= 0 ? $stored['count'] : null;
		$line['rate_fixed']        = $stored_money( $stored['rate_fixed'] ?? null );
		$line['rate_percentage']   = $stored_money( $stored['rate_percentage'] ?? null );
		$line['invoice_id']        = self::text( $stored['invoice_id'] ?? null, 64 );
		$line['invoice_reference'] = self::text( $stored['invoice_reference'] ?? null, 64 );
		foreach ( self::AMOUNTS as $field ) {
			$line[ $field ] = $stored_money( $stored[ $field ] ?? null );
		}
		unset( $line['rate_percentage']['currency'] );

		return $line;
	}

	/**
	 * What a report line adds to the payout, with its sign.
	 *
	 * Mollie's own signs are kept in the stored amounts; here revenue adds
	 * and costs subtract, so a negative cost adjustment increases the payout.
	 * The gross amount is what moves money; the net amount stands in only
	 * when Mollie sent no gross amount at all.
	 *
	 * @param array $line Report line.
	 * @return array{value: string|null, currency: string|null, state: string}
	 */
	public static function contribution( array $line ) {
		$amount = self::STATE_MISSING === $line['amount_gross']['state'] ? $line['amount_net'] : $line['amount_gross'];

		if ( self::STATE_PROVIDED === $amount['state'] && self::GROUP_COSTS === $line['group'] ) {
			$amount['value'] = ReportDecimal::negate( $amount['value'] );
		}

		return $amount;
	}

	/**
	 * Whether Mollie sent a value in a report line that could not be read.
	 *
	 * @param array $line Report line.
	 * @return bool
	 */
	public static function has_invalid_value( array $line ) {
		foreach ( array_merge( self::AMOUNTS, array( 'rate_fixed', 'rate_percentage' ) ) as $field ) {
			if ( self::STATE_INVALID === $line[ $field ]['state'] ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Everything financially meaningful in a report line, with one spelling
	 * per amount, so `0.7500` and `0.75` identify and hash the same.
	 *
	 * @param array $line Report line.
	 * @return array
	 */
	public static function material( array $line ) {
		$material = array( $line['year'], $line['month'], $line['group'], $line['method'], $line['count'], $line['invoice_id'], $line['invoice_reference'] );

		foreach ( array_merge( self::AMOUNTS, array( 'rate_fixed', 'rate_percentage' ) ) as $field ) {
			$amount     = $line[ $field ];
			$material[] = array(
				$amount['state'],
				null === $amount['value'] ? null : ReportDecimal::canonical( $amount['value'] ),
				$amount['currency'] ?? null,
			);
		}

		return $material;
	}

	/**
	 * Add up a settlement's report and compare it with the payout.
	 *
	 * Amounts are summed at the precision Mollie supplied, rounding lines
	 * included; nothing is rounded and no balancing amount is made up. A
	 * group holding a line that cannot be counted has no total, and then
	 * neither has the report: an incomplete sum is never shown as the whole.
	 *
	 * The comparison is between the report and the payout only. It says
	 * nothing about whether every movement of the settlement was listed.
	 *
	 * @param string|null $payout   Payout amount.
	 * @param string|null $currency Payout currency.
	 * @param array[]     $items    Movements of the revision.
	 * @return array|null Summary, or null when the revision has no report lines.
	 */
	public static function summarize( $payout, $currency, array $items ) {
		$groups = array(
			'revenue' => array(),
			'refunds' => array(),
			'costs'   => array(),
		);
		$lines  = 0;

		foreach ( $items as $item ) {
			if ( empty( $item['report'] ) ) {
				continue;
			}

			++$lines;
			$line = $item['report'];
			if ( self::GROUP_COSTS === $line['group'] ) {
				$group = 'costs';
			} else {
				// Only Mollie's own method marks a refund line; a description never does.
				$group = self::METHOD_REFUND === $line['method'] ? 'refunds' : 'revenue';
			}
			$groups[ $group ][] = self::contribution( $line );
		}

		if ( 0 === $lines ) {
			return null;
		}

		if ( null === $currency ) {
			$currencies = array();
			foreach ( $groups as $amounts ) {
				foreach ( $amounts as $amount ) {
					if ( null !== $amount['currency'] ) {
						$currencies[ $amount['currency'] ] = true;
					}
				}
			}
			$currency = 1 === count( $currencies ) ? (string) array_key_first( $currencies ) : null;
		}

		$summary = array(
			'currency'       => $currency,
			'lines'          => $lines,
			'missing'        => 0,
			'invalid'        => 0,
			'other_currency' => 0,
		);
		$totals  = array();

		foreach ( $groups as $group => $amounts ) {
			$values   = array();
			$complete = true;

			foreach ( $amounts as $amount ) {
				if ( self::STATE_PROVIDED !== $amount['state'] ) {
					++$summary[ self::STATE_INVALID === $amount['state'] ? 'invalid' : 'missing' ];
					$complete = false;
				} elseif ( null === $currency || $amount['currency'] !== $currency ) {
					++$summary['other_currency'];
					$complete = false;
				} else {
					$values[] = $amount['value'];
				}
			}

			$summary[ $group ] = array(
				'lines'  => count( $amounts ),
				'amount' => $complete && ! empty( $values ) ? ReportDecimal::sum( $values ) : null,
			);
			if ( null !== $summary[ $group ]['amount'] ) {
				$totals[] = $summary[ $group ]['amount'];
			}
		}

		$complete              = 0 === $summary['missing'] + $summary['invalid'] + $summary['other_currency'];
		$summary['complete']   = $complete;
		$summary['net']        = $complete ? ReportDecimal::sum( $totals ) : null;
		$summary['payout']     = $payout;
		$summary['difference'] = null !== $summary['net'] && null !== $payout ? ReportDecimal::subtract( $summary['net'], $payout ) : null;

		if ( null === $summary['difference'] ) {
			$summary['check'] = 'unavailable';
		} else {
			// Compared exactly: a difference below one cent is still a difference.
			$summary['check'] = ReportDecimal::is_zero( $summary['difference'] ) ? 'verified' : 'mismatch';
		}

		return $summary;
	}

	/**
	 * Read a Mollie `{ value, currency }` object, keeping its precision.
	 *
	 * @param mixed $amount Amount object.
	 * @return array{value: string|null, currency: string|null, state: string}
	 */
	private static function money( $amount ) {
		if ( null === $amount ) {
			return array(
				'value'    => null,
				'currency' => null,
				'state'    => self::STATE_MISSING,
			);
		}

		$amount   = (array) $amount;
		$currency = $amount['currency'] ?? null;
		$value    = Decimal::is_currency( $currency ) ? ReportDecimal::parse( $amount['value'] ?? null ) : null;

		return array(
			'value'    => $value,
			'currency' => null === $value ? null : $currency,
			'state'    => null === $value ? self::STATE_INVALID : self::STATE_PROVIDED,
		);
	}

	/**
	 * Read a percentage rate, keeping its precision.
	 *
	 * @param mixed $rate Raw rate.
	 * @return array{value: string|null, state: string}
	 */
	private static function rate( $rate ) {
		if ( null === $rate ) {
			return array(
				'value' => null,
				'state' => self::STATE_MISSING,
			);
		}

		$value = ReportDecimal::parse( $rate );

		return array(
			'value' => $value,
			'state' => null === $value ? self::STATE_INVALID : self::STATE_PROVIDED,
		);
	}

	/**
	 * Read an optional short text value.
	 *
	 * @param mixed $value  Raw value.
	 * @param int   $length Maximum length.
	 * @return string|null
	 */
	private static function text( $value, $length ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return null;
		}

		return substr( sanitize_text_field( $value ), 0, $length );
	}
}
