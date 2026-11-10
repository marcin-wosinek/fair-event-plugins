<?php
/**
 * The purchases a payment notification describes
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Decides which purchases a Connector transaction paid for, so a payment
 * notification names their ticket types, event, purchaser, activities and
 * discounts and nothing from the participant's other purchases (#2250).
 *
 * They come from the transaction's Fair Events payment links
 * (PAYMENT_HISTORY_MIGRATION.md §8.15). When Fair Events can't answer, or
 * the transaction has no links, it names no purchase: never the Audience
 * ledger, the transaction metadata or the latest-attempt pointer (#2251).
 */
class TransactionPurchases {

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
	 * Constructor.
	 *
	 * @param bool     $readers_active   Whether Fair Events' readers answer.
	 * @param callable $linked_purchases fn( int $transaction_id ): object[].
	 */
	public function __construct( $readers_active, callable $linked_purchases ) {
		$this->readers_active   = (bool) $readers_active;
		$this->linked_purchases = $linked_purchases;
	}

	/**
	 * The resolver wired to this site's plugins.
	 *
	 * @return self
	 */
	public static function create() {
		return new self(
			EventsPaymentReaders::active(),
			array( EventsPaymentReaders::class, 'transaction_purchases' )
		);
	}

	/**
	 * The purchases a transaction paid for.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return object[] Each with event_id, event_date_id, participant_id and
	 *                  ticket_type_id; empty when unresolved.
	 */
	public function for_transaction( $transaction_id ) {
		if ( ! $this->readers_active ) {
			return array();
		}

		return array_values( (array) call_user_func( $this->linked_purchases, (int) $transaction_id ) );
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
