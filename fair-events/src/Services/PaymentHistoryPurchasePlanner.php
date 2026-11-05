<?php
/**
 * Which relationships the payment history backfill turns into purchases
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Answers, for the dry run, which relationships the backfill would turn
 * into purchases. PaymentHistoryAdmissions implements it on a site; unit
 * tests pass an in-memory one.
 */
interface PaymentHistoryPurchasePlanner {

	/**
	 * The relationship, when the backfill would create a purchase for it.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return array{id: int, event_date_id: int, participant_id: int}|null
	 */
	public function planned_relationship( $relationship_id );

	/**
	 * A participant's relationships on an event date that the backfill
	 * would turn into purchases.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int[] Relationship IDs.
	 */
	public function planned_relationships_of( $event_date_id, $participant_id );
}
