<?php
/**
 * Records behind the event finance summary API coverage (#2398).
 *
 * Usage: wp eval-file .../event-finance-summary.php <action> <json>
 *
 * Actions:
 *   seed     {key, eventDateId, otherDateId}  For the event date:
 *            - 105 paid live payments of €10 with a €0.25 Mollie fee each,
 *              attributed by Connector's event_date_id only (no purchase);
 *            - an open, a failed and a paid test-mode payment, which never count;
 *            - one paid €100 payment shared by three purchases, linked in
 *              the order €30 (other date), €50 (this date), €20 (other
 *              date), with a €1.01 Mollie and €0.07 application fee;
 *            - a paid-out settlement listing the shared payment and an open
 *              one listing the first €10 payment;
 *            - Fair Finance entries: €15 paid personally by Sayli, €40 from
 *              a bank import, €5 without a payment method, €20 of a split
 *              bank import (€4 on the other date), €35 cash income,
 *              €90 unclassified income (a reconciled payout, not a sale) and
 *              a €100 transfer, which never count.
 *   confirm  {key}  Confirm the paid-out settlement's bank receipt in Fair
 *            Finance's reconciliation, as an administrator would.
 *   cleanup  {key}  Remove everything seeded with the key.
 *
 * Rows are written directly, so no lifecycle hook runs. Prints one
 * `E2E_EVENT_FINANCE:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\SignupPaymentLink;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) || empty( $data['key'] ) || ! preg_match( '/^[a-z0-9]+$/', (string) $data['key'] ) ) {
	WP_CLI::error( 'Pass a JSON object with an alphanumeric key.' );
}

$key          = (string) $data['key'];
$prefix       = 'tr_efs' . $key . '_';
$transactions = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
$signups      = $wpdb->prefix . 'fair_events_signups';
$accounts     = \FairPaymentsConnector\Database\Schema::get_settlement_accounts_table_name();
$settlements  = \FairPaymentsConnector\Database\Schema::get_settlements_table_name();
$revisions    = \FairPaymentsConnector\Database\Schema::get_settlement_revisions_table_name();
$items        = \FairPaymentsConnector\Database\Schema::get_settlement_items_table_name();
$entries      = \FairFinance\Database\Schema::get_financial_entries_table_name();
$decisions    = \FairFinance\Database\Schema::reconciliation_table( 'decisions' );
$history      = \FairFinance\Database\Schema::reconciliation_table( 'history' );
$now          = gmdate( 'Y-m-d H:i:s' );
$result       = array();

$insert_transaction = static function ( $suffix, array $fields ) use ( $wpdb, $transactions, $prefix ) {
	$wpdb->insert(
		$transactions,
		$fields + array(
			'mollie_payment_id' => $prefix . $suffix,
			'currency'          => 'EUR',
			'testmode'          => 0,
			'description'       => 'Event finance summary fixture',
			'metadata'          => '',
			'created_at'        => '2026-07-01 10:00:00',
		)
	);
	return (int) $wpdb->insert_id;
};

$insert_settlement = static function ( $status, $reference ) use ( $wpdb, $settlements, $revisions, $items, $key, $now ) {
	$account_id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE label = %s', \FairPaymentsConnector\Database\Schema::get_settlement_accounts_table_name(), 'efs-' . $key ) );
	$wpdb->insert(
		$settlements,
		array(
			'account_id' => $account_id,
			'reference'  => 'efs-' . $key . '-' . $status,
			'currency'   => 'EUR',
			'status'     => $status,
			'created_at' => $now,
			'updated_at' => $now,
		)
	);
	$settlement_id = (int) $wpdb->insert_id;
	$wpdb->insert(
		$revisions,
		array(
			'settlement_id' => $settlement_id,
			'source'        => 'api',
			'status'        => 'published',
			'item_count'    => 1,
			'created_at'    => $now,
			'published_at'  => $now,
		)
	);
	$revision_id = (int) $wpdb->insert_id;
	$wpdb->insert(
		$items,
		array(
			'revision_id'       => $revision_id,
			'identity_key'      => 'payment:' . $reference,
			'item_type'         => 'payment',
			'external_id'       => $reference,
			'payment_reference' => $reference,
			'currency'          => 'EUR',
		)
	);
	$wpdb->update( $settlements, array( 'api_revision_id' => $revision_id ), array( 'id' => $settlement_id ) );
	return $settlement_id;
};

switch ( $fixture_action ) {
	case 'seed':
		$event_date_id = (int) $data['eventDateId'];
		$other_date_id = (int) $data['otherDateId'];

		$direct = array();
		for ( $i = 0; $i < 105; $i++ ) {
			$direct[] = $insert_transaction(
				'd' . $i,
				array(
					'amount'        => 10,
					'mollie_fee'    => 0.25,
					'status'        => 'paid',
					'event_date_id' => $event_date_id,
				)
			);
		}
		foreach ( array(
			'open'   => array( 'open', 0 ),
			'failed' => array( 'failed', 0 ),
			'test'   => array( 'paid', 1 ),
		) as $suffix => $attempt ) {
			$insert_transaction(
				$suffix,
				array(
					'amount'        => 'open' === $suffix ? 500 : 300,
					'mollie_fee'    => 1,
					'status'        => $attempt[0],
					'testmode'      => $attempt[1],
					'event_date_id' => $event_date_id,
				)
			);
		}

		$shared = $insert_transaction(
			'shared',
			array(
				'amount'          => 100,
				'mollie_fee'      => 1.01,
				'application_fee' => 0.07,
				'status'          => 'paid',
				'event_date_id'   => $other_date_id,
			)
		);
		foreach ( array( array( $other_date_id, 30 ), array( $event_date_id, 50 ), array( $other_date_id, 20 ) ) as $share ) {
			$wpdb->insert(
				$signups,
				array(
					'event_date_id' => $share[0],
					'name'          => 'Finance summary buyer ' . $key,
					'email'         => 'finance-summary-' . $key . '@example.test',
					'quantity'      => 1,
					'status'        => 'confirmed',
					'created_at'    => '2026-07-01 10:00:00',
				)
			);
			$wpdb->insert(
				SignupPaymentLink::table(),
				array(
					'signup_id'        => (int) $wpdb->insert_id,
					'transaction_id'   => $shared,
					'role'             => SignupPaymentLink::ROLE_CHARGE,
					'allocated_amount' => $share[1],
					'currency'         => 'EUR',
					'attribution'      => SignupPaymentLink::ATTRIBUTION_LIVE,
					'evidence'         => wp_json_encode( array( 'type' => 'e2e' ) ),
					'created_at'       => '2026-07-01 10:00:00',
					'recorded_at'      => $now,
				)
			);
		}

		$wpdb->insert(
			$accounts,
			array(
				'label'      => 'efs-' . $key,
				'created_at' => $now,
				'updated_at' => $now,
			)
		);
		$insert_settlement( 'paidout', $prefix . 'shared' );
		$insert_settlement( 'open', $prefix . 'd0' );

		$entry = static function ( $amount, $type, $description, $payment = null ) use ( $event_date_id ) {
			return \FairFinance\Models\FinancialEntry::create( $amount, $type, '2026-07-02', $description, null, null, null, $event_date_id, null, $payment );
		};
		$entry(
			15,
			'cost',
			'Dinner ' . $key,
			array(
				'payment_source' => 'personal_funds',
				'payer_name'     => 'Sayli',
			)
		);
		$bank_id = $entry( 40, 'cost', 'Venue ' . $key );
		$wpdb->update( $entries, array( 'import_source' => 'efs-' . $key . '.csv' ), array( 'id' => $bank_id ) );
		$entry( 5, 'cost', 'Unrecorded ' . $key );
		// A bank import split between both dates: each allocation inherits
		// the parent's bank origin, and the parent itself never counts.
		$split_id = \FairFinance\Models\FinancialEntry::create( 24, 'cost', '2026-07-02', 'Split bank ' . $key );
		$wpdb->update( $entries, array( 'import_source' => 'efs-' . $key . '.csv' ), array( 'id' => $split_id ) );
		\FairFinance\Models\FinancialEntry::split_entry(
			$split_id,
			array(
				array(
					'amount'        => 20,
					'event_date_id' => $event_date_id,
				),
				array(
					'amount'        => 4,
					'event_date_id' => $other_date_id,
				),
			)
		);
		$entry( 35, 'income', 'Gate ' . $key, array( 'payment_source' => 'event_cash' ) );
		$entry( 90, 'income', 'Payout ' . $key );
		$wpdb->insert(
			$entries,
			array(
				'amount'        => 100,
				'entry_type'    => 'transfer',
				'entry_date'    => '2026-07-03',
				'description'   => 'Takings to bank ' . $key,
				'event_date_id' => $event_date_id,
				'created_at'    => $now,
				'updated_at'    => $now,
			)
		);

		$result = array(
			'directCount'   => count( $direct ),
			'sharedId'      => $shared,
			'bankEntryId'   => $bank_id,
			'settlementIds' => array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE reference LIKE %s', $settlements, $wpdb->esc_like( 'efs-' . $key . '-' ) . '%' ) ) ),
		);
		break;

	case 'confirm':
		$settlement_id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE reference = %s', $settlements, 'efs-' . $key . '-paidout' ) );
		$bank_id       = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE description = %s', $entries, 'Venue ' . $key ) );
		$wpdb->insert(
			$decisions,
			array(
				'settlement_id' => $settlement_id,
				'entry_id'      => $bank_id,
				'state'         => 'full',
				'material_hash' => str_repeat( '0', 64 ),
			)
		);
		$decision_id = (int) $wpdb->insert_id;
		$wpdb->insert(
			$history,
			array(
				'decision_id'   => $decision_id,
				'settlement_id' => $settlement_id,
				'request_hash'  => hash( 'sha256', 'efs-' . $key ),
				'state'         => 'full',
				'actor_id'      => 1,
				'confirmed_at'  => $now,
				'reviewed'      => '{}',
			)
		);
		$wpdb->update( $decisions, array( 'history_id' => (int) $wpdb->insert_id ), array( 'id' => $decision_id ) );
		$result = array( 'settlementId' => $settlement_id );
		break;

	case 'cleanup':
		$settlement_ids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE reference LIKE %s', $settlements, $wpdb->esc_like( 'efs-' . $key . '-' ) . '%' ) ) );
		foreach ( $settlement_ids as $settlement_id ) {
			foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE settlement_id = %d', $revisions, $settlement_id ) ) as $revision_id ) {
				$wpdb->delete( $items, array( 'revision_id' => (int) $revision_id ) );
			}
			$wpdb->delete( $revisions, array( 'settlement_id' => $settlement_id ) );
			$wpdb->delete( $history, array( 'settlement_id' => $settlement_id ) );
			$wpdb->delete( $decisions, array( 'settlement_id' => $settlement_id ) );
			$wpdb->delete( $settlements, array( 'id' => $settlement_id ) );
		}
		$wpdb->delete( $accounts, array( 'label' => 'efs-' . $key ) );

		$transaction_ids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE mollie_payment_id LIKE %s', $transactions, $wpdb->esc_like( $prefix ) . '%' ) ) );
		foreach ( $transaction_ids as $transaction_id ) {
			$wpdb->delete( SignupPaymentLink::table(), array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $transactions, array( 'id' => $transaction_id ) );
		}
		$wpdb->delete( $signups, array( 'email' => 'finance-summary-' . $key . '@example.test' ) );
		foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE description LIKE %s', $entries, '% ' . $wpdb->esc_like( $key ) ) ) as $parent_id ) {
			$wpdb->delete( $entries, array( 'parent_entry_id' => (int) $parent_id ) );
		}
		$removed_entries = (int) $wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE description LIKE %s', $entries, '% ' . $wpdb->esc_like( $key ) ) );

		$result = array(
			'transactions' => count( $transaction_ids ),
			'settlements'  => count( $settlement_ids ),
			'entries'      => $removed_entries,
		);
		break;

	default:
		WP_CLI::error( 'Unknown action.' );
}

echo 'E2E_EVENT_FINANCE:' . wp_json_encode( $result ) . "\n";
