<?php
/**
 * Allocation proposals shared by every reconciliation starting point.
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

use FairPaymentsConnector\Settlements\ReportDecimal as Exact;

defined( 'WPINC' ) || die;

/**
 * Turns reviewed financial evidence into the children of one bank entry.
 *
 * Evidence adapters (manual transaction matching, saved settlements) supply
 * signed rows with exact decimal amounts; the planner resolves their event
 * links and budgets the same way for every screen and only proposes a split
 * whose rows are cent-exact and sum to the bank entry exactly. It never
 * invents a balancing row or attributes an unexplained difference.
 */
class AllocationPlanner {
	const PROPOSED    = 'proposed';
	const SINGLE      = 'single';
	const ALLOCATED   = 'allocated';
	const UNSUPPORTED = 'unsupported';

	/**
	 * Connected Site budgets.
	 *
	 * @var ConnectedSiteBudgetResolver
	 */
	private $sites;
	/**
	 * Event budgets.
	 *
	 * @var EventBudgetResolver
	 */
	private $events;

	/**
	 * Construct with fresh per-request resolver caches.
	 */
	public function __construct() {
		$this->sites  = new ConnectedSiteBudgetResolver();
		$this->events = new EventBudgetResolver();
	}

	/**
	 * Whether exact decimal arithmetic is available from the connector.
	 *
	 * @return bool
	 */
	public static function available() {
		return class_exists( Exact::class );
	}

	/**
	 * An amount Finance stores without rounding, as two decimals, or null.
	 *
	 * @param mixed $amount Exact decimal string.
	 * @return string|null
	 */
	public static function cents( $amount ) {
		if ( null === $amount || ! preg_match( '/^-?\d+(?:\.\d+)?$/', (string) $amount ) ) {
			return null;
		}
		$canonical = Exact::canonical( (string) $amount );
		if ( ! preg_match( '/^(-?)(\d{1,8})(?:\.(\d{1,2}))?$/', $canonical, $parts ) ) {
			return null;
		}
		return Exact::is_zero( $canonical ) ? '0.00' : $parts[1] . $parts[2] . '.' . str_pad( $parts[3] ?? '', 2, '0' );
	}

	/**
	 * A transaction's amount after its recorded application and Mollie fees.
	 *
	 * @param array $transaction Transaction row.
	 * @return string|null
	 */
	public static function net( array $transaction ) {
		$values = array( (string) $transaction['amount'] );
		foreach ( array( 'application_fee', 'mollie_fee' ) as $fee ) {
			if ( null !== ( $transaction[ $fee ] ?? null ) && '' !== $transaction[ $fee ] ) {
				$values[] = Exact::negate( (string) $transaction[ $fee ] );
			}
		}
		return self::cents( Exact::sum( $values ) );
	}

	/**
	 * Event link of a transaction.
	 *
	 * Local transactions carry a real event_date_id whose permalink we can
	 * derive; imported transactions (from another site) carry the link in
	 * metadata.detail_url and the source side's event_date_id is not a valid
	 * local FK, so only event_url is reused.
	 *
	 * @param array $transaction Transaction row.
	 * @return array{event_url:string,event_date_id:?int}
	 */
	public static function link( array $transaction ) {
		$event_url     = '';
		$event_date_id = null;

		if ( ! empty( $transaction['event_date_id'] ) && class_exists( '\\FairEvents\\Models\\EventDates' ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $transaction['event_date_id'] );
			if ( $event_date && ! empty( $event_date->event_id ) ) {
				$permalink = get_permalink( (int) $event_date->event_id );
				if ( $permalink ) {
					$event_url     = $permalink;
					$event_date_id = (int) $transaction['event_date_id'];
				}
			}
		}

		if ( '' === $event_url ) {
			$meta = self::metadata( $transaction );
			if ( ! empty( $meta['detail_url'] ) ) {
				$event_url = (string) $meta['detail_url'];
			}
		}

		return array(
			'event_url'     => $event_url,
			'event_date_id' => $event_date_id,
		);
	}

	/**
	 * Decoded transaction metadata.
	 *
	 * @param array $transaction Transaction row.
	 * @return array
	 */
	private static function metadata( array $transaction ) {
		$meta = json_decode( (string) ( $transaction['metadata'] ?? '' ), true );
		return is_array( $meta ) ? $meta : array();
	}

	/**
	 * Proposed budget: the importing Connected Site's, otherwise the event's.
	 *
	 * @param array $transaction Transaction row.
	 * @param array $link Resolved event link.
	 * @return int|null
	 */
	public function budget( array $transaction, array $link ) {
		$site = self::metadata( $transaction )['connected_site_id'] ?? null;
		if ( $site ) {
			return $this->sites->resolve( (int) $site );
		}
		return $this->events->resolve( $link['event_date_id'] );
	}

