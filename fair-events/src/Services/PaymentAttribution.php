<?php
/**
 * Deterministic payment attribution
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\SignupPaymentLink;
use FairEventsShared\LineItemTotals;

defined( 'WPINC' ) || die;

/**
 * Decides which purchases a Connector transaction belongs to, and with what
 * role and allocation, from the evidence PAYMENT_HISTORY_MIGRATION.md §6.1
 * allows: the transaction's immutable metadata and the signup's latest
 * attempt for the oldest get-tickets transactions. Never from participant,
 * email, date, amount or time alone, never from the transaction columns an
 * administrator can edit, and no longer from the Fair Audience ledger,
 * which nothing writes since #2254.
 *
 * The live shadow writers and the historical backfill share these rules, so
 * both reach the same conclusion for the same transaction. The result
 * either has links for every purchase the transaction pays for, or none and
 * the reason (§6.2): a transaction is never attributed in part.
 */
class PaymentAttribution {

	const SOURCE_GET_TICKETS = 'fair-events-get-tickets';
	const SOURCE_AUDIENCE    = 'fair-audience-signup';
	const SOURCE_ADDON       = 'fair-audience-activity-addon';
	const SOURCE_UPGRADE     = 'fair-audience-series-upgrade';

	/**
	 * Lookups.
	 *
	 * @var PaymentAttributionSources
	 */
	private $sources;

	/**
	 * Constructor.
	 *
	 * @param PaymentAttributionSources $sources Lookups.
	 */
	public function __construct( PaymentAttributionSources $sources ) {
		$this->sources = $sources;
	}

	/**
	 * Attribute one transaction.
	 *
	 * @param array $transaction Connector transaction: id, amount, currency, metadata (array),
	 *                           line_items (each with total_amount).
	 * @return array{outcome: string, links: array[], reason: string|null, detail: array, notes: array[]}
	 *               outcome is `attributed` (links set), `unresolved` (reason set) or `out_of_scope`
	 *               (not an event payment: a participant fee, or no event source).
	 *               notes are informational findings for an attributed transaction, such as
	 *               `amount_mismatch`.
	 */
	public function attribute( array $transaction ) {
		$metadata = is_array( $transaction['metadata'] ?? null ) ? $transaction['metadata'] : array();
		$source   = is_string( $metadata['source'] ?? null ) ? $metadata['source'] : '';

		if ( ! empty( $metadata['fee_payment_id'] ) ) {
			return self::out_of_scope();
		}

		switch ( $source ) {
			case self::SOURCE_GET_TICKETS:
				return $this->attribute_get_tickets( $transaction, $metadata );
			case self::SOURCE_AUDIENCE:
				return $this->attribute_audience_signup( $transaction, $metadata );
			case self::SOURCE_ADDON:
				return $this->attribute_addon( $transaction, $metadata );
			case self::SOURCE_UPGRADE:
				return $this->attribute_upgrade( $transaction, $metadata );
		}

		return self::out_of_scope();
	}

	/**
	 * A get-tickets checkout or retry: the purchases its metadata names, or
	 * for the oldest transactions without those keys, the single purchase
	 * whose latest attempt it is (§6.1).
	 *
	 * @param array $transaction Transaction.
	 * @param array $metadata    Metadata.
	 * @return array Result.
	 */
	private function attribute_get_tickets( array $transaction, array $metadata ) {
		$evidence = array( 'source' => self::SOURCE_GET_TICKETS );
		if ( isset( $metadata['signup_ids'] ) && is_array( $metadata['signup_ids'] ) ) {
			$signup_ids       = self::ids( $metadata['signup_ids'] );
			$evidence['type'] = 'metadata_signup_ids';
		} elseif ( ! empty( $metadata['signup_id'] ) ) {
			$signup_ids       = self::ids( array( $metadata['signup_id'] ) );
			$evidence['type'] = 'metadata_signup_id';
		} else {
			$signup_ids = self::ids( $this->sources->signup_ids_with_latest_transaction( (int) $transaction['id'] ) );
			if ( 1 !== count( $signup_ids ) ) {
				return self::unresolved( 'no_evidence', array( 'signup_ids' => $signup_ids ) );
			}
			$evidence['type'] = 'signup_latest_transaction';
		}
		$evidence['signup_ids'] = $signup_ids;
		$evidence              += self::retry_evidence( $metadata );

		if ( ! $signup_ids ) {
			return self::unresolved( 'no_evidence', array() );
		}

		$signups = $this->sources->signups( $signup_ids );
		$missing = array_values( array_diff( $signup_ids, array_keys( $signups ) ) );
		if ( $missing ) {
			return self::unresolved( 'no_evidence', array( 'missing_signup_ids' => $missing ) );
		}

		if ( 1 === count( $signup_ids ) ) {
			return $this->single( $transaction, $signup_ids[0], SignupPaymentLink::ROLE_CHARGE, $evidence, $signups[ $signup_ids[0] ]['amount'] );
		}

		$allocations = array();
		foreach ( $signup_ids as $signup_id ) {
			$allocations[ $signup_id ] = LineItemTotals::normalize_amount( $signups[ $signup_id ]['amount'] );
		}
		return $this->shared( $transaction, $allocations, $evidence );
	}

