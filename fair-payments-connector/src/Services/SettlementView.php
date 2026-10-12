<?php
/**
 * Saved settlement read model
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairPaymentsConnector\Database\SettlementRepository;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;

defined( 'WPINC' ) || die;

/**
 * Builds the REST shape of saved settlements from local data only.
 *
 * Nothing here contacts Mollie, so saved settlements stay readable while
 * the connection is down or gone.
 */
class SettlementView {

	/**
	 * Repository.
	 *
	 * @var SettlementRepository
	 */
	private $repository;

	/**
	 * Accounts already looked up, by ID.
	 *
	 * @var array<int, array|null>
	 */
	private $accounts = array();

	/**
	 * Constructor.
	 *
	 * @param SettlementRepository|null $repository Repository.
	 */
	public function __construct( ?SettlementRepository $repository = null ) {
		$this->repository = $repository ?? new SettlementRepository();
	}

	/**
	 * REST shape of an account.
	 *
	 * @param array $account Account row.
	 * @return array
	 */
	public static function account( array $account ) {
		return array(
			'id'              => (int) $account['id'],
			'label'           => (string) $account['label'],
			'verified'        => (bool) (int) $account['verified'],
			'organization_id' => $account['organization_id'] ? (string) $account['organization_id'] : null,
			'is_connected'    => null !== $account['organization_id'] && SettlementApiImport::connected_organization() === $account['organization_id'],
		);
	}

	/**
	 * REST shape of a settlement in a list.
	 *
	 * @param array $settlement Settlement row.
	 * @return array
	 */
	public function summary( array $settlement ) {
		$account_id = (int) $settlement['account_id'];
		if ( ! array_key_exists( $account_id, $this->accounts ) ) {
			$this->accounts[ $account_id ] = $this->repository->get_account( $account_id );
		}
		$account = $this->accounts[ $account_id ];

		$sources = array();
		if ( $settlement['api_revision_id'] ) {
			$sources[] = Movements::SOURCE_API;
		}
		if ( $settlement['csv_revision_id'] ) {
			$sources[] = Movements::SOURCE_CSV;
		}

		$failure_code = $settlement['last_failure_code'] ? (string) $settlement['last_failure_code'] : null;
		$messages     = SettlementApiImport::error_messages();

		return array(
			'id'                 => (int) $settlement['id'],
			'account'            => $account ? self::account( $account ) : null,
			'provider_id'        => $settlement['provider_id'],
			'reference'          => $settlement['reference'],
			'currency'           => $settlement['currency'],
			'amount'             => $settlement['amount'],
			'status'             => $settlement['status'],
			'created_at'         => self::local( $settlement['provider_created_at'] ),
			'settled_at'         => self::local( $settlement['settled_at'] ),
			'invoice_id'         => $settlement['invoice_id'],
			'sources'            => $sources,
			'completeness'       => (string) $settlement['completeness'],
			'discrepancy_count'  => (int) $settlement['discrepancy_count'],
			'last_refreshed_at'  => self::local( $settlement['last_refreshed_at'] ),
			'last_csv_import_at' => self::local( $settlement['last_csv_import_at'] ),
			'last_failure'       => $failure_code
				? array(
					'code'    => $failure_code,
					'message' => $messages[ $failure_code ] ?? $messages['mollie_request_failed'],
					'at'      => self::local( $settlement['last_failure_at'] ),
				)
				: null,
			'material_change_at' => self::local( $settlement['material_change_at'] ),
		);
	}

