<?php
/**
 * Event finance summary
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * What one event date sold, what it cost and what it earned, for the top of
 * the Finance tab (#2398).
 *
 * - Sales: successful live online payments attributed to the date, plus cash
 *   sales recorded in Fair Finance. A payment linked to purchases counts
 *   only the allocations of this date's purchases (PurchasePaymentHistory,
 *   PAYMENT_HISTORY_MIGRATION.md §5); a paid transaction no purchase is
 *   linked to counts in full when Connector attributes it to the date. Each
 *   transaction counts once.
 * - Costs: Fair Finance expenses (split parents and transfers excluded) plus
 *   the date's share of Mollie and application fees.
 * - Net result: sales minus costs.
 *
 * Fees of a shared payment are split in proportion to each share of the
 * payment's total, to the cent, so the shares' fees add up to the recorded
 * fee exactly. Bank payouts and reconciliation only move a payment's net
 * amount between payout states; they never change the result.
 *
 * Totals cover every payment, never one page of a list. A source that can't
 * be read is null and named in `issues`, never 0; the summary's state is
 * then `incomplete`.
 *
 * Everything is read from saved local records; no provider is contacted.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated placeholder lists.
 */
class EventFinanceSummary {

	const STATE_COMPLETE   = 'complete';
	const STATE_INCOMPLETE = 'incomplete';

	/**
	 * Online payments can't be read: Fair Payments Connector is inactive or
	 * its table is missing.
	 */
	const ISSUE_ONLINE_UNAVAILABLE = 'online_unavailable';

	/**
	 * Some paid money for the date isn't fully allocated to its purchases.
	 */
	const ISSUE_ONLINE_UNALLOCATED = 'online_unallocated';

	/**
	 * A counted payment has no recorded Mollie fee yet.
	 */
	const ISSUE_FEES_MISSING = 'fees_missing';

	/**
	 * A paid payment in another currency than the site's isn't counted.
	 */
	const ISSUE_OTHER_CURRENCY = 'other_currency';

	/**
	 * Fair Finance is inactive: no expenses or cash sales can be read.
	 */
	const ISSUE_FINANCE_INACTIVE = 'finance_inactive';

	/**
	 * Fair Finance is active but its summary could not be read.
	 */
	const ISSUE_FINANCE_UNAVAILABLE = 'finance_unavailable';

	/**
	 * Fair Finance records amounts in a different currency from the site's.
	 */
	const ISSUE_CURRENCY_MISMATCH = 'currency_mismatch';

	/**
	 * Payout states, from least to most confirmed.
	 */
	const PAYOUT_UNKNOWN  = 'unknown';
	const PAYOUT_AWAITING = 'awaiting_payout';
	const PAYOUT_PAID_OUT = 'paid_out';
	const PAYOUT_RECEIVED = 'received_in_bank';

	/**
	 * Fair Finance records every entry in this currency.
	 */
	const FINANCE_CURRENCY = 'EUR';

	/**
	 * Summary of one event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array See calculate().
	 */
	public static function for_event_date( $event_date_id ) {
		$event_date_id = (int) $event_date_id;
		$currency      = \FairEventsShared\Money::site_currency();

		return self::calculate(
			array(
				'currency' => $currency,
				'online'   => self::read_online( $event_date_id, $currency ),
				'finance'  => self::read_finance( $event_date_id ),
			)
		);
	}