	/**
	 * An Audience purchase or its retry: the relationships its metadata
	 * names, then each relationship's purchase (§4, §6.1). Shared
	 * transactions split only along identical line items (§5.4).
	 *
	 * @param array $transaction Transaction.
	 * @param array $metadata    Metadata.
	 * @return array Result.
	 */
	private function attribute_audience_signup( array $transaction, array $metadata ) {
		if ( isset( $metadata['event_participant_ids'] ) && is_array( $metadata['event_participant_ids'] ) ) {
			$relationship_ids = self::ids( $metadata['event_participant_ids'] );
		} elseif ( ! empty( $metadata['event_participant_id'] ) ) {
			$relationship_ids = self::ids( array( $metadata['event_participant_id'] ) );
		} else {
			$relationship_ids = array();
		}

		if ( ! $relationship_ids ) {
			return self::unresolved( 'no_evidence', array() );
		}

		$conflict = $this->participant_conflict( $relationship_ids );
		if ( $conflict ) {
			return self::unresolved( 'participant_relationship_conflict', array( 'event_participant_ids' => $conflict ) );
		}

		$evidence = array(
			'type'                  => 'audience_signup',
			'source'                => self::SOURCE_AUDIENCE,
			'event_participant_ids' => $relationship_ids,
		) + self::retry_evidence( $metadata );

		// A retry of a multi-occurrence purchase names one relationship only
		// (gap G7), so its occurrences can't be told apart.
		if ( 1 === count( $relationship_ids ) && ! empty( $metadata['retry_of_transaction_id'] ) ) {
			$original = $this->sources->transaction_metadata( (int) $metadata['retry_of_transaction_id'] );
			if ( is_array( $original ) && is_array( $original['event_participant_ids'] ?? null ) && count( self::ids( $original['event_participant_ids'] ) ) > 1 ) {
				return self::unresolved( 'allocation_mismatch', array( 'retry_of_transaction_id' => (int) $metadata['retry_of_transaction_id'] ) );
			}
		}

		$purchases = array();
		foreach ( $relationship_ids as $relationship_id ) {
			$signup_id = $this->sources->purchase_for_relationship( $relationship_id );
			if ( ! $signup_id ) {
				return self::unresolved( 'no_evidence', array( 'event_participant_id' => $relationship_id ) );
			}
			$purchases[ $relationship_id ] = (int) $signup_id;
		}
		$evidence['signup_ids'] = array_values( $purchases );

		if ( 1 === count( $purchases ) ) {
			$signup_id = reset( $purchases );
			$signups   = $this->sources->signups( array( $signup_id ) );
			return $this->single( $transaction, $signup_id, SignupPaymentLink::ROLE_CHARGE, $evidence, $signups[ $signup_id ]['amount'] ?? null );
		}

		$lines = array_map(
			static function ( $line ) {
				return LineItemTotals::normalize_amount( is_array( $line ) ? ( $line['total_amount'] ?? 0 ) : ( $line->total_amount ?? 0 ) );
			},
			array_values( (array) ( $transaction['line_items'] ?? array() ) )
		);
		if ( count( $lines ) !== count( $purchases ) || count( array_unique( array_map( 'strval', $lines ) ) ) !== 1 ) {
			return self::unresolved( 'allocation_mismatch', array( 'line_items' => $lines ) );
		}

		$allocations = array();
		foreach ( $purchases as $signup_id ) {
			$allocations[ $signup_id ] = $lines[0];
		}
		return $this->shared( $transaction, $allocations, $evidence );
	}