	/**
	 * REST shape of one settlement with its movements.
	 *
	 * @param array $settlement Settlement row.
	 * @return array
	 */
	public function detail( array $settlement ) {
		$data           = $this->summary( $settlement );
		$data['report'] = null;
		$revisions      = array();
		$items          = array(
			Movements::SOURCE_API => array(),
			Movements::SOURCE_CSV => array(),
		);

		foreach ( array_keys( $items ) as $source ) {
			$revision_id = $settlement[ $source . '_revision_id' ];
			$revision    = $revision_id ? $this->repository->get_revision( (int) $revision_id ) : null;
			if ( ! $revision ) {
				continue;
			}

			$items[ $source ]     = $this->repository->get_items( (int) $revision['id'] );
			$revisions[ $source ] = array(
				'id'           => (int) $revision['id'],
				'content_hash' => (string) $revision['content_hash'],
				'published_at' => self::local( $revision['published_at'] ),
				'item_count'   => (int) $revision['item_count'],
				'coverage'     => json_decode( (string) $revision['coverage'], true ),
				'totals'       => json_decode( (string) $revision['totals'], true ),
			);

			if ( Movements::SOURCE_API === $source ) {
				$data['report'] = self::report( $settlement, $revision, $items[ $source ] );
			}
		}

		$merged     = Movements::merge( $items[ Movements::SOURCE_API ], $items[ Movements::SOURCE_CSV ] );
		$references = array();
		foreach ( $merged as $movement ) {
			if ( null !== $movement['payment_reference'] ) {
				$references[] = $movement['payment_reference'];
			}
		}
		$local = $this->repository->find_local_transactions( $references );

		$movements  = array();
		$aggregates = array();
		$unresolved = array();
		foreach ( $merged as $movement ) {
			$row = array(
				'key'                 => $movement['sources'][0] . ':' . $movement['identity_key'],
				'type'                => $movement['type'],
				'external_id'         => $movement['external_id'],
				'payment_reference'   => $movement['payment_reference'],
				'description'         => $movement['description'],
				'provider_status'     => $movement['provider_status'],
				// Mollie states UTC; a file states no timezone and is shown as written.
				'occurred_at'         => Movements::SOURCE_API === $movement['sources'][0] ? self::local( $movement['occurred_at'] ) : $movement['occurred_at'],
				'amount'              => $movement['amount'],
				'currency'            => $movement['currency'],
				'settlement_amount'   => $movement['settlement_amount'],
				'settlement_currency' => $movement['settlement_currency'],
				'needs_review'        => (bool) $movement['needs_review'],
				'sources'             => $movement['sources'],
				'conflict'            => $movement['conflict'],
			);

			if ( $movement['is_aggregate'] ) {
				// Report lines are also listed, with their details, under `report`.
				$row['in_report'] = ! empty( $movement['report'] );
				$aggregates[]     = $row;
				continue;
			}

			$row['local_transaction_id'] = null === $movement['payment_reference'] ? null : ( $local[ $movement['payment_reference'] ] ?? null );
			if ( null !== $movement['payment_reference'] && null === $row['local_transaction_id'] ) {
				$unresolved[ $movement['payment_reference'] ] = true;
			}
			$movements[] = $row;
		}

		$data['revisions']                = (object) $revisions;
		$data['movements']                = $movements;
		$data['aggregates']               = $aggregates;
		$data['unresolved_payment_count'] = count( $unresolved );
		$data['discrepancies']            = array_map(
			array( self::class, 'discrepancy' ),
			(array) json_decode( (string) $settlement['discrepancies'], true )
		);
		$data['proposed_changes']         = $this->proposed_changes( (int) $settlement['id'], $items[ Movements::SOURCE_CSV ] );
		$data['can_refresh']              = null !== $settlement['provider_id'] && $data['account'] && $data['account']['is_connected'];

		return $data;
	}

	/**
	 * Mollie's report of a settlement: its lines by period and what they add
	 * up to, at the precision Mollie supplied.
	 *
	 * The report describes the same payout as the movements; it is never
	 * added to them. Its agreement with the payout says nothing about whether
	 * every movement was listed.
	 *
	 * @param array   $settlement Settlement row.
	 * @param array   $revision   Published API revision.
	 * @param array[] $items      Movements of that revision.
	 * @return array
	 */
	private static function report( array $settlement, array $revision, array $items ) {
		$report = array(
			'source'  => Movements::SOURCE_API,
			'status'  => 'available',
			'summary' => null,
			'periods' => array(),
		);

		if ( null === $revision['report_version'] ) {
			// Saved before report details were kept: unknown, not zero.
			$report['status'] = 'legacy';
			return $report;
		}

		$periods = array();
		foreach ( $items as $item ) {
			if ( empty( $item['report'] ) ) {
				continue;
			}

			$line = $item['report'];
			$key  = $line['year'] . '-' . $line['month'];
			if ( ! isset( $periods[ $key ] ) ) {
				$periods[ $key ] = array(
					'year'                => $line['year'],
					'month'               => $line['month'],
					'invoice_id'          => $line['invoice_id'],
					'invoice_reference'   => $line['invoice_reference'],
					Report::GROUP_REVENUE => array(),
					Report::GROUP_COSTS   => array(),
				);
			}

			$contribution = Report::contribution( $line );

			$periods[ $key ][ $line['group'] ][] = array(
				'key'             => $item['identity_key'],
				'description'     => $item['description'],
				'method'          => $line['method'],
				// Only Mollie's own method marks a refund line.
				'is_refund'       => Report::METHOD_REFUND === $line['method'],
				'count'           => $line['count'],
				'rate_fixed'      => $line['rate_fixed'],
				'rate_percentage' => $line['rate_percentage'],
				'amount_net'      => $line['amount_net'],
				'amount_vat'      => $line['amount_vat'],
				'amount_gross'    => $line['amount_gross'],
				'contribution'    => $contribution,
				'needs_review'    => (bool) $item['needs_review'],
			);
		}

		if ( empty( $periods ) ) {
			$report['status'] = 'not_provided';
			return $report;
		}

		ksort( $periods );
		$report['periods'] = array_values( $periods );
		$report['summary'] = Report::summarize( $settlement['amount'], $settlement['currency'], $items );

		return $report;
	}

