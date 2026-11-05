<?php
/**
 * Attribution lookups that include the purchases a backfill would create
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Lets the payment history dry run reach the same conclusions as the
 * backfill without creating anything (PAYMENT_HISTORY_MIGRATION.md §8.9).
 * It wraps the real lookups and adds, for every relationship the backfill
 * would turn into a purchase, a planned purchase with the negative
 * relationship ID as its ID: confirmed, with no amount yet, on the
 * relationship's date and participant. PaymentAttribution then attributes a
 * transaction to it exactly as it would to the backfilled purchase.
 */
class PaymentHistoryPlannedSources implements PaymentAttributionSources {

	/**
	 * Real lookups.
	 *
	 * @var PaymentAttributionSources
	 */
	private $inner;

	/**
	 * Planner.
	 *
	 * @var PaymentHistoryPurchasePlanner
	 */
	private $planner;

	/**
	 * Constructor.
	 *
	 * @param PaymentAttributionSources     $inner   Real lookups.
	 * @param PaymentHistoryPurchasePlanner $planner Which relationships would become purchases.
	 */
	public function __construct( PaymentAttributionSources $inner, PaymentHistoryPurchasePlanner $planner ) {
		$this->inner   = $inner;
		$this->planner = $planner;
	}

	/**
	 * The planned purchase ID for a relationship.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int Negative ID.
	 */
	public static function planned_id( $relationship_id ) {
		return -1 * (int) $relationship_id;
	}

	/**
	 * Whether a purchase ID is a planned one.
	 *
	 * @param int $signup_id Signup ID.
	 * @return bool
	 */
	public static function is_planned( $signup_id ) {
		return (int) $signup_id < 0;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $signup_ids Signup IDs, planned ones negative.
	 * @return array
	 */
	public function signups( array $signup_ids ) {
		$real    = array();
		$planned = array();
		foreach ( $signup_ids as $signup_id ) {
			if ( self::is_planned( $signup_id ) ) {
				$planned[] = (int) $signup_id;
			} else {
				$real[] = (int) $signup_id;
			}
		}

		$signups = $real ? $this->inner->signups( $real ) : array();
		foreach ( $planned as $signup_id ) {
			$relationship = $this->planner->planned_relationship( -1 * $signup_id );
			if ( $relationship ) {
				$signups[ $signup_id ] = array(
					'id'             => $signup_id,
					'amount'         => '0.00',
					'event_date_id'  => (int) $relationship['event_date_id'],
					'participant_id' => (int) $relationship['participant_id'],
					'status'         => 'confirmed',
				);
			}
		}
		return $signups;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return int[]
	 */
	public function signup_ids_with_latest_transaction( $transaction_id ) {
		return $this->inner->signup_ids_with_latest_transaction( $transaction_id );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array[]
	 */
	public function ledger_rows( $transaction_id ) {
		return $this->inner->ledger_rows( $transaction_id );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $relationship_ids Relationship IDs.
	 * @return array
	 */
	public function relationships( array $relationship_ids ) {
		return $this->inner->relationships( $relationship_ids );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int|null
	 */
	public function purchase_for_relationship( $relationship_id ) {
		$signup_id = $this->inner->purchase_for_relationship( $relationship_id );
		if ( $signup_id ) {
			return (int) $signup_id;
		}
		return $this->planner->planned_relationship( (int) $relationship_id ) ? self::planned_id( $relationship_id ) : null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int[]
	 */
	public function active_purchases( $event_date_id, $participant_id ) {
		$active = array_map( 'intval', $this->inner->active_purchases( $event_date_id, $participant_id ) );
		foreach ( $this->planner->planned_relationships_of( (int) $event_date_id, (int) $participant_id ) as $relationship_id ) {
			$active[] = self::planned_id( $relationship_id );
		}
		return $active;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $ticket_id Ticket ID.
	 * @return int|null
	 */
	public function purchase_for_ticket( $ticket_id ) {
		return $this->inner->purchase_for_ticket( $ticket_id );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null
	 */
	public function transaction_metadata( $transaction_id ) {
		return $this->inner->transaction_metadata( $transaction_id );
	}
}