	/**
	 * An activity add-on: the purchase owning the ticket it names, else the
	 * relationship's purchase, else the participant's single active
	 * purchase on that date (§5.6).
	 *
	 * @param array $transaction Transaction.
	 * @param array $metadata    Metadata.
	 * @return array Result.
	 */
	private function attribute_addon( array $transaction, array $metadata ) {
		$relationship_id = (int) ( $metadata['event_participant_id'] ?? 0 );
		$ticket_id       = (int) ( $metadata['ticket_id'] ?? 0 );
		$evidence        = array(
			'type'                 => 'audience_activity_addon',
			'source'               => self::SOURCE_ADDON,
			'event_participant_id' => $relationship_id,
			'ticket_id'            => $ticket_id ? $ticket_id : null,
		) + self::retry_evidence( $metadata );

		if ( $ticket_id ) {
			$signup_id = $this->sources->purchase_for_ticket( $ticket_id );
			if ( ! $signup_id ) {
				return self::unresolved( 'ambiguous_activity_charge', array( 'ticket_id' => $ticket_id ) );
			}
		} else {
			$signup_id = $this->relationship_purchase( $relationship_id );
			if ( ! $signup_id ) {
				return self::unresolved( 'ambiguous_activity_charge', array( 'event_participant_id' => $relationship_id ) );
			}
		}

		$evidence['signup_ids'] = array( (int) $signup_id );
		return $this->single( $transaction, (int) $signup_id, SignupPaymentLink::ROLE_ADDITIONAL_CHARGE, $evidence, null );
	}

	/**
	 * A series upgrade: the purchase the upgraded relationship represents
	 * (§5.6). Its original charge link stays as it was.
	 *
	 * @param array $transaction Transaction.
	 * @param array $metadata    Metadata.
	 * @return array Result.
	 */
	private function attribute_upgrade( array $transaction, array $metadata ) {
		$relationship_id = (int) ( $metadata['event_participant_id'] ?? 0 );
		$signup_id       = $this->relationship_purchase( $relationship_id );
		if ( ! $signup_id ) {
			return self::unresolved( 'ambiguous_upgrade', array( 'event_participant_id' => $relationship_id ) );
		}

		return $this->single(
			$transaction,
			(int) $signup_id,
			SignupPaymentLink::ROLE_UPGRADE,
			array(
				'type'                 => 'audience_series_upgrade',
				'source'               => self::SOURCE_UPGRADE,
				'event_participant_id' => $relationship_id,
				'signup_ids'           => array( (int) $signup_id ),
			) + self::retry_evidence( $metadata ),
			null
		);
	}

	/**
	 * The purchase a relationship represents: the one naming it as its
	 * provenance, else the participant's single active purchase on its date.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int|null Signup ID, or null with zero or several candidates.
	 */
	public function relationship_purchase( $relationship_id ) {
		if ( $relationship_id <= 0 ) {
			return null;
		}

		$signup_id = $this->sources->purchase_for_relationship( $relationship_id );
		if ( $signup_id ) {
			return (int) $signup_id;
		}

		$relationships = $this->sources->relationships( array( $relationship_id ) );
		if ( ! isset( $relationships[ $relationship_id ] ) ) {
			return null;
		}
		$relationship = $relationships[ $relationship_id ];
		$active       = self::ids( $this->sources->active_purchases( (int) $relationship['event_date_id'], (int) $relationship['participant_id'] ) );
		return 1 === count( $active ) ? $active[0] : null;
	}

	/**
	 * Relationships of different participants named by one transaction,
	 * if any.
	 *
	 * @param int[] $relationship_ids Relationships the metadata names.
	 * @return int[] The relationship IDs, or none when there is no conflict.
	 */
	private function participant_conflict( array $relationship_ids ) {
		if ( count( $relationship_ids ) < 2 ) {
			return array();
		}

		$participants = array();
		foreach ( $this->sources->relationships( $relationship_ids ) as $relationship ) {
			$participants[ (int) $relationship['participant_id'] ] = true;
		}
		return count( $participants ) > 1 ? $relationship_ids : array();
	}