	/**
	 * Files that disagreed with the accepted CSV, with what they would change.
	 *
	 * @param int     $settlement_id Settlement ID.
	 * @param array[] $accepted      Movements of the accepted CSV revision.
	 * @return array[]
	 */
	private function proposed_changes( $settlement_id, array $accepted ) {
		$changes = array();

		foreach ( $this->repository->find_revisions( $settlement_id, Movements::SOURCE_CSV, 'conflict' ) as $revision ) {
			$diff = Movements::diff( $accepted, $this->repository->get_items( (int) $revision['id'] ) );

			$changes[] = array(
				'revision_id' => (int) $revision['id'],
				'created_at'  => self::local( $revision['created_at'] ),
				'counts'      => array(
					'added'   => count( $diff['added'] ),
					'removed' => count( $diff['removed'] ),
					'changed' => count( $diff['changed'] ),
				),
				'added'       => array_map( array( self::class, 'brief' ), array_slice( $diff['added'], 0, SettlementStore::DIFF_LIMIT ) ),
				'removed'     => array_map( array( self::class, 'brief' ), array_slice( $diff['removed'], 0, SettlementStore::DIFF_LIMIT ) ),
				'changed'     => array_slice( $diff['changed'], 0, SettlementStore::DIFF_LIMIT ),
			);
		}

		return $changes;
	}

	/**
	 * Short form of a movement for a list of differences.
	 *
	 * @param array $movement Movement.
	 * @return array
	 */
	private static function brief( array $movement ) {
		return array(
			'type'                => $movement['type'],
			'external_id'         => $movement['external_id'],
			'description'         => $movement['description'],
			'settlement_amount'   => $movement['settlement_amount'],
			'settlement_currency' => $movement['settlement_currency'],
		);
	}

	/**
	 * Add an administrator-facing message to a stored discrepancy.
	 *
	 * @param array $discrepancy Stored discrepancy.
	 * @return array
	 */
	public static function discrepancy( array $discrepancy ) {
		$count = (int) ( $discrepancy['count'] ?? 0 );

		switch ( $discrepancy['code'] ?? '' ) {
			case 'summary_total_mismatch':
				$message = empty( $discrepancy['difference'] )
					? __( 'The report summary from Mollie does not add up to the payout amount.', 'fair-payments-connector' )
					: sprintf(
						/* translators: %s: exact amount with currency, such as -0.0045 EUR */
						__( 'The report from Mollie differs from the payout amount by %s.', 'fair-payments-connector' ),
						trim( $discrepancy['difference'] . ' ' . (string) ( $discrepancy['currency'] ?? '' ) )
					);
				break;
			case 'currency_conflict':
				$message = __( 'The uploaded file and Mollie state different settlement currencies.', 'fair-payments-connector' );
				break;
			case 'value_conflict':
				$message = sprintf(
					/* translators: %s: Mollie reference such as tr_abc123 */
					__( 'The uploaded file and Mollie state different values for %s. The value from Mollie is shown; neither was added to the other.', 'fair-payments-connector' ),
					(string) ( $discrepancy['external_id'] ?? '' )
				);
				break;
			case 'only_in_api':
				$message = sprintf(
					/* translators: %d: number of movements */
					_n( '%d movement from Mollie is not in the uploaded file.', '%d movements from Mollie are not in the uploaded file.', $count, 'fair-payments-connector' ),
					$count
				);
				break;
			case 'only_in_csv':
				$message = sprintf(
					/* translators: %d: number of movements */
					_n( '%d movement in the uploaded file was not reported by Mollie.', '%d movements in the uploaded file were not reported by Mollie.', $count, 'fair-payments-connector' ),
					$count
				);
				break;
			case 'needs_review':
				$message = sprintf(
					/* translators: %d: number of movements */
					_n( '%d movement has a type or value that was not recognized.', '%d movements have a type or value that was not recognized.', $count, 'fair-payments-connector' ),
					$count
				);
				break;
			case 'csv_content_conflict':
				$message = __( 'A different file was uploaded for this settlement. The first accepted file is kept; the differences are listed below.', 'fair-payments-connector' );
				break;
			case 'ambiguous_identity':
				$message = __( 'More than one saved settlement in this account has this reference, so they were not merged.', 'fair-payments-connector' );
				break;
			case 'source_changed':
				$message           = __( 'Mollie reported different data for this settlement on a later refresh. The earlier version is kept for comparison.', 'fair-payments-connector' );
				$discrepancy['at'] = self::local( $discrepancy['at'] ?? null );
				break;
			default:
				$message = __( 'This settlement needs review.', 'fair-payments-connector' );
		}

		$discrepancy['message'] = $message;

		return $discrepancy;
	}

	/**
	 * Convert a stored GMT datetime to site time.
	 *
	 * @param string|null $gmt GMT datetime.
	 * @return string|null
	 */
	private static function local( $gmt ) {
		return $gmt ? get_date_from_gmt( $gmt ) : null;
	}
}
