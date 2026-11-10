<?php
/**
 * Tests for the purchases a payment notification describes.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\TransactionPurchases;
use PHPUnit\Framework\TestCase;

/**
 * Covers TransactionPurchases (#2250, #2251).
 */
class TransactionPurchasesTest extends TestCase {

	/**
	 * Transaction IDs the payment-link lookup was called with.
	 *
	 * @var int[]
	 */
	private $linked_calls = array();

	/**
	 * A resolver whose payment-link lookup records its calls.
	 *
	 * @param bool     $readers_active Whether Fair Events' readers answer.
	 * @param object[] $linked         Purchases the payment links name.
	 * @return TransactionPurchases
	 */
	private function resolver( $readers_active, array $linked ) {
		$this->linked_calls = array();

		return new TransactionPurchases(
			$readers_active,
			function ( $transaction_id ) use ( $linked ) {
				$this->linked_calls[] = $transaction_id;
				return $linked;
			}
		);
	}

	/**
	 * A purchase row.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @param int $participant_id Purchaser.
	 * @param int $event_id       Event post ID.
	 * @return object
	 */
	private static function purchase( $ticket_type_id, $participant_id = 19, $event_id = 71 ) {
		return (object) array(
			'event_id'       => $event_id,
			'event_date_id'  => 1,
			'participant_id' => $participant_id,
			'ticket_type_id' => $ticket_type_id,
			'activity_rows'  => array(),
		);
	}

	/**
	 * The payment links name the purchases a transaction paid for.
	 *
	 * @return void
	 */
	public function test_payment_links_name_the_purchases() {
		$linked = array( self::purchase( 20 ) );

		$this->assertSame( $linked, $this->resolver( true, $linked )->for_transaction( 80 ) );
		$this->assertSame( array( 80 ), $this->linked_calls );
	}

	/**
	 * A transaction without payment links names no purchase.
	 *
	 * @return void
	 */
	public function test_transaction_without_links_resolves_nothing() {
		$this->assertSame( array(), $this->resolver( true, array() )->for_transaction( 80 ) );
	}

	/**
	 * Without Fair Events' readers nothing is named, and nothing is looked up.
	 *
	 * @return void
	 */
	public function test_unavailable_readers_resolve_nothing() {
		$purchases = $this->resolver( false, array( self::purchase( 20 ) ) )->for_transaction( 80 );

		$this->assertSame( array(), $purchases );
		$this->assertSame( array(), $this->linked_calls );
	}

	/**
	 * A shared checkout names every purchase; each ticket type is listed once.
	 *
	 * @return void
	 */
	public function test_shared_checkout_lists_every_purchase() {
		$purchases = $this->resolver(
			true,
			array(
				self::purchase( 20 ),
				self::purchase( 21 ),
				self::purchase( 20 ),
			)
		)->for_transaction( 81 );

		$summary = TransactionPurchases::summary( $purchases );
		$this->assertSame( array( 20, 21 ), $summary['ticket_type_ids'] );
		$this->assertSame( 71, $summary['event_id'] );
		$this->assertSame( 19, $summary['participant_id'] );
	}

	/**
	 * The event and purchaser are named only when every purchase agrees;
	 * purchases without a ticket type add no label.
	 *
	 * @return void
	 */
	public function test_summary_names_only_what_every_purchase_shares() {
		$summary = TransactionPurchases::summary(
			array(
				self::purchase( 20, 19, 71 ),
				self::purchase( 0, 61, 72 ),
			)
		);

		$this->assertSame(
			array(
				'event_id'        => 0,
				'participant_id'  => 0,
				'ticket_type_ids' => array( 20 ),
			),
			$summary
		);

		$this->assertSame(
			array(
				'event_id'        => 0,
				'participant_id'  => 0,
				'ticket_type_ids' => array(),
			),
			TransactionPurchases::summary( array() )
		);
	}
}
