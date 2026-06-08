<?php
/**
 * REST API Controller for Mollie settlement reconciliation
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Models\EntryTransaction;
use FairPaymentsConnector\Models\FinancialEntry;
use FairPaymentsConnector\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles Mollie settlement import reconciliation endpoints.
 *
 * Parsing of the settlement CSV happens client-side; this controller receives
 * the already-parsed rows, matches payment rows to transactions by
 * mollie_payment_id, reconciles fees, and suggests the bank entry that the
 * payout corresponds to. Persisting matches is done by the existing
 * financial-entries match endpoint.
 */
class SettlementController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Amount tolerance (in currency units) for matching the settlement total
	 * against an unmatched bank entry.
	 *
	 * @var float
	 */
	const ENTRY_MATCH_TOLERANCE = 0.02;

	/**
	 * Register the routes for settlement reconciliation
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-payments-connector/v1/reconciliation/settlement/preview - Match a parsed settlement.
		register_rest_route(
			$this->namespace,
			'/reconciliation/settlement/preview',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview_settlement' ),
					'permission_callback' => array( $this, 'preview_permissions_check' ),
					'args'                => array(
						'settlement_reference' => array(
							'description'       => __( 'Mollie settlement reference shared by all rows.', 'fair-payments-connector' ),
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'currency'             => array(
							'description'       => __( 'Settlement currency.', 'fair-payments-connector' ),
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'settlement_total'     => array(
							'description' => __( 'Sum of all settlement amount cells.', 'fair-payments-connector' ),
							'type'        => 'number',
							'required'    => false,
						),
						'payment_rows'         => array(
							'description' => __( 'Parsed payment rows from the settlement CSV.', 'fair-payments-connector' ),
							'type'        => 'array',
							'required'    => true,
							'items'       => array(
								'type'       => 'object',
								'properties' => array(
									'mollie_payment_id' => array(
										'type'     => 'string',
										'required' => true,
									),
									'amount'            => array(
										'type' => 'number',
									),
									'status'            => array(
										'type' => 'string',
									),
									'description'       => array(
										'type' => 'string',
									),
									'settlement_amount' => array(
										'type' => 'number',
									),
								),
							),
						),
						'fee_rows'             => array(
							'description' => __( 'Parsed aggregate fee rows from the settlement CSV.', 'fair-payments-connector' ),
							'type'        => 'array',
							'required'    => false,
							'items'       => array(
								'type'       => 'object',
								'properties' => array(
									'description' => array(
										'type' => 'string',
									),
									'amount'      => array(
										'type' => 'number',
									),
								),
							),
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for the preview endpoint.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function preview_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Match a parsed settlement against transactions and bank entries.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Report object on success, WP_Error on failure.
	 */
	public function preview_settlement( $request ) {
		$settlement_reference = sanitize_text_field( (string) $request->get_param( 'settlement_reference' ) );
		$currency             = sanitize_text_field( (string) $request->get_param( 'currency' ) );
		$payment_rows         = $request->get_param( 'payment_rows' );
		$fee_rows             = $request->get_param( 'fee_rows' );
		$settlement_total     = (float) $request->get_param( 'settlement_total' );

		if ( '' === $settlement_reference ) {
			return new WP_Error(
				'rest_settlement_invalid',
				__( 'Missing settlement reference. This does not look like a Mollie settlement export.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $payment_rows ) || ! is_array( $payment_rows ) ) {
			return new WP_Error(
				'rest_settlement_invalid',
				__( 'No payment rows found. This does not look like a Mollie settlement export.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		if ( ! is_array( $fee_rows ) ) {
			$fee_rows = array();
		}

		$matched                  = array();
		$unmatched_csv_rows       = array();
		$resolved_transaction_ids = array();
		$payments_total           = 0.0;
		$transaction_fees_total   = 0.0;
		$row_dates                = array();

		foreach ( $payment_rows as $row ) {
			$mollie_payment_id = isset( $row['mollie_payment_id'] ) ? sanitize_text_field( (string) $row['mollie_payment_id'] ) : '';
			$csv_amount        = isset( $row['amount'] ) ? (float) $row['amount'] : 0.0;
			$payments_total   += $csv_amount;

			if ( '' === $mollie_payment_id ) {
				$unmatched_csv_rows[] = $this->format_unmatched_row( $row );
				continue;
			}

			$transaction = Transaction::get_by_mollie_id( $mollie_payment_id );
			if ( ! $transaction ) {
				$unmatched_csv_rows[] = $this->format_unmatched_row( $row );
				continue;
			}

			$transaction_id             = (int) $transaction->id;
			$db_amount                  = (float) $transaction->amount;
			$application_fee            = null !== $transaction->application_fee ? (float) $transaction->application_fee : 0.0;
			$mollie_fee                 = null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : 0.0;
			$transaction_fees_total    += $application_fee + $mollie_fee;
			$resolved_transaction_ids[] = $transaction_id;

			if ( ! empty( $transaction->created_at ) ) {
				$row_dates[] = substr( $transaction->created_at, 0, 10 );
			}

			$matched[] = array(
				'transaction_id'    => $transaction_id,
				'mollie_payment_id' => $mollie_payment_id,
				'csv_amount'        => $csv_amount,
				'amount'            => $db_amount,
				'application_fee'   => $application_fee,
				'mollie_fee'        => $mollie_fee,
				'status'            => $transaction->status,
				'description'       => $transaction->description,
				'created_at'        => $transaction->created_at,
				'already_matched'   => EntryTransaction::is_transaction_matched( $transaction_id ),
				'amount_mismatch'   => abs( $csv_amount - $db_amount ) > 0.001,
			);
		}

		$resolved_transaction_ids = array_values( array_unique( $resolved_transaction_ids ) );

		$csv_fees_total = 0.0;
		foreach ( $fee_rows as $fee_row ) {
			$csv_fees_total += isset( $fee_row['amount'] ) ? (float) $fee_row['amount'] : 0.0;
		}

		$fee_reconciliation = array(
			'csv_fees_total'         => $csv_fees_total,
			'transaction_fees_total' => $transaction_fees_total,
			// CSV fee rows carry negative amounts; compare against the positive
			// total of fees recorded on the transactions.
			'difference'             => abs( $csv_fees_total ) - $transaction_fees_total,
		);

		$entry_suggestions   = $this->suggest_bank_entry( $settlement_total );
		$transactions_no_csv = $this->find_transactions_without_csv( $payment_rows, $row_dates );

		return new WP_REST_Response(
			array(
				'settlement_reference'     => $settlement_reference,
				'currency'                 => $currency,
				'settlement_total'         => $settlement_total,
				'payments_total'           => $payments_total,
				'fees_total'               => $csv_fees_total,
				'payment_count'            => count( $payment_rows ),
				'matched'                  => $matched,
				'unmatched_csv_rows'       => $unmatched_csv_rows,
				'transactions_without_csv' => $transactions_no_csv,
				'fee_reconciliation'       => $fee_reconciliation,
				'suggested_entry'          => $entry_suggestions['suggested'],
				'alternative_entries'      => $entry_suggestions['alternatives'],
				'resolved_transaction_ids' => $resolved_transaction_ids,
			),
			200
		);
	}

	/**
	 * Format a settlement payment row that could not be matched.
	 *
	 * @param array $row Parsed payment row.
	 * @return array
	 */
	private function format_unmatched_row( $row ) {
		return array(
			'mollie_payment_id' => isset( $row['mollie_payment_id'] ) ? sanitize_text_field( (string) $row['mollie_payment_id'] ) : '',
			'amount'            => isset( $row['amount'] ) ? (float) $row['amount'] : 0.0,
			'status'            => isset( $row['status'] ) ? sanitize_text_field( (string) $row['status'] ) : '',
			'description'       => isset( $row['description'] ) ? sanitize_text_field( (string) $row['description'] ) : '',
		);
	}

	/**
	 * Suggest the unmatched bank entry whose amount best matches the settlement total.
	 *
	 * @param float $settlement_total Sum of all settlement amount cells.
	 * @return array {
	 *     @type array|null $suggested    Closest entry within tolerance, or null.
	 *     @type array      $alternatives Remaining unmatched entries (closest first).
	 * }
	 */
	private function suggest_bank_entry( $settlement_total ) {
		$result = FinancialEntry::get_filtered(
			array(
				'unmatched' => true,
				'per_page'  => 100,
				'page'      => 1,
			)
		);

		$candidates = array();
		foreach ( $result['entries'] as $entry ) {
			$difference   = abs( (float) $entry->amount - $settlement_total );
			$candidates[] = array(
				'id'          => (int) $entry->id,
				'amount'      => (float) $entry->amount,
				'description' => $entry->description,
				'entry_date'  => $entry->entry_date,
				'difference'  => $difference,
			);
		}

		usort(
			$candidates,
			static function ( $a, $b ) {
				return $a['difference'] <=> $b['difference'];
			}
		);

		$suggested = null;
		if ( ! empty( $candidates ) && $candidates[0]['difference'] <= self::ENTRY_MATCH_TOLERANCE ) {
			$suggested = array_shift( $candidates );
		}

		return array(
			'suggested'    => $suggested,
			'alternatives' => array_values( $candidates ),
		);
	}

	/**
	 * Find paid live transactions in the payout window that are unmatched and
	 * absent from the settlement CSV, so nothing is silently dropped.
	 *
	 * @param array $payment_rows Parsed payment rows.
	 * @param array $row_dates    Y-m-d dates of matched transactions.
	 * @return array
	 */
	private function find_transactions_without_csv( $payment_rows, $row_dates ) {
		if ( empty( $row_dates ) ) {
			return array();
		}

		$csv_payment_ids = array();
		foreach ( $payment_rows as $row ) {
			if ( ! empty( $row['mollie_payment_id'] ) ) {
				$csv_payment_ids[ (string) $row['mollie_payment_id'] ] = true;
			}
		}

		sort( $row_dates );
		$date_from = $row_dates[0];
		$date_to   = $row_dates[ count( $row_dates ) - 1 ];

		$transactions = Transaction::get_all(
			array(
				'limit'  => 500,
				'status' => 'paid',
				'mode'   => 'live',
			)
		);

		$without_csv = array();
		foreach ( $transactions as $t ) {
			if ( empty( $t->mollie_payment_id ) || isset( $csv_payment_ids[ $t->mollie_payment_id ] ) ) {
				continue;
			}
			if ( EntryTransaction::is_transaction_matched( (int) $t->id ) ) {
				continue;
			}

			$t_date = substr( (string) $t->created_at, 0, 10 );
			if ( $t_date < $date_from || $t_date > $date_to ) {
				continue;
			}

			$without_csv[] = array(
				'id'                => (int) $t->id,
				'mollie_payment_id' => $t->mollie_payment_id,
				'amount'            => (float) $t->amount,
				'currency'          => $t->currency,
				'description'       => $t->description,
				'created_at'        => $t->created_at,
			);
		}

		return $without_csv;
	}
}
