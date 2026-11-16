<?php
/**
 * Compare an existing settlement split with what its evidence supports now.
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

use FairPaymentsConnector\Settlements\ReportDecimal as Exact;

defined( 'WPINC' ) || die;

/**
 * Pure rules for recalculating a split created by settlement reconciliation.
 *
 * Existing allocations are identified by the allocation IDs and movement keys
 * that reconciliation history recorded when it created them, never by row
 * order. Matched payment allocations keep their ID, links, budget, event,
 * description, participant and tag; only their amount may change. Nothing is
 * changed when any row cannot be identified unambiguously.
 */
class SplitRecalculation {
	const PROPOSED  = 'proposed';
	const UNCHANGED = 'unchanged';
	const BLOCKED   = 'blocked';

	const KEEP   = 'keep';
	const UPDATE = 'update';
	const ADD    = 'add';
	const REMOVE = 'remove';

	/**
	 * The rows reconciliation last wrote, keyed by allocation ID, from saved
	 * history (newest first wins).
	 *
	 * @param array $history History rows, oldest first.
	 * @return array|null Generated rows keyed by ID, with the history ID, or null when none recorded them.
	 */
	public static function generated( array $history ) {
		foreach ( array_reverse( $history ) as $entry ) {
			$reviewed = json_decode( (string) $entry['reviewed'], true );
			if ( ! is_array( $reviewed ) || empty( $reviewed['allocation_ids'] ) ) {
				continue;
			}
			$ids  = array_values( $reviewed['allocation_ids'] );
			$rows = $reviewed['allocation_rows'] ?? ( $reviewed['preview']['allocation']['rows'] ?? null );
			if ( ! is_array( $rows ) || count( $rows ) !== count( $ids ) ) {
				return null;
			}
			$generated = array();
			foreach ( array_values( $rows ) as $index => $row ) {
				$generated[ (int) $ids[ $index ] ] = array(
					'kind'           => $row['kind'] ?? 'transaction',
					'amount'         => (string) $row['amount'],
					'description'    => (string) ( $row['description'] ?? '' ),
					'movement_key'   => $row['movement_key'] ?? null,
					'transaction_id' => isset( $row['transaction_id'] ) ? (int) $row['transaction_id'] : null,
				);
			}
			return array(
				'history_id' => (int) $entry['id'],
				'rows'       => $generated,
			);
		}
		return null;
	}

	/**
	 * Whether two stored amounts are equal exactly.
	 *
	 * @param mixed $a Amount.
	 * @param mixed $b Amount.
	 * @return bool
	 */
	private static function same( $a, $b ) {
		return null !== $a && null !== $b && Exact::is_zero( Exact::subtract( (string) $a, (string) $b ) );
	}

	/**
	 * One change, with every categorization field the allocation keeps.
	 *
	 * @param string     $action Change.
	 * @param array|null $child Existing allocation.
	 * @param array|null $row Proposed row.
	 * @param array      $extra Extra fields.
	 * @return array
	 */
	private static function change( $action, $child, $row, array $extra = array() ) {
		$source = $child ? $child : array();
		return array_merge(
			array(
				'action'           => $action,
				'id'               => $child ? (int) $child['id'] : null,
				'kind'             => $row['kind'] ?? ( $extra['kind'] ?? 'transaction' ),
				'movement_key'     => $row['movement_key'] ?? null,
				'transaction_id'   => $row['transaction_id'] ?? null,
				'current_amount'   => $child ? (string) $child['amount'] : null,
				'proposed_amount'  => $row ? (string) $row['amount'] : null,
				'description'      => $child ? (string) $child['description'] : (string) ( $row['description'] ?? '' ),
				'new_description'  => null,
				// Categorization is carried over exactly, including an explicit null tag.
				'tag'              => $source['tag'] ?? null,
				'budget_id'        => isset( $source['budget_id'] ) ? (int) $source['budget_id'] : null,
				'event_url'        => $source['event_url'] ?? null,
				'event_date_id'    => isset( $source['event_date_id'] ) ? (int) $source['event_date_id'] : null,
				'participant_id'   => isset( $source['participant_id'] ) ? (int) $source['participant_id'] : null,
				'manual_amount'    => false,
				'manual_text'      => false,
				'transferred_from' => null,
			),
			$extra
		);
	}

