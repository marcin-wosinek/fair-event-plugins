<?php
/**
 * Transaction Participant Link
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventParticipantTransactionRepository;
use FairAudience\Database\ParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Links a get-tickets transaction to the participant its signups record.
 *
 * The payment list reads the transaction's own participant_id; participant
 * activity reads the event-participant transaction ledger. Both are filled
 * from the persisted signup rows the transaction pays for, and only when
 * every one of them names the same participant — never from an email match.
 * A transaction already linked to another participant, or recorded against
 * another participant's registration, is left as it is.
 *
 * Safe to repeat: the participant link is only written while empty, and
 * ledger rows are unique per registration and transaction.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TransactionParticipantLink {

	/**
	 * The transaction and ledger now name the signups' participant.
	 */
	const LINKED = 'linked';

	/**
	 * The transaction already belongs to another participant.
	 */
	const CONFLICT = 'conflict';

	/**
	 * The signups do not establish one participant, or are missing.
	 */
	const AMBIGUOUS = 'ambiguous';

	/**
	 * Whether fair-events' signups and the payments table are available.
	 *
	 * @return bool
	 */
	public static function available() {
		return class_exists( \FairEvents\Models\EventSignup::class )
			&& class_exists( \FairPaymentsConnector\Database\Schema::class );
	}

	/**
	 * The one participant a set of signup rows establishes: every row must
	 * name a participant, and all the same one.
	 *
	 * @param object[] $signups Signup rows (each with participant_id).
	 * @return int Participant ID, or 0 when none or several are named.
	 */
	public static function participant_for_signups( array $signups ) {
		if ( empty( $signups ) ) {
			return 0;
		}

		$participant_ids = array();
		foreach ( $signups as $signup ) {
			$participant_id = (int) ( $signup->participant_id ?? 0 );
			if ( ! $participant_id ) {
				return 0;
			}
			$participant_ids[ $participant_id ] = true;
		}

		return 1 === count( $participant_ids ) ? (int) array_key_first( $participant_ids ) : 0;
	}

	/**
	 * Load signup rows by ID.
	 *
	 * @param int[] $signup_ids Signup row IDs.
	 * @return object[]|null Rows, or null when any of them is missing.
	 */
	public static function load_signups( array $signup_ids ) {
		$signup_ids = array_values( array_unique( array_filter( array_map( 'intval', $signup_ids ) ) ) );
		if ( empty( $signup_ids ) ) {
			return null;
		}

		$signups = array();
		foreach ( $signup_ids as $signup_id ) {
			$signup = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
			if ( ! $signup ) {
				return null;
			}
			$signups[] = $signup;
		}

		return $signups;
	}

	/**
	 * Link a transaction to the participant its signups record, and record
	 * it against that participant's registration on each signup's date.
	 *
	 * @param int   $transaction_id fair-payments-connector transaction ID.
	 * @param int[] $signup_ids     Signup rows the transaction pays for.
	 * @return string One of the LINKED, CONFLICT or AMBIGUOUS constants.
	 */
	public static function link( $transaction_id, array $signup_ids ) {
		global $wpdb;

		$transaction_id = (int) $transaction_id;
		$signups        = self::load_signups( $signup_ids );
		$participant_id = $signups ? self::participant_for_signups( $signups ) : 0;

		if ( ! $transaction_id || ! $participant_id || ! ( new ParticipantRepository() )->get_by_id( $participant_id ) ) {
			return self::AMBIGUOUS;
		}

		$ledger = new EventParticipantTransactionRepository();
		foreach ( $ledger->get_participant_ids_for_transaction( $transaction_id ) as $ledger_participant_id ) {
			if ( $ledger_participant_id !== $participant_id ) {
				return self::CONFLICT;
			}
		}

		$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();

		// Only fills an empty link, so a participant set meanwhile — by a
		// concurrent callback or anyone else — is never replaced.
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET participant_id = %d WHERE id = %d AND participant_id IS NULL',
				$table,
				$participant_id,
				$transaction_id
			)
		);

		$linked_participant_id = $wpdb->get_var(
			$wpdb->prepare( 'SELECT participant_id FROM %i WHERE id = %d', $table, $transaction_id )
		);
		if ( null === $linked_participant_id ) {
			return self::AMBIGUOUS;
		}
		if ( (int) $linked_participant_id !== $participant_id ) {
			return self::CONFLICT;
		}

		$relationships = new EventParticipantRepository();
		foreach ( $signups as $signup ) {
			$relationship = $relationships->get_by_event_date_and_participant( (int) $signup->event_date_id, $participant_id );
			if ( $relationship ) {
				$ledger->record( (int) $relationship->id, $transaction_id, 'charge' );
			}
		}

		return self::LINKED;
	}
}
