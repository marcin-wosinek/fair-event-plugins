<?php
/**
 * Fair Events payment readers, as Fair Audience uses them
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Reads purchase payments from Fair Events once its readers are active
 * (PAYMENT_HISTORY_MIGRATION.md §8.15): the participant's purchase payment
 * history and the purchases a transaction pays for, from payment links
 * instead of this plugin's ledger.
 *
 * Every check is a capability check, so an older Fair Events, or one whose
 * readers aren't active yet, leaves the ledger readers in place. Once the
 * readers are active the ledger is never read for these again, whatever
 * plugin is later missing (§8.5).
 */
class EventsPaymentReaders {

	/**
	 * Whether Fair Events' payment readers answer.
	 *
	 * @return bool
	 */
	public static function active() {
		$readers = 'FairEvents\\Services\\PaymentHistoryReaders';
		$history = 'FairEvents\\Services\\PurchasePaymentHistory';

		return class_exists( $readers )
			&& method_exists( $readers, 'active' )
			&& class_exists( $history )
			&& method_exists( $history, 'participant_purchases' )
			&& method_exists( $history, 'purchases_for_transactions' )
			&& true === $readers::active();
	}

	/**
	 * The participant's purchases, as the purchaser, with every payment.
	 *
	 * @param int $participant_id Participant ID.
	 * @return array{payment_information: string, purchases: array[]}
	 */
	public static function participant_purchases( $participant_id ) {
		return \FairEvents\Services\PurchasePaymentHistory::participant_purchases( (int) $participant_id );
	}

	/**
	 * What a transaction pays for, for notifications: one entry per linked
	 * purchase, shaped like the relationship fields the enrichment reads.
	 * Activities are the purchase's own ticket activities. A link to a
	 * purchase that no longer exists leaves the transaction unresolved, so
	 * the result is empty rather than naming only some of its purchases.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return object[] event_id, event_date_id, participant_id (the
	 *                  purchaser), ticket_type_id, role, activity_rows.
	 */
	public static function transaction_purchases( $transaction_id ) {
		$transaction_id = (int) $transaction_id;
		$links          = \FairEvents\Services\PurchasePaymentHistory::purchases_for_transactions( array( $transaction_id ) )[ $transaction_id ] ?? array();

		$roles = array();
		foreach ( $links as $link ) {
			if ( 'legacy_refund_record' === $link['role'] || isset( $roles[ (int) $link['signup_id'] ] ) ) {
				continue;
			}
			$roles[ (int) $link['signup_id'] ] = (string) $link['role'];
		}

		return self::signup_purchases( $roles );
	}

	/**
	 * The purchases a get-tickets transaction's metadata names, before
	 * Fair Events' readers are active. The Audience ledger only names the
	 * participant's relationship for the date, which every purchase they
	 * make for it shares, so it can't tell which purchase (and ticket type)
	 * this transaction paid for (PAYMENT_HISTORY_MIGRATION.md §6.1).
	 *
	 * @param int[] $signup_ids Signup IDs from the transaction metadata.
	 * @return object[] As transaction_purchases(); empty when Fair Events
	 *                  is unavailable or any purchase is missing.
	 */
	public static function metadata_purchases( array $signup_ids ) {
		if ( ! class_exists( \FairEvents\Models\EventSignup::class ) ) {
			return array();
		}

		$roles = array();
		foreach ( $signup_ids as $signup_id ) {
			$roles[ (int) $signup_id ] = 'charge';
		}

		return self::signup_purchases( $roles );
	}

	/**
	 * The single purchase whose latest attempt is the transaction: the
	 * evidence for the oldest get-tickets transactions, whose metadata
	 * names no purchase (PAYMENT_HISTORY_MIGRATION.md §6.1).
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return int[] One signup ID, or none.
	 */
	public static function latest_attempt_signup_ids( $transaction_id ) {
		if ( ! class_exists( \FairEvents\Models\EventSignup::class ) ) {
			return array();
		}

		$signup = \FairEvents\Models\EventSignup::get_by_transaction_id( (int) $transaction_id );

		return $signup ? array( (int) $signup->id ) : array();
	}

	/**
	 * One entry per purchase, or none when any purchase is missing.
	 *
	 * @param array<int, string> $roles Payment role, keyed by signup ID.
	 * @return object[]
	 */
	private static function signup_purchases( array $roles ) {
		$subjects = array();
		foreach ( $roles as $signup_id => $role ) {
			$signup = $signup_id > 0 ? \FairEvents\Models\EventSignup::get_by_id( (int) $signup_id ) : null;
			if ( ! $signup ) {
				return array();
			}
			$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $signup->event_date_id );
			$tickets    = \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id );
			$activities = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $tickets, 'id' ) );

			$rows = array();
			foreach ( $tickets as $ticket ) {
				foreach ( $activities[ (int) $ticket->id ] ?? array() as $activity ) {
					$rows[] = (object) array(
						'ticket_option_id'   => (int) $activity->ticket_option_id,
						'ticket_option_name' => (string) $activity->ticket_option_name,
					);
				}
			}

			$subjects[] = (object) array(
				'event_id'       => $event_date ? (int) $event_date->event_id : 0,
				'event_date_id'  => (int) $signup->event_date_id,
				'participant_id' => (int) ( $signup->participant_id ?? 0 ),
				'ticket_type_id' => (int) ( $signup->ticket_type_id ?? 0 ),
				'role'           => (string) $role,
				'activity_rows'  => $rows,
			);
		}
		return $subjects;
	}
}
