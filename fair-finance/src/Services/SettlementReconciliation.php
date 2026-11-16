<?php
/**
 * Local-only saved settlement reconciliation.
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

use FairFinance\Database\ReconciliationRepository;
use FairFinance\Database\Schema;
use FairPaymentsConnector\Database\SettlementRepository;
use FairPaymentsConnector\Models\EntryTransaction;
use FairPaymentsConnector\Services\SettlementStore;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;
use FairPaymentsConnector\Settlements\ReportDecimal as Exact;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Provider facts never change here. Evidence is versioned by confirmation.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class SettlementReconciliation {
	/**
	 * Provider repository.
	 *
	 * @var SettlementRepository
	 */
	private $provider;
	/**
	 * Finance repository.
	 *
	 * @var ReconciliationRepository
	 */
	private $local;

	/**
	 * Construct without contacting a provider.
	 */
	public function __construct() {
		$this->provider = new SettlementRepository();
		$this->local    = new ReconciliationRepository();
	}

	/**
	 * Keep confirmed evidence discoverable and prevent legacy unmatch bypasses.
	 *
	 * @return void
	 */
	public static function register_guards() {
		add_filter( 'fair_payment_settlement_account_confirmation_error', array( self::class, 'guard_account' ), 10, 2 );
		add_filter( 'rest_pre_dispatch', array( self::class, 'guard_legacy_match' ), 10, 3 );
		add_action( 'fair_payment_settlement_converging', array( self::class, 'move_history' ), 10, 2 );
	}

	/**
	 * Move the lookup of released histories when provider identities converge.
	 * The reviewed snapshots and their revision references stay immutable.
	 * Runs inside SettlementStore's lock and transaction.
	 *
	 * @param int $from Old settlement ID.
	 * @param int $into Surviving settlement ID.
	 * @return void
	 */
	public static function move_history( $from, $into ) {
		( new ReconciliationRepository() )->save( 'history', array( 'settlement_id' => $into ), array( 'settlement_id' => $from ) );
	}

	/**
	 * Account convergence cannot discard a settlement with local decisions.
	 * Reconciliation must be explicitly released before changing its identity.
	 *
	 * @param mixed $error Prior error.
	 * @param int   $account_id Account being confirmed.
	 * @return mixed
	 */
	public static function guard_account( $error, $account_id ) {
		global $wpdb;
		$found = $wpdb->get_var( $wpdb->prepare( 'SELECT d.id FROM %i d INNER JOIN %i s ON s.id = d.settlement_id WHERE s.account_id = %d LIMIT 1', Schema::reconciliation_table( 'decisions' ), \FairPaymentsConnector\Database\Schema::get_settlements_table_name(), $account_id ) );
		return $found ? self::error( 'reconciliation_identity_in_use', __( 'This account has saved reconciliation decisions. Release their bank associations in Reconciliation before confirming the account. Confirmation history is retained.', 'fair-finance' ), 409 ) : $error;
	}

	/**
	 * Legacy whole-payment actions must not silently alter saved evidence.
	 *
	 * @param mixed  $result Prior result.
	 * @param object $server REST server.
	 * @param object $request Request.
	 * @return mixed
	 */
	public static function guard_legacy_match( $result, $server, $request ) {
		if ( null !== $result || ! current_user_can( 'manage_options' ) || ! preg_match( '#^/fair-finance/v1/financial-entries/(\d+)/(match|unmatch)$#', $request->get_route(), $match ) ) {
			return $result;
		}
		return self::entry_in_use( (int) $match[1] ) ? self::error( 'reconciliation_entry_in_use', __( 'This entry belongs to a saved settlement reconciliation. Review or release its bank association in Reconciliation first.', 'fair-finance' ), 409 ) : $result;
	}

	/**
	 * Whether a bank entry belongs to a saved settlement reconciliation, so
	 * legacy match and unmatch actions must leave it alone.
	 *
	 * @param int $entry_id Bank entry ID.
	 * @return bool
	 * @throws \RuntimeException On SQL read failure.
	 */
	public static function entry_in_use( $entry_id ) {
		return (bool) ( new ReconciliationRepository() )->rows( 'decisions', 'entry_id', (int) $entry_id );
	}

	/**
	 * Consistent error response.
	 *
	 * @param string $code Code.
	 * @param string $message Message.
	 * @param int    $status HTTP status.
	 * @return WP_Error
	 */
	private static function error( $code, $message, $status = 400 ) {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}

	/**
	 * Stable exact comparison of supported decimals.
	 *
	 * @param mixed $a Amount.
	 * @param mixed $b Amount.
	 * @return bool
	 */
	private static function equal( $a, $b ) {
		return null !== $a && null !== $b && Exact::is_zero( Exact::subtract( $a, $b ) );
	}

	/**
	 * Hash canonical material, ignoring timestamps changed by metadata refreshes.
	 *
	 * @param mixed $value Material.
	 * @return string
	 */
	private static function hash( $value ) {
		return hash( 'sha256', (string) wp_json_encode( $value ) );
	}

	/**
	 * Explain one source without counting aggregates alongside their details.
	 * A report is a separate explanation; its revenue must agree with listed
	 * payment/capture/refund/chargeback movements before it establishes coverage.
	 *
	 * @param array       $items Movements of one source.
	 * @param string|null $currency Settlement currency.
	 * @return array
	 */
	public static function explain( array $items, $currency ) {
		$totals   = Movements::totals( $items );
		$report   = Report::summarize( null, $currency, $items );
		$issues   = array();
		$lines    = array();
		$captured = array();
		foreach ( $items as $item ) {
			if ( Movements::TYPE_CAPTURE === $item['type'] ) {
				$captured[ (string) $item['payment_reference'] ] = true;
			}
		}
		$detail     = array();
		$aggregate  = array();
		$membership = array();
		foreach ( $items as $item ) {
			if ( $item['needs_review'] || Movements::TYPE_UNKNOWN === $item['type'] ) {
				$issues[] = __( 'An unknown movement or value needs review.', 'fair-finance' );
			}
			if ( $item['report'] || Movements::TYPE_SUMMARY === $item['type'] ) {
				continue;
			}
			if ( Movements::TYPE_PAYMENT === $item['type'] && isset( $captured[ (string) $item['external_id'] ] ) ) {
				continue;
			}
			$type = $item['type'];
			if ( $item['is_aggregate'] ) {
				$aggregate[ $type ][] = $item;
			} else {
				$detail[ $type ][] = $item;
			}
			if ( in_array( $type, array( 'payment', 'capture', 'refund', 'chargeback' ), true ) && ! $item['is_aggregate'] ) {
				$membership[] = $item;
			}
		}
		$values = array();
		foreach ( array_unique( array_merge( array_keys( $detail ), array_keys( $aggregate ) ) ) as $type ) {
			// A total and its constituent rows are alternative evidence, never additive.
			$rows  = $detail[ $type ] ?? $aggregate[ $type ];
			$group = array();
			foreach ( $rows as $item ) {
				$lines[] = $item;
				if ( null === $item['settlement_amount'] || $currency !== $item['settlement_currency'] ) {
					$issues[] = __( 'A movement has an unknown settlement amount or a different settlement currency.', 'fair-finance' );
				} else {
					$group[] = $item['settlement_amount'];
				}
			}
			if ( isset( $detail[ $type ], $aggregate[ $type ] ) ) {
				$aggregate_values = array();
				foreach ( $aggregate[ $type ] as $item ) {
					if ( null !== $item['settlement_amount'] && $currency === $item['settlement_currency'] ) {
						$aggregate_values[] = $item['settlement_amount'];
					}
				}
				if ( count( $aggregate_values ) !== count( $aggregate[ $type ] ) || ! self::equal( Exact::sum( $group ), Exact::sum( $aggregate_values ) ) ) {
					$issues[] = __( 'Aggregate amounts disagree with their detailed movements.', 'fair-finance' );
				}
			}
			$values = array_merge( $values, $group );
		}
		$net = $values ? Exact::sum( $values ) : null;
		if ( $report ) {
			$membership_values = array_column( $membership, 'settlement_amount' );
			$revenue           = Exact::sum(
				array_filter(
					array( $report['revenue']['amount'], $report['refunds']['amount'] ),
					static function ( $value ) {
						return null !== $value;
					}
				)
			);
			if ( ! $report['complete'] || in_array( null, $membership_values, true ) || ! self::equal( Exact::sum( $membership_values ), $revenue ) ) {
				$issues[] = __( 'The report revenue is not fully covered by the listed movements.', 'fair-finance' );
			}
			// The report already contains its revenue, costs and rounding lines.
			$net   = $report['net'];
			$lines = array_values(
				array_filter(
					$items,
					static function ( $item ) {
						return ! empty( $item['report'] );
					}
				)
			);
		}
		if ( ! $items || null === $net ) {
			$issues[] = __( 'There is not enough saved evidence to explain this payout.', 'fair-finance' );
		}
		return array(
			'net'      => $net,
			'currency' => $currency,
			'lines'    => $lines,
			'report'   => $report,
			'totals'   => $totals,
			'issues'   => array_values( array_unique( $issues ) ),
		);
	}

	/**
	 * Preview fresh local evidence. Preview never writes.
	 *
	 * @param int   $id Settlement ID.
	 * @param array $proposal Selected entry and explicit context.
	 * @param bool  $lock Use locking reads within confirmation.
	 * @return array|WP_Error
	 */
	public function preview( $id, array $proposal = array(), $lock = false ) {
		try {
			return $this->build_preview( $id, $proposal, $lock );
		} catch ( \Throwable $error ) {
			return self::error( 'reconciliation_read_failed', __( 'The local reconciliation evidence could not be read. Try again.', 'fair-finance' ), 500 );
		}
	}

	/**
	 * Read the preview snapshot.
	 *
	 * @param int   $id Settlement ID.
	 * @param array $proposal Proposal.
	 * @param bool  $lock Lock records.
	 * @param bool  $resplit Also propose a split for an existing one, ignoring its children.
	 * @return array|WP_Error
	 */
	private function build_preview( $id, array $proposal, $lock, $resplit = false ) {
		$settlement = $this->provider->get_settlement( $id, $lock );
		if ( ! $settlement ) {
			return self::error( 'settlement_not_found', __( 'This settlement is not saved on this site.', 'fair-finance' ), 404 );
		}
		$decision  = $this->local->decision( $id, $lock );
		$entry_id  = (int) ( $proposal['entry_id'] ?? ( $decision['entry_id'] ?? 0 ) );
		$account   = $this->provider->get_account( (int) $settlement['account_id'] );
		$items     = array(
			'api' => array(),
			'csv' => array(),
		);
		$revisions = array();
		$issues    = array();
		foreach ( array_keys( $items ) as $source ) {
			$revision = $settlement[ $source . '_revision_id' ] ? $this->provider->get_revision( (int) $settlement[ $source . '_revision_id' ] ) : null;
			if ( $revision ) {
				$revisions[ $source ] = $revision;
				$items[ $source ]     = $this->provider->get_items( (int) $revision['id'] );
			}
		}
		if ( isset( $revisions['api'] ) ) {
			$coverage = (array) json_decode( (string) $revisions['api']['coverage'], true );
			foreach ( array( 'payments', 'captures', 'refunds', 'chargebacks' ) as $part ) {
				$type   = rtrim( $part, 's' );
				$loaded = count(
					array_filter(
						$items['api'],
						static function ( $item ) use ( $type ) {
							return ! $item['is_aggregate'] && $type === $item['type'];
						}
					)
				);
				if ( isset( $coverage['retrieved'][ $part ] ) && (int) $coverage['retrieved'][ $part ] !== $loaded ) {
					$issues[] = __( 'Saved movement counts disagree with the API coverage record.', 'fair-finance' );
				}
				if ( ! array_key_exists( $part, $coverage['retrieved'] ?? array() ) ) {
					$issues[] = __( 'The saved API revision does not establish coverage of every movement type.', 'fair-finance' );
				}
			}
		}
		if ( $settlement['provider_id'] && empty( $revisions['api'] ) ) {
			$issues[] = __( 'The API import has not finished.', 'fair-finance' );
		}
		$merged        = Movements::merge( $items['api'], $items['csv'] );
		$memberships   = $this->local->memberships( (int) $settlement['account_id'], $id );
		$movement_keys = array_column( $merged, 'identity_key' );
		$memberships   = array_values(
			array_filter(
				$memberships,
				static function ( $membership ) use ( $movement_keys ) {
					return in_array( $membership['movement_key'], $movement_keys, true );
				}
			)
		);
		$occupied      = array_column( $memberships, 'settlement_id', 'movement_key' );
		$references    = array();
		foreach ( $merged as $item ) {
			if ( $item['payment_reference'] ) {
				$references[] = $item['payment_reference'];
			}
		}
		$transactions = $this->local->transactions( $references, $lock );
		$by_reference = array();
		foreach ( $transactions as $transaction ) {
			$by_reference[ $transaction['mollie_payment_id'] ][] = $transaction;
		}
		$links     = $this->local->links( array_column( $transactions, 'id' ), $entry_id, $lock );
		$bank_rows = $entry_id ? $this->local->bank( $entry_id, $lock ) : array();
		$bank      = null;
		foreach ( $bank_rows as $row ) {
			if ( (int) $row['id'] === $entry_id ) {
				$bank = $row;
			}
		}
		$context     = $entry_id ? $this->local->context( $entry_id, $lock ) : null;
		$currency    = $proposal['currency'] ?? ( $context['currency'] ?? null );
		$account_id  = (int) ( $proposal['account_id'] ?? ( $context['account_id'] ?? 0 ) );
		$bank_issues = array();
		if ( ! $account ) {
			$bank_issues[] = __( 'The settlement’s payout account is missing.', 'fair-finance' );
		}
		if ( ! $bank || $bank['parent_entry_id'] || 'income' !== $bank['entry_type'] || ! empty( $bank['payment_source'] ) ) {
			$bank_issues[] = __( 'Select an eligible bank income entry.', 'fair-finance' );
		}
		if ( ! $currency || ! $account_id ) {
			$bank_issues[] = __( 'Confirm the bank entry’s currency and payout account explicitly.', 'fair-finance' );
		} elseif ( $currency !== $settlement['currency'] || $account_id !== (int) $settlement['account_id'] || ( $context && ( $context['currency'] !== $currency || (int) $context['account_id'] !== $account_id ) ) ) {
			$bank_issues[] = __( 'The bank entry’s confirmed currency or account does not match this settlement.', 'fair-finance' );
		}
		if ( $decision && (int) $decision['entry_id'] !== $entry_id ) {
			$bank_issues[] = __( 'Release the existing bank association before selecting a different entry.', 'fair-finance' );
		}
		foreach ( $this->local->rows( 'decisions', 'entry_id', $entry_id, $lock ) as $other ) {
			if ( (int) $other['settlement_id'] !== (int) $id ) {
				$bank_issues[] = __( 'This bank entry is already associated with another settlement.', 'fair-finance' );
			}
		}
		$whole_ids = array();
		$non_whole = array();
		foreach ( $merged as $movement ) {
			if ( in_array( $movement['type'], array( 'capture', 'refund', 'chargeback' ), true ) ) {
				$non_whole[ (string) $movement['payment_reference'] ] = true;
			}
		}
		foreach ( $merged as &$item ) {
			if ( ! $item['is_aggregate'] && isset( $occupied[ $item['identity_key'] ] ) ) {
				$bank_issues[] = __( 'A movement already belongs to another saved settlement reconciliation.', 'fair-finance' );
			}
			$matches                = $by_reference[ (string) $item['payment_reference'] ] ?? array();
			$item['transactions']   = $matches;
			$item['transaction_id'] = 1 === count( $matches ) ? (int) $matches[0]['id'] : null;
			if ( $item['conflict'] ) {
				$issues[] = __( 'Saved sources disagree about a movement.', 'fair-finance' );
			}
			if ( ! $item['is_aggregate'] && in_array( $item['type'], array( 'payment', 'capture', 'refund', 'chargeback' ), true ) ) {
				if ( 1 !== count( $matches ) ) {
					$issues[] = __( 'A required payment reference is missing or matches more than one local transaction.', 'fair-finance' );
				} else {
					$transaction = $matches[0];
					if ( ! empty( $transaction['testmode'] ) || ( 'payment' === $item['type'] && 'paid' !== $transaction['status'] ) ) {
						$issues[] = __( 'A required local transaction is not a paid live payment.', 'fair-finance' );
					}
					if ( null !== $item['currency'] && $item['currency'] !== $transaction['currency'] ) {
						$issues[] = __( 'A local payment has a different original currency.', 'fair-finance' );
					}
					if ( 'payment' === $item['type'] && ! self::equal( $item['amount'], $transaction['amount'] ) ) {
						$issues[] = __( 'A payment amount differs from its local transaction.', 'fair-finance' );
					}
					if ( 'payment' === $item['type'] && ! isset( $non_whole[ (string) $item['payment_reference'] ] ) && self::equal( $item['amount'], $transaction['amount'] ) && self::equal( $item['settlement_amount'], $transaction['amount'] ) && $item['settlement_currency'] === $transaction['currency'] ) {
						$whole_ids[] = (int) $transaction['id'];
					}
				}
			}
		}
		unset( $item );
		$adoption = $bank && ! empty( $bank['transaction_id'] );
		foreach ( $links as $link ) {
			if ( (int) $link['entry_id'] === $entry_id ) {
				$adoption = true;
				if ( ! in_array( (int) $link['transaction_id'], $whole_ids, true ) ) {
					$bank_issues[] = __( 'This bank entry has an incompatible existing whole-payment match.', 'fair-finance' );
				}
			} elseif ( in_array( (int) $link['transaction_id'], $whole_ids, true ) ) {
				$bank_issues[] = __( 'A payment is already matched to another bank entry.', 'fair-finance' );
			}
		}
		if ( $bank && ! empty( $bank['transaction_id'] ) && ! in_array( (int) $bank['transaction_id'], $whole_ids, true ) ) {
			$bank_issues[] = __( 'The bank entry has an incompatible legacy payment match.', 'fair-finance' );
		}
		$explanations = array();
		foreach ( $revisions as $source => $revision ) {
			$explanations[ $source ] = self::explain( $items[ $source ], $settlement['currency'] );
			$issues                  = array_merge( $issues, $explanations[ $source ]['issues'] );
			if ( 'published' !== $revision['status'] ) {
				$issues[] = __( 'A selected source revision is not published.', 'fair-finance' );
			}
		}
		$explanation = $explanations['api'] ?? ( $explanations['csv'] ?? array( 'net' => null ) );
		if ( isset( $explanations['api'], $explanations['csv'] ) && ! self::equal( $explanations['api']['net'], $explanations['csv']['net'] ) ) {
			$issues[] = __( 'The API and CSV payout explanations disagree.', 'fair-finance' );
		}
		foreach ( (array) json_decode( (string) $settlement['discrepancies'], true ) as $discrepancy ) {
			if ( in_array( $discrepancy['code'], array( 'csv_content_conflict', 'ambiguous_identity', 'only_in_api', 'only_in_csv', 'currency_conflict' ), true ) ) {
				$issues[] = __( 'Conflicting or incomplete saved sources require resolution.', 'fair-finance' );
			}
		}
		if ( null !== $settlement['amount'] && ! self::equal( $settlement['amount'], $explanation['net'] ) ) {
			$issues[] = __( 'The saved movements and report do not explain the provider payout exactly.', 'fair-finance' );
		}
		$difference = $bank && null !== $explanation['net'] ? Exact::subtract( $explanation['net'], $bank['amount'] ) : null;
		if ( null === $difference || ! Exact::is_zero( $difference ) ) {
			$issues[] = __( 'The supported payout explanation does not equal the bank entry exactly.', 'fair-finance' );
		}
		$issues      = array_values( array_unique( $issues ) );
		$bank_issues = array_values( array_unique( $bank_issues ) );
		$source      = isset( $explanations['api'] ) ? 'api' : 'csv';
		$allocation  = $this->allocation( $merged, $transactions, $bank_rows, $bank, $items[ $source ], $explanations[ $source ] ?? null, $settlement['currency'] );
		// What the evidence supports now for an existing split, compared only
		// by an explicit recalculation.
		$resplit = $resplit && $bank && AllocationPlanner::ALLOCATED === $allocation['status'] ? $this->propose( $merged, $transactions, $bank, $items[ $source ], $explanations[ $source ] ?? null, $settlement['currency'] ) : null;
		// Material fingerprints exclude source IDs and refresh timestamps. History
		// retains those IDs separately, so refreshing identical facts is harmless.
		$material_revisions = array();
		foreach ( $revisions as $source => $revision ) {
			$material_revisions[ $source ] = array( Movements::content_hash( (array) json_decode( $revision['facts'], true ), $items[ $source ] ), json_decode( (string) $revision['coverage'], true ) );
		}
		$material      = array( $material_revisions, self::material_rows( $transactions ), self::material_rows( $bank_rows ), $links, $memberships, array( $account_id, $currency ), array( $account['id'] ?? null, $account['organization_id'] ?? null ), $issues, $bank_issues );
		$material_hash = self::hash( $material );
		$fingerprint   = self::hash(
			array(
				$material_hash,
				array_map(
					static function ( $revision ) {
								return $revision['id'];
					},
					$revisions
				),
				$decision,
				$context,
				$allocation,
			)
		);
		$history       = $this->local->rows( 'history', 'settlement_id', $id );
		if ( $decision ) {
			$decision['current_state'] = $material_hash === $decision['material_hash'] ? $decision['state'] : 'needs_review';
		}
		return array(
			'settlement'            => $settlement,
			'account'               => $account,
			'revisions'             => $revisions,
			'movements'             => $merged,
			'explanations'          => $explanations,
			'explanation'           => $explanation,
			'bank'                  => $bank,
			'bank_rows'             => $bank_rows,
			'context'               => $context,
			'currency'              => $currency,
			'account_id'            => $account_id,
			'links'                 => $links,
			'whole_transaction_ids' => array_values( array_unique( $whole_ids ) ),
			'issues'                => $issues,
			'bank_issues'           => $bank_issues,
			'difference'            => $difference,
			'can_partial'           => ! $bank_issues,
			'can_full'              => ! $bank_issues && ! $issues,
			'adoption_required'     => $adoption && ! $decision,
			'allocation'            => $allocation,
			'decision'              => $decision,
			'history'               => $history,
			'material_hash'         => $material_hash,
			'fingerprint'           => $fingerprint,
			'resplit'               => $resplit,
		);
	}

	/**
	 * Strip incidental database timestamps from financial evidence.
	 *
	 * @param array $rows Rows.
	 * @return array
	 */
	private static function material_rows( array $rows ) {
		foreach ( $rows as &$row ) {
			// The bank account is fixed at import, and existing decisions were
			// hashed before the column existed.
			unset( $row['created_at'], $row['updated_at'], $row['imported_at'], $row['bank_account_id'] );
			if ( isset( $row['mollie_payment_id'] ) ) {
				unset( $row['description'] );
				$metadata        = (array) json_decode( (string) $row['metadata'], true );
				$row['metadata'] = array_intersect_key( $metadata, array_flip( array( 'connected_site_id', 'detail_url' ) ) );
			}
		}
		return $rows;
	}

	/**
	 * Allocation proposal from this settlement's movement-level evidence.
	 *
	 * Transaction rows follow movements: a payment settled through captures
	 * is allocated through those captures, and refunds and chargebacks are
	 * signed rows of their own payment. Recorded transaction fees are tried
	 * first; otherwise settlement-level fees and adjustments become explicit
	 * signed rows, never attributed to a payment.
	 *
	 * @param array      $movements Merged movements with resolved transactions.
	 * @param array      $transactions Local payments.
	 * @param array      $bank_rows Existing entry and allocations.
	 * @param array|null $bank Selected bank entry.
	 * @param array      $items Movements of the source that explains the payout.
	 * @param array|null $explanation That source's explanation.
	 * @param string     $currency Settlement currency.
	 * @return array
	 */
	private function allocation( array $movements, array $transactions, array $bank_rows, ?array $bank, array $items, $explanation, $currency ) {
		if ( ! $bank ) {
			return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, __( 'Select a bank entry to see its proposed allocation.', 'fair-finance' ) );
		}
		$children = array_values(
			array_filter(
				$bank_rows,
				static function ( $row ) use ( $bank ) {
					return (int) $row['id'] !== (int) $bank['id'];
				}
			)
		);
		if ( $children ) {
			return ( new AllocationPlanner() )->plan( $bank, $children, array(), null );
		}
		return $this->propose( $movements, $transactions, $bank, $items, $explanation, $currency );
	}

	/**
	 * The split this settlement's evidence supports, ignoring any existing
	 * children, so an existing split can be compared with it.
	 *
	 * Recorded net amounts are tried first, alone and then with settlement
	 * adjustments that the evidence lists separately from payment fees. Gross
	 * amounts with settlement costs remain the fallback, with the reason why
	 * net attribution is unavailable.
	 *
	 * @param array      $movements Merged movements with resolved transactions.
	 * @param array      $transactions Local payments.
	 * @param array      $bank Selected bank entry.
	 * @param array      $items Movements of the source that explains the payout.
	 * @param array|null $explanation That source's explanation.
	 * @param string     $currency Settlement currency.
	 * @return array
	 */
	private function propose( array $movements, array $transactions, array $bank, array $items, $explanation, $currency ) {
		$planner  = new AllocationPlanner();
		$by_id    = array_column( $transactions, null, 'id' );
		$captured = array();
		foreach ( $movements as $item ) {
			if ( Movements::TYPE_CAPTURE === $item['type'] ) {
				$captured[ (string) $item['payment_reference'] ] = true;
			}
		}
		$gross    = array();
		$net      = array();
		$payments = array();
		$net_ok   = true;
		$labels   = array(
			/* translators: %s: transaction description. */
			Movements::TYPE_REFUND     => __( 'Refund: %s', 'fair-finance' ),
			/* translators: %s: transaction description. */
			Movements::TYPE_CHARGEBACK => __( 'Chargeback: %s', 'fair-finance' ),
		);
		$reasons  = array(
			'aggregate' => __( 'Payments are only reported as totals, so they cannot be allocated per transaction.', 'fair-finance' ),
			'reference' => __( 'A movement has no single matching local transaction, so it cannot be allocated yet.', 'fair-finance' ),
			'amount'    => __( 'A movement has an unknown settlement amount or a different currency, so it cannot be allocated.', 'fair-finance' ),
		);
		foreach ( $movements as $item ) {
			if ( $item['report'] || ! in_array( $item['type'], array( 'payment', 'capture', 'refund', 'chargeback' ), true ) ) {
				continue;
			}
			if ( Movements::TYPE_PAYMENT === $item['type'] && isset( $captured[ (string) $item['external_id'] ] ) ) {
				continue;
			}
			if ( $item['is_aggregate'] ) {
				return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, $reasons['aggregate'] );
			}
			if ( ! $item['transaction_id'] || ! isset( $by_id[ $item['transaction_id'] ] ) ) {
				return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, $reasons['reference'] );
			}
			if ( null === $item['settlement_amount'] || $currency !== $item['settlement_currency'] ) {
				return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, $reasons['amount'] );
			}
			$transaction = $by_id[ $item['transaction_id'] ];
			$description = (string) ( $transaction['description'] ? $transaction['description'] : $item['description'] );
			$row         = array(
				'kind'         => 'transaction',
				'amount'       => $item['settlement_amount'],
				'description'  => isset( $labels[ $item['type'] ] ) ? sprintf( $labels[ $item['type'] ], $description ) : $description,
				'transaction'  => $transaction,
				'movement_key' => $item['identity_key'],
			);
			$gross[]     = $row;
			if ( Movements::TYPE_PAYMENT === $item['type'] ) {
				// Recorded fees describe the whole payment only.
				$net_ok = $net_ok && self::equal( $item['settlement_amount'], $transaction['amount'] ) && $transaction['currency'] === $currency;
				if ( $net_ok ) {
					$row['amount'] = AllocationPlanner::net( $transaction ) ?? $item['settlement_amount'];
					$payments[]    = array(
						'gross'    => $item['settlement_amount'],
						'net'      => AllocationPlanner::net( $transaction ),
						'recorded' => null !== ( $transaction['mollie_fee'] ?? null ) && '' !== $transaction['mollie_fee'],
					);
				}
			}
			$net[] = $row;
		}
		if ( ! $gross ) {
			return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, __( 'There are no payment movements to allocate.', 'fair-finance' ) );
		}
		$unavailable = __( 'A payment was settled partially, through captures or in another currency, so its recorded whole-payment fee cannot be applied.', 'fair-finance' );
		if ( $net_ok ) {
			$plan = $planner->plan( $bank, array(), $net, 'transaction_net' );
			if ( in_array( $plan['status'], array( AllocationPlanner::PROPOSED, AllocationPlanner::SINGLE ), true ) ) {
				return $plan;
			}
			$adjustments = self::net_adjustments( $payments, $items, $explanation, $currency );
			if ( is_string( $adjustments ) ) {
				$unavailable = $adjustments;
			} else {
				$plan = $planner->plan( $bank, array(), array_merge( $net, $adjustments ), 'transaction_net_adjustments' );
				if ( AllocationPlanner::PROPOSED === $plan['status'] ) {
					return array_merge( $plan, array( 'reason' => __( 'Each payment is allocated at its recorded net amount, and each settlement adjustment listed separately in the evidence gets its own allocation. Recorded payment fees are not deducted again. The amounts sum exactly to this bank entry.', 'fair-finance' ) ) );
				}
				$unavailable = $plan['reason'];
			}
		}
		$deductions = self::deductions( $items, $explanation, $currency );
		if ( is_string( $deductions ) ) {
			return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, $unavailable . ' ' . $deductions );
		}
		$plan = $planner->plan( $bank, array(), array_merge( $gross, $deductions ), 'settlement_deductions' );
		// Say why recorded net amounts were not used, whatever the outcome.
		return array_merge(
			$plan,
			array(
				'reason'          => sprintf(
					/* translators: 1: why recorded net payment amounts cannot be used, 2: the outcome of the gross-amount proposal. */
					__( 'Net payment amounts were not used: %1$s %2$s', 'fair-finance' ),
					$unavailable,
					$plan['reason']
				),
				'net_unavailable' => $unavailable,
			)
		);
	}

	/**
	 * Settlement adjustments to add to recorded net payment amounts.
	 *
	 * Payment fees and settlement adjustments are told apart by structured
	 * evidence only: a report cost line with a payment method is a payment
	 * fee, and any other cost line (no method, or Mollie's refund method) an
	 * adjustment; without a report, the movement type decides. The payment
	 * fees in the evidence must equal the fees already deducted from the
	 * payments exactly, so nothing is deducted twice. Neither a description
	 * nor the remaining difference ever establishes an adjustment.
	 *
	 * @param array      $payments Whole payments: `gross`, `net` (or null) and whether a fee was `recorded`.
	 * @param array      $items Movements of the explaining source.
	 * @param array|null $explanation Its explanation.
	 * @param string     $currency Settlement currency.
	 * @return array|string Adjustment rows, or why net amounts cannot be used.
	 */
	public static function net_adjustments( array $payments, array $items, $explanation, $currency ) {
		if ( ! $payments ) {
			return __( 'No payment was settled whole, so recorded payment fees cannot be used.', 'fair-finance' );
		}
		$deducted = array();
		foreach ( $payments as $payment ) {
			if ( ! $payment['recorded'] ) {
				return __( 'A payment has no recorded Mollie fee, so its net amount cannot be confirmed. Load the missing fees, then preview again.', 'fair-finance' );
			}
			if ( null === $payment['net'] ) {
				return __( 'A recorded payment fee has fractions of a cent, so its net amount cannot be stored exactly.', 'fair-finance' );
			}
			$deducted[] = Exact::subtract( $payment['gross'], $payment['net'] );
		}
		$fees        = array();
		$adjustments = array();
		if ( ! empty( $explanation['report'] ) ) {
			foreach ( $items as $item ) {
				if ( empty( $item['report'] ) || Report::GROUP_COSTS !== $item['report']['group'] ) {
					continue;
				}
				if ( null === $item['settlement_amount'] || $currency !== $item['settlement_currency'] ) {
					return __( 'The report costs are incomplete, so recorded payment fees cannot be compared with them.', 'fair-finance' );
				}
				$method = $item['report']['method'];
				if ( null !== $method && Report::METHOD_REFUND !== $method ) {
					$fees[] = $item['settlement_amount'];
				} else {
					$adjustments[] = $item;
				}
			}
		} else {
			$by_type = array();
			foreach ( $items as $item ) {
				if ( ! $item['report'] && in_array( $item['type'], array( Movements::TYPE_FEE, Movements::TYPE_ADJUSTMENT ), true ) ) {
					$by_type[ $item['type'] ][ $item['is_aggregate'] ? 'aggregate' : 'detail' ][] = $item;
				}
			}
			foreach ( $by_type as $type => $groups ) {
				// Detail rows are preferred over the aggregate that sums them.
				foreach ( $groups['detail'] ?? $groups['aggregate'] as $item ) {
					if ( null === $item['settlement_amount'] || $currency !== $item['settlement_currency'] ) {
						return __( 'A fee or adjustment has an unknown amount or a different currency, so recorded payment fees cannot be compared with it.', 'fair-finance' );
					}
					if ( Movements::TYPE_FEE === $type ) {
						$fees[] = $item['settlement_amount'];
					} else {
						$adjustments[] = $item;
					}
				}
			}
		}
		$recorded = Exact::sum( $deducted );
		$listed   = $fees ? Exact::negate( Exact::sum( $fees ) ) : '0';
		if ( ! self::equal( $recorded, $listed ) ) {
			return sprintf(
				/* translators: 1: exact total of fees recorded on the payments, 2: exact total of payment fees in the settlement evidence. */
				__( 'The fees recorded on the payments total %1$s, but the settlement evidence lists %2$s in payment fees. Correct the recorded fees, then preview again.', 'fair-finance' ),
				Exact::canonical( $recorded ),
				Exact::canonical( $listed )
			);
		}
		if ( ! $adjustments ) {
			return __( 'The recorded payment fees agree with the settlement fees, but no settlement adjustment in the evidence explains the remaining difference.', 'fair-finance' );
		}
		$rows = array();
		foreach ( $adjustments as $item ) {
			$rows[] = array(
				'kind'         => 'settlement',
				'amount'       => $item['settlement_amount'],
				'description'  => '' !== (string) $item['description'] ? $item['description'] : __( 'Settlement adjustment', 'fair-finance' ),
				'movement_key' => $item['identity_key'],
			);
		}
		foreach ( $rows as $row ) {
			if ( null === AllocationPlanner::cents( $row['amount'] ) ) {
				$total = Exact::sum( array_column( $rows, 'amount' ) );
				if ( null === AllocationPlanner::cents( $total ) ) {
					return __( 'Settlement adjustments have fractions of a cent, so they cannot be stored exactly.', 'fair-finance' );
				}
				return array(
					array(
						'kind'        => 'settlement',
						'amount'      => $total,
						'description' => __( 'Settlement adjustments', 'fair-finance' ),
					),
				);
			}
		}
		return $rows;
	}

	/**
	 * Settlement-level fees and adjustments as explicit signed rows.
	 *
	 * A report's costs are taken as its exact costs total. Otherwise detail
	 * rows of each type are preferred over the aggregate that sums them. Rows
	 * with fractions of a cent are combined only when their exact total is
	 * whole cents; nothing is prorated or rounded.
	 *
	 * @param array      $items Movements of the explaining source.
	 * @param array|null $explanation Its explanation.
	 * @param string     $currency Settlement currency.
	 * @return array|string Rows, or the reason they cannot be stated.
	 */
	private static function deductions( array $items, $explanation, $currency ) {
		if ( ! empty( $explanation['report'] ) ) {
			$costs = $explanation['report']['costs'];
			if ( ! $costs['lines'] ) {
				return array();
			}
			if ( null === $costs['amount'] ) {
				return __( 'The report costs are incomplete, so they cannot be allocated.', 'fair-finance' );
			}
			// Report contributions already carry the sign of a deduction.
			$rows = array(
				array(
					'kind'        => 'settlement',
					'amount'      => $costs['amount'],
					'description' => __( 'Mollie costs from the settlement report', 'fair-finance' ),
				),
			);
		} else {
			$by_type = array();
			foreach ( $items as $item ) {
				if ( ! $item['report'] && in_array( $item['type'], array( Movements::TYPE_FEE, Movements::TYPE_ADJUSTMENT ), true ) ) {
					$by_type[ $item['type'] ][ $item['is_aggregate'] ? 'aggregate' : 'detail' ][] = $item;
				}
			}
			$rows = array();
			foreach ( $by_type as $type => $groups ) {
				foreach ( $groups['detail'] ?? $groups['aggregate'] as $item ) {
					if ( null === $item['settlement_amount'] || $currency !== $item['settlement_currency'] ) {
						return __( 'A fee or adjustment has an unknown amount or a different currency, so it cannot be allocated.', 'fair-finance' );
					}
					$rows[] = array(
						'kind'         => 'settlement',
						'amount'       => $item['settlement_amount'],
						'description'  => '' !== (string) $item['description'] ? $item['description'] : ( Movements::TYPE_FEE === $type ? __( 'Settlement fees', 'fair-finance' ) : __( 'Settlement adjustment', 'fair-finance' ) ),
						'movement_key' => $item['identity_key'],
					);
				}
			}
		}
		foreach ( $rows as $row ) {
			if ( null === AllocationPlanner::cents( $row['amount'] ) ) {
				$total = Exact::sum( array_column( $rows, 'amount' ) );
				return null === AllocationPlanner::cents( $total ) ? __( 'Settlement fees have fractions of a cent, so they cannot be stored exactly. Allocate this entry manually.', 'fair-finance' ) : array(
					array(
						'kind'        => 'settlement',
						'amount'      => $total,
						'description' => __( 'Settlement fees and adjustments', 'fair-finance' ),
					),
				);
			}
		}
		return $rows;
	}

	/**
	 * This settlement's proposal for a bank entry matched by hand, used only
	 * when its evidence is complete and covers exactly the matched payments.
	 *
	 * @param int   $id Settlement ID.
	 * @param int   $entry_id Bank entry ID.
	 * @param int[] $transaction_ids Matched transactions.
	 * @return array|null
	 */
	public function plan_for_transactions( $id, $entry_id, array $transaction_ids ) {
		$preview = $this->preview( $id, array( 'entry_id' => $entry_id ) );
		if ( is_wp_error( $preview ) || $preview['issues'] || $preview['decision'] ) {
			return null;
		}
		$covered = array();
		foreach ( $preview['movements'] as $movement ) {
			if ( ! $movement['is_aggregate'] && in_array( $movement['type'], array( 'payment', 'capture', 'refund', 'chargeback' ), true ) ) {
				$covered[] = (int) $movement['transaction_id'];
			}
		}
		$covered = array_values( array_unique( $covered ) );
		sort( $covered );
		sort( $transaction_ids );
		if ( $covered !== $transaction_ids ) {
			return null;
		}
		$plan               = $preview['allocation'];
		$plan['settlement'] = (int) $id;
		return $plan;
	}

	/**
	 * Shared evidence for one settlement and one bank entry, in either direction.
	 * Dates only support a reference or amount; they never establish a match.
	 *
	 * @param array       $settlement Settlement row.
	 * @param string|null $amount Payout amount, or the supported explanation for CSV-only records.
	 * @param array       $entry Bank entry with its confirmed context columns.
	 * @return array
	 */
	public static function score( array $settlement, $amount, array $entry ) {
		$reasons = array();
		$score   = 0;
		if ( $settlement['reference'] && false !== stripos( (string) $entry['description'], $settlement['reference'] ) ) {
			$score    += 8;
			$reasons[] = __( 'Payout reference appears in the bank description.', 'fair-finance' );
		}
		if ( self::equal( $amount, $entry['amount'] ) ) {
			$score    += 4;
			$reasons[] = __( 'The amount matches exactly.', 'fair-finance' );
		}
		if ( (int) $entry['context_account_id'] === (int) $settlement['account_id'] ) {
			$score    += 4;
			$reasons[] = __( 'The administrator-confirmed payout account matches.', 'fair-finance' );
		}
		if ( $entry['context_currency'] === $settlement['currency'] ) {
			$score    += 2;
			$reasons[] = __( 'The administrator-confirmed currency matches.', 'fair-finance' );
		}
		if ( $settlement['settled_at'] && abs( strtotime( $entry['entry_date'] ) - strtotime( $settlement['settled_at'] ) ) <= 7 * DAY_IN_SECONDS ) {
			++$score;
			$reasons[] = __( 'The bank date is within seven days of the payout.', 'fair-finance' );
		}
		return array(
			'score'            => $score,
			'reasons'          => $reasons,
			'context_mismatch' => ( $entry['context_currency'] && $entry['context_currency'] !== $settlement['currency'] ) || ( $entry['context_account_id'] && (int) $entry['context_account_id'] !== (int) $settlement['account_id'] ),
		);
	}

	/**
	 * Highest score first; ties keep a stable ID order.
	 *
	 * @param array $rows Scored rows.
	 * @return array
	 */
	private static function rank( array $rows ) {
		usort(
			$rows,
			static function ( $a, $b ) {
				$rank = $b['score'] <=> $a['score'];
				return $rank ? $rank : ( (int) $a['id'] <=> (int) $b['id'] );
			}
		);
		return $rows;
	}

	/**
	 * Paginated local bank search, ranked with visible reasons.
	 *
	 * @param int $id Settlement ID.
	 * @return array|WP_Error
	 */
	public function candidates( $id ) {
		$preview = $this->preview( $id );
		if ( is_wp_error( $preview ) ) {
			return $preview;
		}
		$settlement = $preview['settlement'];
		$amount     = $settlement['amount'] ?? $preview['explanation']['net'];
		$candidates = array();
		$page       = 1;
		do {
			$batch = $this->local->candidates( $id, $page++ );
			foreach ( $batch as $entry ) {
				$candidates[] = array_merge( $entry, self::score( $settlement, $amount, $entry ) );
			}
			$batch_count = count( $batch );
		} while ( 100 === $batch_count );
		return self::rank( $candidates );
	}

	/**
	 * Payout amount to compare, without contacting a provider. A CSV-only
	 * record has no provider amount, so its supported explanation is used,
	 * as the bank candidates of that settlement use it.
	 *
	 * @param array $settlement Settlement row.
	 * @return string|null
	 */
	private function payout_amount( array $settlement ) {
		if ( null !== $settlement['amount'] ) {
			return $settlement['amount'];
		}
		foreach ( array( 'api', 'csv' ) as $source ) {
			if ( $settlement[ $source . '_revision_id' ] ) {
				return self::explain( $this->provider->get_items( (int) $settlement[ $source . '_revision_id' ] ), $settlement['currency'] )['net'];
			}
		}
		return null;
	}

	/**
	 * Saved settlements that may be the payout of one bank entry, ranked with
	 * visible reasons. Every unassociated settlement is scored before the
	 * ranked result is paginated; a reference or exact amount is required.
	 *
	 * @param int $entry_id Bank entry ID.
	 * @param int $page Result page.
	 * @param int $per_page Result page size.
	 * @return array|WP_Error
	 */
	public function suggest_settlements( $entry_id, $page = 1, $per_page = 10 ) {
		try {
			$entry = null;
			foreach ( $this->local->bank( $entry_id ) as $row ) {
				if ( (int) $row['id'] === (int) $entry_id ) {
					$entry = $row;
				}
			}
			if ( ! $entry ) {
				return self::error( 'entry_not_found', __( 'This bank entry was not found.', 'fair-finance' ), 404 );
			}
			if ( $entry['parent_entry_id'] || 'income' !== $entry['entry_type'] || ! empty( $entry['payment_source'] ) ) {
				return self::error( 'reconciliation_entry_ineligible', __( 'Only bank income entries can be matched to a settlement.', 'fair-finance' ) );
			}
			if ( $this->local->rows( 'decisions', 'entry_id', $entry_id ) ) {
				return self::error( 'reconciliation_entry_in_use', __( 'This bank entry is already associated with a settlement.', 'fair-finance' ), 409 );
			}
			$context                     = $this->local->context( $entry_id );
			$entry['context_account_id'] = $context['account_id'] ?? null;
			$entry['context_currency']   = $context['currency'] ?? null;
			$accounts                    = array();
			$suggestions                 = array();
			$batch_page                  = 1;
			do {
				$batch = $this->local->unassociated_settlements( $batch_page++ );
				foreach ( $batch as $settlement ) {
					$amount   = $this->payout_amount( $settlement );
					$evidence = self::score( $settlement, $amount, $entry );
					// Account context, currency and date alone are not a suggestion.
					$referenced = $settlement['reference'] && false !== stripos( (string) $entry['description'], $settlement['reference'] );
					if ( ! $referenced && ! self::equal( $amount, $entry['amount'] ) ) {
						continue;
					}
					$account_id = (int) $settlement['account_id'];
					if ( ! array_key_exists( $account_id, $accounts ) ) {
						$account                 = $this->provider->get_account( $account_id );
						$accounts[ $account_id ] = $account ? array(
							'id'    => (int) $account['id'],
							'label' => $account['label'],
						) : null;
					}
					$suggestions[] = array_merge(
						array(
							'id'           => (int) $settlement['id'],
							'reference'    => $settlement['reference'],
							'provider_id'  => $settlement['provider_id'],
							'account'      => $accounts[ $account_id ],
							'amount'       => $amount,
							'currency'     => $settlement['currency'],
							'settled_at'   => $settlement['settled_at'],
							'completeness' => $settlement['completeness'],
							'state'        => null,
						),
						$evidence
					);
				}
				$batch_count = count( $batch );
			} while ( 100 === $batch_count );
		} catch ( \Throwable $error ) {
			return self::error( 'reconciliation_read_failed', __( 'The local reconciliation evidence could not be read. Try again.', 'fair-finance' ), 500 );
		}
		$suggestions = self::rank( $suggestions );
		$total       = count( $suggestions );
		$per_page    = max( 1, (int) $per_page );
		$page        = max( 1, (int) $page );
		return array(
			'items'     => array_slice( $suggestions, ( $page - 1 ) * $per_page, $per_page ),
			'total'     => $total,
			'page'      => $page,
			'pages'     => max( 1, (int) ceil( $total / $per_page ) ),
			'ambiguous' => $total > 1 && $suggestions[0]['score'] === $suggestions[1]['score'],
		);
	}

	/**
	 * Saved bank associations with their current state, for the overview.
	 *
	 * @param string|null $date_from Earliest bank entry date.
	 * @param string|null $date_to Latest bank entry date.
	 * @return array Keyed by bank entry ID.
	 */
	public function associations( $date_from = null, $date_to = null ) {
		$associations = array();
		foreach ( $this->local->associations( $date_from, $date_to ) as $row ) {
			$preview = $this->preview( (int) $row['settlement_id'] );
			if ( is_wp_error( $preview ) || ! $preview['decision'] ) {
				continue;
			}
			$settlement                             = $preview['settlement'];
			$associations[ (int) $row['entry_id'] ] = array(
				'id'            => (int) $settlement['id'],
				'reference'     => $settlement['reference'],
				'provider_id'   => $settlement['provider_id'],
				'account'       => $preview['account'] ? array(
					'id'    => (int) $preview['account']['id'],
					'label' => $preview['account']['label'],
				) : null,
				'amount'        => $settlement['amount'] ?? $preview['explanation']['net'],
				'currency'      => $settlement['currency'],
				'state'         => $preview['decision']['state'],
				'current_state' => $preview['decision']['current_state'],
			);
		}
		return $associations;
	}

	/**
	 * Preview recalculating an existing settlement split. Preview never writes.
	 *
	 * @param int  $id Settlement ID.
	 * @param bool $lock Use locking reads within the recalculation.
	 * @return array|WP_Error
	 */
	public function recalculation( $id, $lock = false ) {
		try {
			return $this->build_recalculation( $id, $lock );
		} catch ( \Throwable $error ) {
			return self::error( 'reconciliation_read_failed', __( 'The local reconciliation evidence could not be read. Try again.', 'fair-finance' ), 500 );
		}
	}

	/**
	 * Build the recalculation preview.
	 *
	 * @param int  $id Settlement ID.
	 * @param bool $lock Lock records.
	 * @return array|WP_Error
	 */
	private function build_recalculation( $id, $lock ) {
		$decision = $this->local->decision( $id, $lock );
		if ( ! $decision || 'full' !== $decision['state'] ) {
			return self::error( 'reconciliation_not_split', __( 'Only a fully reconciled settlement’s split can be recalculated.', 'fair-finance' ), 409 );
		}
		$preview = $this->build_preview( $id, array( 'entry_id' => (int) $decision['entry_id'] ), $lock, true );
		if ( is_wp_error( $preview ) ) {
			return $preview;
		}
		$children = array_values(
			array_filter(
				$preview['bank_rows'],
				static function ( $row ) use ( $decision ) {
					return (int) $row['id'] !== (int) $decision['entry_id'];
				}
			)
		);
		$plan     = $preview['resplit'];
		$reasons  = array();
		if ( ! $children ) {
			$reasons[] = __( 'This bank entry is not split, so there is nothing to recalculate.', 'fair-finance' );
		}
		if ( ! $preview['can_full'] ) {
			$reasons[] = __( 'Resolve the reconciliation issues shown above before recalculating the split.', 'fair-finance' );
		}
		if ( $children && ( ! $plan || AllocationPlanner::PROPOSED !== $plan['status'] ) ) {
			$reasons[] = $plan ? $plan['reason'] : __( 'There is no supported evidence to allocate.', 'fair-finance' );
		}
		$generated = SplitRecalculation::generated( $preview['history'] );
		$diff      = $reasons ? array(
			'status'   => SplitRecalculation::BLOCKED,
			'changes'  => array(),
			'reasons'  => $reasons,
			'warnings' => array(),
		) : SplitRecalculation::diff( $children, $generated, $plan['rows'] );
		$result    = array(
			'status'      => $diff['status'],
			'changes'     => $diff['changes'],
			'reasons'     => $diff['reasons'],
			'warnings'    => $diff['warnings'],
			'method'      => $plan['method'] ?? null,
			'explanation' => $plan['reason'] ?? null,
			'currency'    => $preview['settlement']['currency'],
			'entry_id'    => (int) $decision['entry_id'],
		);
		// Every allocation field and the evidence are part of what was reviewed.
		$result['fingerprint'] = self::hash( array( 'recalculate', $preview['fingerprint'], $children, $generated['history_id'] ?? null, $result ) );
		$result['preview']     = $preview;
		$result['rows']        = $plan['rows'] ?? array();
		return $result;
	}

	/**
	 * Apply a reviewed recalculation atomically, recorded in history.
	 *
	 * @param int    $id Settlement ID.
	 * @param string $fingerprint Reviewed recalculation fingerprint.
	 * @return array|WP_Error Fresh recalculation preview.
	 * @throws \RuntimeException Internally caught to roll back every failed write.
	 */
	public function recalculate( $id, $fingerprint ) {
		global $wpdb;
		if ( ! $this->provider->lock( SettlementStore::WRITE_LOCK, 15 ) ) {
			return self::error( 'reconciliation_busy', __( 'Another settlement operation is running. Try again.', 'fair-finance' ), 409 );
		}
		$this->provider->begin();
		try {
			$review = $this->recalculation( $id, true );
			if ( is_wp_error( $review ) ) {
				$this->provider->rollback();
				return $review;
			}
			$request_hash = self::hash( array( 'recalculate', $id, $fingerprint ) );
			$prior        = $wpdb->get_row( $wpdb->prepare( 'SELECT id FROM %i WHERE request_hash = %s', Schema::reconciliation_table( 'history' ), $request_hash ), ARRAY_A );
			if ( $prior ) {
				// A retry of an applied request changes nothing.
				$this->provider->rollback();
				return $this->public_recalculation( $review );
			}
			if ( ! hash_equals( $review['fingerprint'], (string) $fingerprint ) ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_stale', __( 'The split or its evidence changed. Preview the recalculation again before applying it.', 'fair-finance' ), 409 );
			}
			if ( SplitRecalculation::BLOCKED === $review['status'] ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_recalculation_blocked', __( 'This split cannot be recalculated automatically. Review the reasons shown in the preview.', 'fair-finance' ), 409 );
			}
			if ( SplitRecalculation::UNCHANGED === $review['status'] ) {
				$this->provider->rollback();
				return $this->public_recalculation( $review );
			}
			$preview  = $review['preview'];
			$entry_id = $review['entry_id'];
			$table    = \FairFinance\Database\Schema::get_financial_entries_table_name();
			$parent   = null;
			$before   = array();
			foreach ( $preview['bank_rows'] as $row ) {
				if ( (int) $row['id'] === $entry_id ) {
					$parent = $row;
				} else {
					$before[] = $row;
				}
			}
			$ids  = array();
			$rows = array();
			foreach ( $review['changes'] as $change ) {
				if ( SplitRecalculation::REMOVE === $change['action'] ) {
					if ( 1 !== $wpdb->delete(
						$table,
						array(
							'id'              => $change['id'],
							'parent_entry_id' => $entry_id,
						),
						array( '%d', '%d' )
					) ) {
						throw new \RuntimeException( 'Allocation removal failed.' );
					}
					continue;
				}
				if ( SplitRecalculation::ADD === $change['action'] ) {
					// Inserted directly so an unclassified adjustment stays untagged
					// instead of inheriting the bank entry's tag.
					$inserted = $wpdb->insert(
						$table,
						array(
							'amount'          => $change['proposed_amount'],
							'entry_type'      => $parent['entry_type'],
							'entry_date'      => $parent['entry_date'],
							'description'     => $change['description'],
							'transaction_id'  => $parent['transaction_id'],
							'parent_entry_id' => $entry_id,
						),
						array( '%s', '%s', '%s', '%s', '%d', '%d' )
					);
					if ( ! $inserted ) {
						throw new \RuntimeException( 'Allocation insert failed.' );
					}
					$change['id'] = (int) $wpdb->insert_id;
				} elseif ( SplitRecalculation::UPDATE === $change['action'] ) {
					// Only the amount, and a generated description, change.
					$data = array( 'amount' => $change['proposed_amount'] );
					if ( null !== $change['new_description'] ) {
						$data['description'] = $change['new_description'];
					}
					if ( false === $wpdb->update(
						$table,
						$data,
						array(
							'id'              => $change['id'],
							'parent_entry_id' => $entry_id,
						),
						null,
						array( '%d', '%d' )
					) ) {
						throw new \RuntimeException( 'Allocation update failed.' );
					}
				}
				$ids[]  = (int) $change['id'];
				$rows[] = array(
					'kind'           => $change['kind'],
					'amount'         => $change['proposed_amount'],
					'description'    => $change['new_description'] ?? $change['description'],
					'movement_key'   => $change['movement_key'],
					'transaction_id' => $change['transaction_id'],
				);
			}
			$after_rows = ( new ReconciliationRepository() )->bank( $entry_id, true );
			$decision   = $preview['decision'];
			unset( $preview['history'], $preview['resplit'] );
			$history_id = $this->local->save(
				'history',
				array(
					'settlement_id' => $id,
					'decision_id'   => (int) $decision['id'],
					'request_hash'  => $request_hash,
					'state'         => 'recalculated',
					'actor_id'      => get_current_user_id(),
					'confirmed_at'  => current_time( 'mysql', true ),
					'reviewed'      => wp_json_encode(
						array(
							'preview'         => $preview,
							'allocation_ids'  => $ids,
							'allocation_rows' => $rows,
							'allocation'      => array(
								'status'    => AllocationPlanner::PROPOSED,
								'method'    => $review['method'],
								'repair'    => false,
								'revisions' => array_map(
									static function ( $revision ) {
										return (int) $revision['id'];
									},
									$preview['revisions']
								),
							),
							'recalculation'   => array(
								'changes'  => $review['changes'],
								'warnings' => $review['warnings'],
								'before'   => self::material_rows( $before ),
								'after'    => self::material_rows(
									array_values(
										array_filter(
											$after_rows,
											static function ( $row ) use ( $entry_id ) {
												return (int) $row['id'] !== $entry_id;
											}
										)
									)
								),
							),
						)
					),
				)
			);
			$this->record_evidence( $history_id, $preview );
			$after = $this->preview( $id, array( 'entry_id' => $entry_id ), true );
			if ( is_wp_error( $after ) ) {
				throw new \RuntimeException( 'Unable to verify committed evidence.' );
			}
			$this->local->save(
				'decisions',
				array(
					'history_id'    => $history_id,
					'material_hash' => $after['material_hash'],
				),
				array( 'id' => (int) $decision['id'] )
			);
			$this->provider->commit();
			$fresh = $this->recalculation( $id );
			return is_wp_error( $fresh ) ? $fresh : $this->public_recalculation( $fresh );
		} catch ( \Throwable $error ) {
			$this->provider->rollback();
			return self::error( 'reconciliation_save_failed', __( 'The split could not be recalculated. Nothing was changed.', 'fair-finance' ), 500 );
		} finally {
			$this->provider->unlock( SettlementStore::WRITE_LOCK );
		}
	}

	/**
	 * Recalculation preview as returned to the screen.
	 *
	 * @param array $review Recalculation.
	 * @return array
	 */
	public function public_recalculation( array $review ) {
		unset( $review['preview']['resplit'] );
		return $review;
	}

	/**
	 * Save the reviewed movement evidence of one history row.
	 *
	 * @param int   $history_id History row.
	 * @param array $preview Reviewed preview.
	 * @return void
	 */
	private function record_evidence( $history_id, array $preview ) {
		foreach ( $preview['movements'] as $movement ) {
			foreach ( $movement['sources'] as $source ) {
				$this->local->save(
					'evidence',
					array(
						'history_id'     => $history_id,
						'revision_id'    => $preview['revisions'][ $source ]['id'],
						'movement_key'   => $movement['identity_key'],
						'transaction_id' => $movement['transaction_id'],
						'evidence'       => wp_json_encode( $movement ),
					)
				);
			}
		}
	}

	/**
	 * Confirm under the provider write lock and SQL row/range locks.
	 *
	 * @param int   $id Settlement ID.
	 * @param array $proposal Reviewed proposal.
	 * @return array|WP_Error
	 * @throws \RuntimeException Internally caught to roll back every failed write.
	 */
	public function confirm( $id, array $proposal ) {
		global $wpdb;
		if ( ! $this->provider->lock( SettlementStore::WRITE_LOCK, 15 ) ) {
			return self::error( 'reconciliation_busy', __( 'Another settlement operation is running. Try again.', 'fair-finance' ), 409 );
		}
		$this->provider->begin();
		try {
			$preview = $this->preview( $id, $proposal, true );
			if ( is_wp_error( $preview ) ) {
				$this->provider->rollback();
				return $preview;
			}
			$request_hash = self::hash( array( $id, $proposal ) );
			$prior        = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE request_hash = %s', Schema::reconciliation_table( 'history' ), $request_hash ), ARRAY_A );
			if ( $prior ) {
				$this->provider->rollback();
				return $preview;
			}
			if ( ! hash_equals( $preview['fingerprint'], (string) $proposal['fingerprint'] ) ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_stale', __( 'The reviewed data changed. Run preview again before confirming.', 'fair-finance' ), 409 );
			}
			$state = $proposal['state'];
			if ( 'released' !== $state && ( ! $preview['can_partial'] || ( 'full' === $state && ! $preview['can_full'] ) || ( $preview['adoption_required'] && empty( $proposal['adopt_existing'] ) ) ) ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_ineligible', __( 'Resolve the blocking issues and explicitly adopt compatible existing matches before confirming.', 'fair-finance' ), 409 );
			}
			$decision = $preview['decision'];
			// Supported splits are part of full reconciliation, so an
			// unchanged full decision still applies a missing split.
			$allocate = 'full' === $state && in_array( $preview['allocation']['status'], array( AllocationPlanner::PROPOSED, AllocationPlanner::SINGLE ), true );
			$repair   = $decision && 'full' === $decision['state'] && AllocationPlanner::PROPOSED === $preview['allocation']['status'];
			if ( $decision && $decision['state'] === $state && $decision['material_hash'] === $preview['material_hash'] && ! $repair ) {
				$this->provider->rollback();
				return $preview;
			}
			if ( 'released' === $state && ! $decision ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_not_confirmed', __( 'There is no bank association to release.', 'fair-finance' ) );
			}
			$entry_id = (int) ( $preview['bank']['id'] ?? ( $decision['entry_id'] ?? 0 ) );
			if ( $decision && (int) $decision['entry_id'] !== $entry_id ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_release_first', __( 'Release the existing bank association before selecting a different entry.', 'fair-finance' ), 409 );
			}
			$decision_id = $decision ? (int) $decision['id'] : $this->local->save(
				'decisions',
				array(
					'settlement_id' => $id,
					'entry_id'      => $entry_id,
					'state'         => $state,
					'material_hash' => $preview['material_hash'],
				)
			);
			$context     = array(
				'entry_id'     => $entry_id,
				'account_id'   => $preview['account_id'],
				'currency'     => $preview['currency'],
				'actor_id'     => get_current_user_id(),
				'confirmed_at' => current_time( 'mysql', true ),
			);
			if ( 'released' !== $state && ! $preview['context'] ) {
				$this->local->save( 'context', $context );
			}
			$allocation_ids = array();
			if ( $allocate ) {
				$reviewed_budget = array_key_exists( 'budget_id', $proposal ) ? array( 'budget_id' => $proposal['budget_id'] ? (int) $proposal['budget_id'] : null ) : null;
				$allocation_ids  = ( new ReconciliationAllocation() )->apply( $entry_id, $preview['allocation'], $reviewed_budget );
			}
			// Movement evidence remains authoritative. Only whole-payment evidence
			// may add compatibility links, and only on full confirmation.
			if ( 'full' === $state ) {
				foreach ( $preview['whole_transaction_ids'] as $transaction_id ) {
					if ( ! EntryTransaction::link( $entry_id, $transaction_id ) ) {
						throw new \RuntimeException( 'Compatibility link failed.' );
					}
				}
			}
			$reviewed = array(
				'preview'            => $preview,
				'proposal'           => $proposal,
				'allocation_ids'     => $allocation_ids,
				'allocation'         => array(
					'status'    => $allocate ? $preview['allocation']['status'] : null,
					'method'    => $preview['allocation']['method'],
					'repair'    => $repair,
					'revisions' => array_map(
						static function ( $revision ) {
							return (int) $revision['id'];
						},
						$preview['revisions']
					),
				),
				'context_provenance' => 'administrator',
			);
			// Do not recursively copy the preceding history into every history row.
			unset( $reviewed['preview']['history'] );
			$history_id = $this->local->save(
				'history',
				array(
					'settlement_id' => $id,
					'decision_id'   => $decision_id,
					'request_hash'  => $request_hash,
					'state'         => $state,
					'actor_id'      => get_current_user_id(),
					'confirmed_at'  => current_time( 'mysql', true ),
					'reviewed'      => wp_json_encode( $reviewed ),
				)
			);
			$this->record_evidence( $history_id, $preview );
			$after = $this->preview( $id, $proposal, true );
			if ( is_wp_error( $after ) ) {
				throw new \RuntimeException( 'Unable to verify committed evidence.' );
			}
			$this->local->save(
				'decisions',
				array(
					'state'         => $state,
					'history_id'    => $history_id,
					'material_hash' => $after['material_hash'],
				),
				array( 'id' => $decision_id )
			);
			if ( 'released' === $state ) {
				if ( false === $wpdb->delete( Schema::reconciliation_table( 'context' ), array( 'entry_id' => $entry_id ) ) ) {
					throw new \RuntimeException( 'Context release failed.' );
				}
				// Keep immutable history/evidence and reviewed context. Existing
				// manual or compatibility links and allocations are never removed.
				if ( false === $wpdb->delete( Schema::reconciliation_table( 'decisions' ), array( 'id' => $decision_id ) ) ) {
					throw new \RuntimeException( 'Release failed.' );
				}
			}
			$this->provider->commit();
			return $this->preview( $id, $proposal );
		} catch ( \Throwable $error ) {
			$this->provider->rollback();
			return self::error( 'reconciliation_save_failed', __( 'Reconciliation could not be saved. Nothing was changed.', 'fair-finance' ), 500 );
		} finally {
			$this->provider->unlock( SettlementStore::WRITE_LOCK );
		}
	}
}
