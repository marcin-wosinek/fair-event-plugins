<?php
/**
 * Upgrade states for the supported upgrade path coverage (#2255,
 * PAYMENT_HISTORY_MIGRATION.md §8.17). Run on the `upgrade-path` fresh
 * site (FAIR_E2E_SITE=upgrade-path), never on the shared tests site.
 *
 * Usage: wp eval-file .../payment-upgrade.php <action> <json>
 *
 * Actions:
 *   state       {}  The completion evidence, the stored database versions,
 *                   the staging verification and the intermediate release's
 *                   activation records.
 *   unmigrated  {dbVersion}  Make the site look like an existing one that
 *                   ran the intermediate release without finishing the
 *                   migration: no evidence, no activation, no verification,
 *                   the given stored Fair Events database version.
 *   migrated    {findings?: [{reason, sourceId}],
 *                work?: [{kind, sourceId, status}]}
 *                   Record what the intermediate release records once the
 *                   migration finished (a clean verification, the stage 4
 *                   switch and the stage 5 switch), replacing every finding
 *                   and queued shadow work with the given ones. One call,
 *                   because every WP-CLI run is a request the upgrade check
 *                   decides on.
 *   legacy      {eventId, eventDateId}  Recreate what an upgraded site
 *                   still holds from the migration (#2254): the Fair
 *                   Audience ledger with a charge and a refund row, the
 *                   comparisons table with a row, two dry-run findings and
 *                   three `ledger_row` backfill findings (the refund, a
 *                   reviewed missing payment and a row already gone), plus
 *                   what the cleanup must keep: a relationship, a purchase
 *                   naming it as provenance with a backfill payment link,
 *                   and a paid fee payment. Prints their IDs.
 *   storage     {}  What the cleanup removes and keeps: the tables and
 *                   options still present, the findings by mode, the
 *                   `ledger_row` findings' detail, a checksum of every kept
 *                   table, the audit and the cleanup record.
 *   unmigrated  is also used after the cleanup: it removes the evidence.
 *
 * Writes go to the options and tables directly, so no hook runs. Prints
 * one `E2E_PAYMENT_UPGRADE:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixture DDL for the retired tables.
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryUpgrade;

global $wpdb;

if ( ! defined( 'FAIR_E2E_FRESH_SITES' ) || 'e2efresh_upgrade_' !== $wpdb->prefix ) {
	WP_CLI::error( 'Run payment-upgrade.php on the upgrade-path fresh site only.' );
}

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$raw_option = static function ( $name ) use ( $wpdb ) {
	$value = $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, $name ) );
	return null === $value ? null : maybe_unserialize( $value );
};

$result = array();
switch ( $fixture_action ) {
	case 'state':
		$result = array(
			'evidence'          => $raw_option( PaymentHistoryUpgrade::EVIDENCE_OPTION ),
			'staging'           => $raw_option( PaymentHistoryUpgrade::STAGING_OPTION ),
			'eventsDbVersion'   => $raw_option( 'fair_events_db_version' ),
			'audienceDbVersion' => $raw_option( 'fair_audience_db_version' ),
			'cutover'           => $raw_option( PaymentHistoryCompatibility::CUTOVER_OPTION ),
			'readers'           => $raw_option( PaymentHistoryCompatibility::READERS_OPTION ),
		);
		break;

	case 'unmigrated':
		delete_option( PaymentHistoryUpgrade::EVIDENCE_OPTION );
		delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
		delete_option( PaymentHistoryCompatibility::READERS_OPTION );
		delete_option( PaymentHistoryCompatibility::STATE_OPTION );
		update_option( 'fair_events_db_version', (string) ( $data['dbVersion'] ?? '3.52.0' ) );
		$result = array( 'ok' => true );
		break;

	case 'migrated':
		$checked_at        = gmdate( 'Y-m-d H:i:s', time() - 60 );
		$state             = PaymentHistoryCompatibility::get_state();
		$state['status']   = 'verified';
		$state['backfill'] = array(
			'status'       => 'complete',
			'cutoffs'      => array(
				'transaction_id'  => 0,
				'relationship_id' => 0,
			),
			'verification' => array(
				'status'     => 'verified',
				'checked_at' => $checked_at,
			),
		);
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		update_option(
			PaymentHistoryCompatibility::CUTOVER_OPTION,
			array(
				'activated_at'        => gmdate( 'Y-m-d H:i:s', time() - 3600 ),
				'user_id'             => 1,
				'backup_confirmed_at' => gmdate( 'Y-m-d H:i:s', time() - 3600 ),
				'reference'           => 'backfill-verification:' . $checked_at,
				'audit_id'            => 1,
			),
			true
		);
		update_option(
			PaymentHistoryCompatibility::READERS_OPTION,
			array(
				'activated_at' => gmdate( 'Y-m-d H:i:s', time() - 30 ),
				'reason'       => PaymentHistoryCompatibility::READERS_REASON_VERIFIED,
				'user_id'      => 1,
				'reference'    => 'backfill-verification:' . $checked_at,
				'audit_id'     => 2,
			),
			true
		);
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentHistoryFinding::table() ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentShadowWork::table() ) );
		foreach ( (array) ( $data['findings'] ?? array() ) as $finding ) {
			PaymentHistoryFinding::record(
				PaymentHistoryFinding::MODE_BACKFILL,
				(string) $finding['reason'],
				PaymentHistoryFinding::SOURCE_TRANSACTION,
				(int) $finding['sourceId']
			);
		}
		foreach ( (array) ( $data['work'] ?? array() ) as $work ) {
			if ( PaymentShadowWork::STATUS_PENDING === $work['status'] ) {
				PaymentShadowWork::enqueue_later( (string) $work['kind'], (int) $work['sourceId'], HOUR_IN_SECONDS );
			} else {
				PaymentShadowWork::defer( (string) $work['kind'], (int) $work['sourceId'], (string) $work['status'], 'e2e_fixture' );
			}
		}
		$result = array( 'ok' => true );
		break;

	case 'legacy':
		$ledger      = $wpdb->prefix . 'fair_audience_event_participant_transactions';
		$comparisons = $wpdb->prefix . 'fair_events_payment_history_comparisons';
		$charset     = $wpdb->get_charset_collate();
		// The definitions the intermediate release created them with.
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$ledger} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				event_participant_id BIGINT UNSIGNED NOT NULL,
				transaction_id BIGINT UNSIGNED NOT NULL,
				kind ENUM('charge', 'refund') NOT NULL DEFAULT 'charge',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY  (id),
				UNIQUE KEY idx_participant_tx_kind (event_participant_id, transaction_id, kind)
			) ENGINE=InnoDB {$charset}"
		);
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$comparisons} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				event_date_id BIGINT UNSIGNED NOT NULL,
				admissions TEXT NOT NULL,
				activities TEXT NOT NULL,
				revenue TEXT NOT NULL,
				revenue_state VARCHAR(20) NOT NULL,
				blocking TINYINT(1) NOT NULL DEFAULT 0,
				checked_at DATETIME NOT NULL,
				PRIMARY KEY (id),
				UNIQUE KEY idx_event_date_id (event_date_id)
			) ENGINE=InnoDB {$charset}"
		);

		// A second call starts the ledger and comparisons over.
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', $ledger ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', $comparisons ) );

		$event_id      = (int) ( $data['eventId'] ?? 0 );
		$event_date_id = (int) ( $data['eventDateId'] ?? 0 );
		$now           = gmdate( 'Y-m-d H:i:s' );

		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_participants',
			array(
				'name'  => 'Legacy Buyer',
				'email' => 'legacy-buyer-' . wp_generate_password( 6, false ) . '@example.test',
			)
		);
		$participant_id = (int) $wpdb->insert_id;
		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_event_participants',
			array(
				'event_id'       => $event_id,
				'event_date_id'  => $event_date_id,
				'participant_id' => $participant_id,
				'label'          => 'signed_up',
			)
		);
		$relationship_id = (int) $wpdb->insert_id;

		$wpdb->insert(
			$wpdb->prefix . 'fair_events_signups',
			array(
				'event_date_id'               => $event_date_id,
				'name'                        => 'Legacy Buyer',
				'email'                       => 'legacy-buyer@example.test',
				'quantity'                    => 1,
				'amount'                      => '20.00',
				'status'                      => 'confirmed',
				'legacy_event_participant_id' => $relationship_id,
				'created_at'                  => '2024-03-01 11:00:00',
			)
		);
		$signup_id = (int) $wpdb->insert_id;
		$wpdb->insert(
			$wpdb->prefix . 'fair_events_signup_payment_links',
			array(
				'signup_id'        => $signup_id,
				'transaction_id'   => 7001,
				'role'             => 'initial',
				'allocated_amount' => '20.00',
				'currency'         => 'EUR',
				'attribution'      => 'backfill',
				'evidence'         => '{}',
				'created_at'       => '2024-03-01 11:00:00',
			)
		);

		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_fees',
			array(
				'name'       => 'Legacy fee',
				'group_id'   => 1,
				'amount'     => '10.00',
				'status'     => 'active',
				'created_by' => 1,
			)
		);
		$fee_id = (int) $wpdb->insert_id;
		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_fee_payments',
			array(
				'fee_id'         => $fee_id,
				'participant_id' => $participant_id,
				'amount'         => '10.00',
				'status'         => 'paid',
			)
		);
		$fee_payment_id = (int) $wpdb->insert_id;
		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_fee_payment_transactions',
			array(
				'fee_payment_id' => $fee_payment_id,
				'transaction_id' => 7003,
			)
		);

		$wpdb->insert(
			$ledger,
			array(
				'event_participant_id' => $relationship_id,
				'transaction_id'       => 7001,
				'kind'                 => 'charge',
				'created_at'           => '2024-03-01 11:00:00',
			)
		);
		$charge = (int) $wpdb->insert_id;
		$wpdb->insert(
			$ledger,
			array(
				'event_participant_id' => $relationship_id,
				'transaction_id'       => 7002,
				'kind'                 => 'refund',
				'created_at'           => '2024-03-02 11:00:00',
			)
		);
		$refund = (int) $wpdb->insert_id;
		$wpdb->replace(
			$comparisons,
			array(
				'event_date_id' => $event_date_id,
				'admissions'    => '{}',
				'activities'    => '{}',
				'revenue'       => '{}',
				'revenue_state' => 'available',
				'checked_at'    => $now,
			)
		);

		$state                  = PaymentHistoryCompatibility::get_state();
		$state['shadow_writes'] = array( 'supported' => true );
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );

		$finding_id    = static function ( $mode, $reason, $source_id ) use ( $wpdb ) {
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE mode = %s AND reason = %s AND source_type = %s AND source_id = %d',
					PaymentHistoryFinding::table(),
					$mode,
					$reason,
					PaymentHistoryFinding::SOURCE_LEDGER_ROW,
					$source_id
				)
			);
		};
		$ledger_detail = static function ( $transaction_id, $kind ) use ( $relationship_id ) {
			return array(
				'transaction_id'       => $transaction_id,
				'event_participant_id' => $relationship_id,
				'kind'                 => $kind,
			);
		};
		// Informational: open, but never blocking.
		PaymentHistoryFinding::record( PaymentHistoryFinding::MODE_BACKFILL, 'unsupported_refund_record', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $refund, $event_date_id, $ledger_detail( 7002, 'refund' ) );
		// Blocking, but already decided by an administrator.
		PaymentHistoryFinding::record( PaymentHistoryFinding::MODE_BACKFILL, 'missing_transaction', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $charge, $event_date_id, $ledger_detail( 7001, 'charge' ) );
		$missing = $finding_id( PaymentHistoryFinding::MODE_BACKFILL, 'missing_transaction', $charge );
		PaymentHistoryFinding::transition( array( $missing ), PaymentHistoryFinding::STATUS_OPEN, PaymentHistoryFinding::STATUS_REVIEWED );
		// A ledger row deleted before the cleanup.
		PaymentHistoryFinding::record( PaymentHistoryFinding::MODE_BACKFILL, 'unsupported_refund_record', PaymentHistoryFinding::SOURCE_LEDGER_ROW, 999999, $event_date_id, $ledger_detail( 7004, 'refund' ) );
		foreach ( array( $charge, $refund ) as $ledger_id ) {
			PaymentHistoryFinding::record( PaymentHistoryFinding::MODE_DRY_RUN, 'missing_transaction', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $ledger_id, $event_date_id );
		}

		$result = array(
			'relationshipId' => $relationship_id,
			'signupId'       => $signup_id,
			'ledger'         => array(
				'charge' => $charge,
				'refund' => $refund,
			),
			'findings'       => array(
				'refund'  => $finding_id( PaymentHistoryFinding::MODE_BACKFILL, 'unsupported_refund_record', $refund ),
				'charge'  => $missing,
				'deleted' => $finding_id( PaymentHistoryFinding::MODE_BACKFILL, 'unsupported_refund_record', 999999 ),
			),
		);
		break;

	case 'storage':
		$present = static function ( $table ) use ( $wpdb ) {
			return $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		};
		$kept    = array();
		foreach ( array(
			'fair_events_signups',
			'fair_events_signup_payment_links',
			'fair_events_payment_shadow_work',
			'fair_audience_participants',
			'fair_audience_event_participants',
			'fair_audience_fee_payments',
			'fair_audience_fee_payment_transactions',
		) as $table ) {
			$row            = $wpdb->get_row( $wpdb->prepare( 'CHECKSUM TABLE %i', $wpdb->prefix . $table ), ARRAY_A );
			$kept[ $table ] = array(
				'rows'     => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $wpdb->prefix . $table ) ),
				'checksum' => (string) ( $row['Checksum'] ?? '' ),
			);
		}
		$options = array();
		foreach ( array(
			PaymentHistoryCompatibility::STATE_OPTION,
			PaymentHistoryCompatibility::CUTOVER_OPTION,
			PaymentHistoryCompatibility::READERS_OPTION,
		) as $option ) {
			if ( null !== $raw_option( $option ) ) {
				$options[] = $option;
			}
		}
		$findings = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, mode, reason, status, source_type, source_id, detail FROM %i ORDER BY id', PaymentHistoryFinding::table() ),
			ARRAY_A
		) as $row ) {
			$row['id']        = (int) $row['id'];
			$row['source_id'] = (int) $row['source_id'];
			$row['detail']    = json_decode( (string) $row['detail'], true );
			$findings[]       = $row;
		}
		$result = array(
			'tables'   => array(
				'ledger'      => $present( $wpdb->prefix . 'fair_audience_event_participant_transactions' ),
				'comparisons' => $present( $wpdb->prefix . 'fair_events_payment_history_comparisons' ),
			),
			'options'  => $options,
			'findings' => $findings,
			'kept'     => $kept,
			'audit'    => array_map(
				static function ( $row ) {
					$row['after_state'] = json_decode( (string) $row['after_state'], true );
					return $row;
				},
				(array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, action, reason, user_id, after_state FROM %i ORDER BY id', $wpdb->prefix . 'fair_events_payment_history_audit' ), ARRAY_A )
			),
			'cleanup'  => $raw_option( \FairEvents\Services\PaymentHistoryCleanup::RECORD_OPTION ),
			'evidence' => $raw_option( PaymentHistoryUpgrade::EVIDENCE_OPTION ),
			'staging'  => $raw_option( PaymentHistoryUpgrade::STAGING_OPTION ),
		);
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

WP_CLI::line( 'E2E_PAYMENT_UPGRADE:' . wp_json_encode( $result ) );
