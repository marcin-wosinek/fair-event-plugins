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
		$rows = ( new ReconciliationRepository() )->rows( 'decisions', 'entry_id', (int) $match[1] );
		return $rows ? self::error( 'reconciliation_entry_in_use', __( 'This entry belongs to a saved settlement reconciliation. Review or release its bank association in Reconciliation first.', 'fair-finance' ), 409 ) : $result;
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
	 * @return array|WP_Error
	 */
	private function build_preview( $id, array $proposal, $lock ) {
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
		if ( ! $bank || $bank['parent_entry_id'] || 'income' !== $bank['entry_type'] ) {
			$bank_issues[] = __( 'Select an eligible bank income entry.', 'fair-finance' );
		}
		if ( ! $currency || ! $account_id ) {
			$bank_issues[] = __( 'Confirm the bank entry’s currency and payout account explicitly.', 'fair-finance' );
		} elseif ( $currency !== $settlement['currency'] || $account_id !== (int) $settlement['account_id'] || ( $context && ( $context['currency'] !== $currency || (int) $context['account_id'] !== $account_id ) ) ) {
			$bank_issues[] = __( 'The bank entry’s confirmed currency or account does not match this settlement.', 'fair-finance' );
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
		$allocation  = $this->allocation( $merged, $transactions, $bank_rows, $bank );
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
			unset( $row['created_at'], $row['updated_at'], $row['imported_at'] );
			if ( isset( $row['mollie_payment_id'] ) ) {
				unset( $row['description'] );
				$metadata        = (array) json_decode( (string) $row['metadata'], true );
				$row['metadata'] = array_intersect_key( $metadata, array_flip( array( 'connected_site_id', 'detail_url' ) ) );
			}
		}
		return $rows;
	}

	/**
	 * Offer only justified positive, cent-exact, whole-movement allocations.
	 *
	 * @param array      $movements Merged movements.
	 * @param array      $transactions Local payments.
	 * @param array      $bank_rows Existing entry and allocations.
	 * @param array|null $bank Selected bank entry.
	 * @return array
	 */
	private function allocation( array $movements, array $transactions, array $bank_rows, ?array $bank ) {
		$unavailable = array(
			'supported' => false,
			'rows'      => array(),
			'reason'    => __( 'Existing allocations are preserved. An automatic split requires positive, cent-exact movement amounts that sum to the bank entry without allocating aggregate fees.', 'fair-finance' ),
		);
		if ( ! $bank || count( $bank_rows ) > 1 || $bank['budget_id'] || $bank['event_url'] || $bank['event_date_id'] || $bank['tag'] || $bank['participant_id'] ) {
			return $unavailable;
		}
		$by_id  = array_column( $transactions, null, 'id' );
		$rows   = array();
		$values = array();
		$sites  = new ConnectedSiteBudgetResolver();
		$events = new EventBudgetResolver();
		foreach ( $movements as $item ) {
			if ( $item['report'] || 'summary' === $item['type'] ) {
				continue;
			}
			$amount = $item['settlement_amount'];
			if ( $item['is_aggregate'] || 'payment' !== $item['type'] || ! $item['transaction_id'] || null === $amount || ! preg_match( '/^\d{1,8}(?:\.\d{1,2})?$/', $amount ) || Exact::is_zero( $amount ) ) {
				return $unavailable;
			}
			$transaction = $by_id[ $item['transaction_id'] ];
			$metadata    = (array) json_decode( (string) $transaction['metadata'], true );
			$budget      = $sites->resolve( $metadata['connected_site_id'] ?? null ) ?? $events->resolve( empty( $metadata['connected_site_id'] ) ? ( $transaction['event_date_id'] ?? null ) : null );
			$rows[]      = array(
				'amount'       => $amount,
				'description'  => $item['description'],
				'budget_id'    => $budget,
				'movement_key' => $item['identity_key'],
			);
			$values[]    = $amount;
		}
		if ( count( $rows ) < 2 || ! self::equal( Exact::sum( $values ), $bank['amount'] ) ) {
			return $unavailable;
		}
		return array(
			'supported' => true,
			'rows'      => $rows,
			'reason'    => __( 'The reviewed movement amounts sum exactly to this bank entry. Splitting is optional.', 'fair-finance' ),
		);
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
				$entry['score']            = $score;
				$entry['reasons']          = $reasons;
				$entry['context_mismatch'] = ( $entry['context_currency'] && $entry['context_currency'] !== $settlement['currency'] ) || ( $entry['context_account_id'] && (int) $entry['context_account_id'] !== (int) $settlement['account_id'] );
				$candidates[]              = $entry;
			}
			$batch_count = count( $batch );
		} while ( 100 === $batch_count );
		usort(
			$candidates,
			static function ( $a, $b ) {
				$rank = $b['score'] <=> $a['score'];
				return $rank ? $rank : ( (int) $a['id'] <=> (int) $b['id'] );
			}
		);
		return $candidates;
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
			if ( ! empty( $proposal['allocate'] ) && ( 'full' !== $state || ! $preview['allocation']['supported'] ) ) {
				$this->provider->rollback();
				return self::error( 'reconciliation_allocation_unsupported', __( 'An automatic allocation is not supported by this evidence.', 'fair-finance' ), 409 );
			}
			$decision = $preview['decision'];
			if ( $decision && $decision['state'] === $state && $decision['material_hash'] === $preview['material_hash'] && empty( $proposal['allocate'] ) ) {
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
			if ( ! empty( $proposal['allocate'] ) ) {
				foreach ( $preview['allocation']['rows'] as $row ) {
					if ( array_key_exists( 'budget_id', $proposal ) ) {
						$row['budget_id'] = $proposal['budget_id'] ? $proposal['budget_id'] : null;
					}
					$result = $wpdb->insert(
						Schema::get_financial_entries_table_name(),
						array(
							'amount'          => $row['amount'],
							'entry_type'      => $preview['bank']['entry_type'],
							'entry_date'      => $preview['bank']['entry_date'],
							'description'     => $row['description'],
							'budget_id'       => $row['budget_id'],
							'parent_entry_id' => $entry_id,
						)
					);
					if ( false === $result ) {
						throw new \RuntimeException( 'Allocation write failed.' );
					}
					$allocation_ids[] = (int) $wpdb->insert_id;
				}
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
