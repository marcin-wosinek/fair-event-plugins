<?php
/**
 * In-memory lookups for payment attribution tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentAttributionSources;

/**
 * In-memory records for PaymentAttribution.
 */
class Fake_Attribution_Sources implements PaymentAttributionSources {

	/**
	 * Signups by ID.
	 *
	 * @var array
	 */
	public $signups = array();

	/**
	 * Signup IDs by latest transaction ID.
	 *
	 * @var array
	 */
	public $latest = array();

	/**
	 * Relationships by ID.
	 *
	 * @var array
	 */
	public $relationships = array();

	/**
	 * Provenance: relationship ID => signup ID.
	 *
	 * @var array
	 */
	public $provenance = array();

	/**
	 * Active purchases: "date:participant" => signup IDs.
	 *
	 * @var array
	 */
	public $active = array();

	/**
	 * Ticket owners: ticket ID => signup ID.
	 *
	 * @var array
	 */
	public $tickets = array();

	/**
	 * Other transactions' metadata by ID.
	 *
	 * @var array
	 */
	public $metadata = array();

	/**
	 * Add a signup.
	 *
	 * @param int    $id     ID.
	 * @param string $amount Amount.
	 * @return void
	 */
	public function signup( $id, $amount ) {
		$this->signups[ $id ] = array(
			'id'             => $id,
			'amount'         => $amount,
			'event_date_id'  => 1,
			'participant_id' => null,
			'status'         => 'confirmed',
		);
	}

	/**
	 * Add a relationship.
	 *
	 * @param int $id             ID.
	 * @param int $participant_id Participant.
	 * @param int $event_date_id  Event date.
	 * @return void
	 */
	public function relationship( $id, $participant_id, $event_date_id = 1 ) {
		$this->relationships[ $id ] = array(
			'id'             => $id,
			'participant_id' => $participant_id,
			'event_date_id'  => $event_date_id,
			'label'          => 'signed_up',
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $signup_ids IDs.
	 * @return array
	 */
	public function signups( array $signup_ids ) {
		return array_intersect_key( $this->signups, array_flip( $signup_ids ) );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id ID.
	 * @return int[]
	 */
	public function signup_ids_with_latest_transaction( $transaction_id ) {
		return $this->latest[ $transaction_id ] ?? array();
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $relationship_ids IDs.
	 * @return array
	 */
	public function relationships( array $relationship_ids ) {
		return array_intersect_key( $this->relationships, array_flip( $relationship_ids ) );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $relationship_id ID.
	 * @return int|null
	 */
	public function purchase_for_relationship( $relationship_id ) {
		return $this->provenance[ $relationship_id ] ?? null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $event_date_id  Date.
	 * @param int $participant_id Participant.
	 * @return int[]
	 */
	public function active_purchases( $event_date_id, $participant_id ) {
		return $this->active[ $event_date_id . ':' . $participant_id ] ?? array();
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $ticket_id Ticket.
	 * @return int|null
	 */
	public function purchase_for_ticket( $ticket_id ) {
		return $this->tickets[ $ticket_id ] ?? null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id ID.
	 * @return array|null
	 */
	public function transaction_metadata( $transaction_id ) {
		return $this->metadata[ $transaction_id ] ?? null;
	}
}
