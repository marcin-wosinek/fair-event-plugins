<?php
/**
 * Seed synthetic payment history and drive the payment history backfill
 * for the PaymentHistoryBackfill and PaymentHistoryReconciliation API
 * coverage (#2139, stage 3 of #2111).
 *
 * Usage: wp eval-file .../payment-history-backfill.php <action> <json>
 *
 * Actions:
 *   seed       {eventId, dateA, dateB, dateC}  Legacy history for the
 *              contract's worked examples 3, 4, 5, 7, 9, 11, 13, 14, 16,
 *              20, 21 and 22, written straight to the tables as older
 *              versions left it (no hook fires). Then raises the shadow
 *              writes' coverage floors to the newest IDs, so the seeded
 *              history is the backfill's, as history before shadow writes
 *              is on a site. Prints every seeded ID.
 *   dry-run    {}  Start a dry run and run it to the end.
 *   start      {backupConfirmed}  Start the backfill.
 *   run        {untilPhase?, batchSize?}  Run batches until the backfill
 *              reaches the phase, or stops running.
 *   rewind     {phase}  Put the backfill back at the start of a phase, as if
 *              the cursor of batches that committed had been lost.
 *   set-label  {relationshipId, label}
 *   state      {relationshipIds, transactionIds, signupIds, eventDateIds}
 *   cleanup    {seed}  Remove what seed created and every trace the runs left.
 *
 * Prints one `E2E_PAYMENT_BACKFILL:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Services\PaymentHistoryBackfill;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryVerification;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$t = array(
	'signups'       => $wpdb->prefix . 'fair_events_signups',
	'tickets'       => $wpdb->prefix . 'fair_events_tickets',
	'activities'    => $wpdb->prefix . 'fair_events_ticket_activities',
	'links'         => $wpdb->prefix . 'fair_events_signup_payment_links',
	'participants'  => $wpdb->prefix . 'fair_audience_participants',
	'relationships' => $wpdb->prefix . 'fair_audience_event_participants',
	'options'       => $wpdb->prefix . 'fair_audience_event_participant_options',
	'ledger'        => $wpdb->prefix . 'fair_audience_event_participant_transactions',
	'transactions'  => \FairPaymentsConnector\Database\Schema::get_payments_table_name(),
	'line_items'    => \FairPaymentsConnector\Database\Schema::get_line_items_table_name(),
);

$result = array();

switch ( $fixture_action ) {
	case 'seed':
		$event_id = (int) $data['eventId'];
		$dates    = array(
			'A' => (int) $data['dateA'],
			'B' => (int) $data['dateB'],
			'C' => (int) $data['dateC'],
		);
		$seed     = array(
			'participants'  => array(),
			'relationships' => array(),
			'transactions'  => array(),
			'signups'       => array(),
			'ledger'        => array(),
		);

		$participant  = static function ( $key ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['participants'],
				array(
					'name'    => 'Backfill',
					'surname' => $key,
					'email'   => 'backfill-' . strtolower( $key ) . '-' . wp_generate_password( 8, false ) . '@example.test',
					'status'  => 'confirmed',
				)
			);
			$seed['participants'][ $key ] = (int) $wpdb->insert_id;
			return $seed['participants'][ $key ];
		};
		$relationship = static function ( $key, $participant_id, $date, $label, $extra = array() ) use ( $wpdb, $t, $event_id, &$seed ) {
			$wpdb->insert(
				$t['relationships'],
				array_merge(
					array(
						'event_id'       => $event_id,
						'event_date_id'  => $date,
						'participant_id' => $participant_id,
						'label'          => $label,
						'created_at'     => '2024-03-01 10:00:00',
					),
					$extra
				)
			);
			$seed['relationships'][ $key ] = (int) $wpdb->insert_id;
			return $seed['relationships'][ $key ];
		};
		$transaction  = static function ( $key, $amount, $status, array $metadata, array $lines = array() ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['transactions'],
				array(
					'mollie_payment_id' => 'tr_e2e_backfill_' . strtolower( $key ),
					'event_date_id'     => (int) ( $metadata['event_date_id'] ?? 0 ),
					'amount'            => $amount,
					'currency'          => 'EUR',
					'status'            => $status,
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
		$ledger       = static function ( $relationship_id, $transaction_id, $kind = 'charge' ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['ledger'],
				array(
					'event_participant_id' => $relationship_id,
					'transaction_id'       => $transaction_id,
					'kind'                 => $kind,
				)
			);
			$seed['ledger'][] = (int) $wpdb->insert_id;
		};
		$signup       = static function ( $key, $date, $participant_id, $amount, $quantity = 1, $transaction_id = null ) use ( $wpdb, $t, &$seed ) {
			$wpdb->insert(
				$t['signups'],
				array(
					'event_date_id'  => $date,
					'name'           => 'Backfill ' . $key,
					'email'          => 'backfill-' . strtolower( $key ) . '@example.test',
					'quantity'       => $quantity,
					'amount'         => $amount,
					'status'         => 'confirmed',
					'participant_id' => $participant_id,
					'transaction_id' => $transaction_id,
					'created_at'     => '2024-03-01 11:00:00',
				)
			);
			$id = (int) $wpdb->insert_id;
			\FairEvents\Models\EventTicket::reconcile_signup( \FairEvents\Models\EventSignup::get_by_id( $id ) );
			$seed['signups'][ $key ] = $id;
			return $id;
		};
		$option       = static function ( $relationship_id, $option_id ) use ( $wpdb, $t ) {
			$wpdb->insert(
				$t['options'],
				array(
					'event_participant_id' => $relationship_id,
					'ticket_option_id'     => $option_id,
					'ticket_option_name'   => 'Workshop ' . $option_id,
					'status'               => 'confirmed',
				)
			);
		};

		// Example 3: a legacy Audience purchase, with an activity and a check-in.
		$r3 = $relationship( 'R3', $participant( 'P3' ), $dates['A'], 'signed_up', array( 'attended_at' => '2024-03-02 18:00:00' ) );
		$option( $r3, 910001 );
		$ledger(
			$r3,
			$transaction(
				'T2',
				'20.00',
				'paid',
				array(
					'source'               => 'fair-audience-signup',
					'event_participant_id' => $r3,
					'event_date_id'        => $dates['A'],
				)
			)
		);

		// Example 4: added by an organizer, no payment.
		$relationship( 'R4', $participant( 'P4' ), $dates['A'], 'signed_up' );

		// Example 5: interest and a collaborator are never admissions.
		$relationship( 'R5a', $participant( 'P5a' ), $dates['A'], 'interested' );
		$relationship( 'R5b', $participant( 'P5b' ), $dates['A'], 'collaborator' );

		// Example 7: a shared get-tickets purchase across three dates.
		$p7 = $participant( 'P7' );
		$s7 = array(
			$signup( 'S7A', $dates['A'], $p7, '12.00' ),
			$signup( 'S7B', $dates['B'], $p7, '12.00' ),
			$signup( 'S7C', $dates['C'], $p7, '12.00' ),
		);
		$t3 = $transaction(
			'T3',
			'36.00',
			'paid',
			array(
				'source'        => 'fair-events-get-tickets',
				'signup_ids'    => $s7,
				'event_date_id' => $dates['A'],
			),
			array( '12.00', '12.00', '12.00' )
		);
		foreach ( array( 'A', 'B', 'C' ) as $letter ) {
			$wpdb->update( $t['signups'], array( 'transaction_id' => $t3 ), array( 'id' => $seed['signups'][ 'S7' . $letter ] ) );
			$ledger( $relationship( 'R7' . $letter, $p7, $dates[ $letter ], 'signed_up' ), $t3 );
		}

		// Example 9: a failed-looking attempt later paid, and its paid retry.
		$p9 = $participant( 'P9' );
		$s9 = $signup( 'S9', $dates['B'], $p9, '30.00' );
		$t4 = $transaction(
			'T4',
			'30.00',
			'paid',
			array(
				'source'        => 'fair-events-get-tickets',
				'signup_ids'    => array( $s9 ),
				'event_date_id' => $dates['B'],
			)
		);
		$t5 = $transaction(
			'T5',
			'30.00',
			'paid',
			array(
				'source'                  => 'fair-events-get-tickets',
				'signup_ids'              => array( $s9 ),
				'retry_of_transaction_id' => $t4,
				'event_date_id'           => $dates['B'],
			)
		);
		$wpdb->update( $t['signups'], array( 'transaction_id' => $t5 ), array( 'id' => $s9 ) );
		$r9 = $relationship( 'R9', $p9, $dates['B'], 'signed_up' );
		$ledger( $r9, $t4 );
		$ledger( $r9, $t5 );

		// Example 11: an add-on without a ticket, two active purchases.
		$p11 = $participant( 'P11' );
		$signup( 'S11a', $dates['C'], $p11, '0.00' );
		$signup( 'S11b', $dates['C'], $p11, '0.00' );
		$r11 = $relationship( 'R11', $p11, $dates['C'], 'signed_up' );
		$ledger(
			$r11,
			$transaction(
				'T7',
				'8.00',
				'paid',
				array(
					'source'               => 'fair-audience-activity-addon',
					'event_participant_id' => $r11,
					'ticket_id'            => null,
					'event_date_id'        => $dates['C'],
				)
			)
		);

		// Example 13: a participant-scope activity, two tickets held.
		$p13 = $participant( 'P13' );
		$signup( 'S13', $dates['C'], $p13, '0.00', 2 );
		$option( $relationship( 'R13', $p13, $dates['C'], 'signed_up' ), 910013 );

		// Example 14: get-tickets naming a purchase that no longer exists.
		$transaction(
			'T10',
			'15.00',
			'paid',
			array(
				'source'        => 'fair-events-get-tickets',
				'signup_id'     => 999999999,
				'event_date_id' => $dates['A'],
			)
		);

		// Example 16: a ledger row naming a deleted transaction.
		$t11 = $transaction( 'T11', '10.00', 'paid', array( 'source' => 'fair-audience-signup' ) );
		$wpdb->delete( $t['transactions'], array( 'id' => $t11 ) );
		$wpdb->delete( $t['line_items'], array( 'transaction_id' => $t11 ) );
		$ledger( $relationship( 'R16', $participant( 'P16' ), $dates['B'], 'signed_up' ), $t11 );

		// Examples 20 and 21: Audience multi-instance, split and unsplittable.
		$p20  = $participant( 'P20' );
		$r20a = $relationship( 'R20A', $p20, $dates['A'], 'signed_up' );
		$r20b = $relationship( 'R20B', $p20, $dates['B'], 'signed_up' );
		$t13  = $transaction(
			'T13',
			'24.00',
			'paid',
			array(
				'source'                => 'fair-audience-signup',
				'event_participant_ids' => array( $r20a, $r20b ),
				'event_date_id'         => $dates['A'],
			),
			array( '12.00', '12.00' )
		);
		$ledger( $r20a, $t13 );
		$ledger( $r20b, $t13 );

		$p21  = $participant( 'P21' );
		$r21a = $relationship( 'R21A', $p21, $dates['A'], 'signed_up' );
		$r21b = $relationship( 'R21B', $p21, $dates['B'], 'signed_up' );
		$t13b = $transaction(
			'T13b',
			'24.00',
			'paid',
			array(
				'source'                => 'fair-audience-signup',
				'event_participant_ids' => array( $r21a, $r21b ),
				'event_date_id'         => $dates['A'],
			),
			array( '24.00' )
		);
		$ledger( $r21a, $t13b );
		$ledger( $r21b, $t13b );

		// Example 22: a refund-labelled ledger row.
		$r22 = $relationship( 'R22', $participant( 'P22' ), $dates['C'], 'signed_up' );
		$t14 = $transaction(
			'T14',
			'20.00',
			'paid',
			array(
				'source'               => 'fair-audience-signup',
				'event_participant_id' => $r22,
				'event_date_id'        => $dates['C'],
			)
		);
		$ledger( $r22, $t14 );
		$ledger( $r22, $t14, 'refund' );

		// A checkout still pending when the backfill passes; signed up later.
		$relationship( 'R23', $participant( 'P23' ), $dates['A'], 'pending_payment', array( 'payment_expires_at' => '2024-03-01 10:15:00' ) );

		// The seeded history predates shadow writes.
		$state                       = PaymentHistoryCompatibility::get_state();
		$seed['originalCoverage']    = $state['shadow_writes'] ?? null;
		$state['shadow_writes']      = array(
			'enabled_at'         => $state['shadow_writes']['enabled_at'] ?? gmdate( 'Y-m-d H:i:s' ),
			'transaction_floor'  => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM %i', $t['transactions'] ) ),
			'relationship_floor' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM %i', $t['relationships'] ) ),
		);
		$seed['transactions']['T11'] = $t11;
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );

		$result = $seed + array( 'blockers' => PaymentHistoryCompatibility::backfill_blockers() );
		break;

	case 'dry-run':
		$started = PaymentHistoryBackfill::start_dry_run();
		// This script runs the batches; page loads must not run them too.
		wp_clear_scheduled_hook( PaymentHistoryBackfill::CRON_HOOK );
		$result = is_wp_error( $started )
			? array( 'error' => $started->get_error_code() )
			: array( 'run' => PaymentHistoryBackfill::run_until_idle( 1000, 50 ) );
		break;

	case 'start':
		$started = PaymentHistoryBackfill::start( array( 'backup_confirmed' => ! empty( $data['backupConfirmed'] ) ) );
		wp_clear_scheduled_hook( PaymentHistoryBackfill::CRON_HOOK );
		$result = is_wp_error( $started ) ? array( 'error' => $started->get_error_code() ) : array( 'run' => $started );
		break;

	case 'run':
		$until = (string) ( $data['untilPhase'] ?? '' );
		$run   = PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL );
		for ( $i = 0; $i < 1000; $i++ ) {
			if ( ! $run || 'running' !== $run['status'] || ( $until && $until === $run['phase'] ) ) {
				break;
			}
			wp_clear_scheduled_hook( PaymentHistoryBackfill::CRON_HOOK );
			$advanced = PaymentHistoryBackfill::run_batch( (int) ( $data['batchSize'] ?? 50 ) );
			if ( ! $advanced ) {
				// A batch started elsewhere holds the lock; wait for it.
				usleep( 200000 );
			} elseif ( ! empty( $advanced['last_error'] ) ) {
				break;
			}
			$run = PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL );
		}
		$result = array( 'run' => PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL ) );
		break;

	case 'rewind':
		$state                       = PaymentHistoryCompatibility::get_state();
		$state['backfill']['phase']  = (string) $data['phase'];
		$state['backfill']['cursor'] = 0;
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		$result = array( 'run' => $state['backfill'] );
		break;

	case 'set-label':
		$wpdb->update( $t['relationships'], array( 'label' => (string) $data['label'] ), array( 'id' => (int) $data['relationshipId'] ) );
		$result = array( 'ok' => true );
		break;

	case 'state':
		$result = array(
			'purchases'   => array(),
			'links'       => array(),
			'findings'    => array(),
			'comparisons' => array(),
			'status'      => PaymentHistoryBackfill::status(),
		);
		foreach ( array_map( 'intval', (array) ( $data['relationshipIds'] ?? array() ) ) as $relationship_id ) {
			$purchases = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, event_date_id, status, amount, quantity, participant_id, name, created_at, transaction_id FROM %i WHERE legacy_event_participant_id = %d', $t['signups'], $relationship_id ), ARRAY_A );
			foreach ( $purchases as &$purchase ) {
				$purchase['units'] = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, status, holder_participant_id, attended_at FROM %i WHERE signup_id = %d', $t['tickets'], (int) $purchase['id'] ), ARRAY_A );
				foreach ( $purchase['units'] as &$unit ) {
					$unit['activities'] = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT ticket_option_id, status FROM %i WHERE ticket_id = %d', $t['activities'], (int) $unit['id'] ), ARRAY_A );
				}
				unset( $unit );
			}
			unset( $purchase );
			$result['purchases'][ $relationship_id ] = $purchases;
		}
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$result['links'][ $transaction_id ] = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT id, signup_id, role, allocated_amount, attribution FROM %i WHERE transaction_id = %d ORDER BY signup_id, role', $t['links'], $transaction_id ),
				ARRAY_A
			);
		}
		$sources = array(
			PaymentHistoryFinding::SOURCE_TRANSACTION  => (array) ( $data['transactionIds'] ?? array() ),
			PaymentHistoryFinding::SOURCE_RELATIONSHIP => (array) ( $data['relationshipIds'] ?? array() ),
			PaymentHistoryFinding::SOURCE_SIGNUP       => (array) ( $data['signupIds'] ?? array() ),
			PaymentHistoryFinding::SOURCE_LEDGER_ROW   => (array) ( $data['ledgerIds'] ?? array() ),
		);
		foreach ( array( PaymentHistoryFinding::MODE_DRY_RUN, PaymentHistoryFinding::MODE_BACKFILL ) as $finding_mode ) {
			$result['findings'][ $finding_mode ] = array();
			foreach ( $sources as $source_type => $ids ) {
				foreach ( array_map( 'intval', $ids ) as $source_id ) {
					foreach ( PaymentHistoryFinding::query(
						$finding_mode,
						array(
							'source_type' => $source_type,
							'source_id'   => $source_id,
						)
					) as $finding ) {
						$result['findings'][ $finding_mode ][] = array(
							'reason'      => $finding['reason'],
							'source_type' => $finding['source_type'],
							'source_id'   => $finding['source_id'],
							'status'      => $finding['status'],
						);
					}
				}
			}
		}
		foreach ( array_map( 'intval', (array) ( $data['eventDateIds'] ?? array() ) ) as $event_date_id ) {
			$rows                                    = PaymentHistoryVerification::get_comparisons( array( 'event_date_id' => $event_date_id ) );
			$result['comparisons'][ $event_date_id ] = $rows ? $rows[0] : null;
		}
		break;

	case 'cleanup':
		$seed = (array) ( $data['seed'] ?? array() );
		foreach ( (array) ( $seed['relationships'] ?? array() ) as $relationship_id ) {
			$signup_ids = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_event_participant_id = %d', $t['signups'], (int) $relationship_id ) ) );
			foreach ( $signup_ids as $signup_id ) {
				$seed['signups'][] = $signup_id;
			}
			$wpdb->delete( $t['options'], array( 'event_participant_id' => (int) $relationship_id ) );
			$wpdb->delete( $t['ledger'], array( 'event_participant_id' => (int) $relationship_id ) );
			$wpdb->delete( $t['relationships'], array( 'id' => (int) $relationship_id ) );
		}
		foreach ( array_unique( array_map( 'intval', (array) ( $seed['signups'] ?? array() ) ) ) as $signup_id ) {
			$wpdb->delete( $t['links'], array( 'signup_id' => $signup_id ) );
			\FairEvents\Models\EventTicket::delete_by_signup_id( $signup_id );
			$wpdb->delete( $t['signups'], array( 'id' => $signup_id ) );
		}
		foreach ( (array) ( $seed['transactions'] ?? array() ) as $transaction_id ) {
			$wpdb->delete( $t['links'], array( 'transaction_id' => (int) $transaction_id ) );
			$wpdb->delete( $t['line_items'], array( 'transaction_id' => (int) $transaction_id ) );
			$wpdb->delete( $t['transactions'], array( 'id' => (int) $transaction_id ) );
		}
		foreach ( (array) ( $seed['participants'] ?? array() ) as $participant_id ) {
			$wpdb->delete( $t['participants'], array( 'id' => (int) $participant_id ) );
		}

		// The runs' traces: their state, findings, reconciliation audit and the report.
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentHistoryFinding::table() ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', \FairEvents\Models\PaymentHistoryAudit::table() ) );
		PaymentHistoryVerification::clear();
		$state = PaymentHistoryCompatibility::get_state();
		unset( $state['dry_run'], $state['backfill'], $state['status'] );
		if ( ! empty( $seed['originalCoverage'] ) ) {
			$state['shadow_writes'] = $seed['originalCoverage'];
		}
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		wp_clear_scheduled_hook( PaymentHistoryBackfill::CRON_HOOK );
		$result = array( 'ok' => true );
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_PAYMENT_BACKFILL:' . wp_json_encode( $result ) . "\n";