	/**
	 * Combine the read sources into the summary. Pure: everything it needs
	 * is passed in, amounts in cents.
	 *
	 * `$input` holds:
	 * - currency: site currency.
	 * - online: null when payments can't be read; else transactions (each:
	 *   transaction_id, total, mollie_fee|null, application_fee|null,
	 *   shares [ { amount, own } ] in link order, payout), unallocated (int)
	 *   and other_currency (bool).
	 * - finance: null when Fair Finance is inactive, false when it failed,
	 *   else FinancialEntry::get_event_cash_summary() in amounts, with
	 *   currency.
	 *
	 * The result holds currency, state, issues[], sales { total, online,
	 * cash }, costs { total, expenses, payment_fees }, net_result and payout.
	 * Amounts that can't be read are null, never 0.
	 *
	 * @param array $input Read sources.
	 * @return array Summary.
	 */
	public static function calculate( array $input ) {
		$currency = strtoupper( (string) ( $input['currency'] ?? 'EUR' ) );
		$issues   = array();

		$online = null;
		$payout = null;
		if ( null === ( $input['online'] ?? null ) ) {
			$issues[] = self::ISSUE_ONLINE_UNAVAILABLE;
		} else {
			list( $online, $payout, $online_issues ) = self::online_totals( $input['online'] );
			$issues                                  = array_merge( $issues, $online_issues );
		}

		$finance  = $input['finance'] ?? null;
		$cash     = null;
		$expenses = null;
		if ( null === $finance ) {
			$issues[] = self::ISSUE_FINANCE_INACTIVE;
		} elseif ( ! is_array( $finance ) ) {
			$issues[] = self::ISSUE_FINANCE_UNAVAILABLE;
		} else {
			if ( strtoupper( (string) ( $finance['currency'] ?? self::FINANCE_CURRENCY ) ) !== $currency ) {
				$issues[] = self::ISSUE_CURRENCY_MISMATCH;
			}
			$cash     = self::cents( $finance['cash_income'] ?? 0 );
			$expenses = array(
				'total'             => self::cents( $finance['total_expenses'] ?? 0 ),
				'event_cash'        => self::cents( $finance['event_cash_expenses'] ?? 0 ),
				'personal'          => self::cents( $finance['personally_paid'] ?? 0 ),
				'personal_by_payer' => array_map(
					static function ( $payer ) {
						return array(
							'payer_name' => (string) ( $payer['payer_name'] ?? '' ),
							'amount'     => self::amount( self::cents( $payer['amount'] ?? 0 ) ),
						);
					},
					array_values( (array) ( $finance['personally_paid_by_payer'] ?? array() ) )
				),
				'bank'              => self::cents( $finance['bank_paid_expenses'] ?? 0 ),
				'unclassified'      => self::cents( $finance['unclassified_expenses'] ?? 0 ),
			);
		}

		$sales_total = self::sum_known( array( $online ? $online['gross'] : null, $cash ) );
		$fees        = $online ? $online['fees'] : null;
		$costs_total = self::sum_known( array( $expenses ? $expenses['total'] : null, $fees ) );
		$net_result  = ( null === $sales_total && null === $costs_total ) ? null : (int) $sales_total - (int) $costs_total;

		$issues = array_values( array_unique( $issues ) );

		return array(
			'currency'   => $currency,
			'state'      => $issues ? self::STATE_INCOMPLETE : self::STATE_COMPLETE,
			'issues'     => $issues,
			'sales'      => array(
				'total'  => self::amount( $sales_total ),
				'online' => $online ? array(
					'gross'            => self::amount( $online['gross'] ),
					'mollie_fees'      => self::amount( $online['mollie_fees'] ),
					'application_fees' => self::amount( $online['application_fees'] ),
					'fees'             => self::amount( $online['fees'] ),
					'net'              => self::amount( $online['gross'] - $online['fees'] ),
					'fees_complete'    => $online['fees_complete'],
					'payment_count'    => $online['payment_count'],
					'unallocated'      => $online['unallocated'],
				) : null,
				'cash'   => self::amount( $cash ),
			),
			'costs'      => array(
				'total'        => self::amount( $costs_total ),
				'expenses'     => $expenses ? array_merge(
					array_map( array( self::class, 'amount' ), array_diff_key( $expenses, array( 'personal_by_payer' => true ) ) ),
					array( 'personal_by_payer' => $expenses['personal_by_payer'] )
				) : null,
				'payment_fees' => self::amount( $fees ),
			),
			'net_result' => self::amount( $net_result ),
			'payout'     => $payout,
		);
	}

