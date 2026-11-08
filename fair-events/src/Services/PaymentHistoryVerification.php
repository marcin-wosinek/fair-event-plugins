<?php
/**
 * Payment history verification report
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\EventTiming;
use FairEvents\Models\EventDates;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\SignupPaymentLink;
use FairEventsShared\LineItemTotals;

defined( 'WPINC' ) || die;

/**
 * Compares, per event date, what the source history says (Audience
 * relationships and ledger, purchases without provenance) with what the
 * Events-owned history says (ticket units including backfilled purchases,
 * payment links), as PAYMENT_HISTORY_MIGRATION.md §8.4 requires:
 *
 * - admissions: source counts confirmed units of ordinary purchases,
 *   confirmed purchases without units and signed-up relationships by
 *   today's rule ignoring provenance; target is what Statistics counts now.
 *   The only allowed difference is §4.1 replacing gap G3: a relationship
 *   whose participant only had a failed or expired purchase is now an
 *   admission (`legacy_rule`).
 * - activity selections: the same split; reported, never blocking.
 * - revenue per currency and transaction: the ledger's paid transactions on
 *   signed-up relationships against paid link allocations. Allowed causes:
 *   `shared_transaction` (§5.4), `legacy_refund_record` (§11), `unresolved`
 *   (an open finding lists it), `reconciled` (an administrator linked or
 *   reviewed it, §6.3), `not_in_ledger` (a paid purchase today's ledger
 *   reader can't reach, §8.9), `moved_purchase` (the ledger still counts a
 *   payment on the date its metadata names, while its fully allocated
 *   purchase was moved to another date, §8.9). Anything else is
 *   `unexpected` and blocks.
 *
 * Counts are per stored event date, on both sides, so a whole-series
 * pass's revenue appears once, on its master (§7.2). For a generated
 * occurrence the report adds `series_pass_revenue`: what today's
 * Statistics adds there for passes, the intentional difference §7.2
 * introduces at stage 5.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated %d lists.
 */
class PaymentHistoryVerification {

	/**
	 * Causes a revenue difference may have without blocking.
	 */
	const EXPLAINED_CAUSES = array( 'shared_transaction', 'legacy_refund_record', 'unresolved', 'reconciled', 'not_in_ledger', 'moved_purchase' );

	/**
	 * Classify per-transaction revenue differences of one event date.
	 *
	 * @param array[] $source  Ledger rows: transaction_id, kind, amount, currency.
	 * @param array[] $target  Link sums: transaction_id, allocated, currency.
	 * @param array   $context shared: tx => true (fully allocated across several purchases),
	 *                         unresolved: tx => true (open finding),
	 *                         reconciled: tx => true (an administrator decided it),
	 *                         moved: tx => true (fully allocated to purchases moved off this date).
	 * @return array<string, array{source: float, target: float, differences: array[], unexpected: float}> Per currency.
	 */
	public static function classify_revenue( array $source, array $target, array $context ) {
		$transactions = array();
		foreach ( $source as $row ) {
			$id   = (int) $row['transaction_id'];
			$sign = 'refund' === ( $row['kind'] ?? 'charge' ) ? -1 : 1;

			$transactions[ $id ]                                       = ( $transactions[ $id ] ?? array(
				'currency' => strtoupper( (string) $row['currency'] ),
				'charge'   => 0,
				'refund'   => 0,
				'target'   => 0,
			) );
			$transactions[ $id ][ 1 === $sign ? 'charge' : 'refund' ] += self::cents( $row['amount'] );
		}
		foreach ( $target as $row ) {
			$id = (int) $row['transaction_id'];

			$transactions[ $id ]            = ( $transactions[ $id ] ?? array(
				'currency' => strtoupper( (string) $row['currency'] ),
				'charge'   => 0,
				'refund'   => 0,
				'target'   => 0,
			) );
			$transactions[ $id ]['target'] += self::cents( $row['allocated'] );
		}
		ksort( $transactions );

		$currencies = array();
		foreach ( $transactions as $id => $tx ) {
			$currency = $tx['currency'];

			$currencies[ $currency ] = ( $currencies[ $currency ] ?? array(
				'source'      => 0,
				'target'      => 0,
				'differences' => array(),
				'unexpected'  => 0,
			) );

			$source_cents                       = $tx['charge'] - $tx['refund'];
			$currencies[ $currency ]['source'] += $source_cents;
			$currencies[ $currency ]['target'] += $tx['target'];
			if ( $source_cents === $tx['target'] ) {
				continue;
			}

			$cause = self::revenue_cause( $id, $tx, $context );
			if ( ! $cause ) {
				$cause                                  = 'unexpected';
				$currencies[ $currency ]['unexpected'] += $tx['target'] - $source_cents;
			}
			$currencies[ $currency ]['differences'][] = array(
				'transaction_id' => $id,
				'source'         => self::amount( $source_cents ),
				'target'         => self::amount( $tx['target'] ),
				'cause'          => $cause,
			);
		}

		foreach ( $currencies as &$summary ) {
			$summary['source']     = self::amount( $summary['source'] );
			$summary['target']     = self::amount( $summary['target'] );
			$summary['unexpected'] = self::amount( $summary['unexpected'] );
		}
		unset( $summary );
		ksort( $currencies );

		return $currencies;
	}

