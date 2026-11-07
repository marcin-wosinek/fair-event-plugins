<?php
/**
 * Purchase payment history reader
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\EventTiming;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\SignupPaymentLink;
use FairEventsShared\LineItemTotals;

defined( 'WPINC' ) || die;

/**
 * Reads purchase payments from what Fair Events owns: payment links, with
 * each transaction's status, total and currency from Fair Payments
 * Connector (PAYMENT_HISTORY_MIGRATION.md §5, §7, §8.14). Statistics,
 * purchase details and the participant's payment history share it, so
 * every reader attributes a payment the same way.
 *
 * - A purchase's history is every attempt linked to it, in every role,
 *   including failed attempts and preserved refund-labelled records.
 * - Revenue sums the allocations of paid links only, never transaction
 *   totals, so a shared transaction counts once across its purchases.
 *   Refund-labelled records stay visible and never count.
 * - Ownership comes from links only: never from editable transaction
 *   columns, a matching email or the purchase's latest-attempt pointer.
 *
 * Revenue is `unavailable` (no amount, never 0) when Connector's
 * transactions can't be read, and `incomplete` when paid money that
 * belongs to the date isn't fully allocated to its purchases.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated %d lists.
 */
class PurchasePaymentHistory {

	/**
	 * Revenue can be read and every paid payment is allocated.
	 */
	const STATE_AVAILABLE = 'available';

	/**
	 * Some paid money for the date isn't allocated to its purchases.
	 */
	const STATE_INCOMPLETE = 'incomplete';

	/**
	 * Payment information can't be read.
	 */
	const STATE_UNAVAILABLE = 'unavailable';