	/**
	 * Online totals and payout states of the date's own shares.
	 *
	 * @param array $online See calculate().
	 * @return array{0: array, 1: array, 2: string[]} Totals in cents, payout
	 *         in amounts, issues.
	 */
	private static function online_totals( array $online ) {
		$issues  = array();
		$totals  = array(
			'gross'            => 0,
			'mollie_fees'      => 0,
			'application_fees' => 0,
			'fees'             => 0,
			'fees_complete'    => true,
			'payment_count'    => 0,
			'unallocated'      => (int) ( $online['unallocated'] ?? 0 ),
		);
		$buckets = array(
			self::PAYOUT_AWAITING => 0,
			self::PAYOUT_PAID_OUT => 0,
			self::PAYOUT_RECEIVED => 0,
			self::PAYOUT_UNKNOWN  => 0,
		);
		// Own shares whose net amount isn't known, because the fee isn't.
		$unpriced = 0;

		foreach ( (array) ( $online['transactions'] ?? array() ) as $transaction ) {
			$total  = (int) $transaction['total'];
			$shares = array_values( (array) $transaction['shares'] );
			$own    = 0;
			foreach ( $shares as $share ) {
				if ( ! empty( $share['own'] ) ) {
					$own += (int) $share['amount'];
				}
			}
			if ( $own <= 0 ) {
				continue;
			}

			++$totals['payment_count'];
			$totals['gross'] += $own;

			$mollie_fee      = null === $transaction['mollie_fee'] ? null : (int) $transaction['mollie_fee'];
			$application_fee = (int) ( $transaction['application_fee'] ?? 0 );
			$fee_known       = null !== $mollie_fee;
			$own_fee         = 0;
			if ( $fee_known ) {
				$own_mollie                  = self::own_fee( $mollie_fee, $shares, $total );
				$own_application             = self::own_fee( $application_fee, $shares, $total );
				$totals['mollie_fees']      += $own_mollie;
				$totals['application_fees'] += $own_application;
				$own_fee                     = $own_mollie + $own_application;
				$totals['fees']             += $own_fee;
			} else {
				$totals['fees_complete'] = false;
			}

			$state = (string) ( $transaction['payout'] ?? self::PAYOUT_UNKNOWN );
			if ( ! array_key_exists( $state, $buckets ) ) {
				$state = self::PAYOUT_UNKNOWN;
			}
			if ( $fee_known ) {
				$buckets[ $state ] += $own - $own_fee;
			} else {
				++$unpriced;
			}
		}

		if ( ! $totals['fees_complete'] ) {
			$issues[] = self::ISSUE_FEES_MISSING;
		}
		if ( $totals['unallocated'] > 0 ) {
			$issues[] = self::ISSUE_ONLINE_UNALLOCATED;
		}
		if ( ! empty( $online['other_currency'] ) ) {
			$issues[] = self::ISSUE_OTHER_CURRENCY;
		}

		$payout = array(
			self::PAYOUT_AWAITING => self::amount( $buckets[ self::PAYOUT_AWAITING ] ),
			self::PAYOUT_PAID_OUT => self::amount( $buckets[ self::PAYOUT_PAID_OUT ] ),
			self::PAYOUT_RECEIVED => self::amount( $buckets[ self::PAYOUT_RECEIVED ] ),
			self::PAYOUT_UNKNOWN  => self::amount( $buckets[ self::PAYOUT_UNKNOWN ] ),
			// Payments whose status is unknown and whose net amount isn't
			// known either, so they can't be added to `unknown`.
			'unpriced_count'      => $unpriced,
		);

		return array( $totals, $payout, $issues );
	}

	/**
	 * The date's share of one transaction's fee.
	 *
	 * @param int     $fee    Fee in cents.
	 * @param array[] $shares Shares of the transaction, in link order.
	 * @param int     $total  Transaction total in cents.
	 * @return int Cents.
	 */
	private static function own_fee( $fee, array $shares, $total ) {
		$weights = array_map(
			static function ( $share ) {
				return (int) $share['amount'];
			},
			$shares
		);
		// Money nobody was allocated still carries its part of the fee.
		$weights[] = max( 0, (int) $total - array_sum( $weights ) );

		$allocated = self::allocate( (int) $fee, $weights );
		$own       = 0;
		foreach ( $shares as $index => $share ) {
			if ( ! empty( $share['own'] ) ) {
				$own += $allocated[ $index ];
			}
		}
		return $own;
	}

