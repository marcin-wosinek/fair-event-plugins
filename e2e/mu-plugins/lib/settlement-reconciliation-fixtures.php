<?php
/**
 * Synthetic local reconciliation fixtures; loaded only by the E2E plugin.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixtures and cleanup.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/settlements/reconciliation',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;
					$provider = new \FairPaymentsConnector\Database\SettlementRepository();
					$store = new \FairPaymentsConnector\Services\SettlementStore();
					$schema = '\FairFinance\Database\Schema';
					$payments = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
					$entries = $schema::get_financial_entries_table_name();
					$schema::create_tables();
					$action = $request->get_param( 'action' ) ?? 'seed';
					if ( 'cleanup' === $action ) {
						foreach ( array( 'decisions', 'evidence', 'history', 'context' ) as $kind ) {
							$wpdb->query( $wpdb->prepare( 'TRUNCATE TABLE %i', $schema::reconciliation_table( $kind ) ) );
						}
						$wpdb->query( $wpdb->prepare( 'DELETE l FROM %i l LEFT JOIN %i e ON e.id = l.entry_id LEFT JOIN %i t ON t.id = l.transaction_id WHERE e.description LIKE %s OR t.description LIKE %s', \FairPaymentsConnector\Models\EntryTransaction::get_table_name(), $entries, $payments, 'Reconcile fixture%', 'Reconcile fixture%' ) );
						$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE description LIKE %s', $entries, 'Reconcile fixture%' ) );
						$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE description LIKE %s', $payments, 'Reconcile fixture%' ) );
						return array( 'cleaned' => true );
					}
					if ( 'fail_write' === $action ) {
						update_option( 'fair_e2e_reconciliation_fail', (bool) $request->get_param( 'enabled' ) );
						return array( 'updated' => true );
					}
					if ( 'seed' !== $action ) {
						$id = (int) $request->get_param( 'settlement_id' );
						$settlement = $provider->get_settlement( $id );
						if ( 'converge' === $action ) {
							$target_account = $store->ensure_connected_account( 'org_e2e0001' );
							$revision = $provider->get_revision( $settlement['csv_revision_id'] );
							$facts = json_decode( $revision['facts'], true );
							$facts['provider_id'] = 'stl_historymerge';
							$facts['amount'] = '38.55';
							$target_id = $store->upsert_api_settlement( $target_account, $facts );
							$result = $store->confirm_account( (int) $settlement['account_id'], 'org_e2e0001' );
							return is_wp_error( $result ) ? $result : array( 'settlement_id' => $target_id );
						}
						if ( 'source_change' === $action || 'metadata' === $action ) {
							if ( 'metadata' === $action ) {
								$provider->update_settlement( $id, array( 'last_refreshed_at' => current_time( 'mysql', true ) ) );
							} else {
								$source = $settlement['api_revision_id'] ? 'api' : 'csv';
								$revision = $provider->get_revision( $settlement[ $source . '_revision_id' ] );
								$items = $provider->get_items( $revision['id'] );
								$items[0]['settlement_amount'] = '26.00';
								unset( $revision['id'], $revision['created_at'] );
								$new = $provider->insert_revision( $revision );
								$provider->save_items( $new, $items );
								$provider->update_settlement( $id, array( $source . '_revision_id' => $new ) );
							}
							return array( 'updated' => true );
						}
						if ( 'delete_transaction' === $action ) {
							$wpdb->delete( $payments, array( 'id' => (int) $request['transaction_id'] ) );
							return array( 'deleted' => true );
						}
						if ( 'arrive' === $action || 'duplicate' === $action ) {
							$wpdb->insert(
								$payments,
								array(
									'mollie_payment_id' => 'tr_reconcile02',
									'amount'            => '15.00',
									'currency'          => 'EUR',
									'status'            => 'paid',
									'testmode'          => 0,
									'description'       => 'Reconcile fixture payment B',
								)
							);
							return array( 'transaction_id' => (int) $wpdb->insert_id );
						}
						return new WP_Error( 'invalid_fixture', 'Unknown fixture action.', array( 'status' => 400 ) );
					}
					$origin = $request->get_param( 'origin' ) ?? 'csv';
					$variant = $request->get_param( 'variant' ) ?? 'fees';
					$account_id = $request->get_param( 'account_id' ) ?? $provider->insert_account(
						array(
							'label'    => 'Reconcile fixture account',
							'verified' => false,
						)
					);
					$account = $provider->get_account( $account_id );
					$items = array();
					foreach ( array( array( 'tr_reconcile01', '25.00' ), array( 'tr_reconcile02', '15.00' ) ) as $payment ) {
						$items[] = \FairPaymentsConnector\Settlements\Movements::make(
							array(
								'type'                => 'payment',
								'external_id'         => $payment[0],
								'payment_reference'   => $payment[0],
								'amount'              => $payment[1],
								'currency'            => 'EUR',
								'settlement_amount'   => $payment[1],
								'settlement_currency' => 'EUR',
								'description'         => 'Reconcile fixture payment',
								'provider_status'     => 'paid',
							)
						);
					}
					$payout = '40.00';
					if ( 'fees' === $variant ) {
						$payout = '38.55';
						$items[] = \FairPaymentsConnector\Settlements\Movements::make(
							array(
								'type'                => 'fee',
								'is_aggregate'        => true,
								'settlement_amount'   => '-1.45',
								'settlement_currency' => 'EUR',
								'description'         => 'Reconcile fixture aggregate fees',
							)
						);
					}
					if ( 'unknown' === $variant ) {
						$items[] = \FairPaymentsConnector\Settlements\Movements::make(
							array(
								'type'                => 'unknown',
								'settlement_amount'   => '0.00',
								'settlement_currency' => 'EUR',
								'needs_review'        => true,
							)
						);
					}
					if ( 'refund' === $variant ) {
						$items[1]['type'] = 'refund';
						$items[1]['external_id'] = 're_reconcile02';
						$items[1]['settlement_amount'] = '-15.00';
						$payout = '10.00';
					}
					$items = \FairPaymentsConnector\Settlements\Movements::assign_identities( $items );
					$facts = array(
						'provider_id' => 'api' === $origin ? 'stl_reconcile' : null,
						'reference'   => 'RECONCILE.2605.01',
						'currency'    => 'EUR',
						'amount'      => 'api' === $origin ? $payout : null,
						'status'      => 'paidout',
						'created_at'  => '2026-05-01 00:00:00',
						'settled_at'  => '2026-05-02 00:00:00',
						'invoice_id'  => null,
						'balance_id'  => null,
					);
					$id = $provider->insert_settlement(
						array(
							'account_id'   => $account_id,
							'reference'    => $facts['reference'],
							'provider_id'  => $facts['provider_id'],
							'currency'     => 'EUR',
							'amount'       => $facts['amount'],
							'completeness' => 'unverified',
						)
					);
					$revision_id = $provider->insert_revision(
						array(
							'settlement_id' => $id,
							'source'        => $origin,
							'status'        => 'published',
							'content_hash'  => \FairPaymentsConnector\Settlements\Movements::content_hash( $facts, $items ),
							'facts'         => wp_json_encode( $facts ),
							'coverage'      => wp_json_encode(
								'api' === $origin ? array(
									'retrieved' => array(
										'payments'    => 2,
										'captures'    => 0,
										'refunds'     => 0,
										'chargebacks' => 0,
									),
								) : array( 'format' => 'en' )
							),
							'totals'        => wp_json_encode( \FairPaymentsConnector\Settlements\Movements::totals( $items ) ),
							'item_count'    => count( $items ),
							'published_at'  => current_time( 'mysql', true ),
						)
					);
					$provider->save_items( $revision_id, $items );
					$provider->update_settlement( $id, array( $origin . '_revision_id' => $revision_id ) );
					$ids = array();
					foreach ( array( array( 'tr_reconcile01', '25.00' ), array( 'tr_reconcile02', '15.00' ) ) as $index => $payment ) {
						if ( $request->get_param( 'missing' ) && 1 === $index ) {
							continue;
						}
						$existing = $request->get_param( 'reuse_transactions' ) ? \FairPaymentsConnector\Models\Transaction::get_by_mollie_id( $payment[0] ) : null;
						if ( $existing ) {
							$ids[] = (int) $existing->id;
							continue; }
						$wpdb->insert(
							$payments,
							array(
								'mollie_payment_id' => $payment[0],
								'amount'            => $payment[1],
								'currency'          => 'EUR',
								'status'            => 'paid',
								'testmode'          => 0,
								'description'       => 'Reconcile fixture payment',
							)
						);
						$ids[] = (int) $wpdb->insert_id;
					}
					$padding = (int) $request->get_param( 'bank_padding' );
					for ( $i = 0; $i < $padding; ++$i ) {
						\FairFinance\Models\FinancialEntry::create( 1, 'income', '2026-01-01', 'Reconcile fixture decoy' );
					}
					$entry_id = \FairFinance\Models\FinancialEntry::create( (float) $payout, 'income', '2026-05-02', 'Reconcile fixture RECONCILE.2605.01' );
					return array(
						'settlement_id'   => $id,
						'entry_id'        => $entry_id,
						'account_id'      => $account_id,
						'transaction_ids' => $ids,
						'revision_id'     => $revision_id,
					);
				},
			)
		);
	}
);

// Deterministic database failure after decision/context writes, before commit.
add_filter(
	'query',
	static function ( $query ) {
		if ( str_starts_with( $query, 'INSERT INTO' ) && str_contains( $query, 'fair_finance_reconciliation_evidence' ) && get_option( 'fair_e2e_reconciliation_fail' ) ) {
			return 'INSERT INTO fair_e2e_deliberately_missing_table (id) VALUES (1)';
		}
		return $query;
	}
);
