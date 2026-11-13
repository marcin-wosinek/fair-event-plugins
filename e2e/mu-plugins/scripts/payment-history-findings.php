<?php
/**
 * Seed synthetic payment history findings for the Payment history
 * reconciliation API and E2E coverage (#2139, #2252).
 *
 * The one-time migration that used to report these records is gone, so the
 * records it left behind are written directly: Connector payments, Fair
 * Events purchases, one migrated payment link and the findings an
 * administrator reconciles. No Fair Audience table is involved.
 *
 * Usage: wp eval-file .../payment-history-findings.php <action> <json>
 *
 * Actions:
 *   seed             {dateA, dateB, dateC}  Prints every seeded ID:
 *                    - T2, a paid 20.00 payment already linked to purchase
 *                      S3 by the migration (attribution `backfill`);
 *                    - T7, an 8.00 add-on charge (ambiguous_activity_charge,
 *                      also reported by a dry run: dryRunFinding) for one of P11's two
 *                      purchases S11a and S11b on date C;
 *                    - T10, a 15.00 payment naming a purchase that no
 *                      longer exists (no_evidence, date A);
 *                    - T13b, a 24.00 payment recorded as one line for the
 *                      purchases S21A (date A) and S21B (date B), migrated
 *                      from the registrations it names (allocation_mismatch);
 *                    - S9, a purchase paid twice by T4 and T5
 *                      (multiple_paid_attempts, informational);
 *                    - a registration record without a payment
 *                      (duplicate_series_relationship) and a payment record
 *                      naming a deleted payment T11 (missing_transaction).
 *   set-transactions {transactions: {id: {status?, testmode?}}}  Returns
 *                    what they were, so a spec can put them back.
 *   state            {transactionIds}  Links per payment.
 *   cleanup          {seed}  Remove what seed created and every audit
 *                    record about it.
 *
 * Prints one `E2E_PAYMENT_FINDINGS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\SignupPaymentLink;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$t = array(
	'signups'      => $wpdb->prefix . 'fair_events_signups',
	'links'        => SignupPaymentLink::table(),
	'findings'     => PaymentHistoryFinding::table(),
	'audit'        => PaymentHistoryAudit::table(),
	'transactions' => \FairPaymentsConnector\Database\Schema::get_payments_table_name(),
	'line_items'   => \FairPaymentsConnector\Database\Schema::get_line_items_table_name(),
);

$result = array();

switch ( $fixture_action ) {
	case 'seed':
		$dates = array(
			'A' => (int) $data['dateA'],
			'B' => (int) $data['dateB'],
			'C' => (int) $data['dateC'],
		);
		// Registration and payment record numbers from a Fair Audience that
		// is no longer read; unique per run so findings never collide.
		$legacy = 900000000 + wp_rand( 0, 9999999 ) * 10;
		$seed   = array(
			'transactions' => array(),
			'signups'      => array(),
			'findings'     => array(),
			'legacy'       => array(
				'R21A' => $legacy + 1,
				'R21B' => $legacy + 2,
				'R4'   => $legacy + 3,
				'L16'  => $legacy + 4,
			),
		);

		$transaction = static function ( $key, $amount, array $metadata, array $lines = array() ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['transactions'],
				array(
					'mollie_payment_id' => 'tr_e2e_findings_' . strtolower( $key ) . '_' . wp_generate_password( 6, false ),
					'event_date_id'     => (int) ( $metadata['event_date_id'] ?? 0 ),
					'amount'            => $amount,
					'currency'          => 'EUR',
					'status'            => 'paid',
					'metadata'          => wp_json_encode( $metadata ),
					'created_at'        => '2024-03-01 10:05:00',
				)
			);
			$id = (int) $wpdb->insert_id;
			foreach ( ( $lines ? $lines : array( $amount ) ) as $position => $line ) {
				$wpdb->insert(
					$t['line_items'],
					array(
						'transaction_id' => $id,
						'name'           => 'Ticket',
						'quantity'       => 1,
						'unit_amount'    => $line,
						'total_amount'   => $line,
						'sort_order'     => $position,
					)
				);
			}
			$seed['transactions'][ $key ] = $id;
			return $id;
		};
		$signup      = static function ( $key, $date, $amount, $extra = array() ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['signups'],
				array_merge(
					array(
						'event_date_id' => $date,
						'name'          => 'Findings ' . $key,
						'email'         => 'findings-' . strtolower( $key ) . '-' . wp_generate_password( 6, false ) . '@example.test',
						'quantity'      => 1,
						'amount'        => $amount,
						'status'        => 'confirmed',
						'created_at'    => '2024-03-01 11:00:00',
					),
					$extra
				)
			);
			$id = (int) $wpdb->insert_id;
			\FairEvents\Models\EventTicket::reconcile_signup( \FairEvents\Models\EventSignup::get_by_id( $id ) );
			$seed['signups'][ $key ] = $id;
			return $id;
		};
		$finding     = static function ( $mode, $reason, $source_type, $source_id, $date, array $detail = array() ) use ( $wpdb, $t, &$seed ) {
			PaymentHistoryFinding::record( $mode, $reason, $source_type, $source_id, $date, $detail );
			$seed['findings'][] = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE mode = %s AND reason = %s AND source_type = %s AND source_id = %d',
					$t['findings'],
					$mode,
					$reason,
					$source_type,
					$source_id
				)
			);
			return end( $seed['findings'] );
		};
		$summary     = static function ( $amount, $source ) {
			return array(
				'amount'   => (float) $amount,
				'currency' => 'EUR',
				'status'   => 'paid',
				'source'   => $source,
			);
		};

		// A purchase the migration linked to its payment.
		$s3 = $signup( 'S3', $dates['A'], '20.00' );
		$t2 = $transaction(
			'T2',
			'20.00',
			array(
				'source'        => 'fair-audience-signup',
				'event_date_id' => $dates['A'],
			)
		);
		$wpdb->update( $t['signups'], array( 'transaction_id' => $t2 ), array( 'id' => $s3 ) );
		SignupPaymentLink::insert(
			array(
				'signup_id'        => $s3,
				'transaction_id'   => $t2,
				'role'             => SignupPaymentLink::ROLE_CHARGE,
				'allocated_amount' => 20,
				'currency'         => 'EUR',
				'attribution'      => SignupPaymentLink::ATTRIBUTION_BACKFILL,
				'evidence'         => wp_json_encode( array( 'fixture' => 'payment-history-findings' ) ),
				'created_at'       => '2024-03-01 10:05:00',
			)
		);

		// An add-on charge for one of two purchases of the same participant.
		$signup( 'S11a', $dates['C'], '0.00' );
		$signup( 'S11b', $dates['C'], '0.00' );
		$t7 = $transaction(
			'T7',
			'8.00',
			array(
				'source'        => 'fair-audience-activity-addon',
				'ticket_id'     => null,
				'event_date_id' => $dates['C'],
			)
		);
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'ambiguous_activity_charge', PaymentHistoryFinding::SOURCE_TRANSACTION, $t7, $dates['C'], $summary( 8, 'fair-audience-activity-addon' ) );
		// Left by a retired dry run: not listed, never reconcilable.
		$seed['dryRunFinding'] = $finding( PaymentHistoryFinding::MODE_DRY_RUN, 'ambiguous_activity_charge', PaymentHistoryFinding::SOURCE_TRANSACTION, $t7, $dates['C'], $summary( 8, 'fair-audience-activity-addon' ) );

		// A payment naming a purchase that no longer exists.
		$t10 = $transaction(
			'T10',
			'15.00',
			array(
				'source'        => 'fair-events-get-tickets',
				'signup_id'     => 999999999,
				'event_date_id' => $dates['A'],
			)
		);
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'no_evidence', PaymentHistoryFinding::SOURCE_TRANSACTION, $t10, $dates['A'], $summary( 15, 'fair-events-get-tickets' ) );

		// One line for two sessions: the amounts can't be split from it.
		$signup( 'S21A', $dates['A'], '12.00', array( 'legacy_event_participant_id' => $seed['legacy']['R21A'] ) );
		$signup( 'S21B', $dates['B'], '12.00', array( 'legacy_event_participant_id' => $seed['legacy']['R21B'] ) );
		$t13b = $transaction(
			'T13b',
			'24.00',
			array(
				'source'                => 'fair-audience-signup',
				'event_participant_ids' => array( $seed['legacy']['R21A'], $seed['legacy']['R21B'] ),
				'event_date_id'         => $dates['A'],
			),
			array( '24.00' )
		);
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'allocation_mismatch', PaymentHistoryFinding::SOURCE_TRANSACTION, $t13b, $dates['A'], $summary( 24, 'fair-audience-signup' ) );

		// A purchase paid twice: reported for review only.
		$s9 = $signup( 'S9', $dates['B'], '30.00' );
		$t4 = $transaction(
			'T4',
			'30.00',
			array(
				'source'        => 'fair-events-get-tickets',
				'signup_ids'    => array( $s9 ),
				'event_date_id' => $dates['B'],
			)
		);
		$t5 = $transaction(
			'T5',
			'30.00',
			array(
				'source'                  => 'fair-events-get-tickets',
				'signup_ids'              => array( $s9 ),
				'retry_of_transaction_id' => $t4,
				'event_date_id'           => $dates['B'],
			)
		);
		$wpdb->update( $t['signups'], array( 'transaction_id' => $t5 ), array( 'id' => $s9 ) );
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'multiple_paid_attempts', PaymentHistoryFinding::SOURCE_SIGNUP, $s9, $dates['B'], array( 'transaction_ids' => array( $t4, $t5 ) ) );

		// A registration record without a payment.
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'duplicate_series_relationship', PaymentHistoryFinding::SOURCE_RELATIONSHIP, $seed['legacy']['R4'], $dates['A'] );

		// A payment record naming a payment that was deleted.
		$t11 = $transaction( 'T11', '10.00', array( 'source' => 'fair-audience-signup' ) );
		$wpdb->delete( $t['transactions'], array( 'id' => $t11 ) );
		$wpdb->delete( $t['line_items'], array( 'transaction_id' => $t11 ) );
		$finding( PaymentHistoryFinding::MODE_BACKFILL, 'missing_transaction', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $seed['legacy']['L16'], $dates['B'], array( 'transaction_id' => $t11 ) );

		$result = $seed;
		break;

	case 'set-transactions':
		$result = array( 'previous' => array() );
		foreach ( (array) ( $data['transactions'] ?? array() ) as $transaction_id => $changes ) {
			$result['previous'][ $transaction_id ] = $wpdb->get_row( $wpdb->prepare( 'SELECT status, testmode FROM %i WHERE id = %d', $t['transactions'], (int) $transaction_id ), ARRAY_A );
			$wpdb->update( $t['transactions'], array_intersect_key( (array) $changes, array_flip( array( 'status', 'testmode' ) ) ), array( 'id' => (int) $transaction_id ) );
		}
		break;

	case 'state':
		$result = array( 'links' => array() );
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$result['links'][ $transaction_id ] = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT id, signup_id, role, allocated_amount, attribution FROM %i WHERE transaction_id = %d ORDER BY signup_id, role', $t['links'], $transaction_id ),
				ARRAY_A
			);
		}
		break;

	case 'cleanup':
		$seed         = (array) ( $data['seed'] ?? array() );
		$transactions = array_map( 'intval', (array) ( $seed['transactions'] ?? array() ) );
		$findings     = array_filter( array_map( 'intval', (array) ( $seed['findings'] ?? array() ) ) );
		foreach ( $findings as $finding_id ) {
			$wpdb->delete( $t['audit'], array( 'finding_id' => $finding_id ) );
			$wpdb->delete( $t['findings'], array( 'id' => $finding_id ) );
		}
		foreach ( array_map( 'intval', (array) ( $seed['signups'] ?? array() ) ) as $signup_id ) {
			$wpdb->delete( $t['links'], array( 'signup_id' => $signup_id ) );
			\FairEvents\Models\EventTicket::delete_by_signup_id( $signup_id );
			$wpdb->delete( $t['signups'], array( 'id' => $signup_id ) );
		}
		foreach ( $transactions as $transaction_id ) {
			$wpdb->delete( $t['audit'], array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $t['links'], array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $t['line_items'], array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $t['transactions'], array( 'id' => $transaction_id ) );
		}
		$result = array( 'ok' => true );
		break;

	default:
		WP_CLI::error( 'Unknown action: ' . $fixture_action );
}

WP_CLI::line( 'E2E_PAYMENT_FINDINGS:' . wp_json_encode( $result ) );