	/**
	 * Split an amount in proportion to weights, to the cent, by largest
	 * remainder: the parts always add up to the amount. Ties go to the
	 * earlier weight, so the split is deterministic.
	 *
	 * @param int   $amount  Cents to split (may be negative).
	 * @param int[] $weights Non-negative weights.
	 * @return int[] Parts, keyed like the weights.
	 */
	public static function allocate( $amount, array $weights ) {
		$amount  = (int) $amount;
		$weights = array_map( 'intval', $weights );
		$sum     = array_sum( $weights );
		$parts   = array_fill_keys( array_keys( $weights ), 0 );
		if ( 0 === $amount || $sum <= 0 ) {
			return $parts;
		}

		$sign       = $amount < 0 ? -1 : 1;
		$magnitude  = abs( $amount );
		$remainders = array();
		foreach ( $weights as $key => $weight ) {
			$product            = $magnitude * max( 0, $weight );
			$parts[ $key ]      = intdiv( $product, $sum );
			$remainders[ $key ] = $product % $sum;
		}

		$left  = $magnitude - array_sum( $parts );
		$order = array_keys( $remainders );
		usort(
			$order,
			static function ( $a, $b ) use ( $remainders, $order ) {
				if ( $remainders[ $a ] !== $remainders[ $b ] ) {
					return $remainders[ $b ] <=> $remainders[ $a ];
				}
				return array_search( $a, $order, true ) <=> array_search( $b, $order, true );
			}
		);
		foreach ( array_slice( $order, 0, $left ) as $key ) {
			++$parts[ $key ];
		}

		return array_map(
			static function ( $part ) use ( $sign ) {
				return $sign * $part;
			},
			$parts
		);
	}

	/**
	 * Online payments of the date, as calculate() takes them.
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $currency      Site currency.
	 * @return array|null Null when payment information can't be read.
	 */
	private static function read_online( $event_date_id, $currency ) {
		global $wpdb;

		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return null;
		}

		$transactions_table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
		$links_available    = PaymentHistoryCompatibility::storage_available();
		$signups_table      = $wpdb->prefix . 'fair_events_signups';

		// Paid live transactions linked to this date's purchases.
		$linked_ids = array();
		if ( $links_available ) {
			$linked_ids = array_map(
				'intval',
				(array) $wpdb->get_col(
					$wpdb->prepare(
						"SELECT DISTINCT lk.transaction_id FROM %i AS lk
						INNER JOIN %i AS s ON s.id = lk.signup_id
						INNER JOIN %i AS t ON t.id = lk.transaction_id
						WHERE s.event_date_id = %d AND lk.role <> %s AND t.status = 'paid' AND t.testmode = 0",
						SignupPaymentLink::table(),
						$signups_table,
						$transactions_table,
						$event_date_id,
						SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD
					)
				)
			);
		}