	/**
	 * Compare the existing split with the proposed rows.
	 *
	 * @param array      $children Existing allocations (financial entry rows).
	 * @param array|null $generated Output of generated().
	 * @param array      $rows Proposed rows from the allocation planner.
	 * @return array{status:string,changes:array,reasons:string[],warnings:string[]}
	 */
	public static function diff( array $children, $generated, array $rows ) {
		$blocked = static function ( $reason ) {
			return array(
				'status'   => self::BLOCKED,
				'changes'  => array(),
				'reasons'  => array( $reason ),
				'warnings' => array(),
			);
		};
		if ( ! $generated ) {
			return $blocked( __( 'This split has no saved reconciliation record of the allocations it created, so they cannot be identified safely. Adjust it manually.', 'fair-finance' ) );
		}
		$known   = $generated['rows'];
		$reasons = array();
		$by_id   = array();
		foreach ( $children as $child ) {
			$by_id[ (int) $child['id'] ] = $child;
			if ( ! isset( $known[ (int) $child['id'] ] ) ) {
				$reasons[] = sprintf(
					/* translators: %d: allocation ID. */
					__( 'Allocation #%d was added after reconciliation, so this split cannot be recalculated automatically.', 'fair-finance' ),
					(int) $child['id']
				);
			}
		}
		foreach ( array_keys( $known ) as $id ) {
			if ( ! isset( $by_id[ $id ] ) ) {
				$reasons[] = sprintf(
					/* translators: %d: allocation ID. */
					__( 'Allocation #%d created by reconciliation no longer exists, so this split cannot be recalculated automatically.', 'fair-finance' ),
					$id
				);
			}
		}
		if ( $reasons ) {
			return array(
				'status'   => self::BLOCKED,
				'changes'  => array(),
				'reasons'  => $reasons,
				'warnings' => array(),
			);
		}
		// Existing allocations by movement identity.
		$old_by_key = array();
		$old_loose  = array();
		foreach ( $known as $id => $row ) {
			if ( null === $row['movement_key'] ) {
				if ( 'transaction' === $row['kind'] ) {
					return $blocked( __( 'A payment allocation has no saved movement identity, so it cannot be matched safely.', 'fair-finance' ) );
				}
				$old_loose[] = $id;
				continue;
			}
			if ( isset( $old_by_key[ $row['movement_key'] ] ) ) {
				return $blocked( __( 'Two allocations record the same movement, so they cannot be matched safely.', 'fair-finance' ) );
			}
			$old_by_key[ $row['movement_key'] ] = $id;
		}
		$changes   = array();
		$warnings  = array();
		$new_loose = array();
		$used      = array();
		foreach ( $rows as $row ) {
			$key = $row['movement_key'] ?? null;
			if ( null !== $key && isset( $used[ $key ] ) ) {
				return $blocked( __( 'The proposal lists one movement twice, so it cannot be applied safely.', 'fair-finance' ) );
			}
			$id = null !== $key ? ( $old_by_key[ $key ] ?? null ) : null;
			if ( null === $id ) {
				if ( 'transaction' === $row['kind'] ) {
					return $blocked( __( 'A payment in the proposal has no allocation created by reconciliation, so it cannot be matched safely.', 'fair-finance' ) );
				}
				$new_loose[] = $row;
				continue;
			}
			$used[ $key ] = true;
			$old          = $known[ $id ];
			if ( $old['kind'] !== $row['kind'] || ( 'transaction' === $row['kind'] && (int) $old['transaction_id'] !== (int) $row['transaction_id'] ) ) {
				return $blocked( __( 'An allocation’s saved payment link disagrees with the proposal, so it cannot be matched safely.', 'fair-finance' ) );
			}
			$changes[] = self::evolve( $by_id[ $id ], $old, $row, $warnings );
		}
		foreach ( $old_by_key as $key => $id ) {
			if ( isset( $used[ $key ] ) ) {
				continue;
			}
			if ( 'transaction' === $known[ $id ]['kind'] ) {
				return $blocked( __( 'A payment allocation is no longer supported by the settlement evidence. Adjust this split manually.', 'fair-finance' ) );
			}
			$old_loose[] = $id;
		}
		// Settlement-level rows without a shared movement identity.
		if ( 1 === count( $old_loose ) && 1 === count( $new_loose ) ) {
			// One generated cost row is replaced by one adjustment: it keeps
			// its ID and categorization.
			$id        = $old_loose[0];
			$change    = self::evolve( $by_id[ $id ], $known[ $id ], $new_loose[0], $warnings, true );
			$changes[] = $change;
		} elseif ( $old_loose && $new_loose ) {
			return $blocked( __( 'Several settlement-level allocations would be replaced by several new ones, so their categorization cannot be transferred safely. Adjust this split manually.', 'fair-finance' ) );
		} else {
			foreach ( $old_loose as $id ) {
				$child = $by_id[ $id ];
				if ( ! self::same( $child['amount'], $known[ $id ]['amount'] ) || (string) $child['description'] !== $known[ $id ]['description'] ) {
					return $blocked(
						sprintf(
							/* translators: %d: allocation ID. */
							__( 'Allocation #%d was edited after reconciliation and would be removed. Adjust this split manually.', 'fair-finance' ),
							$id
						)
					);
				}
				$changes[] = self::change( self::REMOVE, $child, null, array( 'kind' => $known[ $id ]['kind'] ) );
			}
			foreach ( $new_loose as $row ) {
				$changes[] = self::change( self::ADD, null, $row );
			}
		}
		$changed = array_filter(
			$changes,
			static function ( $change ) {
				return self::KEEP !== $change['action'];
			}
		);
		return array(
			'status'   => $changed ? self::PROPOSED : self::UNCHANGED,
			'changes'  => $changes,
			'reasons'  => array(),
			'warnings' => array_values( array_unique( $warnings ) ),
		);
	}

