<?php
/**
 * The purchases a payment notification describes
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventParticipantTransactionRepository;

defined( 'WPINC' ) || die;

/**
 * Decides which purchases a Connector transaction paid for, so a payment
 * notification names their ticket types, event, purchaser, activities and
 * discounts and nothing from the participant's other purchases.
 *
 * - Fair Events' readers active: the transaction's payment links
 *   (PAYMENT_HISTORY_MIGRATION.md §8.15). The ledger is never read again.
 * - Before that, a get-tickets transaction: the purchases its metadata
 *   names, or for the oldest ones the purchase whose latest attempt it is
 *   (§6.1). Its ledger row only names the participant's relationship for
 *   the date, which keeps the ticket type of whichever purchase confirmed
 *   it first, so a later purchase would show that earlier ticket (#2250).
 * - Before that, any other event transaction: its ledger relationships, as
 *   Fair Audience's own routes create one relationship per purchase.
 *
 * An unresolved get-tickets transaction yields no purchases rather than
 * falling back to the ledger.
 */
class TransactionPurchases {

	const SOURCE_GET_TICKETS = 'fair-events-get-tickets';

	/**
	 * Whether Fair Events' payment readers answer.
	 *
	 * @var bool
	 */
	private $readers_active;

	/**
	 * Transaction ID => purchases from payment links.
	 *
	 * @var callable
	 */
	private $linked_purchases;

	/**
	 * Signup IDs => purchases, or none when any is missing.
	 *
	 * @var callable
	 */
	private $signup_purchases;

	/**
	 * Transaction ID => the signup whose latest attempt it is.
	 *
	 * @var callable
	 */
	private $latest_attempt_signup_ids;

	/**
	 * Transaction ID => ledger relationships.
	 *
	 * @var callable
	 */
	private $ledger_relationships;

	/**
	 * Constructor.
	 *
	 * @param bool     $readers_active            Whether Fair Events' readers answer.
	 * @param callable $linked_purchases          fn( int $transaction_id ): object[].
	 * @param callable $signup_purchases          fn( int[] $signup_ids ): object[].
	 * @param callable $latest_attempt_signup_ids fn( int $transaction_id ): int[].
	 * @param callable $ledger_relationships      fn( int $transaction_id ): object[].
	 */
	public function __construct( $readers_active, callable $linked_purchases, callable $signup_purchases, callable $latest_attempt_signup_ids, callable $ledger_relationships ) {
		$this->readers_active            = (bool) $readers_active;
		$this->linked_purchases          = $linked_purchases;
		$this->signup_purchases          = $signup_purchases;
		$this->latest_attempt_signup_ids = $latest_attempt_signup_ids;
		$this->ledger_relationships      = $ledger_relationships;
	}

	/**
	 * The resolver wired to this site's plugins.
	 *
	 * @return self
	 */
	public static function create() {
		return new self(
			EventsPaymentReaders::active(),
			array( EventsPaymentReaders::class, 'transaction_purchases' ),
			array( EventsPaymentReaders::class, 'metadata_purchases' ),
			array( EventsPaymentReaders::class, 'latest_attempt_signup_ids' ),
			static function ( $transaction_id ) {
				$repository = new EventParticipantRepository();
				$purchases  = array();
				foreach ( ( new EventParticipantTransactionRepository() )->get_event_participant_ids_by_transaction_id( $transaction_id ) as $event_participant_id ) {
					$event_participant = $repository->get_by_id( $event_participant_id );
					if ( $event_participant ) {
						$purchases[] = $event_participant;
					}
				}
				return $purchases;
			}
		);
	}

	/**
	 * The purchases a transaction paid for.
	 *
	 * @param int   $transaction_id Connector transaction ID.
	 * @param array $metadata       Decoded transaction metadata.
	 * @return object[] Each with event_id, event_date_id, participant_id and
	 *                  ticket_type_id; empty when unresolved.
	 */
	public function for_transaction( $transaction_id, array $metadata ) {
		$transaction_id = (int) $transaction_id;

		if ( $this->readers_active ) {
			return array_values( (array) call_user_func( $this->linked_purchases, $transaction_id ) );
		}

		if ( self::SOURCE_GET_TICKETS === ( $metadata['source'] ?? '' ) ) {
			$signup_ids = self::metadata_signup_ids( $metadata );
			if ( null === $signup_ids ) {
				$signup_ids = array_map( 'intval', (array) call_user_func( $this->latest_attempt_signup_ids, $transaction_id ) );
			}
			return $signup_ids ? array_values( (array) call_user_func( $this->signup_purchases, $signup_ids ) ) : array();
		}

		return array_values( (array) call_user_func( $this->ledger_relationships, $transaction_id ) );
	}

	/**
	 * The purchases a get-tickets transaction's metadata names: `signup_ids`
	 * for a shared checkout, else `signup_id`.
	 *
	 * @param array $metadata Decoded transaction metadata.
	 * @return int[]|null Positive signup IDs, possibly none when the keys are
	 *                    malformed; null when the metadata has neither key.
	 */
	public static function metadata_signup_ids( array $metadata ) {
		if ( array_key_exists( 'signup_ids', $metadata ) ) {
			$ids = is_array( $metadata['signup_ids'] ) ? $metadata['signup_ids'] : array();
		} elseif ( array_key_exists( 'signup_id', $metadata ) ) {
			$ids = array( $metadata['signup_id'] );
		} else {
			return null;
		}

		$signup_ids = array();
		foreach ( $ids as $id ) {
			// A malformed entry means the metadata can't be trusted as a whole.
			if ( ! is_numeric( $id ) || (int) $id <= 0 ) {
				return array();
			}
			$signup_ids[ (int) $id ] = (int) $id;
		}

		return array_values( $signup_ids );
	}

	/**
	 * What the purchases share, for the notification fields that name one
	 * thing: the event and the purchaser only when every purchase agrees.
	 *
	 * @param object[] $purchases Resolved purchases.
	 * @return array{event_id: int, participant_id: int, ticket_type_ids: int[]}
	 *               event_id and participant_id are 0 unless shared;
	 *               ticket_type_ids are the distinct types, in order.
	 */
	public static function summary( array $purchases ) {
		$event_ids       = array();
		$participant_ids = array();
		$ticket_type_ids = array();

		foreach ( $purchases as $purchase ) {
			$event_ids[]       = (int) ( $purchase->event_id ?? 0 );
			$participant_ids[] = (int) ( $purchase->participant_id ?? 0 );
			$ticket_type_id    = (int) ( $purchase->ticket_type_id ?? 0 );
			if ( $ticket_type_id > 0 ) {
				$ticket_type_ids[ $ticket_type_id ] = $ticket_type_id;
			}
		}

		return array(
			'event_id'        => self::shared_id( $event_ids ),
			'participant_id'  => self::shared_id( $participant_ids ),
			'ticket_type_ids' => array_values( $ticket_type_ids ),
		);
	}

	/**
	 * The one positive ID every entry has, else 0.
	 *
	 * @param int[] $ids IDs.
	 * @return int
	 */
	private static function shared_id( array $ids ) {
		$unique = array_unique( $ids );

		return 1 === count( $unique ) && reset( $unique ) > 0 ? (int) reset( $unique ) : 0;
	}
}