	/**
	 * Plan the children of one bank entry from signed evidence rows.
	 *
	 * Each row is `amount` (exact decimal string), `description`, optional
	 * `transaction` (row array) and `transaction_id`, `movement_key`, and
	 * `kind` ('transaction' or 'settlement' for settlement-level fees and
	 * adjustments that belong to no payment).
	 *
	 * @param array  $entry Bank entry row.
	 * @param array  $children Existing children of the entry.
	 * @param array  $rows Evidence rows.
	 * @param string $method Evidence method recorded with the proposal.
	 * @return array
	 */
	public function plan( array $entry, array $children, array $rows, $method ) {
		if ( $children ) {
			return self::outcome( self::ALLOCATED, __( 'This bank entry is already split. Its existing allocations are preserved.', 'fair-finance' ) );
		}
		if ( ! empty( $entry['parent_entry_id'] ) ) {
			return self::outcome( self::UNSUPPORTED, __( 'A split allocation cannot be split again.', 'fair-finance' ) );
		}
		$amount = self::cents( $entry['amount'] );
		$values = array();
		$plan   = array();
		foreach ( $rows as $row ) {
			$value = self::cents( $row['amount'] );
			if ( null === $value ) {
				return self::outcome( self::UNSUPPORTED, __( 'An amount has fractions of a cent, so it cannot be stored exactly. Allocate this entry manually.', 'fair-finance' ) );
			}
			if ( Exact::is_zero( $value ) ) {
				continue;
			}
			$transaction = $row['transaction'] ?? null;
			$link        = $transaction ? self::link( $transaction ) : array(
				'event_url'     => '',
				'event_date_id' => null,
			);
			$plan[]      = array(
				'kind'           => $row['kind'] ?? 'transaction',
				'amount'         => $value,
				'description'    => (string) ( $row['description'] ?? '' ),
				'transaction_id' => $transaction ? (int) $transaction['id'] : null,
				'movement_key'   => $row['movement_key'] ?? null,
				'event_url'      => '' !== $link['event_url'] ? $link['event_url'] : null,
				'event_date_id'  => $link['event_date_id'],
				'budget_id'      => $transaction ? $this->budget( $transaction, $link ) : null,
			);
			$values[]    = $value;
		}
		if ( ! $plan ) {
			return self::outcome( self::UNSUPPORTED, __( 'There is no supported evidence to allocate.', 'fair-finance' ) );
		}
		$total = Exact::sum( $values );
		if ( null === $amount || ! Exact::is_zero( Exact::subtract( $total, $amount ) ) ) {
			return self::outcome(
				self::UNSUPPORTED,
				sprintf(
					/* translators: 1: exact allocation total, 2: bank entry amount. */
					__( 'The supported amounts total %1$s, which does not equal the bank entry amount of %2$s. No split was proposed and no balancing amount is invented.', 'fair-finance' ),
					$total,
					(string) $entry['amount']
				)
			);
		}
		if ( 1 === count( $plan ) ) {
			// One transaction explains the entry: link it, no one-child split.
			$single = self::outcome( self::SINGLE, __( 'One transaction explains this bank entry, so no split is needed.', 'fair-finance' ), $plan, $method );
			return 'transaction' === $plan[0]['kind'] ? $single : self::outcome( self::UNSUPPORTED, __( 'There is no supported evidence to allocate.', 'fair-finance' ) );
		}
		$classified = ! empty( $entry['budget_id'] ) || ! empty( $entry['event_url'] ) || ! empty( $entry['event_date_id'] ) || ! empty( $entry['tag'] ) || ! empty( $entry['participant_id'] );
		if ( $classified ) {
			return self::outcome( self::UNSUPPORTED, __( 'This bank entry already has a budget, event, tag or participant. It is kept as it is; split it manually if needed.', 'fair-finance' ), $plan, $method );
		}
		return self::outcome( self::PROPOSED, __( 'Confirming creates one allocation per supported movement. Their amounts sum exactly to this bank entry.', 'fair-finance' ), $plan, $method );
	}

	/**
	 * Proposal shape returned to every screen.
	 *
	 * @param string      $status Status.
	 * @param string      $reason Explanation.
	 * @param array       $rows Planned rows.
	 * @param string|null $method Evidence method.
	 * @return array
	 */
	public static function outcome( $status, $reason, array $rows = array(), $method = null ) {
		return array(
			'status'    => $status,
			'supported' => self::PROPOSED === $status,
			'method'    => $method,
			'rows'      => $rows,
			'reason'    => $reason,
		);
	}
}
