<?php
/**
 * Lookups behind payment attribution
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * The records PaymentAttribution reads to decide which purchases a Connector
 * transaction belongs to. PaymentAttributionDatabase reads them from the
 * site; unit tests pass an in-memory implementation.
 */
interface PaymentAttributionSources {

	/**
	 * Purchases by ID. Missing IDs are left out.
	 *
	 * @param int[] $signup_ids Signup IDs.
	 * @return array<int, array{id: int, amount: string, event_date_id: int, participant_id: int|null, status: string}>
	 */
	public function signups( array $signup_ids );

	/**
	 * Purchases whose latest attempt (signup.transaction_id) is the transaction.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return int[]
	 */
	public function signup_ids_with_latest_transaction( $transaction_id );

	/**
	 * Audience ledger rows naming the transaction.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array[] Each: event_participant_id, kind.
	 */
	public function ledger_rows( $transaction_id );

	/**
	 * Audience relationships by ID. Missing IDs are left out.
	 *
	 * @param int[] $relationship_ids Relationship IDs.
	 * @return array<int, array{id: int, participant_id: int, event_date_id: int, label: string}>
	 */
	public function relationships( array $relationship_ids );

	/**
	 * The purchase that names the relationship as its provenance.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int|null Signup ID.
	 */
	public function purchase_for_relationship( $relationship_id );

	/**
	 * A participant's active purchases (confirmed, or pending payment within
	 * its hold) on an event date.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int[] Signup IDs.
	 */
	public function active_purchases( $event_date_id, $participant_id );

	/**
	 * The purchase that owns a ticket unit.
	 *
	 * @param int $ticket_id Ticket ID.
	 * @return int|null Signup ID.
	 */
	public function purchase_for_ticket( $ticket_id );

	/**
	 * Another transaction's metadata, for retry chains.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null Metadata, or null when the transaction doesn't exist.
	 */
	public function transaction_metadata( $transaction_id );
}