	/**
	 * Change for one identified allocation.
	 *
	 * @param array $child Existing allocation.
	 * @param array $old Row reconciliation wrote for it.
	 * @param array $row Proposed row.
	 * @param array $warnings Collected warnings.
	 * @param bool  $transfer Whether a different settlement row replaces it.
	 * @return array
	 */
	private static function evolve( array $child, array $old, array $row, array &$warnings, $transfer = false ) {
		$manual_amount = ! self::same( $child['amount'], $old['amount'] );
		$manual_text   = (string) $child['description'] !== $old['description'];
		$changes_text  = $transfer && ! $manual_text && (string) $row['description'] !== (string) $child['description'];
		$changes_value = ! self::same( $child['amount'], $row['amount'] );
		if ( $manual_amount && $changes_value ) {
			$warnings[] = sprintf(
				/* translators: 1: allocation ID, 2: amount reconciliation created, 3: current amount, 4: proposed amount. */
				__( 'Allocation #%1$d was changed from %2$s to %3$s after reconciliation. Recalculation replaces that amount with %4$s.', 'fair-finance' ),
				(int) $child['id'],
				$old['amount'],
				(string) $child['amount'],
				(string) $row['amount']
			);
		}
		if ( $transfer && $manual_text ) {
			$warnings[] = sprintf(
				/* translators: %d: allocation ID. */
				__( 'Allocation #%d has an edited description, which is kept.', 'fair-finance' ),
				(int) $child['id']
			);
		}
		return self::change(
			$changes_value || $changes_text ? self::UPDATE : self::KEEP,
			$child,
			$row,
			array(
				'new_description'  => $changes_text ? (string) $row['description'] : null,
				'manual_amount'    => $manual_amount,
				'manual_text'      => $manual_text,
				'transferred_from' => $transfer ? (int) $child['id'] : null,
			)
		);
	}
}