		// Paid live transactions Connector attributes to the date that no
		// purchase is linked to: they belong to the date in full.
		$unlinked_sql = $links_available
			? $wpdb->prepare( ' AND NOT EXISTS ( SELECT 1 FROM %i AS lk WHERE lk.transaction_id = t.id )', SignupPaymentLink::table() )
			: '';
		$direct_ids   = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT t.id FROM %i AS t WHERE t.event_date_id = %d AND t.status = 'paid' AND t.testmode = 0{$unlinked_sql}",
					$transactions_table,
					$event_date_id
				)
			)
		);

		$ids = array_values( array_unique( array_merge( $linked_ids, $direct_ids ) ) );

		// Every revenue link of those transactions, on any date, in link order.
		$shares = array();
		if ( $links_available && $linked_ids ) {
			foreach ( (array) $wpdb->get_results(
				$wpdb->prepare(
					'SELECT lk.transaction_id, lk.allocated_amount, s.event_date_id FROM %i AS lk
					INNER JOIN %i AS s ON s.id = lk.signup_id
					WHERE lk.transaction_id IN ( ' . implode( ', ', array_fill( 0, count( $linked_ids ), '%d' ) ) . ' ) AND lk.role <> %s
					ORDER BY lk.id ASC',
					array_merge(
						array( SignupPaymentLink::table(), $signups_table ),
						$linked_ids,
						array( SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD )
					)
				),
				ARRAY_A
			) as $row ) {
				$shares[ (int) $row['transaction_id'] ][] = array(
					'amount' => self::cents( $row['allocated_amount'] ),
					'own'    => (int) $row['event_date_id'] === $event_date_id,
				);
			}
		}

		$rows = array();
		if ( $ids ) {
			$rows = (array) $wpdb->get_results(
				$wpdb->prepare(
					'SELECT id, amount, currency, mollie_fee, application_fee, mollie_payment_id FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ' ) ORDER BY id ASC',
					array_merge( array( $transactions_table ), $ids )
				),
				ARRAY_A
			);
		}

		$payouts        = self::read_payouts( array_column( $rows, 'mollie_payment_id' ) );
		$transactions   = array();
		$other_currency = false;
		foreach ( $rows as $row ) {
			if ( strtoupper( (string) $row['currency'] ) !== strtoupper( (string) $currency ) ) {
				$other_currency = true;
				continue;
			}
			$id    = (int) $row['id'];
			$total = self::cents( $row['amount'] );

			$transactions[] = array(
				'transaction_id'  => $id,
				'total'           => $total,
				'mollie_fee'      => null === $row['mollie_fee'] ? null : self::cents( $row['mollie_fee'] ),
				'application_fee' => null === $row['application_fee'] ? 0 : self::cents( $row['application_fee'] ),
				'shares'          => $shares[ $id ] ?? array(
					array(
						'amount' => $total,
						'own'    => true,
					),
				),
				'payout'          => $payouts[ (string) $row['mollie_payment_id'] ] ?? self::PAYOUT_UNKNOWN,
			);
		}

		$unallocated = 0;
		$event_date  = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date && $links_available ) {
			$revenue     = PurchasePaymentHistory::event_date_revenue( $event_date );
			$unallocated = (int) ( $revenue['unresolved'] ?? 0 );
		}

		return array(
			'transactions'   => $transactions,
			'unallocated'    => $unallocated,
			'other_currency' => $other_currency,
		);
	}

	/**
	 * Payout state of each payment, from saved settlements and Fair
	 * Finance's confirmed bank reconciliations.
	 *
	 * A payment is in a settlement when one of the settlement's published
	 * revisions lists a payment movement with its reference. Mollie pays
	 * several events in one settlement; the state follows each payment, so
	 * a settlement's total is never attributed to one event. A payment in
	 * none, or in several settlements, is `unknown`.
	 *
	 * @param string[] $references Mollie payment IDs.
	 * @return array<string, string> Payout state per reference found.
	 */
	private static function read_payouts( array $references ) {
		global $wpdb;

		$references = array_values( array_unique( array_filter( array_map( 'strval', $references ) ) ) );
		if ( ! $references
			|| ! method_exists( \FairPaymentsConnector\Database\Schema::class, 'get_settlement_items_table_name' )
			|| ! self::table_exists( \FairPaymentsConnector\Database\Schema::get_settlement_items_table_name() ) ) {
			return array();
		}

		$found = array();
		foreach ( array_chunk( $references, 200 ) as $chunk ) {
			foreach ( (array) $wpdb->get_results(
				$wpdb->prepare(
					"SELECT DISTINCT i.payment_reference, s.id, s.status, s.material_change_at FROM %i AS i
					INNER JOIN %i AS s ON ( i.revision_id = s.api_revision_id OR i.revision_id = s.csv_revision_id )
					WHERE i.is_aggregate = 0 AND i.item_type IN ( 'payment', 'capture' )
					AND i.payment_reference IN ( " . implode( ', ', array_fill( 0, count( $chunk ), '%s' ) ) . ' )',
					array_merge(
						array( \FairPaymentsConnector\Database\Schema::get_settlement_items_table_name(), \FairPaymentsConnector\Database\Schema::get_settlements_table_name() ),
						$chunk
					)
				),
				ARRAY_A
			) as $row ) {
				$found[ (string) $row['payment_reference'] ][ (int) $row['id'] ] = $row;
			}
		}

		$settlement_ids = array();
		foreach ( $found as $settlements ) {
			if ( 1 === count( $settlements ) ) {
				$settlement_ids[] = (int) array_key_first( $settlements );
			}
		}
		$confirmed = self::read_bank_confirmations( $settlement_ids );

		$states = array();
		foreach ( $found as $reference => $settlements ) {
			if ( 1 !== count( $settlements ) ) {
				// Conflicting evidence: unknown, never one of them.
				$states[ $reference ] = self::PAYOUT_UNKNOWN;
				continue;
			}
			$settlement = reset( $settlements );
			$id         = (int) $settlement['id'];
			$status     = strtolower( (string) $settlement['status'] );

			if ( isset( $confirmed[ $id ] ) && ( empty( $settlement['material_change_at'] ) || (string) $settlement['material_change_at'] <= $confirmed[ $id ] ) ) {
				$states[ $reference ] = self::PAYOUT_RECEIVED;
			} elseif ( 'paidout' === $status ) {
				$states[ $reference ] = self::PAYOUT_PAID_OUT;
			} elseif ( in_array( $status, array( 'open', 'pending' ), true ) ) {
				$states[ $reference ] = self::PAYOUT_AWAITING;
			} else {
				$states[ $reference ] = self::PAYOUT_UNKNOWN;
			}
		}
		return $states;
	}

	/**
	 * Settlements whose bank receipt an administrator confirmed in Fair
	 * Finance's reconciliation, with when.
	 *
	 * @param int[] $settlement_ids Settlement IDs.
	 * @return array<int, string> Confirmation time (UTC) per settlement.
	 */
	private static function read_bank_confirmations( array $settlement_ids ) {
		global $wpdb;

		if ( ! $settlement_ids
			|| ! class_exists( '\\FairFinance\\Database\\Schema' )
			|| ! method_exists( '\\FairFinance\\Database\\Schema', 'reconciliation_table' ) ) {
			return array();
		}
		$decisions = \FairFinance\Database\Schema::reconciliation_table( 'decisions' );
		$history   = \FairFinance\Database\Schema::reconciliation_table( 'history' );
		if ( ! self::table_exists( $decisions ) || ! self::table_exists( $history ) ) {
			return array();
		}

		$confirmed = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT d.settlement_id, h.confirmed_at FROM %i AS d INNER JOIN %i AS h ON h.id = d.history_id
				WHERE d.state IN ( 'full', 'partial' ) AND d.settlement_id IN ( " . implode( ', ', array_fill( 0, count( $settlement_ids ), '%d' ) ) . ' )',
				array_merge( array( $decisions, $history ), $settlement_ids )
			),
			ARRAY_A
		) as $row ) {
			$confirmed[ (int) $row['settlement_id'] ] = (string) $row['confirmed_at'];
		}
		return $confirmed;
	}

	/**
	 * Fair Finance's event summary, as calculate() takes it.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|false|null Null when Fair Finance is inactive, false when
	 *                          its summary failed.
	 */
	private static function read_finance( $event_date_id ) {
		if ( ! class_exists( '\\FairFinance\\Core\\Plugin' )
			|| ! class_exists( '\\FairFinance\\Models\\FinancialEntry' )
			|| ! method_exists( '\\FairFinance\\Models\\FinancialEntry', 'get_event_cash_summary' ) ) {
			return null;
		}

		$summary = \FairFinance\Models\FinancialEntry::get_event_cash_summary( (int) $event_date_id );
		// An older Fair Finance can't tell bank-paid from unspecified costs.
		if ( ! is_array( $summary ) || ! array_key_exists( 'unclassified_expenses', $summary ) ) {
			return false;
		}
		$summary['currency'] = self::FINANCE_CURRENCY;
		return $summary;
	}

	/**
	 * Whether a table exists.
	 *
	 * @param string $table Table name.
	 * @return bool
	 */
	private static function table_exists( $table ) {
		global $wpdb;
		return $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
	}

	/**
	 * Sum of the known amounts; null when none is known.
	 *
	 * @param array<int|null> $amounts Cents or null.
	 * @return int|null
	 */
	private static function sum_known( array $amounts ) {
		$known = array_filter(
			$amounts,
			static function ( $amount ) {
				return null !== $amount;
			}
		);
		return $known ? (int) array_sum( $known ) : null;
	}

	/**
	 * Amount in cents.
	 *
	 * @param mixed $amount Amount.
	 * @return int
	 */
	private static function cents( $amount ) {
		return (int) round( (float) $amount * 100 );
	}

	/**
	 * Cents as an amount; null stays null.
	 *
	 * @param int|null $cents Cents.
	 * @return float|null
	 */
	public static function amount( $cents ) {
		return null === $cents ? null : round( $cents / 100, 2 );
	}
}