	/**
	 * The allowed cause of one transaction's difference, if any.
	 *
	 * @param int   $id      Transaction ID.
	 * @param array $tx      charge, refund and target cents.
	 * @param array $context See classify_revenue().
	 * @return string|null
	 */
	private static function revenue_cause( $id, array $tx, array $context ) {
		if ( ! empty( $context['unresolved'][ $id ] ) ) {
			return 'unresolved';
		}
		if ( ! empty( $context['reconciled'][ $id ] ) ) {
			return 'reconciled';
		}
		// The ledger relationship stayed on the original date when its
		// purchase moved; the links count the payment once, on the
		// purchase's current date (§8.9).
		if ( ! empty( $context['moved'][ $id ] ) && 0 === $tx['target'] && 0 === $tx['refund'] && $tx['charge'] > 0 ) {
			return 'moved_purchase';
		}
		// The ledger subtracts a refund-labelled row; links keep it as a
		// legacy record that never counts (§11).
		if ( $tx['refund'] > 0 && $tx['charge'] === $tx['target'] ) {
			return 'legacy_refund_record';
		}
		// The ledger counts a shared transaction in full on each date; links
		// give each date its allocation (§5.4, gap G1).
		if ( ! empty( $context['shared'][ $id ] ) && $tx['target'] < $tx['charge'] ) {
			return 'shared_transaction';
		}
		if ( 0 === $tx['charge'] && 0 === $tx['refund'] && $tx['target'] > 0 ) {
			return 'not_in_ledger';
		}
		return null;
	}

	/**
	 * Compare admission counts.
	 *
	 * @param int $source    Source count.
	 * @param int $target    Target count.
	 * @param int $explained Target-only admissions from §4.1 replacing gap G3.
	 * @return array{source: int, target: int, explained: array, unexpected: int}
	 */
	public static function compare_admissions( $source, $target, $explained ) {
		return array(
			'source'     => (int) $source,
			'target'     => (int) $target,
			'explained'  => $explained ? array( 'legacy_rule' => (int) $explained ) : array(),
			'unexpected' => (int) $target - (int) $source - (int) $explained,
		);
	}

	/**
	 * Compare one event date and store the result, or remove a stored one
	 * when the date has no history.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|null The comparison row, or null when the date has no history.
	 */
	public static function check_event_date( $event_date_id ) {
		global $wpdb;

		$event_date_id = (int) $event_date_id;
		$comparison    = self::compare_event_date( $event_date_id );
		$table         = self::table();
		if ( ! $comparison ) {
			$wpdb->delete( $table, array( 'event_date_id' => $event_date_id ) );
			return null;
		}

		$wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (event_date_id, admissions, activities, revenue, revenue_state, blocking, checked_at) VALUES (%d, %s, %s, %s, %s, %d, %s)
				ON DUPLICATE KEY UPDATE admissions = VALUES(admissions), activities = VALUES(activities), revenue = VALUES(revenue),
				revenue_state = VALUES(revenue_state), blocking = VALUES(blocking), checked_at = VALUES(checked_at)',
				$table,
				$event_date_id,
				(string) wp_json_encode( $comparison['admissions'] ),
				(string) wp_json_encode( $comparison['activities'] ),
				(string) wp_json_encode(
					array(
						'currencies'          => $comparison['revenue'],
						'series_pass_revenue' => $comparison['series_pass_revenue'],
					)
				),
				$comparison['revenue_state'],
				$comparison['blocking'] ? 1 : 0,
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		return $comparison;
	}