	/**
	 * Every linked attempt of the purchases, oldest first, with each
	 * transaction as Connector has it now.
	 *
	 * @param int[] $signup_ids Purchase IDs.
	 * @return array{payment_information: string, purchases: array<int, array[]>}
	 *         Per purchase: transaction_id, role, allocated_amount, currency,
	 *         attribution, created_at, counts_as_revenue, and transaction
	 *         (status, amount, currency, created_at; null when it is missing
	 *         or unreadable) with transaction_missing.
	 */
	public static function for_signups( array $signup_ids ) {
		global $wpdb;

		$signup_ids = self::ids( $signup_ids );
		$purchases  = array_fill_keys( $signup_ids, array() );
		$available  = PaymentHistoryCompatibility::payment_information_available();
		if ( ! $signup_ids || ! PaymentHistoryCompatibility::storage_available() ) {
			return array(
				'payment_information' => $available ? self::STATE_AVAILABLE : self::STATE_UNAVAILABLE,
				'purchases'           => $purchases,
			);
		}

		$links = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, signup_id, transaction_id, role, allocated_amount, currency, attribution, created_at FROM %i
				WHERE signup_id IN ( ' . implode( ', ', array_fill( 0, count( $signup_ids ), '%d' ) ) . ' ) ORDER BY created_at ASC, transaction_id ASC, id ASC',
				array_merge( array( SignupPaymentLink::table() ), $signup_ids )
			),
			ARRAY_A
		);

		$transactions = $available ? self::transactions( array_column( $links, 'transaction_id' ) ) : array();
		foreach ( $links as $link ) {
			$transaction                             = $transactions[ (int) $link['transaction_id'] ] ?? null;
			$purchases[ (int) $link['signup_id'] ][] = array(
				'transaction_id'      => (int) $link['transaction_id'],
				'role'                => (string) $link['role'],
				'allocated_amount'    => (float) $link['allocated_amount'],
				'currency'            => strtoupper( (string) $link['currency'] ),
				'attribution'         => (string) $link['attribution'],
				'created_at'          => (string) $link['created_at'],
				'counts_as_revenue'   => $transaction && self::counts_as_revenue( $link['role'], $transaction['status'] ),
				'transaction'         => $transaction,
				'transaction_missing' => $available && ! $transaction,
			);
		}

		return array(
			'payment_information' => $available ? self::STATE_AVAILABLE : self::STATE_UNAVAILABLE,
			'purchases'           => $purchases,
		);
	}

	/**
	 * The purchases each transaction is linked to.
	 *
	 * @param int[] $transaction_ids Connector transaction IDs.
	 * @return array<int, array[]> Per transaction: signup_id, event_date_id,
	 *                             role, allocated_amount, currency.
	 */
	public static function purchases_for_transactions( array $transaction_ids ) {
		global $wpdb;

		$transaction_ids = self::ids( $transaction_ids );
		$result          = array_fill_keys( $transaction_ids, array() );
		if ( ! $transaction_ids || ! PaymentHistoryCompatibility::storage_available() ) {
			return $result;
		}

		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT lk.transaction_id, lk.signup_id, s.event_date_id, lk.role, lk.allocated_amount, lk.currency
				FROM %i AS lk INNER JOIN %i AS s ON s.id = lk.signup_id
				WHERE lk.transaction_id IN ( ' . implode( ', ', array_fill( 0, count( $transaction_ids ), '%d' ) ) . ' ) ORDER BY lk.transaction_id ASC, lk.signup_id ASC, lk.id ASC',
				array_merge( array( SignupPaymentLink::table(), $wpdb->prefix . 'fair_events_signups' ), $transaction_ids )
			),
			ARRAY_A
		) as $row ) {
			$result[ (int) $row['transaction_id'] ][] = array(
				'signup_id'        => (int) $row['signup_id'],
				'event_date_id'    => (int) $row['event_date_id'],
				'role'             => (string) $row['role'],
				'allocated_amount' => (float) $row['allocated_amount'],
				'currency'         => strtoupper( (string) $row['currency'] ),
			);
		}
		return $result;
	}

	/**
	 * Revenue of one occurrence from paid link allocations (§7).
	 *
	 * The purchases stored on the date count, a whole-series pass on its
	 * master (§7.2). A generated occurrence reports the pass revenue
	 * covering it separately, never in its total.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array{state: string, currency: string, total: float|null, daily: array<string, float>,
	 *               excluded_currencies: string[], unresolved: int, series_pass_revenue: float|null}
	 */
	public static function event_date_revenue( $event_date ) {
		$currency = \FairEventsShared\Money::site_currency();
		if ( ! PaymentHistoryCompatibility::storage_available() || ! PaymentHistoryCompatibility::payment_information_available() ) {
			return self::summarize( array(), array(), $currency, false );
		}

		$rows    = self::paid_link_rows( array( (int) $event_date->id ) );
		$context = array(
			'remainder'  => self::with_remainder( array_column( $rows, 'transaction_id' ) ),
			'unresolved' => array_merge( self::open_finding_keys( (int) $event_date->id ), self::unlinked_transaction_keys( (int) $event_date->id ) ),
			'series'     => null,
		);

		$covering = self::covering_pass_signup_ids( $event_date );
		if ( null !== $covering ) {
			$context['series'] = $covering ? self::paid_link_rows( array(), $covering ) : array();
		}

		return self::summarize( $rows, $context, $currency, true );
	}

	/**
	 * Sum paid allocations into a revenue summary. Pure: everything it
	 * needs is passed in.
	 *
	 * @param array[] $rows      Paid links: transaction_id, allocated_amount, currency, created_at.
	 * @param array   $context   remainder: tx => true (allocations below the total),
	 *                           unresolved: key => true (unallocated paid money for the date),
	 *                           series: paid links of covering passes, or null when not an occurrence.
	 * @param string  $currency  Site currency.
	 * @param bool    $available Whether payment information can be read.
	 * @return array See event_date_revenue().
	 */
	public static function summarize( array $rows, array $context, $currency, $available ) {
		$currency = strtoupper( (string) $currency );
		if ( ! $available ) {
			return array(
				'state'               => self::STATE_UNAVAILABLE,
				'currency'            => $currency,
				'total'               => null,
				'daily'               => array(),
				'excluded_currencies' => array(),
				'unresolved'          => 0,
				'series_pass_revenue' => null,
			);
		}

		$total    = 0;
		$daily    = array();
		$excluded = array();
		$timezone = wp_timezone();
		foreach ( $rows as $row ) {
			$row_currency = strtoupper( (string) $row['currency'] );
			if ( $row_currency !== $currency ) {
				$excluded[ $row_currency ] = true;
				continue;
			}
			$cents  = self::cents( $row['allocated_amount'] );
			$total += $cents;
			// The attempt's creation day, as the ledger dated it (§7.3).
			$date = \DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', (string) $row['created_at'], $timezone );
			if ( $date ) {
				$key           = $date->format( 'Y-m-d' );
				$daily[ $key ] = ( $daily[ $key ] ?? 0 ) + $cents;
			}
		}
		ksort( $daily );

		$unresolved = array_keys( $context['unresolved'] ?? array() );
		foreach ( array_keys( $context['remainder'] ?? array() ) as $transaction_id ) {
			$unresolved[] = 'transaction:' . (int) $transaction_id;
		}
		$unresolved = array_unique( $unresolved );

		$series = null;
		if ( is_array( $context['series'] ?? null ) ) {
			$series = 0;
			foreach ( $context['series'] as $row ) {
				if ( strtoupper( (string) $row['currency'] ) === $currency ) {
					$series += self::cents( $row['allocated_amount'] );
				} else {
					$excluded[ strtoupper( (string) $row['currency'] ) ] = true;
				}
			}
			$series = self::amount( $series );
		}

		$excluded = array_keys( $excluded );
		sort( $excluded );

		return array(
			'state'               => $unresolved ? self::STATE_INCOMPLETE : self::STATE_AVAILABLE,
			'currency'            => $currency,
			'total'               => self::amount( $total ),
			'daily'               => array_map( array( self::class, 'amount' ), $daily ),
			'excluded_currencies' => $excluded,
			'unresolved'          => count( $unresolved ),
			'series_pass_revenue' => $series,
		);
	}

	/**
	 * Whether a link counts as revenue: its transaction is paid and it
	 * isn't a preserved refund-labelled record.
	 *
	 * @param string $role   Link role.
	 * @param string $status Connector status.
	 * @return bool
	 */
	public static function counts_as_revenue( $role, $status ) {
		return 'paid' === (string) $status && SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD !== (string) $role;
	}

	/**
	 * Paid revenue links of purchases stored on the dates, or of the named
	 * purchases.
	 *
	 * @param int[] $event_date_ids Stored event date IDs.
	 * @param int[] $signup_ids     Purchase IDs, instead of dates.
	 * @return array[] transaction_id, signup_id, allocated_amount, currency, created_at.
	 */
	private static function paid_link_rows( array $event_date_ids, array $signup_ids = array() ) {
		global $wpdb;

		$column = $signup_ids ? 's.id' : 's.event_date_id';
		$ids    = self::ids( $signup_ids ? $signup_ids : $event_date_ids );
		if ( ! $ids ) {
			return array();
		}

		return (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT lk.transaction_id, lk.signup_id, lk.allocated_amount, t.currency, lk.created_at
				FROM %i AS lk
				INNER JOIN %i AS s ON s.id = lk.signup_id
				INNER JOIN %i AS t ON t.id = lk.transaction_id
				WHERE {$column} IN ( " . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . " ) AND t.status = 'paid' AND lk.role <> %s
				ORDER BY lk.id ASC",
				array_merge(
					array( SignupPaymentLink::table(), $wpdb->prefix . 'fair_events_signups', \FairPaymentsConnector\Database\Schema::get_payments_table_name() ),
					$ids,
					array( SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD )
				)
			),
			ARRAY_A
		);
	}

	/**
	 * Transactions whose revenue links allocate less than their total: an
	 * unallocated remainder (§5.1, §6.2).
	 *
	 * @param int[] $transaction_ids Transaction IDs.
	 * @return array<int, true>
	 */
	private static function with_remainder( array $transaction_ids ) {
		global $wpdb;

		$transaction_ids = self::ids( $transaction_ids );
		if ( ! $transaction_ids ) {
			return array();
		}

		$remainder = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT lk.transaction_id, SUM(lk.allocated_amount) AS allocated, t.amount
				FROM %i AS lk INNER JOIN %i AS t ON t.id = lk.transaction_id
				WHERE lk.transaction_id IN ( ' . implode( ', ', array_fill( 0, count( $transaction_ids ), '%d' ) ) . ' ) AND lk.role <> %s
				GROUP BY lk.transaction_id, t.amount',
				array_merge(
					array( SignupPaymentLink::table(), \FairPaymentsConnector\Database\Schema::get_payments_table_name() ),
					$transaction_ids,
					array( SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD )
				)
			),
			ARRAY_A
		) as $row ) {
			if ( ! LineItemTotals::amounts_match( $row['allocated'], $row['amount'] ) ) {
				$remainder[ (int) $row['transaction_id'] ] = true;
			}
		}
		return $remainder;
	}

	/**
	 * Open backfill findings about unallocated money whose immutable
	 * metadata names the date (§7.1).
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array<string, true> Keyed by `transaction:<id>` or `<type>:<id>`.
	 */
	private static function open_finding_keys( $event_date_id ) {
		global $wpdb;

		if ( version_compare( \FairEvents\Database\Schema::get_db_version(), PaymentHistoryCompatibility::BACKFILL_DB_VERSION, '<' ) ) {
			return array();
		}

		$reasons = array_values( array_diff( PaymentHistoryFinding::REASONS, PaymentHistoryFinding::INFORMATIONAL, array( 'ambiguous_activity', 'duplicate_series_relationship' ) ) );
		$keys    = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DISTINCT source_type, source_id FROM %i WHERE mode = %s AND status = %s AND event_date_id = %d
				AND reason IN ( ' . implode( ', ', array_fill( 0, count( $reasons ), '%s' ) ) . ' )',
				array_merge(
					array( PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::STATUS_OPEN, (int) $event_date_id ),
					$reasons
				)
			),
			ARRAY_A
		) as $row ) {
			$keys[ $row['source_type'] . ':' . (int) $row['source_id'] ] = true;
		}
		return $keys;
	}

	/**
	 * Paid event payments whose immutable metadata names the date but which
	 * no link and no finding accounts for: money the date received that no
	 * purchase holds yet, e.g. from before shadow writes on a site that
	 * never ran the backfill.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array<string, true> Keyed by `transaction:<id>`.
	 */
	private static function unlinked_transaction_keys( $event_date_id ) {
		global $wpdb;

		$findings = version_compare( \FairEvents\Database\Schema::get_db_version(), PaymentHistoryCompatibility::BACKFILL_DB_VERSION, '>=' )
			? $wpdb->prepare( ' AND NOT EXISTS ( SELECT 1 FROM %i AS f WHERE f.mode = %s AND f.source_type = %s AND f.source_id = t.id )', PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::SOURCE_TRANSACTION )
			: '';

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT t.id, t.metadata FROM %i AS t
				WHERE t.status = 'paid' AND ( t.metadata LIKE %s OR t.metadata LIKE %s )
				AND ( t.metadata LIKE %s OR t.metadata LIKE %s ) AND t.metadata NOT LIKE %s
				AND NOT EXISTS ( SELECT 1 FROM %i AS lk WHERE lk.transaction_id = t.id ){$findings}
				ORDER BY t.id ASC LIMIT 500",
				\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
				'%' . $wpdb->esc_like( '"event_date_id":' . (int) $event_date_id ) . '%',
				'%' . $wpdb->esc_like( '"event_date_id":"' . (int) $event_date_id . '"' ) . '%',
				'%' . $wpdb->esc_like( PaymentAttribution::SOURCE_GET_TICKETS ) . '%',
				'%' . $wpdb->esc_like( 'fair-audience-' ) . '%',
				'%' . $wpdb->esc_like( 'fee_payment_id' ) . '%',
				SignupPaymentLink::table()
			),
			ARRAY_A
		);

		$keys = array();
		foreach ( $rows as $row ) {
			$metadata = json_decode( (string) $row['metadata'], true );
			if ( is_array( $metadata ) && (int) ( $metadata['event_date_id'] ?? 0 ) === (int) $event_date_id ) {
				$keys[ 'transaction:' . (int) $row['id'] ] = true;
			}
		}
		return $keys;
	}

	/**
	 * Confirmed whole-series purchases on a generated occurrence's master
	 * that cover it: bought before the occurrence's pass cutoff, as ticket
	 * counts apply them (EventTicketStatistics).
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return int[]|null Purchase IDs; null when the date isn't a generated occurrence.
	 */
	private static function covering_pass_signup_ids( $event_date ) {
		global $wpdb;

		if ( 'generated' !== $event_date->occurrence_type || empty( $event_date->master_id ) ) {
			return null;
		}

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT s.id FROM %i AS s INNER JOIN %i AS tt ON tt.id = s.ticket_type_id
					WHERE s.event_date_id = %d AND s.status = 'confirmed' AND tt.recurrence_scope = 'whole_series' AND s.created_at <= %s",
					$wpdb->prefix . 'fair_events_signups',
					$wpdb->prefix . 'fair_events_ticket_types',
					(int) $event_date->master_id,
					(string) EventTiming::series_pass_cutoff( $event_date->get_timing() )
				)
			)
		);
	}

	/**
	 * Connector transactions by ID.
	 *
	 * @param int[] $transaction_ids Transaction IDs.
	 * @return array<int, array{status: string, amount: float, currency: string, created_at: string}>
	 */
	private static function transactions( array $transaction_ids ) {
		global $wpdb;

		$transaction_ids = self::ids( $transaction_ids );
		if ( ! $transaction_ids ) {
			return array();
		}

		$transactions = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, status, amount, currency, created_at FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $transaction_ids ), '%d' ) ) . ' )',
				array_merge( array( \FairPaymentsConnector\Database\Schema::get_payments_table_name() ), $transaction_ids )
			),
			ARRAY_A
		) as $row ) {
			$transactions[ (int) $row['id'] ] = array(
				'status'     => (string) $row['status'],
				'amount'     => (float) $row['amount'],
				'currency'   => strtoupper( (string) $row['currency'] ),
				'created_at' => (string) $row['created_at'],
			);
		}
		return $transactions;
	}

	/**
	 * Positive, distinct integer IDs.
	 *
	 * @param array $ids IDs.
	 * @return int[]
	 */
	private static function ids( array $ids ) {
		return array_values( array_unique( array_filter( array_map( 'intval', $ids ), static fn( $id ) => $id > 0 ) ) );
	}

	/**
	 * Cents as an amount.
	 *
	 * @param int $cents Cents.
	 * @return float
	 */
	public static function amount( $cents ) {
		return round( $cents / 100, 2 );
	}

	/**
	 * Amount in cents.
	 *
	 * @param mixed $amount Amount.
	 * @return int
	 */
	private static function cents( $amount ) {
		return (int) round( LineItemTotals::normalize_amount( $amount ) * 100 );
	}
}