	/**
	 * One purchase gets the whole transaction (§5.3, §5.6).
	 *
	 * @param array      $transaction   Transaction.
	 * @param int        $signup_id     Purchase.
	 * @param string     $role          Link role.
	 * @param array      $evidence      Evidence.
	 * @param mixed|null $signup_amount The purchase's own amount, compared for a charge; null to skip.
	 * @return array Result.
	 */
	private function single( array $transaction, $signup_id, $role, array $evidence, $signup_amount ) {
		$notes = array();
		if ( null !== $signup_amount && ! LineItemTotals::amounts_match( $signup_amount, $transaction['amount'] ) ) {
			$notes[] = array(
				'reason' => 'amount_mismatch',
				'detail' => array(
					'signup_id'     => (int) $signup_id,
					'signup_amount' => LineItemTotals::normalize_amount( $signup_amount ),
					'total'         => LineItemTotals::normalize_amount( $transaction['amount'] ),
				),
			);
		}

		return array(
			'outcome' => 'attributed',
			'links'   => array(
				array(
					'signup_id'        => (int) $signup_id,
					'role'             => $role,
					'allocated_amount' => LineItemTotals::normalize_amount( $transaction['amount'] ),
					'evidence'         => $evidence,
				),
			),
			'reason'  => null,
			'detail'  => array(),
			'notes'   => $notes,
		);
	}

	/**
	 * Several purchases share the transaction; every allocation is written
	 * only when they add up to its total (§5.4).
	 *
	 * @param array             $transaction Transaction.
	 * @param array<int, float> $allocations Signup ID => allocation.
	 * @param array             $evidence    Evidence.
	 * @return array Result.
	 */
	private function shared( array $transaction, array $allocations, array $evidence ) {
		$sum = LineItemTotals::normalize_amount( array_sum( $allocations ) );
		if ( ! LineItemTotals::amounts_match( $sum, $transaction['amount'] ) ) {
			return self::unresolved(
				'allocation_mismatch',
				array(
					'allocations' => $allocations,
					'total'       => LineItemTotals::normalize_amount( $transaction['amount'] ),
				)
			);
		}

		$links = array();
		foreach ( $allocations as $signup_id => $amount ) {
			$links[] = array(
				'signup_id'        => (int) $signup_id,
				'role'             => SignupPaymentLink::ROLE_CHARGE,
				'allocated_amount' => $amount,
				'evidence'         => $evidence,
			);
		}

		return array(
			'outcome' => 'attributed',
			'links'   => $links,
			'reason'  => null,
			'detail'  => array(),
			'notes'   => array(),
		);
	}

	/**
	 * The attempt order a retry records (§5.5). Never names a purchase by itself.
	 *
	 * @param array $metadata Metadata.
	 * @return array
	 */
	private static function retry_evidence( array $metadata ) {
		return empty( $metadata['retry_of_transaction_id'] ) ? array() : array( 'retry_of_transaction_id' => (int) $metadata['retry_of_transaction_id'] );
	}

	/**
	 * Unresolved result.
	 *
	 * @param string $reason §6.2 reason.
	 * @param array  $detail Source IDs and context.
	 * @return array
	 */
	private static function unresolved( $reason, array $detail ) {
		return array(
			'outcome' => 'unresolved',
			'links'   => array(),
			'reason'  => $reason,
			'detail'  => $detail,
			'notes'   => array(),
		);
	}

	/**
	 * Result for a transaction that isn't an event payment.
	 *
	 * @return array
	 */
	private static function out_of_scope() {
		return array(
			'outcome' => 'out_of_scope',
			'links'   => array(),
			'reason'  => null,
			'detail'  => array(),
			'notes'   => array(),
		);
	}

	/**
	 * Positive integer IDs, unique, in their given order.
	 *
	 * @param array $values Values.
	 * @return int[]
	 */
	private static function ids( array $values ) {
		$ids = array();
		foreach ( $values as $value ) {
			$id = is_numeric( $value ) ? (int) $value : 0;
			if ( $id > 0 && ! in_array( $id, $ids, true ) ) {
				$ids[] = $id;
			}
		}
		return $ids;
	}
}