	/**
	 * Comparisons table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_payment_history_comparisons';
	}

	/**
	 * Stored comparisons, optionally only blocking ones.
	 *
	 * @param array $filters blocking (bool), event_date_id, after_id, limit.
	 * @return array[]
	 */
	public static function get_comparisons( array $filters = array() ) {
		global $wpdb;

		$where = array( 'id > %d' );
		$args  = array( (int) ( $filters['after_id'] ?? 0 ) );
		if ( ! empty( $filters['blocking'] ) ) {
			$where[] = 'blocking = 1';
		}
		if ( ! empty( $filters['event_date_id'] ) ) {
			$where[] = 'event_date_id = %d';
			$args[]  = (int) $filters['event_date_id'];
		}
		$args[] = max( 1, min( 500, (int) ( $filters['limit'] ?? 100 ) ) );

		$where_sql = implode( ' AND ', $where );
		return array_map(
			static function ( $row ) {
				return array(
					'id'            => (int) $row['id'],
					'event_date_id' => (int) $row['event_date_id'],
					'admissions'    => json_decode( (string) $row['admissions'], true ),
					'activities'    => json_decode( (string) $row['activities'], true ),
					'revenue'       => json_decode( (string) $row['revenue'], true ),
					'revenue_state' => (string) $row['revenue_state'],
					'blocking'      => (bool) $row['blocking'],
					'checked_at'    => (string) $row['checked_at'],
				);
			},
			(array) $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i WHERE {$where_sql} ORDER BY id ASC LIMIT %d",
					array_merge( array( self::table() ), $args )
				),
				ARRAY_A
			)
		);
	}

	/**
	 * Totals over every stored comparison.
	 *
	 * @return array{event_dates: int, blocking: int, incomplete: int}
	 */
	public static function summary() {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(*) AS event_dates, COALESCE(SUM(blocking), 0) AS blocking, COALESCE(SUM(revenue_state = 'incomplete'), 0) AS incomplete FROM %i",
				self::table()
			),
			ARRAY_A
		);
		return array(
			'event_dates' => (int) ( $row['event_dates'] ?? 0 ),
			'blocking'    => (int) ( $row['blocking'] ?? 0 ),
			'incomplete'  => (int) ( $row['incomplete'] ?? 0 ),
		);
	}

	/**
	 * Remove every stored comparison, before a new verification pass.
	 *
	 * @return void
	 */
	public static function clear() {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', self::table() ) );
	}

	/**
	 * Compare one event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|null admissions, activities, revenue, series_pass_revenue, revenue_state, blocking;
	 *                    null when the date has no purchase, relationship or link.
	 */
	public static function compare_event_date( $event_date_id ) {
		$audience = ShadowPurchases::audience_tables_exist();
		$counts   = self::admission_counts( $event_date_id, $audience );
		$revenue  = self::revenue_rows( $event_date_id, $audience );
		if ( ! array_filter( $counts ) && ! $revenue['source'] && ! $revenue['target'] && ! self::has_history( $event_date_id, $audience ) ) {
			return null;
		}

		$admissions = self::compare_admissions(
			$counts['units'] + $counts['unbackfilled'] + $counts['legacy_old'],
			$counts['units'] + $counts['unbackfilled'] + $counts['provenance_units'] + $counts['legacy_now'],
			$counts['legacy_rule']
		);

		$activities               = self::activity_counts( $event_date_id, $audience );
		$activities['unexpected'] = $activities['target'] - $activities['source'];

		$transaction_ids  = array_unique( array_merge( array_column( $revenue['source'], 'transaction_id' ), array_column( $revenue['target'], 'transaction_id' ) ) );
		$context          = self::revenue_context( $transaction_ids );
		$context['moved'] = self::moved_transactions(
			$event_date_id,
			array_diff( array_column( $revenue['source'], 'transaction_id' ), array_column( $revenue['target'], 'transaction_id' ) ),
			$context
		);
		$currencies       = self::classify_revenue( $revenue['source'], $revenue['target'], $context );

		$incomplete = (bool) array_intersect_key( $context['unresolved'], array_flip( $transaction_ids ) )
			|| (bool) array_intersect_key( $context['remainder'], array_flip( array_column( $revenue['target'], 'transaction_id' ) ) )
			|| self::has_open_date_findings( $event_date_id );

		$blocking = 0 !== $admissions['unexpected'];
		foreach ( $currencies as $summary ) {
			if ( 0.0 !== (float) $summary['unexpected'] ) {
				$blocking = true;
			}
			foreach ( $summary['differences'] as $difference ) {
				if ( 'unexpected' === $difference['cause'] ) {
					$blocking = true;
				}
			}
		}

		return array(
			'admissions'          => $admissions,
			'activities'          => $activities,
			'revenue'             => $currencies,
			'series_pass_revenue' => $audience ? self::series_pass_revenue( $event_date_id ) : array(),
			'revenue_state'       => $incomplete ? 'incomplete' : 'available',
			'blocking'            => $blocking,
		);
	}

	/**
	 * Admission counts of one stored date.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $audience      Whether Audience tables exist.
	 * @return array{units: int, provenance_units: int, unbackfilled: int, legacy_old: int, legacy_now: int, legacy_rule: int}
	 */
	private static function admission_counts( $event_date_id, $audience ) {
		global $wpdb;

		$signups = $wpdb->prefix . 'fair_events_signups';
		$tickets = $wpdb->prefix . 'fair_events_tickets';

		$units = static function ( $provenance ) use ( $wpdb, $signups, $tickets, $event_date_id ) {
			$is = $provenance ? 'IS NOT NULL' : 'IS NULL';
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id
					WHERE t.event_date_id = %d AND t.status = 'confirmed' AND s.legacy_event_participant_id {$is}",
					$tickets,
					$signups,
					$event_date_id
				)
			);
		};

		$counts = array(
			'units'            => $units( false ),
			'provenance_units' => $units( true ),
			'unbackfilled'     => (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COALESCE(SUM(GREATEST(s.quantity, 1)), 0) FROM %i AS s
					WHERE s.event_date_id = %d AND s.status = 'confirmed' AND s.legacy_event_participant_id IS NULL
					AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id )",
					$signups,
					$event_date_id,
					$tickets
				)
			),
			'legacy_old'       => 0,
			'legacy_now'       => 0,
			'legacy_rule'      => 0,
		);

		if ( ! $audience ) {
			return $counts;
		}

		$relationships = $wpdb->prefix . 'fair_audience_event_participants';
		$match         = 'o.participant_id = ep.participant_id AND ( o.event_date_id = ep.event_date_id OR ( ep.ticket_type_id IS NOT NULL AND o.ticket_type_id = ep.ticket_type_id ) )';

		// Today's rule without provenance: a relationship counts unless its
		// participant has any ordinary purchase on the date.
		$counts['legacy_old'] = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS ep WHERE ep.event_date_id = %d AND ep.label = 'signed_up'
				AND NOT EXISTS ( SELECT 1 FROM %i AS o WHERE {$match} AND o.legacy_event_participant_id IS NULL )",
				$relationships,
				$event_date_id,
				$signups
			)
		);
		// What Statistics counts now (EventTicketStatistics).
		$counts['legacy_now'] = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS ep WHERE ep.event_date_id = %d AND ep.label = 'signed_up'
				AND NOT EXISTS ( SELECT 1 FROM %i AS o WHERE {$match} )
				AND NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )",
				$relationships,
				$event_date_id,
				$signups,
				$signups
			)
		);
		// Provenance units whose relationship the old rule hid behind a
		// failed or expired ordinary purchase (gap G3, replaced by §4.1).
		$counts['legacy_rule'] = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS bp ON bp.id = t.signup_id
				INNER JOIN %i AS ep ON ep.id = bp.legacy_event_participant_id
				WHERE t.event_date_id = %d AND t.status = 'confirmed' AND ep.label = 'signed_up' AND ep.event_date_id = %d
				AND EXISTS ( SELECT 1 FROM %i AS o WHERE {$match} AND o.legacy_event_participant_id IS NULL )",
				$tickets,
				$signups,
				$relationships,
				$event_date_id,
				$event_date_id,
				$signups
			)
		);

		return $counts;
	}

	/**
	 * Confirmed activity selections of one stored date.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $audience      Whether Audience tables exist.
	 * @return array{source: int, target: int}
	 */
	private static function activity_counts( $event_date_id, $audience ) {
		global $wpdb;

		$on_units = static function ( $with_provenance ) use ( $wpdb, $event_date_id ) {
			$clause = $with_provenance ? '' : 'AND s.legacy_event_participant_id IS NULL';
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS ta INNER JOIN %i AS t ON t.id = ta.ticket_id INNER JOIN %i AS s ON s.id = t.signup_id
					WHERE t.event_date_id = %d AND t.status = 'confirmed' AND ta.status = 'confirmed' {$clause}",
					$wpdb->prefix . 'fair_events_ticket_activities',
					$wpdb->prefix . 'fair_events_tickets',
					$wpdb->prefix . 'fair_events_signups',
					$event_date_id
				)
			);
		};

		$at_participant_scope = static function ( $skip_provenance ) use ( $wpdb, $event_date_id, $audience ) {
			if ( ! $audience ) {
				return 0;
			}
			$clause = $skip_provenance ? 'AND NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )' : '';
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS epo INNER JOIN %i AS ep ON ep.id = epo.event_participant_id
					WHERE ep.event_date_id = %d AND ep.label = 'signed_up' AND epo.ticket_id IS NULL AND epo.status = 'confirmed' {$clause}",
					array_merge(
						array( $wpdb->prefix . 'fair_audience_event_participant_options', $wpdb->prefix . 'fair_audience_event_participants', $event_date_id ),
						$skip_provenance ? array( $wpdb->prefix . 'fair_events_signups' ) : array()
					)
				)
			);
		};

		return array(
			'source' => $on_units( false ) + $at_participant_scope( false ),
			'target' => $on_units( true ) + $at_participant_scope( true ),
		);
	}

	/**
	 * Paid revenue rows of one stored date: the ledger's (as Statistics
	 * reads it) and the links'.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $audience      Whether Audience tables exist.
	 * @return array{source: array[], target: array[]}
	 */
	private static function revenue_rows( $event_date_id, $audience ) {
		global $wpdb;

		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return array(
				'source' => array(),
				'target' => array(),
			);
		}
		$transactions = \FairPaymentsConnector\Database\Schema::get_payments_table_name();

		$source = $audience ? (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT l.transaction_id, l.kind, t.amount, t.currency FROM %i AS l
				INNER JOIN %i AS ep ON ep.id = l.event_participant_id
				INNER JOIN %i AS t ON t.id = l.transaction_id
				WHERE ep.event_date_id = %d AND ep.label = 'signed_up' AND t.status = 'paid'
				GROUP BY l.transaction_id, l.kind, t.amount, t.currency",
				$wpdb->prefix . 'fair_audience_event_participant_transactions',
				$wpdb->prefix . 'fair_audience_event_participants',
				$transactions,
				(int) $event_date_id
			),
			ARRAY_A
		) : array();

		$target = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT lk.transaction_id, SUM(lk.allocated_amount) AS allocated, t.currency FROM %i AS lk
				INNER JOIN %i AS s ON s.id = lk.signup_id
				INNER JOIN %i AS t ON t.id = lk.transaction_id
				WHERE s.event_date_id = %d AND t.status = 'paid' AND lk.role <> %s
				GROUP BY lk.transaction_id, t.currency",
				SignupPaymentLink::table(),
				$wpdb->prefix . 'fair_events_signups',
				$transactions,
				(int) $event_date_id,
				SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD
			),
			ARRAY_A
		);

		return array(
			'source' => $source,
			'target' => $target,
		);
	}

	/**
	 * Which transactions are shared and fully allocated, have an
	 * unallocated remainder, have an open finding, or were decided by an
	 * administrator.
	 *
	 * @param int[] $transaction_ids Transaction IDs.
	 * @return array{shared: array<int, true>, complete: array<int, true>, remainder: array<int, true>, unresolved: array<int, true>, reconciled: array<int, true>}
	 */
	private static function revenue_context( array $transaction_ids ) {
		global $wpdb;

		$context         = array(
			'shared'     => array(),
			'complete'   => array(),
			'remainder'  => array(),
			'unresolved' => array(),
			'reconciled' => array(),
		);
		$transaction_ids = array_values( array_filter( array_map( 'intval', $transaction_ids ) ) );
		if ( ! $transaction_ids ) {
			return $context;
		}
		$list = implode( ', ', array_fill( 0, count( $transaction_ids ), '%d' ) );

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT lk.transaction_id, COUNT(DISTINCT lk.signup_id) AS purchases, SUM(lk.allocated_amount) AS allocated, t.amount
				FROM %i AS lk INNER JOIN %i AS t ON t.id = lk.transaction_id
				WHERE lk.transaction_id IN ( {$list} ) AND lk.role <> %s
				GROUP BY lk.transaction_id, t.amount",
				array_merge(
					array( SignupPaymentLink::table(), \FairPaymentsConnector\Database\Schema::get_payments_table_name() ),
					$transaction_ids,
					array( SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD )
				)
			),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			$id = (int) $row['transaction_id'];
			if ( LineItemTotals::amounts_match( $row['allocated'], $row['amount'] ) ) {
				$context['complete'][ $id ] = true;
				if ( (int) $row['purchases'] > 1 ) {
					$context['shared'][ $id ] = true;
				}
			} else {
				$context['remainder'][ $id ] = true;
			}
		}

		$reasons     = array_values( array_diff( PaymentHistoryFinding::REASONS, PaymentHistoryFinding::INFORMATIONAL ) );
		$reason_list = implode( ', ', array_fill( 0, count( $reasons ), '%s' ) );
		foreach ( (array) $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT source_id FROM %i WHERE mode = %s AND status = %s AND source_type = %s AND source_id IN ( {$list} )
				AND reason IN ( {$reason_list} )",
				array_merge(
					array( PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::STATUS_OPEN, PaymentHistoryFinding::SOURCE_TRANSACTION ),
					$transaction_ids,
					$reasons
				)
			)
		) as $id ) {
			$context['unresolved'][ (int) $id ] = true;
		}

		foreach ( (array) $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT source_id FROM %i WHERE mode = %s AND status IN ( %s, %s ) AND source_type = %s AND source_id IN ( {$list} )
				UNION SELECT DISTINCT transaction_id FROM %i WHERE attribution = %s AND transaction_id IN ( {$list} )",
				array_merge(
					array( PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::STATUS_RECONCILED, PaymentHistoryFinding::STATUS_REVIEWED, PaymentHistoryFinding::SOURCE_TRANSACTION ),
					$transaction_ids,
					array( SignupPaymentLink::table(), SignupPaymentLink::ATTRIBUTION_RECONCILED ),
					$transaction_ids
				)
			)
		) as $id ) {
			$context['reconciled'][ (int) $id ] = true;
		}

		return $context;
	}

	/**
	 * Which of the ledger's transactions on a date belong to a purchase
	 * moved off it: links allocate the whole transaction, none of them to a
	 * purchase on this date, and the transaction's immutable metadata names
	 * this date as the one it paid for. The editable transaction column is
	 * never evidence, and a transaction with an open finding or an
	 * administrator's decision keeps that cause (§8.9).
	 *
	 * @param int   $event_date_id   Event date ID.
	 * @param int[] $transaction_ids Ledger transactions without a link on the date.
	 * @param array $context         See revenue_context().
	 * @return array<int, true>
	 */
	private static function moved_transactions( $event_date_id, array $transaction_ids, array $context ) {
		global $wpdb;

		$candidates = array();
		foreach ( $transaction_ids as $id ) {
			$id = (int) $id;
			if ( ! empty( $context['complete'][ $id ] ) && empty( $context['unresolved'][ $id ] ) && empty( $context['reconciled'][ $id ] ) ) {
				$candidates[] = $id;
			}
		}
		if ( ! $candidates ) {
			return array();
		}

		$moved = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, metadata FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $candidates ), '%d' ) ) . ' )',
				array_merge( array( \FairPaymentsConnector\Database\Schema::get_payments_table_name() ), $candidates )
			),
			ARRAY_A
		) as $row ) {
			$metadata = json_decode( (string) $row['metadata'], true );
			if ( is_array( $metadata ) && isset( $metadata['event_date_id'] ) && (int) $metadata['event_date_id'] === (int) $event_date_id ) {
				$moved[ (int) $row['id'] ] = true;
			}
		}
		return $moved;
	}

	/**
	 * Whether an open, non-informational backfill finding concerns the date:
	 * unresolved money whose immutable metadata names it (§7.1).
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool
	 */
	private static function has_open_date_findings( $event_date_id ) {
		global $wpdb;

		$reasons = array_values( array_diff( PaymentHistoryFinding::REASONS, PaymentHistoryFinding::INFORMATIONAL, array( 'ambiguous_activity', 'duplicate_series_relationship' ) ) );
		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT 1 FROM %i WHERE mode = %s AND status = %s AND event_date_id = %d AND reason IN ( ' . implode( ', ', array_fill( 0, count( $reasons ), '%s' ) ) . ' ) LIMIT 1',
				array_merge(
					array( PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::STATUS_OPEN, (int) $event_date_id ),
					$reasons
				)
			)
		);
	}

	/**
	 * Whether the date has any purchase, relationship or finding at all.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $audience      Whether Audience tables exist.
	 * @return bool
	 */
	private static function has_history( $event_date_id, $audience ) {
		global $wpdb;

		if ( $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM %i WHERE event_date_id = %d LIMIT 1', $wpdb->prefix . 'fair_events_signups', (int) $event_date_id ) ) ) {
			return true;
		}
		if ( $audience && $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM %i WHERE event_date_id = %d LIMIT 1', $wpdb->prefix . 'fair_audience_event_participants', (int) $event_date_id ) ) ) {
			return true;
		}
		return self::has_open_date_findings( $event_date_id );
	}

	/**
	 * What today's Statistics adds to a generated occurrence for whole-series
	 * passes on its master, per currency. After stage 5 the pass revenue is
	 * counted once on the master and shown separately here (§7.2).
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array<string, float>
	 */
	private static function series_pass_revenue( $event_date_id ) {
		global $wpdb;

		$occurrence = EventDates::get_by_id( (int) $event_date_id );
		if ( ! $occurrence || 'generated' !== $occurrence->occurrence_type || empty( $occurrence->master_id ) || ! PaymentHistoryCompatibility::payment_information_available() ) {
			return array();
		}

		$cutoff = EventTiming::series_pass_cutoff( $occurrence->get_timing() );
		$rows   = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT l.transaction_id, l.kind, t.amount, t.currency FROM %i AS l
				INNER JOIN %i AS ep ON ep.id = l.event_participant_id
				INNER JOIN %i AS tt ON tt.id = ep.ticket_type_id
				INNER JOIN %i AS t ON t.id = l.transaction_id
				WHERE ep.event_date_id = %d AND ep.label = 'signed_up' AND tt.recurrence_scope = 'whole_series' AND t.status = 'paid'
				AND ep.created_at <= %s
				AND NOT EXISTS ( SELECT 1 FROM %i AS own WHERE own.event_date_id = %d AND own.participant_id = ep.participant_id AND own.label = 'signed_up' )
				GROUP BY l.transaction_id, l.kind, t.amount, t.currency",
				$wpdb->prefix . 'fair_audience_event_participant_transactions',
				$wpdb->prefix . 'fair_audience_event_participants',
				$wpdb->prefix . 'fair_events_ticket_types',
				\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
				(int) $occurrence->master_id,
				$cutoff ? get_gmt_from_date( $cutoff ) : '9999-12-31 23:59:59',
				$wpdb->prefix . 'fair_audience_event_participants',
				(int) $event_date_id
			),
			ARRAY_A
		);

		$totals = array();
		foreach ( $rows as $row ) {
			$currency            = strtoupper( (string) $row['currency'] );
			$totals[ $currency ] = ( $totals[ $currency ] ?? 0 ) + self::cents( $row['amount'] ) * ( 'refund' === $row['kind'] ? -1 : 1 );
		}
		return array_map(
			static function ( $cents ) {
				return self::amount( $cents );
			},
			$totals
		);
	}

	/**
	 * Checks over the whole history after every date was compared (§8.4).
	 * Records the informational findings they produce and returns what
	 * blocks verification.
	 *
	 * @param int $transaction_cutoff Highest transaction ID the backfill covers.
	 * @return array<string, mixed> Blocker code => detail; empty when clean.
	 */
	public static function global_checks( $transaction_cutoff ) {
		global $wpdb;

		$blockers = array();
		$mode     = PaymentHistoryFinding::MODE_BACKFILL;
		$links    = SignupPaymentLink::table();

		$blocking_dates = (array) $wpdb->get_col( $wpdb->prepare( 'SELECT event_date_id FROM %i WHERE blocking = 1 ORDER BY event_date_id LIMIT 100', self::table() ) );
		if ( $blocking_dates ) {
			$blockers['unexpected_differences'] = array_map( 'intval', $blocking_dates );
		}

		$outstanding = \FairEvents\Models\PaymentShadowWork::count_outstanding();
		if ( $outstanding ) {
			$blockers['shadow_work_outstanding'] = $outstanding;
		}

		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			$blockers['payment_information_unavailable'] = true;
			return $blockers;
		}
		$transactions = \FairPaymentsConnector\Database\Schema::get_payments_table_name();

		// Links naming a transaction Connector no longer has (gap G8).
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT lk.id, lk.signup_id, lk.transaction_id FROM %i AS lk LEFT JOIN %i AS t ON t.id = lk.transaction_id WHERE t.id IS NULL', $links, $transactions ),
			ARRAY_A
		) as $row ) {
			$signup_date = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT event_date_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_signups', (int) $row['signup_id'] ) );
			PaymentHistoryFinding::record( $mode, 'missing_transaction', PaymentHistoryFinding::SOURCE_LINK, (int) $row['id'], $signup_date, $row );
		}

		// Links whose currency no longer matches their transaction's.
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT lk.id, lk.signup_id, lk.transaction_id, lk.currency AS link_currency, t.currency AS transaction_currency
				FROM %i AS lk INNER JOIN %i AS t ON t.id = lk.transaction_id WHERE UPPER(lk.currency) <> UPPER(t.currency)',
				$links,
				$transactions
			),
			ARRAY_A
		) as $row ) {
			PaymentHistoryFinding::record( $mode, 'currency_mismatch', PaymentHistoryFinding::SOURCE_TRANSACTION, (int) $row['transaction_id'], null, $row );
		}

		// More than one paid attempt for one purchase and role (§5.5).
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT lk.signup_id, lk.role, GROUP_CONCAT(lk.transaction_id ORDER BY lk.transaction_id) AS transaction_ids, s.event_date_id
				FROM %i AS lk INNER JOIN %i AS t ON t.id = lk.transaction_id INNER JOIN %i AS s ON s.id = lk.signup_id
				WHERE t.status = 'paid' AND lk.role IN ( %s, %s )
				GROUP BY lk.signup_id, lk.role, s.event_date_id HAVING COUNT(*) > 1",
				$links,
				$transactions,
				$wpdb->prefix . 'fair_events_signups',
				SignupPaymentLink::ROLE_CHARGE,
				SignupPaymentLink::ROLE_UPGRADE
			),
			ARRAY_A
		) as $row ) {
			PaymentHistoryFinding::record(
				$mode,
				'multiple_paid_attempts',
				PaymentHistoryFinding::SOURCE_SIGNUP,
				(int) $row['signup_id'],
				(int) $row['event_date_id'],
				array(
					'role'            => (string) $row['role'],
					'transaction_ids' => array_map( 'intval', explode( ',', (string) $row['transaction_ids'] ) ),
				)
			);
		}

		// No transaction is allocated beyond its total (§5.1).
		$over = (array) $wpdb->get_col(
			$wpdb->prepare(
				'SELECT lk.transaction_id FROM %i AS lk INNER JOIN %i AS t ON t.id = lk.transaction_id
				GROUP BY lk.transaction_id, t.amount HAVING SUM(lk.allocated_amount) > t.amount + 0.004 LIMIT 100',
				$links,
				$transactions
			)
		);
		if ( $over ) {
			$blockers['allocation_exceeds_total'] = array_map( 'intval', $over );
		}

		// No paid event payment is linked to nothing and missing from the
		// unresolved list (or decided by an administrator). Event payments are the recognised sources and
		// anything the ledger names; participant fees are out of scope.
		$ledger_clause = ShadowPurchases::audience_tables_exist()
			? $wpdb->prepare( ' OR EXISTS ( SELECT 1 FROM %i AS l WHERE l.transaction_id = t.id )', $wpdb->prefix . 'fair_audience_event_participant_transactions' )
			: '';
		$unlisted      = (array) $wpdb->get_col(
			$wpdb->prepare(
				"SELECT t.id FROM %i AS t
				WHERE t.id <= %d AND t.status = 'paid'
				AND ( t.metadata LIKE %s OR t.metadata LIKE %s{$ledger_clause} )
				AND ( t.metadata IS NULL OR t.metadata NOT LIKE %s )
				AND NOT EXISTS ( SELECT 1 FROM %i AS lk WHERE lk.transaction_id = t.id )
				AND NOT EXISTS ( SELECT 1 FROM %i AS f WHERE f.mode = %s AND f.status IN ( %s, %s, %s ) AND f.source_type = %s AND f.source_id = t.id )
				ORDER BY t.id LIMIT 100",
				$transactions,
				(int) $transaction_cutoff,
				'%' . $wpdb->esc_like( PaymentAttribution::SOURCE_GET_TICKETS ) . '%',
				'%' . $wpdb->esc_like( 'fair-audience-' ) . '%',
				'%' . $wpdb->esc_like( 'fee_payment_id' ) . '%',
				$links,
				PaymentHistoryFinding::table(),
				$mode,
				PaymentHistoryFinding::STATUS_OPEN,
				PaymentHistoryFinding::STATUS_RECONCILED,
				PaymentHistoryFinding::STATUS_REVIEWED,
				PaymentHistoryFinding::SOURCE_TRANSACTION
			)
		);
		if ( $unlisted ) {
			$blockers['unlisted_paid_transactions'] = array_map( 'intval', $unlisted );
		}

		return $blockers;
	}

	/**
	 * Cents as an amount.
	 *
	 * @param int $cents Cents.
	 * @return float
	 */
	private static function amount( $cents ) {
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
