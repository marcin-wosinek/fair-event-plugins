<?php
/**
 * Reconciliation matching and allocation, whichever screen starts it.
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

use FairFinance\Database\ReconciliationRepository;
use FairFinance\Database\Schema;
use FairFinance\Models\FinancialEntry;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Plans and writes the allocations of a reconciled bank entry.
 *
 * Manual transaction matching (the bank-transfer list and legacy CSV
 * review) and saved-settlement confirmation both write through apply(), so
 * equivalent reviewed evidence produces equivalent children. apply() never
 * opens or commits a database transaction: every operation has exactly one
 * owner that rolls links, children, parent updates and history back together.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ReconciliationAllocation {
	/**
	 * Allocation planner.
	 *
	 * @var AllocationPlanner
	 */
	private $planner;

	/**
	 * Construct with a fresh planner.
	 */
	public function __construct() {
		$this->planner = new AllocationPlanner();
	}

	/**
	 * The shared planner, for evidence adapters.
	 *
	 * @return AllocationPlanner
	 */
	public function planner() {
		return $this->planner;
	}

	/**
	 * Whole-payment rows: each transaction's amount after its recorded fees.
	 *
	 * @param array $transactions Transaction rows.
	 * @return array|null Null when a net amount cannot be stated exactly.
	 */
	public static function transaction_rows( array $transactions ) {
		$rows = array();
		foreach ( $transactions as $transaction ) {
			$net = AllocationPlanner::net( $transaction );
			if ( null === $net ) {
				return null;
			}
			$rows[] = array(
				'kind'        => 'transaction',
				'amount'      => $net,
				'description' => (string) ( $transaction['description'] ?? '' ),
				'transaction' => $transaction,
			);
		}
		return $rows;
	}

	/**
	 * Proposal for matching transactions to a bank entry by hand.
	 *
	 * Recorded transaction fees are tried first. When their net amounts do
	 * not explain the entry, saved settlement evidence for exactly these
	 * transactions may, through its settlement-level fees and adjustments.
	 *
	 * @param int   $entry_id Bank entry ID.
	 * @param array $transactions Transaction rows.
	 * @param bool  $lock Lock the entry and its allocations.
	 * @return array
	 */
	public function plan_match( $entry_id, array $transactions, $lock = false ) {
		if ( ! AllocationPlanner::available() ) {
			return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, __( 'Update Fair Payments Connector to allocate matched transactions.', 'fair-finance' ) );
		}
		$rows     = ( new ReconciliationRepository() )->bank( $entry_id, $lock );
		$entry    = null;
		$children = array();
		foreach ( $rows as $row ) {
			if ( (int) $row['id'] === (int) $entry_id ) {
				$entry = $row;
			} else {
				$children[] = $row;
			}
		}
		if ( ! $entry ) {
			return AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, __( 'Financial entry not found.', 'fair-finance' ) );
		}
		$evidence = self::transaction_rows( $transactions );
		$plan     = null === $evidence
			? AllocationPlanner::outcome( AllocationPlanner::UNSUPPORTED, __( 'A transaction fee has fractions of a cent, so its net amount cannot be stored exactly.', 'fair-finance' ) )
			: $this->planner->plan( $entry, $children, $evidence, 'transaction_net' );
		if ( in_array( $plan['status'], array( AllocationPlanner::PROPOSED, AllocationPlanner::SINGLE, AllocationPlanner::ALLOCATED ), true ) ) {
			return $plan;
		}
		$settlement = $this->settlement_plan( $entry_id, $transactions );
		if ( $settlement && AllocationPlanner::PROPOSED === $settlement['status'] ) {
			return $settlement;
		}
		if ( 1 === count( $transactions ) ) {
			// A single match keeps seeding the entry's empty link and budget,
			// as it always has, even when fees make the amounts differ.
			$seed = $this->planner->plan( array_merge( $entry, array( 'amount' => $evidence[0]['amount'] ?? $entry['amount'] ) ), array(), $evidence ?? array(), 'transaction_net' );
			if ( AllocationPlanner::SINGLE === $seed['status'] ) {
				return array_merge( $seed, array( 'reason' => $plan['reason'] ) );
			}
		}
		return $plan;
	}

	/**
	 * A saved settlement's proposal, when it covers exactly these transactions.
	 *
	 * @param int   $entry_id Bank entry ID.
	 * @param array $transactions Transaction rows.
	 * @return array|null
	 */
	private function settlement_plan( $entry_id, array $transactions ) {
		$references = array_values( array_filter( array_column( $transactions, 'mollie_payment_id' ) ) );
		if ( count( $references ) !== count( $transactions ) || ! class_exists( '\\FairPaymentsConnector\\Database\\SettlementRepository' ) ) {
			return null;
		}
		try {
			$found = ( new ReconciliationRepository() )->settlements_with_references( $references );
		} catch ( \RuntimeException $error ) {
			return null;
		}
		if ( 1 !== count( $found ) ) {
			return null;
		}
		return ( new SettlementReconciliation() )->plan_for_transactions( (int) $found[0], $entry_id, array_map( 'intval', array_column( $transactions, 'id' ) ) );
	}

	/**
	 * Apply a reviewed proposal inside the caller's transaction.
	 *
	 * @param int        $entry_id Bank entry ID.
	 * @param array      $plan Proposal from plan_match() or a settlement preview.
	 * @param array|null $reviewed_budget Null for proposed budgets, or array( 'budget_id' => int|null ) for an administrator-reviewed budget (null clears it).
	 * @return int[] New allocation IDs.
	 * @throws \RuntimeException On any failed write, for the caller to roll back.
	 */
	public function apply( $entry_id, array $plan, ?array $reviewed_budget = null ) {
		global $wpdb;
		$rows = $plan['rows'];
		if ( null !== $reviewed_budget ) {
			foreach ( $rows as &$row ) {
				$row['budget_id'] = $reviewed_budget['budget_id'];
			}
			unset( $row );
		}
		$entry = FinancialEntry::get_by_id( $entry_id );
		if ( ! $entry ) {
			throw new \RuntimeException( 'Allocation entry missing.' );
		}
		if ( AllocationPlanner::PROPOSED === $plan['status'] ) {
			if ( FinancialEntry::has_children( $entry_id ) ) {
				throw new \RuntimeException( 'Allocation already exists.' );
			}
			$ids = FinancialEntry::write_split( $entry, $rows );
			if ( false === $ids ) {
				throw new \RuntimeException( 'Allocation write failed.' );
			}
			return $ids;
		}
		if ( AllocationPlanner::SINGLE === $plan['status'] ) {
			// Seed only what the entry does not have yet.
			$row  = $rows[0];
			$data = array();
			if ( empty( $entry->event_url ) && ( null !== $row['event_url'] || null !== $row['event_date_id'] ) ) {
				$data['event_url']     = $row['event_url'];
				$data['event_date_id'] = $row['event_date_id'];
			}
			if ( empty( $entry->budget_id ) && $row['budget_id'] ) {
				$data['budget_id'] = (int) $row['budget_id'];
			}
			if ( $data && false === $wpdb->update( Schema::get_financial_entries_table_name(), $data, array( 'id' => $entry_id ) ) ) {
				throw new \RuntimeException( 'Entry update failed.' );
			}
		}
		return array();
	}

	/**
	 * Match transactions to a bank entry and allocate it, atomically.
	 *
	 * @param int        $entry_id Bank entry ID.
	 * @param array      $transactions Transaction rows.
	 * @param array|null $reviewed_budget See apply().
	 * @return array|WP_Error The applied proposal with its allocation IDs.
	 * @throws \RuntimeException Internally caught to roll back every failed write.
	 */
	public function match( $entry_id, array $transactions, ?array $reviewed_budget = null ) {
		global $wpdb;
		$wpdb->query( 'START TRANSACTION' );
		try {
			// Locking the entry and its allocation range serializes concurrent
			// matches: a retry sees the split the first request created.
			$plan = $this->plan_match( $entry_id, $transactions, true );
			$ids  = array_map( 'intval', array_column( $transactions, 'id' ) );
			foreach ( $ids as $transaction_id ) {
				if ( class_exists( '\\FairPaymentsConnector\\Models\\EntryTransaction' ) && ! \FairPaymentsConnector\Models\EntryTransaction::link( $entry_id, $transaction_id ) ) {
					throw new \RuntimeException( 'Link failed.' );
				}
			}
			// Legacy column, kept for backward compatibility.
			if ( false === $wpdb->update( Schema::get_financial_entries_table_name(), array( 'transaction_id' => $ids[0] ), array( 'id' => $entry_id ), array( '%d' ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Link failed.' );
			}
			$plan['allocation_ids'] = $this->apply( $entry_id, $plan, $reviewed_budget );
			$wpdb->query( 'COMMIT' );
			return $plan;
		} catch ( \Throwable $error ) {
			$wpdb->query( 'ROLLBACK' );
			return new WP_Error( 'rest_match_failed', __( 'Failed to match entry to transaction. Nothing was changed.', 'fair-finance' ), array( 'status' => 500 ) );
		}
	}
}
